// ChannelHub — the single-process pub/sub core behind ONE room of a `channel(...)` (ADR 0023).
//
// A hub is one topic's in-memory state: a bounded tail ring buffer for replay and a set of live
// subscribers, each backed by its own bounded FIFO queue. `publish` appends to the tail and fans out.
// Delivery is at-most-once, best-effort: on a subscriber queue overflow the oldest message is dropped
// for that subscriber (S3.4).
//
// This is pure pub/sub with NO transport, auth, or mediation — that is why it lives in `shared`: the
// same hub backs a `channel` on the server AND in the browser. `socket = channel + transport` layers
// the mediator (`clientPublish`/`DROP`) and per-room auth on top, in `server/socket.ts`.

import { Subscriber } from './subscriber.ts'

interface TailEntry<T> {
    message: T
    time: number
}

// The hub's own config — deliberately NOT a socket's options, so the pub/sub core carries no transport
// vocabulary. `channel`'s public `maxAge` maps onto `ttl` here.
export interface ChannelHubOptions {
    tail?: number
    ttl?: number
}

export class ChannelHub<T> {
    private readonly tailSize: number
    private readonly ttl: number
    private readonly tail: TailEntry<T>[] = []
    private readonly subscribers = new Set<Subscriber<T>>()
    // The most-recently-published message, retained INDEPENDENT of `tail` size so a `tail: 0` channel
    // still has a `peek()` (client-sockets.md CS4.2). `ttl`-windowed on read.
    private last: TailEntry<T> | undefined

    constructor(options: ChannelHubOptions) {
        this.tailSize = options.tail ?? 0
        this.ttl = options.ttl ?? Infinity
    }

    // Publish — append to the tail buffer and fan out. The mediator, if any, ran in the socket layer above (S1.3).
    publish(message: T): void {
        const time = Date.now()
        this.last = { message, time }
        if (this.tailSize > 0) {
            this.tail.push({ message, time })
            while (this.tail.length > this.tailSize) this.tail.shift()
        }
        for (const subscriber of this.subscribers) subscriber.push(message)
    }

    // No live subscriber on this room. Backs the isomorphic `done()` probe (ADR 0023: "true-when-idle,
    // then false once live"), which is a LIFECYCLE axis and not one of the three genuinely degenerate
    // ones. Note `snapshotIterator` registers nothing, so an SSR render leaves the room idle — which is
    // exactly `client-sockets.md` CS5.1's "`done()===true` post-render".
    get idle(): boolean {
        return this.subscribers.size === 0
    }

    // Drop the retained state (tail + last) WITHOUT detaching live subscribers — the room's `invalidate`:
    // future joiners replay nothing until the next publish; current subscribers keep receiving live.
    clearTail(): void {
        this.tail.length = 0
        this.last = undefined
    }

    // The `ttl`-windowed latest message — backs the isomorphic `peek()` (CS4.2). `undefined` before
    // the first publish or once the last message ages past `ttl` (matches what a fresh subscriber
    // would replay). `ttl: Infinity` (the default) → sticky.
    peekLatest(): T | undefined {
        const last = this.last
        if (last === undefined) return undefined
        if (Date.now() - last.time > this.ttl) return undefined
        return last.message
    }

    // A one-shot snapshot of the in-window tail (last-N within ttl, S2) — the MCP tail tool's
    // request/response view (MS2.2). Ordered oldest→newest, same window a fresh subscriber replays.
    tailSnapshot(): T[] {
        const now = Date.now()
        const messages: T[] = []
        for (const entry of this.tail) {
            if (now - entry.time <= this.ttl) messages.push(entry.message)
        }
        return messages
    }

    // A snapshot-then-complete iterator (client-sockets.md CS5): yields the in-window tail, then
    // COMPLETES instead of registering a live subscriber. This is what a socket's `[Symbol.asyncIterator]`
    // resolves to INSIDE an SSR page render — a live topic never closes, so iterating it live would hang
    // the render; snapshot-then-done renders the backlog into initial HTML and lets the render finish.
    snapshotIterator(): AsyncIterator<T> {
        const messages = this.tailSnapshot()
        let index = 0
        return {
            next: (): Promise<IteratorResult<T>> => {
                if (index < messages.length) {
                    const value = messages[index] as T
                    index++
                    return Promise.resolve({ value, done: false })
                }
                return Promise.resolve({ value: undefined, done: true })
            },
            return: (): Promise<IteratorResult<T>> => {
                index = messages.length
                return Promise.resolve({ value: undefined, done: true })
            },
        }
    }

    // Subscribe = replay the in-window tail, then live messages, over a bounded FIFO iterator.
    // Snapshot + registration are synchronous, so no publish can interleave and break FIFO.
    // `replay: false` (client-sockets.md CS5, the hydration join) skips the tail replay and registers
    // a live-only subscriber — SSR already painted the backlog, so the live sub owns tail-forward.
    subscribe(replay = true): AsyncIterator<T> {
        const subscriber = new Subscriber<T>()
        if (replay) {
            const now = Date.now()
            for (const entry of this.tail) {
                if (now - entry.time <= this.ttl) subscriber.push(entry.message)
            }
        }
        this.subscribers.add(subscriber)

        const subscribers = this.subscribers
        return {
            next: (): Promise<IteratorResult<T>> => subscriber.next(),
            return: (): Promise<IteratorResult<T>> => {
                subscribers.delete(subscriber)
                subscriber.close()
                return Promise.resolve({ value: undefined, done: true })
            },
        }
    }
}
