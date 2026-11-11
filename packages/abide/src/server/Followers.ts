// 18.3 — WHO FOLLOWS WHAT, for one app: every subscription to a handler, by handler, whichever lane
// it came over — a socket on the mux, or an event stream (18.20) — and the one feed per value served
// that its followers share (18.6). The mux and the http lane subscribe; a trigger, a sweep and an
// answer reach them.
//
// A TRIGGER REACHES EVERY APP'S FOLLOWERS in the process: `rpc.invalidate({ id })` inside one request
// reaches every browser holding that key, whichever connection it came over, and two apps in one
// process share their `global` entries (42.12). So an app's followers are filed on `RPC_SERVER` for
// as long as anyone follows, which is what the in-process trigger walks.

import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import type { ServerFrame } from '#shared/muxFrames.ts'
import { matchesPattern } from '#shared/reactive/matchesPattern.ts'
import { followServed } from '#shared/reactive/producer.ts'
import { unowned } from '#shared/reactive/watch.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'

import { fileIn } from './fileIn.ts'
import type { FollowedHandler } from './mountHandlers.ts'
import { heldByApp } from './requestScope.ts'
import { EVENT_STREAM_OPENER, streamEvent } from './streamEvent.ts'
import { patchesSince, versionOf } from './versionOf.ts'

const ENCODER = new TextEncoder()

/**
 * One `ServerFrame`, for every follower it is sent to.
 *
 * 18.6 — ITS BODY IS SERIALIZED ONCE PER VERSION, and each encoding of it once however many
 * followers it reaches: a socket is sent the JSON with its follower's id spliced in, and an event
 * stream the event, which names no follower and is the same text for every stream.
 */
