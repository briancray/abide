// SECTION 18 — THE MUX. Every `GET` a page follows is carried over one web socket per browser (18.1),
// at `SOCKET_ADDRESS`, and each subscription on it is a frame naming the handler's address and its
// args. What goes back is the value, and then what each patch wrote over it (18.6, 18.11) — the same
// frames an event stream writes as events (18.20), multiplexed so a page following many values holds
// one connection.
//
// THE FRAMES are `BrowserFrame` in and `ServerFrame` out, as JSON.
//
// 18.3 — every subscription is followed for the handler's triggers, whether its value is `global` or
// built per request, since a trigger names args rather than a value. A `global` value is also fed its productions, a guarded one only to a
// subscription its rungs admitted when it opened (18.8) — they run once, in the connection's request.

import { problemOf } from '#shared/Failed.ts'
import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import { namedLogger } from '#shared/log.ts'
import { compose } from '#shared/Middleware.ts'
import { unmounted } from '#shared/mount.ts'
import type { BrowserFrame, ServerFrame } from '#shared/muxFrames.ts'
import { FOLLOWED } from '#shared/reactive/FOLLOWED.ts'
import { servedCellOf } from '#shared/reactive/index.ts'
import { matchesPattern } from '#shared/reactive/matchesPattern.ts'
import { PATCH_SINKS } from '#shared/reactive/PATCH_SINKS.ts'
import { unowned } from '#shared/reactive/watch.ts'
import { refuse } from '#shared/refuse.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { handlerKey, type Mounted } from './answerRpc.ts'
import { argsFor } from './argsFor.ts'
import { positiveSetting } from './config.ts'
import { closedTo, crossingOrigin, crossingRefusal } from './crossingOrigin.ts'
import { failureOf } from './hooks.ts'
import { sendOrClose } from './muxUpgrade.ts'
import {
    heldByApp,
    inOpenScope,
    type RequestScope,
    releaseScope,
    scopeFor,
} from './requestScope.ts'
import { EVENT_STREAM_OPENER, streamEvent } from './streamEvent.ts'
import { patchesSince, versionOf } from './versionOf.ts'

/**
 * The far end of one connection to the mux, which its frames are written to as text.
 *
 * Bun's socket under `abide start`, and under `abide dev` a stand-in that posts each frame to the
 * listener holding the real one (38.14).
 */
export type Socket = {
    send(text: string): unknown
    close(code: number, reason: string): unknown
}

const ENCODER = new TextEncoder()

// 18.31 — a page follows each value it reads once, so a thousand is a page no one could read.
const MAX_SUBSCRIPTIONS = 1024

/**
 * One `ServerFrame`, for every follower it is sent to.
 *
 * 18.6 — ITS BODY IS SERIALIZED ONCE PER VERSION, and each encoding of it once however many
 * followers it reaches: a socket is sent the JSON with its follower's id spliced in, and an event
 * stream the event, which names no follower and is the same text for every stream.
 */
class Frame {
    readonly op: ServerFrame['op']
    readonly base: number | undefined
    readonly version: number | undefined
    // The value, the patch's ops or the refusal, as JSON.
    readonly body: string | undefined
    // What follows the id in the JSON, and the event's bytes, each written on first use.
    private tail: string | undefined = undefined
    private event: Uint8Array | undefined = undefined

    constructor(
        op: ServerFrame['op'],
        base: number | undefined,
        version: number | undefined,
        body: string | undefined,
    ) {
        this.op = op
        this.base = base
        this.version = version
        this.body = body
    }

    /** As `ServerFrame` JSON for `id`: `base` and `version` where it has them, then the body under its op's member. */
    json(id: number): string {
        if (this.tail === undefined) {
            let tail = ''
            if (this.base !== undefined) tail += `,"base":${this.base}`
            if (this.version !== undefined) tail += `,"version":${this.version}`
            if (this.body !== undefined)
                tail += `,"${this.op === 'patch' ? 'ops' : this.op}":${this.body}`
            this.tail = `${tail}}`
        }
        return `{"op":"${this.op}","id":${id}${this.tail}`
    }

    /** As the SSE event 18.20 makes it, encoded: the op its name, the version its id. */
    asEvent(): Uint8Array {
        this.event ??= ENCODER.encode(
            streamEvent(
                this.op,
                this.version,
                this.body ?? (this.op === 'value' ? 'null' : ''),
            ),
        )
        return this.event
    }
}

