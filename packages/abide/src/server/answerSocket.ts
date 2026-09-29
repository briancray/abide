// SECTION 18 — THE SOCKET MUX. Every `socket` an app mounts is carried over one web socket per browser
// (18.2), at `SOCKET_ADDRESS`, and each subscription on it is a frame naming the socket's address and
// its args. What goes back is every production of the value, numbered with the ordinal its owner
// minted (18.10, 9.14) under the value's epoch (18.11).
//
// THE FRAMES are `BrowserFrame` in and `ServerFrame` out, as JSON.
//
// 18.17 — A SUBSCRIPTION MAY NAME A HANDLER'S ADDRESS as well as a socket's. Every one is followed for
// the handler's triggers, whether its value is `global` or built per request, since a trigger names
// args rather than a value. Only a `global` value with no rungs is also fed its productions: a rung
// runs per request, and a production pushed past it is data the rung never saw.
//
// NOT HERE YET: 18.15 and 18.16, a `{#for}` keyed by sequence and cleared on a reset, which are the
// compiler's. And 6.17 over a socket: a stream's replay is its CHUNKS, not the closed runs `history`
// answers, because switching the replay to runs while the live tail stays on chunks would number one
// sequence two ways, and 18.10 needs it monotonic.

import { ABIDE_ADDRESS } from '#shared/ADDRESSES.ts'
import { type Failed, isFailed, wireFailure } from '#shared/Failed.ts'
import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import { namedLogger } from '#shared/log.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { FOLLOWED } from '#shared/reactive/FOLLOWED.ts'
import { historyFrom, retained } from '#shared/reactive/History.ts'
import { matchesPattern } from '#shared/reactive/matchesPattern.ts'
import { PATCH_SINKS } from '#shared/reactive/PATCH_SINKS.ts'
import { pastOf } from '#shared/reactive/index.ts'
import { refuse } from '#shared/refuse.ts'
import type { BrowserFrame, ServerFrame, Socket } from '#shared/socket.ts'
import { allows, crossingOrigin, type Mounted } from './answerRpc.ts'
import { failureOf } from './hooks.ts'
import { patchesOf, versionOf } from './versionOf.ts'

export type Connection = {
    request: Request
    subscriptions: Map<number, () => void>
    /**
     * The origin a connection from another origin came from, and `null` for the app's own.
     *
     * 18.5 — read once at the upgrade, since every frame on the connection shares it.
     */
    crossing: string | null
}

/**
 * What the mux writes to.
 *
 * Bun's socket under `abide start`, and under `abide dev` a stand-in that posts each frame to the
 * listener holding the real one (38.15).
 */
export type MuxSocket = { data: Connection; send(text: string): unknown }

export function connectionOf(request: Request): Connection {
    return {
        request,
        subscriptions: new Map(),
        crossing: crossingOrigin(request.headers.get('origin'), request.url),
    }
}

const SOCKET_LOG = namedLogger('abide:socket')

// 18.11 — ONE EPOCH PER VALUE, minted the first time the value is carried and never moved after
// (9.19). Compared for equality alone.
const EPOCHS = new WeakMap<object, string>()

function epochOf(cell: object): string {
    let epoch = EPOCHS.get(cell)
    if (epoch === undefined) {
        epoch = crypto.randomUUID()
        EPOCHS.set(cell, epoch)
    }
    return epoch
}

// 18.17 — EVERY SUBSCRIPTION TO A HANDLER, by handler, for its triggers to reach (7.10, 7.18).
// PROCESS-WIDE because a trigger is: `rpc.invalidate({ id })` inside one request reaches every browser
// holding that key, whichever connection it came over.
type Follower = {
    ws: MuxSocket
    id: number
    args: unknown
    // The `global` entry its productions are pushed from, which is what a refresh would otherwise
    // re-fetch — or `undefined`, and it is sent triggers instead.
    serving: unknown
    stopFeed: (() => void) | undefined
    // 18.21 — the version it was last sent, or named on subscribing.
    sent: number | undefined
}
const FOLLOWERS = new Map<object, Set<Follower>>()