export class Frame {
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
export type Peer = {
    send(id: number, frame: Frame): void
    close(code: number, reason: string): unknown
}

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

type HandlerFollowers = {
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

// 18.6 — ONE WATCH PER VALUE SERVED, however many follow it, and each frame's body serialized once
// per version: every follower standing where the others stand is sent the same bytes, with its own
// id spliced in front.
type Feed = {
    fed: Set<Follower>
    landed: boolean
    stop: () => void
}

/** Every follower one app holds, and the feeds they share. */
export class Followers {
    private readonly handlers = new Map<object, HandlerFollowers>()
    private readonly feeds = new WeakMap<object, Feed>()
    // How many follow, which files these followers where a trigger reaches them while any do.
    private following = 0

    /**
     * Follows `followed` for `id` on `peer`: its triggers always, its value where `global` and
     * admitted; returns what stops it.
     *
     * 18.3, 18.8. STATE, NOT A LOG: nothing is replayed. 18.6 — the value is sent where the version
     * the subscription named (`held`) is not the one standing, and after that once per change, a
     * burst in one turn going out as the value it left.
     */
    follow(
        peer: Peer,
        id: number,
        followed: FollowedHandler,
        args: unknown,
        held: number | undefined,
        admitted: boolean,
    ): () => void {
        const rpc = followed.handler
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
        this.attach(rpc, follower)
        let handlerFollowers = this.handlers.get(rpc)
        if (handlerFollowers === undefined) {
            handlerFollowers = {
                tags: followed.copy?.tags,
                all: new Set(),
                byKey: new Map(),
            }
            this.handlers.set(rpc, handlerFollowers)
        }
        // A key nobody follows leaves, or the index grows with every key ever followed.
        const unfile = fileIn(handlerFollowers.byKey, key, follower, undefined)
        const all = handlerFollowers.all
        all.add(follower)
        if (this.following++ === 0) RPC_SERVER.following.add(this)
        return () => {
            follower.stopFeed?.()
            if (all.delete(follower) && --this.following === 0)
                RPC_SERVER.following.delete(this)
            unfile()
        }
    }

    /**
     * `followed` followed as an event stream: the same follow a browser's mux makes, written as SSE.
     *
     * 18.20 — EACH MUX FRAME IS ONE EVENT, field for field: its `op` the event's name, its version
     * the event's `id`, and what it carries the `data` — the value for `value`, the JSON Patch for
     * `patch`, nothing for a trigger. So an `EventSource` reconnecting hands the version back as
     * `Last-Event-ID`, which is `held` here, and is sent nothing until the value moves past it.
     */
    events(
        followed: FollowedHandler,
        args: unknown,
        held: number | undefined,
    ): ReadableStream<Uint8Array> {
        let stop = (): void => {}
        let unhold = (): void => {}
        let ended = false
        return new ReadableStream({
            start: (controller) => {
                controller.enqueue(EVENT_STREAM_OPENER)
                // Ended by the app's stop as any body it holds open is, or that stop waits on it.
                unhold = heldByApp(() => {
                    if (ended) return
                    ended = true
                    stop()
                    controller.close()
                })
                stop = this.follow(
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
                    followed,
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

    /** A trigger on `rpc`, narrowed by the pattern it was handed as the handler's own entries are. 7.10, 7.18, 13.12. */
    broadcast(
        rpc: object,
        member: 'invalidate' | 'refresh',
        pattern: unknown,
    ): void {
        const handlerFollowers = this.handlers.get(rpc)
        if (handlerFollowers === undefined) return
        for (const follower of handlerFollowers.all) {
            if (!matchesPattern(follower.args, pattern)) continue
            // A fed copy is refreshed by the production the reload mints (7.18), and invalidated
            // through the cell it is fed from (`followServed`), whichever trigger reached it — where
            // the entry it is fed from is still the one standing.
            if (this.attach(rpc, follower) !== undefined) continue
            follower.peer.send(follower.id, TRIGGERS[member])
        }
    }

    /**
     * 13.15 — A SWEEP REACHES EVERY COPY A BROWSER FOLLOWS that carries one of its `tags`, or every
     * copy where it is bare, as that copy's own trigger. A fed copy is skipped for `broadcast`'s
     * reason: the sweep reloaded the entry it is fed from here, and the production that mints is
     * its refresh.
     */
    sweep(member: 'invalidate' | 'refresh', tags: string[] | null): void {
        for (const [rpc, handlerFollowers] of this.handlers) {
            if (tags !== null && !sharesTag(handlerFollowers.tags, tags))
                continue
            for (const follower of handlerFollowers.all) {
                if (this.attach(rpc, follower) !== undefined) continue
                follower.peer.send(follower.id, TRIGGERS[member])
            }
        }
    }

    /**
     * 18.8 — AN ENTRY ANSWERED THAT NOBODY IS FED FROM: one made after a follower subscribed for its
     * args, or rebuilt after the one it was fed from was evicted. An entry already fed is the common
     * answer, and asks nothing more; one that is not reaches the followers filed under its key.
     */
    served(rpc: object, serving: unknown, key: string): void {
        if (this.feeds.has(serving as object)) return
        const followers = this.handlers.get(rpc)?.byKey.get(key)
        if (followers === undefined) return
        for (const follower of followers) this.attach(rpc, follower)
    }

    /**
     * Feeds the follower from the entry standing for its args; returns what it is fed from now.
     *
     * Only where that entry is not the one it is fed from already.
     */
    private attach(rpc: object, follower: Follower): unknown {
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
            serving === undefined ? undefined : this.feed(serving, follower)
        return serving
    }

    private feed(serving: unknown, fed: Follower): () => void {
        const shared =
            this.feeds.get(serving as object) ?? this.startFeed(serving)
        shared.fed.add(fed)
        if (shared.landed) sendAll(serving, [fed])
        return () => {
            shared.fed.delete(fed)
            if (shared.fed.size === 0) shared.stop()
        }
    }

    private startFeed(serving: unknown): Feed {
        const fed = new Set<Follower>()
        // 18.11 — A VALUE FED TO A FOLLOWER KEEPS ITS PATCHES AS DATA while anyone is fed it, and
        // 7.10 — an invalidate of the value, however it was spelled, reaches every copy it feeds.
        const release = followServed(serving, () => {
            for (const one of fed) one.peer.send(one.id, TRIGGERS.invalidate)
        })
        const feeds = this.feeds
        const shared: Feed = {
            fed,
            landed: false,
            stop: () => {
                stopWatch()
                release()
                feeds.delete(serving as object)
            },
        }
        feeds.set(serving as object, shared)
        // UNOWNED: the feed is stopped when its last follower leaves, and the request it may have
        // been started in is answered long before that (12.5).
        const stopWatch = unowned(() =>
            (serving as { watch(effect: () => void): () => void }).watch(() => {
                shared.landed = true
                sendAll(serving, fed)
            }),
        )
        return shared
    }
}

function sharesTag(held: string[] | undefined, swept: string[]): boolean {
    if (held === undefined) return false
    for (const tag of swept) if (held.includes(tag)) return true
    return false
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