/** A trigger's frame (7.10, 7.18), the same for every follower and every trigger. */
const TRIGGERS = {
    invalidate: new Frame('invalidate', undefined, undefined, undefined),
    refresh: new Frame('refresh', undefined, undefined, undefined),
}

/** What a frame is written to, under the follower's id: a socket, or an event stream. */
type Peer = {
    send(id: number, frame: Frame): void
    close(code: number, reason: string): unknown
}

/** A socket's peer: each frame as the `ServerFrame` JSON a browser parses. */
class SocketPeer implements Peer {
    readonly socket: Socket
    constructor(socket: Socket) {
        this.socket = socket
    }
    send(id: number, frame: Frame): void {
        sendOrClose(this.socket, frame.json(id))
    }
    close(code: number, reason: string): unknown {
        return this.socket.close(code, reason)
    }
}

const SOCKET_LOG = namedLogger('abide:socket')

// 18.3 — EVERY SUBSCRIPTION TO A HANDLER, by handler, for its triggers to reach (7.10, 7.18).
// PROCESS-WIDE because a trigger is: `rpc.invalidate({ id })` inside one request reaches every browser
// holding that key, whichever connection it came over.
type Follower = {
    peer: Peer
    id: number
    args: unknown
    // The entry key its args are filed under (`GLOBAL_GETS`), taken once as it subscribes.
    key: string
    // The `global` entry its productions are pushed from, which is what a refresh would otherwise
    // re-fetch — or `undefined`, and it is sent triggers instead.
    serving: unknown
    stopFeed: (() => void) | undefined
    // 18.6 — the version it was last sent, or named on subscribing.
    sent: number | undefined
    // 18.8 — whether the handler's rungs let it through when it opened: a guarded `GET` feeds only
    // a follower they admitted, and sends the rest its triggers alone.
    admitted: boolean
}
type Followed = {
    // 13.15 — the literal `tags` the build copied onto the browser's copy, for a sweep to match:
    // the handler's, so one for all of its followers.
    tags: string[] | undefined
    // What a trigger walks, matching each follower's args against its pattern.
    all: Set<Follower>
    // BY ENTRY KEY, so an entry answered walks the followers of its own args alone (18.8). Filed
    // apart from `all` rather than instead of it: a walk of every follower through a set per key
    // measured twice a flat set's.
    byKey: Map<string, Set<Follower>>
}
const FOLLOWERS = new Map<object, Followed>()

// 13.12 — narrowed by the pattern the trigger was handed, as the handler's own entries are.
export function broadcast(
    rpc: object,
    member: 'invalidate' | 'refresh',
    pattern: unknown,
): void {
    const followed = FOLLOWERS.get(rpc)
    if (followed === undefined) return
    for (const follower of followed.all) {
        if (!matchesPattern(follower.args, pattern)) continue
        // A fed copy is refreshed by the production the reload mints (7.18), and invalidated through
        // the cell it is fed from (`FOLLOWED`), whichever trigger reached it — where the entry it is
        // fed from is still the one standing.
        if (attach(rpc as Mounted['handler'], follower) !== undefined) continue
        follower.peer.send(follower.id, TRIGGERS[member])
    }
}

// 13.15 — A SWEEP REACHES EVERY COPY A BROWSER FOLLOWS that carries one of its `tags`, or every copy
// where it is bare, as that copy's own trigger. A fed copy is skipped for `broadcast`'s reason: the
// sweep reloaded the entry it is fed from here, and the production that mints is its refresh.
export function swept(
    member: 'invalidate' | 'refresh',
    tags: string[] | null,
): void {
    for (const [rpc, followed] of FOLLOWERS) {
        if (tags !== null && !sharesTag(followed.tags, tags)) continue
        for (const follower of followed.all) {
            if (attach(rpc as Mounted['handler'], follower) !== undefined)
                continue
            follower.peer.send(follower.id, TRIGGERS[member])
        }
    }
}

function sharesTag(held: string[] | undefined, swept: string[]): boolean {
    if (held === undefined) return false
    for (const tag of swept) if (held.includes(tag)) return true
    return false
}