// 13.12 — narrowed by the pattern the trigger was handed, as the handler's own entries are.
RPC_SERVER.broadcast = (rpc, member, pattern) => {
    const followers = FOLLOWERS.get(rpc)
    if (followers === undefined) return
    for (const follower of followers) {
        if (!matchesPattern(follower.args, pattern)) continue
        // A fed copy is refreshed by the production the reload mints (7.18), and invalidated through
        // the cell it is fed from (`FOLLOWED`), whichever trigger reached it — where the entry it is
        // fed from is still the one standing.
        if (attach(rpc as Mounted['handler'], follower) !== undefined) continue
        send(follower.ws, { op: member, id: follower.id })
    }
}

// 18.23 — AN ENTRY ANSWERED THAT NOBODY IS FED FROM: one made after a follower subscribed for its
// args, or rebuilt after the one it was fed from was evicted. An entry already fed is the common
// answer, and asks nothing more.
RPC_SERVER.served = (rpc, serving) => {
    if (FEEDS.has(serving as object)) return
    const followers = FOLLOWERS.get(rpc)
    if (followers === undefined) return
    for (const follower of followers)
        attach(rpc as Mounted['handler'], follower)
}

/**
 * Feeds the follower from the entry standing for its args; returns what it is fed from now.
 *
 * Only where that entry is not the one it is fed from already.
 */
function attach(rpc: Mounted['handler'], follower: Follower): unknown {
    const serving = rpc.guarded
        ? undefined
        : GLOBAL_GETS.get(rpc)?.(follower.args)
    if (serving === follower.serving) return serving
    follower.stopFeed?.()
    // A version is one entry's count, so what it was sent of another says nothing about this one.
    if (follower.serving !== undefined) follower.sent = undefined
    follower.serving = serving
    follower.stopFeed =
        serving === undefined ? undefined : feed(serving, follower)
    return serving
}

function send(ws: MuxSocket, frame: ServerFrame): void {
    ws.send(JSON.stringify(frame))
}

function failure(error: unknown): Failed<string, unknown> {
    return wireFailure(failureOf(error))
}

/** The mux's websocket handlers, over the app's sockets and the handlers a browser may follow. */
export function socketHandlers(
    sockets: Map<string, Socket<unknown, unknown>>,
    handlers: Map<string, Mounted>,
): {
    open(ws: MuxSocket): void
    message(ws: MuxSocket, raw: string | Buffer): Promise<void>
    close(ws: MuxSocket): void
} {
    return {
        open(ws) {
            if (SOCKET_LOG.enabled())
                SOCKET_LOG.debug('open', new URL(ws.data.request.url).pathname)
        },
        async message(ws, raw) {
            // Partial: it is whatever the browser sent.
            let frame: Partial<BrowserFrame>
            try {
                frame = JSON.parse(String(raw))
            } catch {
                return
            }
            const id = frame.id ?? 0
            // THE ADDRESS FROM `/__abide` ON, which is what both tables are keyed by: a browser names
            // it as its wrapper resolved it, which is a whole URL, or a path under the app's mount.
            const address = addressIn(frame.address ?? '')
            if (frame.op === 'unsub') {
                ws.data.subscriptions.get(id)?.()
                ws.data.subscriptions.delete(id)
                return
            }
            const handler =
                frame.op === 'sub' ? handlers.get(address) : undefined
            const followed = handler?.ui ? handler : undefined
            const carried =
                followed === undefined ? sockets.get(address) : undefined
            const gated = followed?.handler ?? carried
            if (gated === undefined) {
                send(ws, {
                    op: 'error',
                    id,
                    error: failure(
                        refuse(404, `No socket answers at ${address}.`),
                    ),
                })
                return
            }
            // 18.5 — ANOTHER ORIGIN IS CLOSED OUT unless the socket declared it: the same gate, and
            // the same own origin, as a handler's (16.14, 16.25, 36.2).
            const { request, crossing } = ws.data
            if (crossing !== null && !allows(gated.crossOrigin, crossing)) {
                send(ws, { op: 'error', id, error: failure(refuse(403)) })
                return
            }
            if (followed !== undefined) {
                follow(ws, id, followed, frame.args, frame.version)
                return
            }
            if (carried === undefined) return
            const onion = carried.onion
            // A SUBSCRIPTION IS HELD FROM THE FRAME ON, not from when its rungs let it through: an
            // `unsub` or the connection's close that lands while a rung is pending stops this
            // placeholder, and the rungs resolving to find another in its place install nothing.
            const pending = (): void => {}
            try {
                if (frame.op === 'sub') {
                    ws.data.subscriptions.get(id)?.()
                    ws.data.subscriptions.set(id, pending)
                    // 18.3, 18.4 — the lane's rungs, and a rung refuses by throwing.
                    if (onion !== null)
                        await onion({
                            kind: 'subscribe',
                            args: frame.args,
                            request,
                        })
                    if (ws.data.subscriptions.get(id) !== pending) return
                    subscribe(
                        ws,
                        id,
                        carried(frame.args as never),
                        frame.seq,
                        frame.epoch,
                    )
                } else if (frame.op === 'pub') {
                    // 18.6, 18.7 — a frame from outside the process publishes only where admitted.
                    if (!carried.clientPublish)
                        throw refuse(403, 'This socket takes no publish.')
                    if (onion !== null)
                        await onion({
                            kind: 'publish',
                            args: frame.args,
                            message: frame.message,
                            request,
                        })
                    // 18.8 — through the value's own `publish`, so its `transform` runs.
                    const minted = (
                        carried(frame.args as never) as unknown as {
                            publish(value: unknown): unknown
                        }
                    ).publish(frame.message)
                    if (isFailed(minted)) throw minted
                }
            } catch (thrown) {
                if (ws.data.subscriptions.get(id) === pending)
                    ws.data.subscriptions.delete(id)
                send(ws, { op: 'error', id, error: failure(thrown) })
            }
        },
        close(ws) {
            for (const stop of ws.data.subscriptions.values()) stop()
            ws.data.subscriptions.clear()
        },
    }
}

