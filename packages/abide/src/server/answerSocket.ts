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

import { ABIDE_ADDRESS } from '#shared/ADDRESSES.ts'
import { type Problem, problemOf } from '#shared/Failed.ts'
import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import { namedLogger } from '#shared/log.ts'
import { FOLLOWED } from '#shared/reactive/FOLLOWED.ts'
import { servedCellOf } from '#shared/reactive/index.ts'
import { matchesPattern } from '#shared/reactive/matchesPattern.ts'
import { PATCH_SINKS } from '#shared/reactive/PATCH_SINKS.ts'
import { unowned } from '#shared/reactive/watch.ts'
import { refuse } from '#shared/refuse.ts'
import type { BrowserFrame, ServerFrame } from '#shared/muxFrames.ts'
import type { Mounted } from './answerRpc.ts'
import { argsFor } from './argsFor.ts'
import { closedTo, crossingOrigin, crossingRefusal } from './crossingOrigin.ts'
import { failureOf } from './hooks.ts'
import {
    heldByApp,
    inOpenScope,
    type RequestScope,
    releaseScope,
    scopeFor,
} from './requestScope.ts'
import { patchesSince, versionOf } from './versionOf.ts'

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
        send(follower.peer, { op: member, id: follower.id })
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
            send(follower.peer, { op: member, id: follower.id })
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
    const serving =
        rpc.guarded && !follower.admitted
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

function send(peer: Peer, frame: ServerFrame): void {
    peer.send(JSON.stringify(frame))
}

function failure(error: unknown): Problem {
    return problemOf(failureOf(error))
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
        if (followed === undefined) {
            send(this.peer, {
                op: 'error',
                id,
                error: failure(
                    refuse(
                        404,
                        `No handler a browser follows answers at ${address}.`,
                    ),
                ),
            })
            return
        }
        // 18.2 — ANOTHER ORIGIN IS CLOSED OUT unless the handler declared it: the same gate, and the
        // same own origin, as its http answer's (16.13, 16.24, 36.2).
        if (closedTo(followed.handler.crossOrigin, this.crossing)) {
            send(this.peer, {
                op: 'error',
                id,
                error: failure(crossingRefusal(this.crossing, 'subscription')),
            })
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
            let admitted = !followed.handler.guarded
            if (!admitted) {
                subscriptions.get(id)?.()
                subscriptions.set(id, pending)
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
            send(this.peer, { op: 'error', id, error: failure(thrown) })
        }
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
    const encoder = new TextEncoder()
    let stop = (): void => {}
    let unhold = (): void => {}
    let ended = false
    return new ReadableStream({
        start(controller) {
            // AN EVENT STREAM OPENS ON A COMMENT, so a proxy has bytes to pass before the first event.
            controller.enqueue(encoder.encode(':\n\n'))
            // Ended by the app's stop as any body it holds open is, or that stop waits on it.
            unhold = heldByApp(() => {
                if (ended) return
                ended = true
                stop()
                controller.close()
            })
            stop = followWith(
                {
                    send(text) {
                        controller.enqueue(encoder.encode(eventOf(text)))
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

/**
 * One mux frame as the SSE event it is: `event`, `id` where it names a version, and `data`.
 *
 * 18.6 — READ OFF THE FRAME'S HEAD, never parsed: the body was serialized once for every follower
 * (`sendAll`), and a parse and a stringify per event stream would pay it again per follower. Every
 * frame this module writes is `{"op":…,"id":…`, numbers named `base` or `version`, and at most one
 * body last — so the body is the rest of the text, as it was written.
 */
function eventOf(text: string): string {
    const opEnd = text.indexOf('"', 7)
    const op = text.slice(7, opEnd)
    let id = ''
    let data =
        op === 'value' || op === 'error' ? 'null' : op === 'patch' ? '[]' : ''
    // Past `,"id":` — a number, so the next comma is the next member's.
    let at = text.indexOf(',', opEnd + 6)
    while (at !== -1) {
        const nameEnd = text.indexOf('"', at + 2)
        const name = text.slice(at + 2, nameEnd)
        const from = nameEnd + 2
        if (name !== 'base' && name !== 'version') {
            data = text.slice(from, -1)
            break
        }
        at = text.indexOf(',', from)
        if (name === 'version')
            id = `id: ${text.slice(from, at === -1 ? -1 : at)}\n`
    }
    return `event: ${op}\n${id}data: ${data}\n\n`
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
    let valueTail: string | undefined
    // ONE BODY PER VERSION A FOLLOWER STANDS AT, since followers a burst left at different places
    // along the chain are each sent the writes since their own.
    let patchTails: Map<number, string> | undefined
    for (const one of fed) {
        if (one.sent === version) continue
        // 18.11 — the writes, where the follower stands on the chain they were written along.
        const since = one.sent
        let patchTail = since === undefined ? undefined : patchTails?.get(since)
        if (patchTail === undefined && since !== undefined) {
            const ops = patchesSince(serving, since)
            if (ops !== undefined) {
                patchTail = `,"base":${since},"version":${version},"ops":${JSON.stringify(ops)}}`
                patchTails ??= new Map()
                patchTails.set(since, patchTail)
            }
        }
        if (patchTail === undefined) {
            if (valueTail === undefined) {
                const held = (serving as { peek(): unknown }).peek()
                valueTail =
                    held === undefined
                        ? `,"version":${version}}`
                        : `,"version":${version},"value":${JSON.stringify(held)}}`
            }
            one.peer.send(`{"op":"value","id":${one.id}${valueTail}`)
        } else one.peer.send(`{"op":"patch","id":${one.id}${patchTail}`)
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