// 18.8 — AN ENTRY ANSWERED THAT NOBODY IS FED FROM: one made after a follower subscribed for its
// args, or rebuilt after the one it was fed from was evicted. An entry already fed is the common
// answer, and asks nothing more; one that is not reaches the followers filed under its key.
export function feedFromServed(
    rpc: object,
    serving: unknown,
    key: string,
): void {
    if (FEEDS.has(serving as object)) return
    const followers = FOLLOWERS.get(rpc)?.byKey.get(key)
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
    // 18.8, 18.26 — what its own rungs or its route's refused is sent its triggers alone.
    const serving = !follower.admitted
        ? undefined
        : GLOBAL_GETS.get(rpc)?.at(follower.key)
    if (serving === follower.serving) return serving
    follower.stopFeed?.()
    // A version is one entry's count, so what it was sent of another says nothing about this one.
    if (follower.serving !== undefined) follower.sent = undefined
    follower.serving = serving
    follower.stopFeed =
        serving === undefined ? undefined : feed(serving, follower)
    return serving
}

/** A refusal's frame: the failure `error` is, as Problem Details (15.21). */
function refusal(error: unknown): Frame {
    return new Frame(
        'error',
        undefined,
        undefined,
        JSON.stringify(problemOf(failureOf(error))),
    )
}

/**
 * The mux over the handlers a browser may follow: what a listener hands each connection it upgraded,
 * and what closes them all when the app stops (42.11).
 */
export class Mux {
    readonly handlers: Map<string, Mounted>
    // 42.12 — the app a frame's scope answers `rpc.raw` and the MCP surface through.
    readonly app: RequestScope['app']
    readonly connections = new Set<MuxConnection>()

    constructor(handlers: Map<string, Mounted>, app: RequestScope['app']) {
        this.handlers = handlers
        this.app = app
    }

