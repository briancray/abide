// A single live consumer of a pub/sub topic: a bounded FIFO with one waiter slot. Single-consumer
// by construction — exactly one iterator drains it, so a lone `waiting` resolver is sufficient. On
// overflow the OLDEST queued message is dropped (at-most-once, best-effort; sockets.md S3.4).
//
// Lifted to `lib/shared/internal` (client-sockets.md CS3) so BOTH the server hub (`socketHub`) and
// the browser socket proxy (`socketProxy`) queue identically — one FIFO implementation, isomorphic
// overflow behavior. Transport-free: a producer calls `push`, the lone consumer awaits `next`.

const DEFAULT_CAPACITY = 1024

export class Subscriber<T> {
    private readonly queue: T[] = []
    private readonly capacity: number
    private waiting: ((result: IteratorResult<T>) => void) | null = null
    private closed = false

    constructor(capacity: number = DEFAULT_CAPACITY) {
        this.capacity = capacity
    }

    push(message: T): void {
        if (this.closed) return
        if (this.waiting !== null) {
            const resolve = this.waiting
            this.waiting = null
            resolve({ value: message, done: false })
            return
        }
        this.queue.push(message)
        // Overflow: drop OLDEST for this subscriber (at-most-once, best-effort).
        if (this.queue.length > this.capacity) this.queue.shift()
    }

    next(): Promise<IteratorResult<T>> {
        if (this.queue.length > 0) {
            return Promise.resolve({ value: this.queue.shift() as T, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
            this.waiting = resolve
        })
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        if (this.waiting !== null) {
            const resolve = this.waiting
            this.waiting = null
            resolve({ value: undefined, done: true })
        }
    }
}
