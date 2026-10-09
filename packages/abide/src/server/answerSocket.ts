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
import { FOLLOWED } from '#shared/reactive/FOLLOWED.ts'
import { pastOf } from '#shared/reactive/index.ts'
import { matchesPattern } from '#shared/reactive/matchesPattern.ts'
import { PATCH_SINKS } from '#shared/reactive/PATCH_SINKS.ts'
import { unowned } from '#shared/reactive/watch.ts'
import { refuse } from '#shared/refuse.ts'
import type { BrowserFrame, ServerFrame, Socket } from '#shared/socket.ts'
import type { Mounted } from './answerRpc.ts'
import { argsFor } from './argsFor.ts'
import { closedTo, crossingOrigin, crossingRefusal } from './crossingOrigin.ts'
import { failureOf } from './hooks.ts'
import {
    inOpenScope,
    type RequestScope,
    releaseScope,
    scopeFor,
} from './requestScope.ts'
import { resumeProductions } from './resumeProductions.ts'
import { patchesOf, versionOf } from './versionOf.ts'

/**
 * The far end of one connection to the mux, which its frames are written to.
 *
 * Bun's socket under `abide start`, and under `abide dev` a stand-in that posts each frame to the
 * listener holding the real one (38.15).
 */
export type Peer = {
    send(text: string): unknown
    close(code: number, reason: string): unknown
}

const SOCKET_LOG = namedLogger('abide:socket')