    /** One connection, upgraded from `request`, whose frames go to `socket`. */
    connect(request: Request, socket: Socket): MuxConnection {
        if (SOCKET_LOG.enabled())
            SOCKET_LOG.debug('open', new URL(request.url).pathname)
        const connection = new MuxConnection(
            this,
            request,
            new SocketPeer(socket),
        )
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
     * 18.2 — read once at the upgrade, since every frame on the connection shares it.
     */
    readonly crossing: string | null
    // 18.18 — what aborts the upgrade's signal at the close.
    readonly hangUp = new AbortController()
    // 18.16 — every frame is answered in this one scope; 18.17 — torn down at the close.
    readonly scope: RequestScope

    constructor(mux: Mux, upgrade: Request, peer: Peer) {
        this.mux = mux
        this.peer = peer
        this.crossing = crossingOrigin(
            upgrade.headers.get('origin'),
            upgrade.url,
        )
        // NO `received`: an upgraded connection has no http idle timeout for 16.22 to raise.
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
        // THE ADDRESS BELOW THE MOUNT, which is what the handlers are keyed by: a browser names it
        // as its wrapper resolved it, which is a whole URL, or a path under the app's mount.
        const address = addressIn(frame.address ?? '')
        const subscriptions = this.subscriptions
        if (frame.op === 'unsub') {
            subscriptions.get(id)?.()
            subscriptions.delete(id)
            return
        }
        // 18.31 — A CONNECTION FOLLOWS AT MOST `ABIDE_MAX_SOCKET_SUBSCRIPTIONS` VALUES; 18.32 — a frame
        // naming an id it already holds replaces that one rather than adding to them.
        if (frame.op === 'sub' && !subscriptions.has(id)) {
            const most = positiveSetting(
                'ABIDE_MAX_SOCKET_SUBSCRIPTIONS',
                MAX_SUBSCRIPTIONS,
            )
            if (subscriptions.size >= most) {
                this.peer.send(
                    id,
                    refusal(
                        refuse(
                            429,
                            `This connection follows ${most} values already.`,
                        ),
                    ),
                )
                return
            }
        }
        const handler =
            frame.op === 'sub'
                ? this.mux.handlers.get(handlerKey('GET', address))
                : undefined
        const followed = handler?.ui ? handler : undefined
        if (followed === undefined) {
            this.peer.send(
                id,
                refusal(
                    refuse(
                        404,
                        `No handler a browser follows answers at ${address}.`,
                    ),
                ),
            )
            return
        }
        // 18.2 — ANOTHER ORIGIN IS CLOSED OUT unless the handler declared it: the same gate, and the
        // same own origin, as its http answer's (16.13, 16.24, 36.2).
        if (closedTo(followed.handler.crossOrigin, this.crossing)) {
            this.peer.send(
                id,
                refusal(crossingRefusal(this.crossing, 'subscription')),
            )
            return
        }
        // A SUBSCRIPTION IS HELD FROM THE FRAME ON, not from when its rungs let it through: an
        // `unsub` or the connection's close that lands while a rung is pending stops this
        // placeholder, and the rungs resolving to find another in its place install nothing.
        const pending = (): void => {}
        try {
            // 18.3 — the args a `GET` over http is answered with, sent as JSON.
            const args = argsFor(followed, frame.args, undefined)
            // 18.8 — A GUARDED `GET`'s RUNGS RUN ONCE, as the subscription opens, in this
            // connection's request: one they admit is fed the value, and one they refuse is sent its
            // triggers alone.
            // 18.26 — AND THE MIDDLEWARE ITS FILE'S ROUTE FILED, over the request a `GET` of it
            // would be: one a rung answers in the handler's place is not fed, as an http call it
            // answered would never reach the handler.
            const routed = followed.rungs.length > 0
            let admitted = !followed.handler.guarded && !routed
            if (!admitted) {
                subscriptions.get(id)?.()
                subscriptions.set(id, pending)
                // No route rungs, no turn: a guarded `GET`'s rungs start in this frame's own run.
                admitted =
                    !routed || (await routeAdmits(this.scope, followed, args))
                if (admitted && followed.handler.guarded)
                    admitted = await Promise.resolve(
                        followed.handler(args as never) as PromiseLike<unknown>,
                    ).then(
                        () => true,
                        () => false,
                    )
                if (subscriptions.get(id) !== pending) return
            }
            follow(this, id, followed, args, frame.version, admitted)
        } catch (thrown) {
            if (subscriptions.get(id) === pending) subscriptions.delete(id)
            this.peer.send(id, refusal(thrown))
        }
    }
}

/**
 * Whether the rungs over `mounted`'s route let a `GET` of it with `args` through, asked over the
 * upgrade's own request at the handler's address. 18.26.
 */
async function routeAdmits(
    scope: RequestScope,
    mounted: Mounted,
    args: unknown,
): Promise<boolean> {
    const upgrade = scope.request as Request
    const asked = rpcRequest(
        'GET',
        mounted.address,
        args as Record<string, unknown> | undefined,
    )
    const request = new Request(new URL(asked.url, upgrade.url), {
        headers: upgrade.headers,
        signal: upgrade.signal,
    })
    // REACHED BY A FLAG, not by the answer's identity: a rung that wraps or re-heads what `next`
    // answered still let the call through, and a shared answer would carry every rung's headers.
    let reached = false
    try {
        const answered = await compose(mounted.rungs, async () => {
            reached = true
            return new Response(null, { status: 204 })
        })({ request })
        return reached && answered.ok
    } catch {
        return false
    }
}

/**
 * Follows a handler for `id`: its triggers always, its value where `global` and unguarded.
 *
 * 18.3, 18.8. STATE, NOT A LOG: nothing is replayed. 18.6 — the value is sent where the version
 * the subscription named is not the one standing, and after that once per change, a burst in one
 * turn going out as the value it left.
 */
function follow(
    connection: MuxConnection,
    id: number,
    mounted: Mounted,
    args: unknown,
    held: number | undefined,
    admitted: boolean,
): void {
    connection.subscriptions.get(id)?.()
    connection.subscriptions.set(
        id,
        followWith(connection.peer, id, mounted, args, held, admitted),
    )
}

/** Follows a handler for `id` on `peer`, however the peer writes; returns what stops it. */
function followWith(
    peer: Peer,
    id: number,
    mounted: Mounted,
    args: unknown,
    held: number | undefined,
    admitted: boolean,
): () => void {
    const rpc = mounted.handler
    const key = GLOBAL_GETS.get(rpc)?.key(args) ?? ''
    const follower: Follower = {
        peer,
        id,
        args,
        key,
        serving: undefined,
        stopFeed: undefined,
        sent: held,
        admitted,
    }
    attach(rpc, follower)
    let followed = FOLLOWERS.get(rpc)
    if (followed === undefined) {
        followed = {
            tags: mounted.copy?.tags,
            all: new Set(),
            byKey: new Map(),
        }
        FOLLOWERS.set(rpc, followed)
    }
    const byKey = followed.byKey
    let followers = byKey.get(key)
    if (followers === undefined) {
        followers = new Set()
        byKey.set(key, followers)
    }
    followers.add(follower)
    const all = followed.all
    all.add(follower)
    return () => {
        follower.stopFeed?.()
        all.delete(follower)
        // A key nobody follows leaves, or the index grows with every key ever followed.
        if (followers.delete(follower) && followers.size === 0)
            byKey.delete(key)
    }
}

/**
 * A handler followed as an event stream: the same follow a browser's mux makes, written as SSE.
 *
 * 18.20 — EACH MUX FRAME IS ONE EVENT, field for field: its `op` the event's name, its version the
 * event's `id`, and what it carries the `data` — the value for `value`, the JSON Patch for `patch`,
 * nothing for a trigger. So an `EventSource` reconnecting hands the version back as `Last-Event-ID`,
 * which is `held` here, and is sent nothing until the value moves past it.
 */
export function followAsEvents(
    mounted: Mounted,
    args: unknown,
    held: number | undefined,
): ReadableStream<Uint8Array> {
    let stop = (): void => {}
    let unhold = (): void => {}
    let ended = false
    return new ReadableStream({
        start(controller) {
            controller.enqueue(ENCODER.encode(EVENT_STREAM_OPENER))
            // Ended by the app's stop as any body it holds open is, or that stop waits on it.
            unhold = heldByApp(() => {
                if (ended) return
                ended = true
                stop()
                controller.close()
            })
            stop = followWith(
                {
                    // 18.6 — the event written and encoded once for every stream, from the body
                    // serialized once for every follower: nothing is parsed back.
                    send(_id, frame) {
                        controller.enqueue(frame.asEvent())
                    },
                    close() {
                        if (ended) return
                        ended = true
                        unhold()
                        controller.close()
                    },
                },
                0,
                mounted,
                args,
                held,
                // The request this stream answers passed the rungs already, or it would not be here.
                true,
            )
        },
        cancel() {
            ended = true
            unhold()
            stop()
        },
    })
}

// 18.6 — ONE WATCH PER VALUE SERVED, however many follow it, and each frame's body serialized once
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
    const past = servedCellOf(serving)
    const release = sinkFor(past)
    const fed = new Set<Follower>()
    // 7.10 — an invalidate of the value, however it was spelled, reaches every copy it feeds.
    const invalidated = (): void => {
        for (const one of fed) one.peer.send(one.id, TRIGGERS.invalidate)
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
    let valueFrame: Frame | undefined
    // ONE FRAME PER VERSION A FOLLOWER STANDS AT, since followers a burst left at different places
    // along the chain are each sent the writes since their own.
    let patchFrames: Map<number, Frame> | undefined
    for (const one of fed) {
        if (one.sent === version) continue
        // 18.11 — the writes, where the follower stands on the chain they were written along.
        const since = one.sent
        let frame = since === undefined ? undefined : patchFrames?.get(since)
        if (frame === undefined && since !== undefined) {
            const ops = patchesSince(serving, since)
            if (ops !== undefined) {
                frame = new Frame('patch', since, version, JSON.stringify(ops))
                patchFrames ??= new Map()
                patchFrames.set(since, frame)
            }
        }
        if (frame === undefined) {
            if (valueFrame === undefined) {
                const held = (serving as { peek(): unknown }).peek()
                valueFrame = new Frame(
                    'value',
                    undefined,
                    version,
                    held === undefined ? undefined : JSON.stringify(held),
                )
            }
            frame = valueFrame
        }
        one.peer.send(one.id, frame)
        one.sent = version
    }
}

function addressIn(named: string): string {
    const path = URL.parse(named)?.pathname ?? named
    return unmounted(path) ?? path
}

/**
 * Holds a patch sink on `cell`; returns what releases it.
 *
 * 18.11 — A VALUE FED TO A FOLLOWER KEEPS ITS PATCHES AS DATA while anyone is fed it, and stops
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
