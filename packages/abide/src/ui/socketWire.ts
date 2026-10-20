// 18.1 — THE MUX, AS A BROWSER HOLDS IT: one web socket per page, over which every `GET` the page
// reads is followed (18.3). Each copy is kept in step with the value it was answered from: the value
// where the version it holds is not the server's, and the writes of each patch over it (18.6, 18.11).

import { SOCKET_ADDRESS } from '#shared/ADDRESSES.ts'
import { mounted } from '#shared/mount.ts'
import { canonicalKey } from '#shared/reactive/canonicalKey.ts'
import {
    heldGenerationOf,
    loadOf,
    type Reactive,
} from '#shared/reactive/index.ts'
import { PATCHES } from '#shared/reactive/PATCHES.ts'
import type { BrowserFrame, ServerFrame } from '#shared/muxFrames.ts'
import { applyPatch } from '#shared/applyPatch.ts'
import { onPrincipalRotated } from '#shared/principalRotated.ts'
import { HYDRATE_LOG } from './Mismatch.ts'

const RETRY_FLOOR_MS = 250
const RETRY_CEILING_MS = 10_000

/**
 * A handler followed over the socket mux, its copy the `Rpc`'s entry for these args.
 *
 * 18.3 — beside the sockets on the same mux. The copy is reached through `entry` — a lookup by
 * then, the follow starting once it has loaded. STATE, NOT A LOG: it names the version it holds
 * (18.9) and takes whatever value it is sent (18.10).
 */
class Following {
    id: number
    address: string
    args: unknown
    version: number | undefined
    entry: () => unknown
    expiry: ReturnType<typeof setTimeout> | undefined
    // 18.21 — WHERE THE COPY WAS LAST IN STEP: the generation it stood at, which a `set` or a new
    // load moves, and the patch epoch then, which a local `s.patch` writes past on what it holds.
    generation: number | undefined
    epoch: number

    constructor(
        id: number,
        address: string,
        args: unknown,
        version: number | undefined,
        entry: () => unknown,
    ) {
        this.id = id
        this.address = address
        this.args = args
        this.version = version
        this.entry = entry
        this.expiry = undefined
        this.generation = undefined
        this.epoch = 0
    }

    /** Marks the copy in step as it stands, its load in flight included. */
    inStep(): void {
        const copy = this.entry()
        this.generation = loadOf(copy) ?? heldGenerationOf(copy)
        this.epoch = PATCHES.epoch
    }

    /** Whether the copy was written to since it was last in step. 18.21. */
    diverged(copy: unknown): boolean {
        if (heldGenerationOf(copy) !== this.generation) return true
        const held = (copy as Reactive<unknown>).peek()
        return (
            held !== null &&
            typeof held === 'object' &&
            (PATCHES.written.get(held) ?? 0) > this.epoch
        )
    }

    /**
     * Marks the copy stale once `lifeMs` runs out.
     *
     * 18.14 — the life is what is left of the production's own on the server (21.8). Stale rather
     * than dropped: it goes on being served until a read or a probe runs the producer (7.17). The
     * later answer's timer replaces the earlier, and an answer naming no life is bounded by
     * `invalidate` alone (21.17).
     */
    expireAfter(lifeMs: number | undefined): void {
        clearTimeout(this.expiry)
        this.expiry =
            lifeMs === undefined
                ? undefined
                : setTimeout(
                      () => (this.entry() as Reactive<unknown>).invalidate(),
                      lifeMs,
                  )
    }

    frame(): BrowserFrame {
        return {
            op: 'sub',
            id: this.id,
            address: this.address,
            args: this.args,
            version: this.version,
        }
    }

    receive(frame: ServerFrame): void {
        const copy = this.entry() as Reactive<unknown>
        if (frame.op === 'value') {
            this.version = frame.version
            copy.set(frame.value)
            this.inStep()
        } else if (frame.op === 'patch') {
            // 18.12 — WRITES MADE OVER ANOTHER VERSION WOULD LAND SOMEWHERE ELSE, and 18.21 over a
            // copy written to here, so the copy reads the value again instead, and the answer's
            // version puts it back in step (18.9).
            if (this.version !== frame.base || this.diverged(copy))
                copy.refresh()
            else {
                this.version = frame.version
                copy.patch((value) => applyPatch(value, frame.ops ?? []))
                this.inStep()
            }
        } else if (frame.op === 'invalidate') copy.invalidate()
        else if (frame.op === 'refresh') copy.refresh()
        else if (frame.op === 'error')
            HYDRATE_LOG.warning('a handler refused to be followed', frame.error)
    }
}

/** One web socket carrying every followed `GET` under one address. */
class Mux {
    url: string
    socket: WebSocket | null
    subscriptions: Map<number, Following>
    nextId: number
    retry: number
    retrying: ReturnType<typeof setTimeout> | undefined

