// SocketHub — the single-process pub/sub core behind `socket(...)` (sockets.md S1-S2).
//
// A hub is one named topic's in-memory state: a bounded tail ring buffer for replay and a set
// of live subscribers, each backed by its own bounded FIFO queue. `publish` is the server path
// (bypasses the handler); `ingressPublish` is the transport path for client publishes — it runs
// the content-mediation handler (transform → publish, DROP/void → drop, throw → reject) before
// fanning out. Delivery is at-most-once, best-effort: on a subscriber queue overflow the oldest
// message is dropped for that subscriber (S3.4).

import { Subscriber } from '../../shared/internal/subscriber.ts'
import type { SocketOptions } from '../socket.ts'

// A handler returning DROP (or nothing) suppresses the client publish. Exported so mediating
// handlers can signal an explicit drop without republishing.
export const DROP: unique symbol = Symbol('abide.socket.drop')

interface TailEntry<T> {
    message: T
    time: number
}

export class SocketHub<T> {
    readonly options: SocketOptions<T>
    private readonly tailSize: number
    private readonly ttl: number
    private readonly tail: TailEntry<T>[] = []
    private readonly subscribers = new Set<Subscriber<T>>()
    // The most-recently-published message, retained INDEPENDENT of `tail` size so a `tail: 0` socket
    // still has a `peek()` (client-sockets.md CS4.2). `ttl`-windowed on read.
    private last: TailEntry<T> | undefined

    constructor(options: SocketOptions<T>) {
        this.options = options
        this.tailSize = options.tail ?? 0
        this.ttl = options.ttl ?? Infinity
    }

    // Server publish — append to the tail buffer and fan out. Never runs the handler (S1.3).
    publish(message: T): void {
        const time = Date.now()
        this.last = { message, time }
        if (this.tailSize > 0) {
            this.tail.push({ message, time })
            while (this.tail.length > this.tailSize) this.tail.shift()
        }
        for (const subscriber of this.subscribers) subscriber.push(message)
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

    // Transport path for CLIENT publishes (S1.3-B). Runs the mediating handler; a returned value
    // is published (transform), DROP/undefined suppresses, a throw rejects to the publisher.
    async ingressPublish(message: T): Promise<void> {
        const handler = this.options.handler
        if (handler === undefined) {
            this.publish(message)
            return
        }
        const result = await handler(message)
        if (result === undefined || (result as unknown) === DROP) return
        this.publish(result as T)
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
