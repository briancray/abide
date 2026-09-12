// RETENTION — `tail` entries, `ttl` expiry, cursors, and 5.8's head replacement.
//
// 6.1 has retention APPEND-ONLY and 6.2 has raising `tail` cost a write nothing, so
// this is a pre-allocated circular buffer and a push is three indexed writes and a
// counter, whatever `tail` is. Rebuilding the retention per write is the revert those
// two clauses exist against, and it is ~1000x at `tail: 4096` against `tail: 4`.
//
// 6.6 forbids a timer per retained production and 6.9 orders ONE per ring, armed at
// the head's expiry; 6.10 has it not hold the process open. 6.5 is the other half —
// a production past its `ttl` is dropped on the read that follows — so the timer is
// what bounds memory and the read is what bounds correctness, and neither is alone.

// `tail: Infinity` is a live spelling (11.35, 11.41), and a pre-allocated array of it
// is not. Past this the ring grows by push instead, which costs an amortised
// reallocation rather than a per-write copy — still 6.2, and the only shape an
// unbounded retention can have.
//
// A FINITE `tail` PAST THE LIMIT IS STILL A CAP. It grows by push until it holds
// `limit` productions and becomes the circular form at that moment — one conversion,
// and every write after it is the same three indexed writes. Treating it as unbounded
// instead is the defect this note replaces: `tail: 100_000` retained every production
// ever written and `s.tail()` replayed all of them.
const PREALLOCATED_LIMIT = 1 << 16

export class Ring {
    values: unknown[]
    sequences: number[]
    stamps: number[]
    capacity: number
    // How far into `values` the oldest retained production sits.
    start: number
    count: number
    // What `tail` asked for, `Infinity` included. `capacity` is what is allocated and
    // this is what is RETAINED, and the two part company only while a finite ring past
    // the pre-allocation limit is still filling.
    limit: number
    ttl: number
    bounded: boolean
    timer: ReturnType<typeof setTimeout> | undefined

    constructor(tail: number, ttl: number) {
        const limit = Number.isFinite(tail)
            ? Math.max(1, Math.floor(tail))
            : Number.POSITIVE_INFINITY
        const bounded = limit <= PREALLOCATED_LIMIT
        const capacity = bounded ? limit : 0
        this.capacity = capacity
        this.values = bounded ? new Array(capacity) : []
        this.sequences = bounded ? new Array(capacity) : []
        this.stamps = bounded ? new Array(capacity) : []
        this.start = 0
        this.count = 0
        this.limit = limit
        this.ttl = ttl
        this.bounded = bounded
        this.timer = undefined
    }

    // THE CLOCK IS THE RING'S, and it is not taken unless it will be read. Measured:
    // `Date.now()` is 23.8 ns against a 31.4 ns write with nothing subscribed — three
    // quarters of the op, on every write, for a stamp that `expire` never looks at
    // where `ttl` is `Infinity`, which is the default. `produce` used to take it and
    // hand it down, so the cost was paid by every producer whether or not it retains
    // anything with a life.
    private now(): number {
        return this.ttl === Number.POSITIVE_INFINITY ? 0 : Date.now()
    }

    push(value: unknown, sequence: number): void {
        const now = this.now()
        if (!this.bounded) {
            this.values.push(value)
            this.sequences.push(sequence)
            this.stamps.push(now)
            this.count += 1
            // FULL, so the growing form becomes the circular one. The arrays hold
            // exactly `limit` productions in order, which is the bounded shape with
            // `start` at 0 — every write after this overwrites the oldest slot.
            if (this.count === this.limit) {
                this.capacity = this.limit
                this.bounded = true
                this.start = 0
            }
            this.arm(now)
            return
        }
        const at = (this.start + this.count) % this.capacity
        this.values[at] = value
        this.sequences[at] = sequence
        this.stamps[at] = now
        if (this.count === this.capacity)
            this.start = (this.start + 1) % this.capacity
        else this.count += 1
        this.arm(now)
    }

    // 5.8 on a room and 5.9 on `s.patch`: the head production is REPLACED rather than
    // appended to, so the ring does not grow and no sequence number is minted.
    replaceHead(value: unknown): void {
        if (this.count === 0) {
            this.push(value, 0)
            return
        }
        const now = this.now()
        const at = this.bounded
            ? (this.start + this.count - 1) % this.capacity
            : this.count - 1
        this.values[at] = value
        this.stamps[at] = now
    }

    // 6.5 — dropped on the READ that follows, which is what makes the answer right
    // even where the timer has not fired. 6.4: this wakes nobody.
    expire(): void {
        if (this.ttl === Number.POSITIVE_INFINITY || this.count === 0) return
        const now = this.now()
        while (this.count > 0) {
            const at = this.bounded ? this.start : 0
            if ((this.stamps[at] as number) + this.ttl > now) break
            if (this.bounded) this.start = (this.start + 1) % this.capacity
            else {
                this.values.shift()
                this.sequences.shift()
                this.stamps.shift()
            }
            this.count -= 1
        }
    }

    // Newest first, which is the order `s.tail` replays in: what is nearest the
    // current value is what a reader asked for first.
    snapshot(depth: number): unknown[] {
        this.expire()
        const take = Math.min(
            this.count,
            Number.isFinite(depth)
                ? Math.max(0, Math.floor(depth))
                : this.count,
        )
        const out: unknown[] = new Array(take)
        for (let at = 0; at < take; at += 1) {
            const index = this.bounded
                ? (this.start + this.count - 1 - at + this.capacity * 2) %
                  this.capacity
                : this.count - 1 - at
            out[at] = this.values[index]
        }
        return out
    }

    // The head's own sequence number, which is what `publish` hands back (9.7).
    head(): number {
        if (this.count === 0) return 0
        const at = this.bounded
            ? (this.start + this.count - 1) % this.capacity
            : this.count - 1
        return this.sequences[at] as number
    }

    private arm(now: number): void {
        if (this.ttl === Number.POSITIVE_INFINITY) return
        if (this.timer !== undefined) return
        const oldest = this.stamps[this.bounded ? this.start : 0] as number
        const delay = Math.max(0, oldest + this.ttl - now)
        // `setTimeout` rather than a bun-only timer: this module runs in a browser
        // too, and the isomorphism is the point.
        const timer = setTimeout(() => {
            this.timer = undefined
            this.expire()
            if (this.count > 0) this.arm(this.now())
        }, delay)
        // 6.10. Bun and node both hand back a `Timeout` with `unref`; a browser hands
        // back a number and has no process to hold open.
        ;(timer as { unref?: () => void }).unref?.()
        this.timer = timer
    }
}
