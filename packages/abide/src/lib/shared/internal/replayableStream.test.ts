// ReplayableStream standalone primitive — build step 1a test matrix (replayable-streams.md §4, §Build).
//
// Cell-independent: exercises buffer + replay-then-live fan-out + terminals + ref-count + abort with no
// cache/TTL/LRU. Every invariant here must hold before the cell integration (step 1b) is attempted.

import { describe, expect, test } from 'bun:test'
import { ReplayableStream } from './replayableStream.ts'

// Drain an async iterable to completion, capturing a thrown terminal instead of rejecting.
async function drain<T>(iter: AsyncIterable<T>): Promise<{ values: T[]; thrown?: unknown }> {
    const values: T[] = []
    try {
        for await (const value of iter) values.push(value)
        return { values }
    } catch (thrown) {
        return { values, thrown }
    }
}

describe('ReplayableStream — single & concurrent consumers', () => {
    test('a single consumer receives every chunk in order until close', async () => {
        const rs = new ReplayableStream<number>()
        const consumer = drain(rs.consume())
        rs.push(0)
        rs.push(1)
        rs.push(2)
        rs.close()
        expect((await consumer).values).toEqual([0, 1, 2])
    })

    test('two concurrent consumers each receive the identical full transcript from ONE buffer', async () => {
        const rs = new ReplayableStream<number>()
        const a = drain(rs.consume())
        const b = drain(rs.consume())
        for (let n = 0; n < 5; n++) rs.push(n)
        rs.close()
        expect((await a).values).toEqual([0, 1, 2, 3, 4])
        expect((await b).values).toEqual([0, 1, 2, 3, 4])
        expect(rs.chunks.length).toBe(5) // one shared buffer, not one-per-consumer
    })

    test('100 concurrent consumers all receive the identical full transcript', async () => {
        const rs = new ReplayableStream<number>()
        const consumers = Array.from({ length: 100 }, () => drain(rs.consume()))
        const expected: number[] = []
        for (let n = 0; n < 20; n++) {
            rs.push(n)
            expected.push(n)
        }
        rs.close()
        const results = await Promise.all(consumers)
        for (const r of results) expect(r.values).toEqual(expected)
    })
})

describe('ReplayableStream — replay-then-live for late joiners', () => {
    test('a late joiner replays the buffered prefix then continues live, no gap or dup', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.push(1)
        rs.push(2)
        // Joiner attaches after 3 chunks are already buffered.
        const joiner = drain(rs.consume())
        rs.push(3)
        rs.push(4)
        rs.close()
        expect((await joiner).values).toEqual([0, 1, 2, 3, 4])
    })

    test('consume(from) replays from an offset then continues live', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.push(1)
        rs.push(2)
        const resumed = drain(rs.consume(1)) // skip index 0
        rs.push(3)
        rs.close()
        expect((await resumed).values).toEqual([1, 2, 3])
    })

    test('a joiner attaching after close replays the whole transcript', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.push(1)
        rs.close()
        // Attaches strictly after the terminal — the primitive always replays what it holds.
        expect((await drain(rs.consume())).values).toEqual([0, 1])
    })

    test('a chunk pushed while a caught-up consumer is parked is delivered exactly once, in order', async () => {
        const rs = new ReplayableStream<number>()
        const iter = rs.consume()
        rs.push(0)
        expect((await iter.next()).value).toBe(0)
        // Consumer is now caught up; the next pull parks a waiter (the live path).
        const pending = iter.next()
        rs.push(1) // wakes the parked waiter
        expect((await pending).value).toBe(1)
        rs.close()
        expect((await iter.next()).done).toBe(true)
    })
})

describe('ReplayableStream — error terminal', () => {
    test('a consumer sees the buffered prefix then throws the source error', async () => {
        const rs = new ReplayableStream<number>()
        const consumer = drain(rs.consume())
        rs.push(0)
        rs.push(1)
        rs.push(2)
        const boom = new Error('boom')
        rs.fail(boom)
        const { values, thrown } = await consumer
        expect(values).toEqual([0, 1, 2])
        expect(thrown).toBe(boom)
    })

    test('a late joiner on an already-errored stream replays-then-throws identically', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.push(1)
        const boom = new Error('late')
        rs.fail(boom)
        const { values, thrown } = await drain(rs.consume())
        expect(values).toEqual([0, 1])
        expect(thrown).toBe(boom)
    })
})

describe('ReplayableStream — abort terminal', () => {
    test('abort ends live consumers at chunks-so-far without throwing, and calls onAbort once', async () => {
        let aborts = 0
        const rs = new ReplayableStream<number>({
            onAbort: () => {
                aborts++
            },
        })
        const consumer = drain(rs.consume())
        rs.push(0)
        rs.push(1)
        rs.abort()
        const { values, thrown } = await consumer
        expect(values).toEqual([0, 1])
        expect(thrown).toBeUndefined() // abort is a graceful terminal, not an error
        expect(aborts).toBe(1)
        rs.abort() // idempotent — no second source cancel
        expect(aborts).toBe(1)
    })

    test('a joiner racing an abort replays the prefix then ends', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.push(1)
        rs.abort()
        expect((await drain(rs.consume())).values).toEqual([0, 1])
    })
})

describe('ReplayableStream — frozen after terminal & ref-counting', () => {
    test('push after any terminal is ignored (transcript frozen)', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.close()
        rs.push(1)
        rs.fail(new Error('x'))
        rs.abort()
        expect(rs.chunks).toEqual([0])
        expect(rs.done).toBe(true)
        expect(rs.errored).toBe(false) // first terminal wins
    })

    test('bytes accumulate per chunk and stop at the terminal', () => {
        const rs = new ReplayableStream<string>()
        rs.push('ab') // JSON.stringify("ab") === '"ab"' → length 4
        rs.push('c') //  '"c"' → length 3
        const settled = rs.bytes
        expect(settled).toBe(7)
        rs.close()
        rs.push('ignored')
        expect(rs.bytes).toBe(settled)
    })

    test('onPush fires once per appended chunk and never after a terminal', () => {
        let pushes = 0
        const rs = new ReplayableStream<number>({ onPush: () => pushes++ })
        rs.push(0)
        rs.push(1)
        expect(pushes).toBe(2)
        rs.close()
        rs.push(2) // frozen — ignored
        expect(pushes).toBe(2)
    })

    test('refCount tracks active iteration and returns to 0 on completion and on early break', async () => {
        const rs = new ReplayableStream<number>()
        rs.push(0)
        rs.push(1)

        // A delivered chunk resolves .next() (a caught-up consumer would otherwise park forever).
        const iter = rs.consume()
        expect((await iter.next()).value).toBe(0)
        expect(rs.refCount).toBe(1)

        // A second consumer that breaks early must decrement.
        const breaker = rs.consume()
        expect((await breaker.next()).value).toBe(0)
        expect(rs.refCount).toBe(2)
        await breaker.return(undefined) // early exit runs the generator's finally
        expect(rs.refCount).toBe(1)

        rs.close()
        await drain(iter) // finish the first consumer
        expect(rs.refCount).toBe(0)
    })
})
