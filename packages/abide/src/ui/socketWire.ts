// 18.1 — THE MUX, AS A BROWSER HOLDS IT: one web socket per page, over which every `GET` the page
// reads is followed (18.3). Each copy is kept in step with the value it was answered from: the value
// where the version it holds is not the server's, and the writes of each patch over it (18.6, 18.11).

import { SOCKET_ADDRESS } from '#shared/ADDRESSES.ts'
import { type Answer, answerFrom, noAnswer } from '#shared/answerOf.ts'
import { applyPatch } from '#shared/applyPatch.ts'
import { mounted } from '#shared/mount.ts'
import type { BrowserFrame, ServerFrame } from '#shared/muxFrames.ts'
import { onPrincipalRotated } from '#shared/principalRotated.ts'
import { canonicalKey } from '#shared/reactive/argsContract.ts'
import { type Reactive } from '#shared/reactive/index.ts'
import { patchEpoch, writtenSince } from '#shared/reactive/patchMarks.ts'
import {
    heldGenerationOf,
    loadOf,
    patchInto,
    produceInto,
    writtenLocally,
} from '#shared/reactive/producer.ts'

import { Backoff } from './Backoff.ts'
import { HYDRATE_LOG } from './Mismatch.ts'
import { undelivered, whenDelivered } from './outboxQueue.ts'

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
        this.epoch = patchEpoch()
    }

    /** Whether the copy was written to since it was last in step. 18.21. */
    diverged(copy: unknown): boolean {
        if (heldGenerationOf(copy) !== this.generation) return true
        return writtenSince((copy as Reactive<unknown>).peek(), this.epoch)
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
        // 18.35 — A COPY WRITTEN HERE WAITS OUT THE CALLS THAT WROTE IT: what the server sends before
        // they are delivered is the value without them, and taking it would undo what is on screen.
        if (
            (frame.op === 'value' || frame.op === 'patch') &&
            writtenLocally(copy) &&
            undelivered() !== 0
        )
            return
        if (frame.op === 'value') {
            this.version = frame.version
            // 18.10 — the server's value is the copy's producer's, not a write made here (3.11).
            produceInto(copy, frame.value)
            this.inStep()
        } else if (frame.op === 'patch') {
            // 18.12 — WRITES MADE OVER ANOTHER VERSION WOULD LAND SOMEWHERE ELSE, and 18.21 over a
            // copy written to here, so the copy reads the value again instead, and the answer's
            // version puts it back in step (18.9).
            if (this.version !== frame.base || this.diverged(copy))
                copy.refresh()
            else {
                this.version = frame.version
                patchInto(copy, (value) => applyPatch(value, frame.ops ?? []))
                this.inStep()
            }
        } else if (frame.op === 'invalidate') copy.invalidate()
        else if (frame.op === 'refresh') copy.refresh()
        else if (frame.op === 'error')
            HYDRATE_LOG.warning('a handler refused to be followed', frame.error)
    }
}

const ENCODER = new TextEncoder()

/**
 * A streaming `GET`'s call read over the mux, as the http answer it stands in for is read: settled
 * with its head as an `Answer`, whose body is then fed the text each `lines` frame carries.
 *
 * 16.93. `undefined` is the call sent back to http (`MuxStream`'s `http`).
 */
class MuxStream {
    id: number
    url: string
    // Whether the frame naming it went out over the socket standing now.
    sent: boolean
    settle: (answer: Answer | Promise<Answer> | undefined) => void
    fail: (reason: unknown) => void
    // The body its head opened, once it has; `null` while it has not.
    body: ReadableStreamDefaultController<Uint8Array> | null
    // A new run in place of this one, for a connection reopened under another caller (18.25).
    restart: () => void

    constructor(
        id: number,
        url: string,
        settle: (answer: Answer | Promise<Answer> | undefined) => void,
        fail: (reason: unknown) => void,
        restart: () => void,
    ) {
        this.id = id
        this.url = url
        this.sent = false
        this.settle = settle
        this.fail = fail
        this.body = null
        this.restart = restart
    }

