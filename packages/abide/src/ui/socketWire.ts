// 18.2 — A SOCKET, AS A BROWSER HOLDS IT. What a page imported as `chat` is, in the bundle,
// `socketWire('/__abide/socket/chat')`: a call per args handing back a subscriber's copy, fed over the
// one web socket every socket on the page shares.
//
// THE COPY IS BUSY UNTIL ITS FIRST PRODUCTION ARRIVES (9.29), and each production after it lands
// through the copy's own `publish`, numbered by the owner rather than by the copy (9.14): the owner's
// sequence number and epoch are held beside it for a reconnect to resume from (18.13). A publish the
// page makes is sent to the owner rather than applied here — it arrives back as a production like any
// other, once the owner has taken it (18.6).
//
// NOT HERE YET: 18.15's reset of a `{#for}` over the copy, which is the compiler's; a reset here
// publishes the owner's ring into the copy.

import { ABIDE_ADDRESS, SOCKET_ADDRESS } from '#shared/ADDRESSES.ts'
import { failed, isFailedNamed } from '#shared/Failed.ts'
import { canonicalKey } from '#shared/reactive/canonicalKey.ts'
import { type Reactive, reactive } from '#shared/reactive/index.ts'
import type { BrowserFrame, ServerFrame } from '#shared/socket.ts'
import { applyPatch } from './applyPatch.ts'
import { HYDRATE_LOG } from './Mismatch.ts'

/** How many productions a subscriber's copy retains for a cursor to replay. */
const COPY_HISTORY = 100
const RETRY_FLOOR_MS = 250
const RETRY_CEILING_MS = 10_000

/** A socket subscribed: an owner-numbered log (9.14), resumed from where it stood (18.13). */
class Subscription {
    id: number
    address: string
    args: unknown
    copy: Reactive<unknown>
    publish: (value: unknown) => unknown
    first: ((value: unknown) => void) | null
    refuse: ((error: unknown) => void) | null
    seq: number | undefined
    epoch: string | undefined

    /**
     * 9.29 — BUSY UNTIL THE FIRST PRODUCTION ARRIVES, which settles the value it was built over.
     */
    constructor(id: number, address: string, args: unknown) {
        this.id = id
        this.address = address
        this.args = args
        const settled = Promise.withResolvers<unknown>()
        this.first = settled.resolve
        this.refuse = settled.reject
        this.copy = reactive<unknown>(settled.promise, {
            history: COPY_HISTORY,
        }) as Reactive<unknown>
        this.publish = this.copy.publish
        this.seq = undefined
        this.epoch = undefined
    }

    frame(): BrowserFrame {
        return {
            op: 'sub',
            id: this.id,
            address: this.address,
            args: this.args,
            seq: this.seq,
            epoch: this.epoch,
        }
    }

    receive(frame: ServerFrame): void {
        if (frame.op === 'error') {
            const error = frame.error
            const refusal =
                error === undefined
                    ? undefined
                    : failed(
                          error.name,
                          error.status,
                          error.message,
                          error.data,
                      )
            if (this.refuse !== null) {
                this.refuse(refusal)
                this.first = null
                this.refuse = null
            } else HYDRATE_LOG.warning('a socket refused', refusal)
            return
        }
        this.epoch = frame.epoch
        if (frame.op === 'reset') {
            for (const [seq, value] of frame.ring ?? []) {
                this.seq = seq
                this.deliver(value)
            }
            return
        }
        this.seq = frame.seq
        this.deliver(frame.value)
    }

    deliver(value: unknown): void {
        if (this.first !== null) {
            this.first(value)
            this.first = null
            this.refuse = null
            return
        }
        this.publish.call(this.copy, value)
    }
}

/**
 * A handler followed over the socket mux, its copy the `Rpc`'s entry for these args.
 *
 * 18.17 — beside the sockets on the same mux. The copy is reached through `entry` — a lookup by
 * then, the follow starting once it has loaded. STATE, NOT A LOG: it names the version it holds
 * (18.24) and takes whatever value it is sent (18.25).
 */
class Following {
    id: number
    address: string
    args: unknown
    version: number | undefined
    entry: () => unknown
    expiry: ReturnType<typeof setTimeout> | undefined

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
    }

    /**
     * Marks the copy stale when the answer's `max-age` runs out.
     *
     * 18.29 — the `max-age` is what is left of the production's own life on the server (21.8).
     * Stale rather than dropped: it goes on being served until a read runs the producer (7.17). The
     * later answer's timer replaces the earlier.
     */
    expireAfter(life: string | null | undefined): void {
        clearTimeout(this.expiry)
        // `max-age=0` is a life the server rounded down to nothing, and stale now — only an answer
        // with no `max-age` at all is bounded by `invalidate` alone (21.17).
        const seconds = /max-age=(\d+)/.exec(life ?? '')?.[1]
        this.expiry =
            seconds === undefined
                ? undefined
                : setTimeout(
                      () => (this.entry() as Reactive<unknown>).invalidate(),
                      Number(seconds) * 1000,
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
            copy.publish(frame.value)
        } else if (frame.op === 'patch') {
            // 18.27 — WRITES MADE OVER ANOTHER VERSION WOULD LAND SOMEWHERE ELSE, so the copy reads
            // the value again instead, and the answer's version puts it back in step (18.24).
            if (this.version !== frame.base) copy.refresh()
            else {
                this.version = frame.version
                copy.patch((value) => applyPatch(value, frame.ops ?? []))
            }
        } else if (frame.op === 'invalidate') copy.invalidate()
        else if (frame.op === 'refresh') copy.refresh()
        else if (frame.op === 'error')
            HYDRATE_LOG.warning('a handler refused to be followed', frame.error)
    }
}