/**
 * Subscribes `id` to a socket's value: the ring's replay, then every production live.
 *
 * 18.13, 18.14 — what the ring holds past where the subscriber stood — all of it for a fresh one,
 * and all of it marked a reset where the epoch it carried is not this value's — then every
 * production after it, live.
 */
function subscribe(
    ws: MuxSocket,
    id: number,
    value: unknown,
    seq: number | undefined,
    epoch: string | undefined,
): void {
    // The past `s.history` would hand back — the adopted value's, swept of what outlived its `ttl`.
    const cell = pastOf(value)
    const current = epochOf(cell)
    const resumed = seq !== undefined && epoch === current
    const moved = seq !== undefined && epoch !== current
    const replay: [number, unknown][] = []
    // THE OLDEST PRODUCTION THE VALUE STILL RETAINS, which is where a fresh subscription starts and
    // where one older than it is clamped to (9.10).
    const floor = cell.ordinal - retained(cell)
    let at = resumed ? Math.max(seq, floor) : floor
    for (const item of historyFrom(cell, at) as Iterable<unknown>) {
        at += 1
        replay.push([at, item])
    }
    if (moved) send(ws, { op: 'reset', id, epoch: current, ring: replay })
    else
        for (const [number, item] of replay)
            send(ws, {
                op: 'prod',
                id,
                seq: number,
                epoch: current,
                value: item,
            })

    // NUMBERED BY WHERE THE CURSOR STANDS rather than by counting its turns: a cursor with no ring
    // collapses a burst onto the standing production (5.11), and that production's number is the
    // one a reconnect resumes from.
    const cursor = (historyFrom(cell, cell.ordinal) as AsyncIterable<unknown>)[
        Symbol.asyncIterator
    ]() as AsyncIterator<unknown> & { at: number }
    let stopped = false
    ws.data.subscriptions.set(id, () => {
        stopped = true
        void cursor.return?.(undefined)
    })
    void (async () => {
        for (;;) {
            const next = await cursor.next()
            if (stopped || next.done === true) return
            send(ws, {
                op: 'prod',
                id,
                seq: cursor.at,
                epoch: current,
                value: next.value,
            })
        }
    })()
}

/**
 * Follows a handler for `id`: its triggers always, its value where `global` and unguarded.
 *
 * 18.17, 18.23. STATE, NOT A LOG: nothing is replayed. 18.21 — the value is sent where the version
 * the subscription named is not the one standing, and after that once per change, a burst in one
 * turn going out as the value it left.
 */