    constructor(url: string) {
        this.url = url
        this.socket = null
        this.subscriptions = new Map()
        this.nextId = 1
        this.retry = RETRY_FLOOR_MS
        this.retrying = undefined
        onPrincipalRotated(() => this.reopen(), true)
        // 18.33 — THE BACKOFF IS FOR A SERVER THAT IS DOWN, not for a network that has just come
        // back or a tab whose timers the browser was throttling while it was hidden.
        addEventListener('online', () => this.redial())
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.redial()
        })
    }

    /** Opens a closed socket now, in place of the retry waiting out its backoff. */
    redial(): void {
        if (this.socket !== null || this.subscriptions.size === 0) return
        clearTimeout(this.retrying)
        this.retrying = undefined
        this.retry = RETRY_FLOOR_MS
        this.connect()
    }

    /**
     * Opens the socket again, so its upgrade carries the cookie as it now stands: a connection is
     * answered as the caller it opened as (18.16), and a sign-in or sign-out has changed who that is.
     */
    reopen(): void {
        const socket = this.socket
        if (socket === null) return
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.close()
        this.socket = null
        if (this.subscriptions.size !== 0) this.connect()
    }

    /**
     * Registers a subscription and sends it, opening the socket where it is not open.
     *
     * A subscription is never queued: `onopen` sends every one standing, so one registered before
     * the socket opens goes out with them.
     */
    subscribe(subscription: Following): void {
        this.subscriptions.set(subscription.id, subscription)
        if (this.socket?.readyState === WebSocket.OPEN)
            this.socket.send(JSON.stringify(subscription.frame()))
        else this.connect()
    }

    connect(): void {
        if (this.socket !== null) return
        const socket = new WebSocket(this.url)
        this.socket = socket
        socket.onopen = () => {
            this.retry = RETRY_FLOOR_MS
            // Every subscription again, carrying the version it holds (18.9).
            for (const each of this.subscriptions.values())
                socket.send(JSON.stringify(each.frame()))
        }
        // THE CLOSE THAT FOLLOWS IS WHAT RETRIES; an error left unhandled is only noise on top of it.
        socket.onerror = () => {}
        socket.onmessage = (event) =>
            this.receive(JSON.parse(String(event.data)) as ServerFrame)
        socket.onclose = () => {
            this.socket = null
            if (this.subscriptions.size === 0) return
            this.retryLater()
        }
    }

    /**
     * Arms the next attempt at the backoff standing, and doubles it.
     *
     * 18.34 — OFFLINE, AN ATTEMPT CANNOT SUCCEED, so none is armed: the `online` event's `redial`
     * makes the next one.
     */
    retryLater(): void {
        if (!navigator.onLine) return
        this.retrying = setTimeout(() => {
            this.retrying = undefined
            this.connect()
        }, this.retry)
        this.retry = Math.min(this.retry * 2, RETRY_CEILING_MS)
    }

    receive(frame: ServerFrame): void {
        this.subscriptions.get(frame.id)?.receive(frame)
    }
}

// Exported for a test to forget: a page never does, and a test process outlives one.
export const MUXES = new Map<string, Mux>()

/**
 * The mux a handler's address is carried over, made on first use.
 *
 * `SOCKET_ADDRESS` under the app's mount, so an app under a sub-path opens its own — at the
 * address's own origin where it names one, and the page's where it is a path.
 */
function muxFor(address: string): Mux {
    const url = new URL(
        mounted(SOCKET_ADDRESS),
        URL.canParse(address) ? address : location.href,
    )
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let mux = MUXES.get(url.href)
    if (mux === undefined) {
        mux = new Mux(url.href)
        MUXES.set(url.href, mux)
    }
    return mux
}

/**
 * The follow standing per handler and args, one for the life of the page.
 *
 * One however often the entry loads. A later answer names a later version, which is what a
 * reconnect then names (18.9).
 */
const FOLLOWING = new Map<string, Following>()

/**
 * Follows a loaded `GET`'s copy over the mux, raising its version and resetting its expiry.
 *
 * `version` and `lifeMs` are what the answer named, read off its headers by the wire.
 */
export function followRpc(
    address: string,
    args: unknown,
    version: number | undefined,
    lifeMs: number | undefined,
    entry: () => unknown,
): void {
    const key = `${address} ${canonicalKey(args)}`
    let following = FOLLOWING.get(key)
    if (following === undefined) {
        const mux = muxFor(address)
        following = new Following(mux.nextId++, address, args, version, entry)
        FOLLOWING.set(key, following)
        mux.subscribe(following)
    } else if (version !== undefined && (following.version ?? 0) < version)
        // 18.7 — versions only rise, so the larger is the later.
        following.version = version
    // IN STEP AS THE ANSWER THIS FOLLOWS LANDS, at its load's generation. A turn later rather than
    // now: an answer that had already arrived lands while its entry is still being built, and a reach
    // of the entry from here would build a second one, which fetches.
    const stepping = following
    queueMicrotask(() => stepping.inStep())
    following.expireAfter(lifeMs)
}