    frame(): BrowserFrame {
        return { op: 'stream', id: this.id, url: this.url }
    }

    /** Takes a frame of its answer; returns whether the stream is over. */
    receive(frame: ServerFrame, cancel: () => void): boolean {
        if (frame.op === 'lines') {
            this.body?.enqueue(ENCODER.encode(frame.lines ?? ''))
            return false
        }
        if (frame.op === 'head' && frame.head !== undefined) {
            const head = frame.head
            const ok = head.status >= 200 && head.status < 300
            const body = ok
                ? new ReadableStream<Uint8Array>({
                      start: (controller) => {
                          this.body = controller
                      },
                      // A reader that stopped — an invalidate discarding the run (7.15) — ends it there.
                      cancel,
                  })
                : (head.text ?? '')
            this.settle(
                answerFrom(
                    new Response(head.status === 204 ? null : body, {
                        status: head.status,
                        statusText: head.statusText,
                        headers: head.headers,
                    }),
                    undefined,
                    true,
                ),
            )
            return !ok
        }
        if (frame.op === 'end') this.body?.close()
        // A body that broke reads as a connection that broke, as a fetch's would.
        else if (frame.op === 'error' && this.body !== null)
            this.body.error(new TypeError('the stream broke'))
        // A refusal before its head, or `http`: the call is made over http instead.
        else this.settle(undefined)
        return true
    }

    /** Its connection is gone: no answer where it had none (16.79), and a broken body where it had one. */
    lost(): void {
        if (this.body === null) this.settle(noAnswer())
        else this.body.error(new TypeError('the connection to the mux closed'))
    }
}

/** One web socket carrying every followed `GET` under one address, and every streaming one read. */
class Mux {
    url: string
    socket: WebSocket | null
    subscriptions: Map<number, Following>
    streams: Map<number, MuxStream>
    nextId: number
    backoff: Backoff

    constructor(url: string) {
        this.url = url
        this.socket = null
        this.subscriptions = new Map()
        this.streams = new Map()
        this.nextId = 1
        this.backoff = new Backoff(RETRY_FLOOR_MS, RETRY_CEILING_MS, () =>
            this.connect(),
        )
        onPrincipalRotated(() => this.reopen(), true)
        this.backoff.whenReachable(() => this.redial())
    }

    /** Opens a closed socket now, in place of the retry waiting out its backoff. */
    redial(): void {
        if (this.socket !== null || this.subscriptions.size === 0) return
        this.backoff.cancel()
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
        // 16.93 — A STREAM ANSWERING THE CALLER IT OPENED AS is run again as the one it is now: a
        // new run in place of one that had begun (9.7), and one that had not sent again as it was.
        for (const stream of this.streams.values()) {
            stream.sent = false
            if (stream.body === null) continue
            this.streams.delete(stream.id)
            stream.restart()
            stream.body.close()
        }
        if (this.subscriptions.size !== 0 || this.streams.size !== 0)
            this.connect()
    }

    /**
     * Reads the streaming `GET` at `url` over the socket: settles with its answer as its head lands,
     * or `undefined` where it is to be called over http instead. 16.93.
     *
     * 16.79 — OFFLINE, OR A SOCKET THAT CLOSES before the head, is no answer, as a fetch's would be.
     */
    stream(
        url: string,
        signal: AbortSignal | undefined,
        restart: () => void,
    ): Promise<Answer | undefined> {
        if (this.socket?.readyState !== WebSocket.OPEN && !navigator.onLine)
            return Promise.resolve(noAnswer())
        return new Promise((settle, fail) => {
            const stream = new MuxStream(
                this.nextId++,
                url,
                settle,
                fail,
                restart,
            )
            this.streams.set(stream.id, stream)
            // 16.48 — the load's own ending: the server stops it, and the read throws as a fetch's.
            signal?.addEventListener(
                'abort',
                () => {
                    if (!this.streams.delete(stream.id)) return
                    this.unsubscribe(stream)
                    if (stream.body === null) fail(signal.reason)
                    else stream.body.error(signal.reason)
                },
                { once: true },
            )
            if (this.socket?.readyState === WebSocket.OPEN) this.send(stream)
            else this.connect()
        })
    }

