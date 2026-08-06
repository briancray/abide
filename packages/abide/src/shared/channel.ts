// `channel` — the third primitive: subscribe. `state` OWNS a value, `memo` LOADS one, `channel`
// RECEIVES them. It is the push face of the same atom, which is why it carries the same read
// vocabulary: iterate it, or call it.
//
// It is CALLABLE for the same reason a cell is — `feed()` is the latest message, subscribing the
// caller. A read has no second name here: every source spells it by being called.
//
// The reactive reads go through a `state` cell, so a component reading `feed()` re-renders on
// publish with no bridging code — the pub/sub side and the graph are not two systems.

import { markSource } from './internal/BRANDS.ts'
import { state } from './reactive.ts'

interface Received<T> {
    latest: T | undefined
    transcript: T[]
    got: boolean
}

const EMPTY: Received<never> = { latest: undefined, transcript: [], got: false }

export interface Channel<T> {
    /** Latest message, reactive. Subscribes the caller. */
    (): T | undefined
    publish(message: T): void
    /** Latest message, subscribing to nothing. */
    peek(): T | undefined
    /** Session transcript, capped at `tail`. Reactive. */
    chunks(): T[]
    /** Reactive: has anything arrived yet? */
    settled(): boolean
    /** Forget what has arrived. The verb means the same here as everywhere: this is no longer good. */
    invalidate(): void
    // A channel never loads, so these are always the cold answer — they are here so a reader can
    // treat any source alike rather than having to know which primitive it was handed.
    pending(): boolean
    refreshing(): boolean
    error(): unknown
    subscribe(listener: (message: T) => void): () => void
    [Symbol.asyncIterator](): AsyncIterator<T>
}

export interface ChannelOptions {
    /** How many past messages `chunks()` retains. Default 0 — latest only. */
    tail?: number
}

export function channel<T>(options: ChannelOptions = {}): Channel<T> {
    const tail = options.tail ?? 0
    const listeners = new Set<(message: T) => void>()
    // One cell holds the whole observable state, so a publish is one wake, not two.
    const cell = state<Received<T>>(EMPTY as Received<T>)

    // A channel is a SOURCE, so a slot reads it rather than rendering it. Without this the two
    // substrates disagreed: the server recurses through any function and printed the message, while
    // the client asks the brand and printed the channel's own source text.
    const self = markSource((() => cell().latest) as Channel<T>)

    self.publish = (message: T): void => {
        const held = cell.peek()
        let transcript = held.transcript
        if (tail > 0) {
            transcript = held.transcript.concat(message)
            if (transcript.length > tail) transcript = transcript.slice(-tail)
        }
        cell.set({ latest: message, transcript, got: true })
        // Delivery is against a SNAPSHOT: a listener that subscribes while this message is going out
        // must not receive it, and one that unsubscribes must still finish this round. The copy is
        // how that is spelled, and it costs an array per publish (32 ns against 18 ns) — so the two
        // sizes where a snapshot is provably the same thing as the live Set take the cheap path.
        // Nought and one are what a channel driving components actually holds.
        const size = listeners.size
        if (size === 0) return
        if (size === 1) {
            for (const listener of listeners) {
                listener(message)
                break
            }
            return
        }
        for (const listener of [...listeners]) listener(message)
    }
    self.peek = () => cell.peek().latest
    self.chunks = () => cell().transcript
    self.settled = () => cell().got
    self.invalidate = () => cell.set(EMPTY as Received<T>)
    self.pending = () => cell.pending()
    self.refreshing = () => cell.refreshing()
    self.error = () => cell.error()
    self.subscribe = (listener: (message: T) => void): (() => void) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
    }
    self[Symbol.asyncIterator] = async function* (): AsyncIterator<T> {
        const pending: T[] = []
        let wake: (() => void) | null = null
        const off = self.subscribe((message) => {
            pending.push(message)
            wake?.()
            wake = null
        })
        try {
            for (;;) {
                while (pending.length > 0) yield pending.shift() as T
                await new Promise<void>((resolve) => {
                    wake = resolve
                })
            }
        } finally {
            off()
        }
    }
    return self
}