function follow(
    ws: MuxSocket,
    id: number,
    mounted: Mounted,
    args: unknown,
    held: number | undefined,
): void {
    const rpc = mounted.handler
    ws.data.subscriptions.get(id)?.()
    const follower: Follower = {
        ws,
        id,
        args,
        serving: undefined,
        stopFeed: undefined,
        sent: held,
    }
    attach(rpc, follower)
    let followers = FOLLOWERS.get(rpc)
    if (followers === undefined) {
        followers = new Set()
        FOLLOWERS.set(rpc, followers)
    }
    followers.add(follower)
    ws.data.subscriptions.set(id, () => {
        follower.stopFeed?.()
        followers.delete(follower)
    })
}

// 18.21 — ONE WATCH PER VALUE SERVED, however many follow it, and each frame's body serialized once
// per version: every follower standing where the others stand is sent the same bytes, with its own
// id spliced in front.
type Feed = {
    fed: Set<Follower>
    landed: boolean
    stop: () => void
}
const FEEDS = new WeakMap<object, Feed>()

function feed(serving: unknown, fed: Follower): () => void {
    const shared = FEEDS.get(serving as object) ?? startFeed(serving)
    shared.fed.add(fed)
    if (shared.landed) sendAll(serving, [fed])
    return () => {
        shared.fed.delete(fed)
        if (shared.fed.size === 0) shared.stop()
    }
}

function startFeed(serving: unknown): Feed {
    const past = pastOf(serving)
    const release = sinkFor(past)
    const fed = new Set<Follower>()
    // 7.10 — an invalidate of the value, however it was spelled, reaches every copy it feeds.
    const invalidated = (): void => {
        for (const one of fed) send(one.ws, { op: 'invalidate', id: one.id })
    }
    let followed = FOLLOWED.get(past)
    if (followed === undefined) {
        followed = new Set()
        FOLLOWED.set(past, followed)
    }
    followed.add(invalidated)
    const shared: Feed = {
        fed,
        landed: false,
        stop: () => {
            stopWatch()
            release()
            FEEDS.delete(serving as object)
            followed.delete(invalidated)
            if (followed.size === 0) FOLLOWED.delete(past)
        },
    }
    FEEDS.set(serving as object, shared)
    const stopWatch = (
        serving as { watch(effect: () => void): () => void }
    ).watch(() => {
        shared.landed = true
        sendAll(serving, fed)
    })
    return shared
}

function sendAll(serving: unknown, fed: Iterable<Follower>): void {
    const version = versionOf(serving)
    const patches = patchesOf(serving)
    let valueTail: string | undefined
    let patchTail: string | undefined
    for (const one of fed) {
        if (one.sent === version) continue
        // 18.26 — the writes, where the follower stands where they were written over.
        if (patches === undefined || patches.from !== one.sent) {
            if (valueTail === undefined) {
                const held = (serving as { peek(): unknown }).peek()
                valueTail =
                    held === undefined
                        ? `,"version":${version}}`
                        : `,"version":${version},"value":${JSON.stringify(held)}}`
            }
            one.ws.send(`{"op":"value","id":${one.id}${valueTail}`)
        } else {
            patchTail ??= `,"base":${one.sent},"version":${version},"ops":${JSON.stringify(patches.ops)}}`
            one.ws.send(`{"op":"patch","id":${one.id}${patchTail}`)
        }
        one.sent = version
    }
}

function addressIn(named: string): string {
    const at = named.indexOf(ABIDE_ADDRESS)
    return at === -1 ? named : named.slice(at)
}

/**
 * Holds a patch sink on `cell`; returns what releases it.
 *
 * 18.26 — A VALUE FED TO A FOLLOWER KEEPS ITS PATCHES AS DATA while anyone is fed it, and stops
 * when the last one goes: a sink nobody drains grows with every patch.
 */
function sinkFor(cell: object): () => void {
    const sink = PATCH_SINKS.get(cell) ?? { ops: [], lost: false, fed: 0 }
    PATCH_SINKS.set(cell, sink)
    sink.fed += 1
    return () => {
        sink.fed -= 1
        if (sink.fed === 0) PATCH_SINKS.delete(cell)
    }
}