    private send(stream: MuxStream): void {
        stream.sent = true
        this.socket?.send(JSON.stringify(stream.frame()))
    }

    private unsubscribe(stream: MuxStream): void {
        if (stream.sent && this.socket?.readyState === WebSocket.OPEN)
            this.socket.send(JSON.stringify({ op: 'unsub', id: stream.id }))
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
            this.backoff.reset()
            // Every subscription again, carrying the version it holds (18.9).
            for (const each of this.subscriptions.values())
                socket.send(JSON.stringify(each.frame()))
            for (const stream of this.streams.values())
                if (!stream.sent) this.send(stream)
        }
        // THE CLOSE THAT FOLLOWS IS WHAT RETRIES; an error left unhandled is only noise on top of it.
        socket.onerror = () => {}
        socket.onmessage = (event) =>
            this.receive(JSON.parse(String(event.data)) as ServerFrame)
        socket.onclose = () => {
            this.socket = null
            const streams = [...this.streams.values()]
            this.streams.clear()
            for (const stream of streams) stream.lost()
            // 18.34 — OFFLINE, AN ATTEMPT CANNOT SUCCEED, so none is armed: coming online redials.
            if (this.subscriptions.size !== 0 && navigator.onLine)
                this.backoff.later()
        }
    }

    receive(frame: ServerFrame): void {
        const stream = this.streams.get(frame.id)
        if (stream === undefined) {
            this.subscriptions.get(frame.id)?.receive(frame)
            return
        }
        const cancel = (): void => {
            if (this.streams.delete(stream.id)) this.unsubscribe(stream)
        }
        if (stream.receive(frame, cancel)) this.streams.delete(stream.id)
    }

    /** Lets go of every subscription, stream and the socket, so a sign-in or a retry reaches nothing. */
    dispose(): void {
        this.backoff.cancel()
        this.subscriptions.clear()
        const streams = [...this.streams.values()]
        this.streams.clear()
        for (const stream of streams) stream.lost()
        this.reopen()
    }
}

const MUXES = new Map<string, Mux>()

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
        // Heard from the first follow on, which is the first copy it could read again.
        if (MUXES.size === 0) whenDelivered(readAgainWritten)
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
 * Forgets every mux and follow this page opened, their timers and sockets with them.
 *
 * A page never does; a test process outlives one, and a later file's sign-in (18.25) would reopen
 * every mux an earlier file left standing.
 */
export function resetSocketWire(): void {
    for (const following of FOLLOWING.values()) clearTimeout(following.expiry)
    FOLLOWING.clear()
    for (const mux of MUXES.values()) mux.dispose()
    MUXES.clear()
}

/**
 * Reads again every followed copy written here, once the outbox holds no call waiting.
 *
 * 18.35 — the server's value, with every queued call that was delivered in it and none of one it
 * refused. Every such copy, not only one a frame was held back from: a refused call may have left
 * the server with nothing to send.
 */
function readAgainWritten(): void {
    for (const following of FOLLOWING.values()) {
        const copy = following.entry() as Reactive<unknown>
        if (writtenLocally(copy)) copy.refresh()
    }
}

/**
 * The streaming `GET` `url` names, read over the mux `address` is carried over: its answer, or
 * `undefined` where it is to be called over http. `restart` runs its copy again (16.93, 18.25).
 */
export function streamOverMux(
    address: string,
    url: string,
    signal: AbortSignal | undefined,
    restart: () => void,
): Promise<Answer | undefined> {
    return muxFor(address).stream(url, signal, restart)
}

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