// 18.17 — EVERY SUBSCRIPTION TO A HANDLER, by handler, for its triggers to reach (7.10, 7.18).
// PROCESS-WIDE because a trigger is: `rpc.invalidate({ id })` inside one request reaches every browser
// holding that key, whichever connection it came over.
type Follower = {
    peer: Peer
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
export function broadcast(
    rpc: object,
    member: 'invalidate' | 'refresh',
    pattern: unknown,
): void {
    const followers = FOLLOWERS.get(rpc)
    if (followers === undefined) return
    for (const follower of followers) {
        if (!matchesPattern(follower.args, pattern)) continue
        // A fed copy is refreshed by the production the reload mints (7.18), and invalidated through
        // the cell it is fed from (`FOLLOWED`), whichever trigger reached it — where the entry it is
        // fed from is still the one standing.
        if (attach(rpc as Mounted['handler'], follower) !== undefined) continue
        send(follower.peer, { op: member, id: follower.id })
    }
}

// 18.23 — AN ENTRY ANSWERED THAT NOBODY IS FED FROM: one made after a follower subscribed for its
// args, or rebuilt after the one it was fed from was evicted. An entry already fed is the common
// answer, and asks nothing more.
export function feedFromServed(rpc: object, serving: unknown): void {
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

function send(peer: Peer, frame: ServerFrame): void {
    peer.send(JSON.stringify(frame))
}

function failure(error: unknown): Failed<string, unknown> {
    return wireFailure(failureOf(error))
}

/**
 * The socket mux over the app's sockets and the handlers a browser may follow: what a listener hands
 * each connection it upgraded, and what closes them all when the app stops (42.11).
 */
export class Mux {
    readonly sockets: Map<string, Socket<unknown, unknown>>
    readonly handlers: Map<string, Mounted>
    // 42.12 — the app a frame's scope answers `rpc.raw` and the MCP surface through.
    readonly app: RequestScope['app']
    readonly connections = new Set<MuxConnection>()

    constructor(
        sockets: Map<string, Socket<unknown, unknown>>,
        handlers: Map<string, Mounted>,
        app: RequestScope['app'],
    ) {
        this.sockets = sockets
        this.handlers = handlers
        this.app = app
    }

    /** One connection, upgraded from `request`, whose frames go to `peer`. */
    connect(request: Request, peer: Peer): MuxConnection {
        if (SOCKET_LOG.enabled())
            SOCKET_LOG.debug('open', new URL(request.url).pathname)
        const connection = new MuxConnection(this, request, peer)
        this.connections.add(connection)
        return connection
    }

    closeAll(code: number, reason: string): void {
        for (const connection of this.connections) {
            connection.close()
            connection.peer.close(code, reason)
        }
    }
}

/** One browser's connection to the mux: its subscriptions, and the scope its frames are answered in. */
export class MuxConnection {
    readonly mux: Mux
    readonly peer: Peer
    readonly subscriptions = new Map<number, () => void>()
    /**
     * The origin a connection from another origin came from, and `null` for the app's own.
     *
     * 18.5 — read once at the upgrade, since every frame on the connection shares it.
     */
    readonly crossing: string | null
    // 18.33 — what aborts the upgrade's signal, for 16.67 to read a hang-up off.
    readonly hangUp = new AbortController()
    // 18.31 — every frame is answered in this one scope; 18.32 — torn down at the close.
    readonly scope: RequestScope

    constructor(mux: Mux, upgrade: Request, peer: Peer) {
        this.mux = mux
        this.peer = peer
        this.crossing = crossingOrigin(
            upgrade.headers.get('origin'),
            upgrade.url,
        )
        // NO `received`: an upgraded connection has no http idle timeout for 16.23 to raise.
        this.scope = scopeFor(
            new Request(upgrade, { signal: this.hangUp.signal }),
            undefined,
            mux.app,
        )
        // 22.10 — the headers went out with the upgrade, so nothing a frame writes is carried.
        this.scope.applied = true
    }

    message(raw: string | Buffer): Promise<void> {
        return inOpenScope(this.scope, () => this.answerFrame(raw))
    }

    /** Stops every subscription and tears the scope down; a second close does nothing. */
    close(): void {
        if (!this.mux.connections.delete(this)) return
        this.hangUp.abort()
        for (const stop of this.subscriptions.values()) stop()
        this.subscriptions.clear()
        releaseScope(this.scope)
    }

    private async answerFrame(raw: string | Buffer): Promise<void> {
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
        const subscriptions = this.subscriptions
        if (frame.op === 'unsub') {
            subscriptions.get(id)?.()
            subscriptions.delete(id)
            return
        }
        const handler =
            frame.op === 'sub' ? this.mux.handlers.get(address) : undefined
        const followed = handler?.ui ? handler : undefined
        const carried =
            followed === undefined ? this.mux.sockets.get(address) : undefined
        const gated = followed?.handler ?? carried
        if (gated === undefined) {
            send(this.peer, {
                op: 'error',
                id,
                error: failure(refuse(404, `No socket answers at ${address}.`)),
            })
            return
        }
        // 18.5 — ANOTHER ORIGIN IS CLOSED OUT unless the socket declared it: the same gate, and
        // the same own origin, as a handler's (16.14, 16.25, 36.2).
        if (closedTo(gated.crossOrigin, this.crossing)) {
            send(this.peer, {
                op: 'error',
                id,
                error: failure(
                    crossingRefusal(
                        this.crossing,
                        frame.op === 'pub' ? 'publish' : 'subscription',
                    ),
                ),
            })
            return
        }
        const request = this.scope.request as Request
        // A SUBSCRIPTION IS HELD FROM THE FRAME ON, not from when its rungs let it through: an
        // `unsub` or the connection's close that lands while a rung is pending stops this
        // placeholder, and the rungs resolving to find another in its place install nothing.
        const pending = (): void => {}
        try {
            if (followed !== undefined) {
                // 18.17 — the args a `GET` over http is answered with, sent as JSON.
                follow(
                    this,
                    id,
                    followed,
                    argsFor(followed, frame.args, undefined),
                    frame.version,
                )
                return
            }
            if (carried === undefined) return
            const onion = carried.onion
            if (frame.op === 'sub') {
                subscriptions.get(id)?.()
                subscriptions.set(id, pending)
                // 18.3, 18.4 — the lane's rungs, and a rung refuses by throwing.
                if (onion !== null)
                    await onion({
                        kind: 'subscribe',
                        args: frame.args,
                        request,
                    })
                if (subscriptions.get(id) !== pending) return
                subscribe(
                    this,
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
            if (subscriptions.get(id) === pending) subscriptions.delete(id)
            send(this.peer, { op: 'error', id, error: failure(thrown) })
        }
    }
}

/**
 * Subscribes `id` to a socket's value: the ring's replay, then every production live.
 *
 * 18.13, 18.14 — what the ring holds past where the subscriber stood, in one frame — all of it for
 * a fresh one, and all of it marked a reset where the epoch it carried is not this value's — then
 * every production after it, live, a frame each.
 */
function subscribe(
    connection: MuxConnection,
    id: number,
    value: unknown,
    seq: number | undefined,
    epoch: string | undefined,
): void {
    const {
        epoch: current,
        moved,
        ring,
        cursor,
    } = resumeProductions(value, seq, epoch)
    const peer = connection.peer
    // THE RING IS ONE FRAME, so a copy lands the whole replay in one turn: one frame per entry
    // landed a hydrating `{#for}`'s copy with its first row alone against every row the server
    // painted (41.8, 41.10). A moved epoch marks it a reset (18.14).
    if (moved || ring.length !== 0)
        send(peer, { op: moved ? 'reset' : 'prod', id, epoch: current, ring })
    let stopped = false
    connection.subscriptions.set(id, () => {
        stopped = true
        void cursor.return?.(undefined)
    })
    void (async () => {
        for (;;) {
            const next = await cursor.next()
            if (stopped || next.done === true) return
            send(peer, {
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
    connection: MuxConnection,
    id: number,
    mounted: Mounted,
    args: unknown,
    held: number | undefined,
): void {
    const rpc = mounted.handler
    connection.subscriptions.get(id)?.()
    const follower: Follower = {
        peer: connection.peer,
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
    connection.subscriptions.set(id, () => {
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
        for (const one of fed) send(one.peer, { op: 'invalidate', id: one.id })
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
    // UNOWNED: the feed is stopped when its last follower leaves, and the request it may have been
    // started in is answered long before that (12.5).
    const stopWatch = unowned(() =>
        (serving as { watch(effect: () => void): () => void }).watch(() => {
            shared.landed = true
            sendAll(serving, fed)
        }),
    )
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
            one.peer.send(`{"op":"value","id":${one.id}${valueTail}`)
        } else {
            patchTail ??= `,"base":${one.sent},"version":${version},"ops":${JSON.stringify(patches.ops)}}`
            one.peer.send(`{"op":"patch","id":${one.id}${patchTail}`)
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