/** One web socket carrying every socket and followed handler under one address. */
class Mux {
    url: string
    socket: WebSocket | null
    subscriptions: Map<number, Subscription | Following>
    pending: string[]
    nextId: number
    retry: number

    constructor(url: string) {
        this.url = url
        this.socket = null
        this.subscriptions = new Map()
        this.pending = []
        this.nextId = 1
        this.retry = RETRY_FLOOR_MS
    }

    send(frame: BrowserFrame): void {
        const text = JSON.stringify(frame)
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(text)
        else {
            this.pending.push(text)
            this.connect()
        }
    }

    /**
     * Registers a subscription and sends it, opening the socket where it is not open.
     *
     * A subscription is never queued: `onopen` sends every one standing, so one registered before
     * the socket opens goes out with them.
     */
    subscribe(subscription: Subscription | Following): void {
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
            // 18.13 — every subscription again, carrying where it stood.
            for (const each of this.subscriptions.values())
                socket.send(JSON.stringify(each.frame()))
            const queued = this.pending
            this.pending = []
            for (const text of queued) socket.send(text)
        }
        // THE CLOSE THAT FOLLOWS IS WHAT RETRIES; an error left unhandled is only noise on top of it.
        socket.onerror = () => {}
        socket.onmessage = (event) =>
            this.receive(JSON.parse(String(event.data)) as ServerFrame)
        socket.onclose = () => {
            this.socket = null
            if (this.subscriptions.size === 0) return
            setTimeout(() => this.connect(), this.retry)
            this.retry = Math.min(this.retry * 2, RETRY_CEILING_MS)
        }
    }

    receive(frame: ServerFrame): void {
        this.subscriptions.get(frame.id)?.receive(frame)
    }
}

const MUXES = new Map<string, Mux>()

/**
 * The mux a socket's or a handler's address is carried over, made on first use.
 *
 * `SOCKET_ADDRESS` under whatever the address stands below, so an app under a sub-path opens its
 * own.
 */
function muxFor(address: string): Mux {
    const below = address.indexOf(ABIDE_ADDRESS)
    const path = `${below === -1 ? '' : address.slice(0, below)}${SOCKET_ADDRESS}`
    const url = new URL(path, location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    let mux = MUXES.get(url.href)
    if (mux === undefined) {
        mux = new Mux(url.href)
        MUXES.set(url.href, mux)
    }
    return mux
}

/** The browser's socket for `address`: a call per args answering a subscriber's copy. */
export function socketWire(address: string): unknown {
    const copies = new Map<string, Reactive<unknown>>()
    const call = (args?: unknown): Reactive<unknown> => {
        const key = canonicalKey(args)
        const standing = copies.get(key)
        if (standing !== undefined) return standing
        const mux = muxFor(address)
        const subscription = new Subscription(mux.nextId++, address, args)
        const copy = subscription.copy
        // 18.6 — A PUBLISH FROM HERE GOES TO THE OWNER, which admits it or refuses it; what it admits
        // comes back as a production.
        copy.publish = (message) => {
            mux.send({ op: 'pub', id: subscription.id, address, args, message })
            return subscription.seq ?? 0
        }
        copies.set(key, copy)
        mux.subscribe(subscription)
        return copy
    }
    return Object.assign(call, { address, isError: isFailedNamed })
}

/**
 * The follow standing per handler and args, one for the life of the page.
 *
 * One however often the entry loads. A later answer names a later version, which is what a
 * reconnect then names (18.24).
 */
const FOLLOWING = new Map<string, Following>()

/** Follows a loaded `GET`'s copy over the mux, raising its version and resetting its expiry. */
export function followRpc(
    address: string,
    args: unknown,
    version: string | null | undefined,
    life: string | null | undefined,
    entry: () => unknown,
): void {
    const key = `${address} ${canonicalKey(args)}`
    const named =
        version === null || version === undefined ? undefined : Number(version)
    let following = FOLLOWING.get(key)
    if (following === undefined) {
        const mux = muxFor(address)
        following = new Following(mux.nextId++, address, args, named, entry)
        FOLLOWING.set(key, following)
        mux.subscribe(following)
    } else if (named !== undefined && (following.version ?? 0) < named)
        // 18.22 — versions only rise, so the larger is the later.
        following.version = named
    following.expireAfter(life)
}
