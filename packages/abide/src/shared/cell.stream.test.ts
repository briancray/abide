// Cell streaming integration — build step 1b (replayable-streams.md §2, §4, §Build).
//
// A handler that yields a raw AsyncIterable is wrapped in a ReplayableStream on the slot: concurrent /
// late reads fan out over ONE source run, ttl clocks from stream CLOSE, ttl:0 disposes on drain, and an
// open stream is never expired. Value-slot behavior is covered by the existing cell.test.ts (regression
// guard = the full suite staying green).

import { describe, expect, test } from 'bun:test'
import { cell } from './cell.ts'
import { effect } from './internal/reactive.ts'

async function drain<T>(iter: AsyncIterable<T>): Promise<{ values: T[]; thrown?: unknown }> {
    const values: T[] = []
    try {
        for await (const value of iter) values.push(value)
        return { values }
    } catch (thrown) {
        return { values, thrown }
    }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('cell streaming — one source run, fanned out', () => {
    test('two concurrent reads share ONE source run; each gets the full transcript', async () => {
        let runs = 0
        const c = cell<{ n: number }, AsyncIterable<number>>(async function* (args) {
            runs++
            for (let i = 0; i < args.n; i++) yield i
        })

        const [a, b] = await Promise.all([c({ n: 3 }), c({ n: 3 })])
        const [ra, rb] = await Promise.all([drain(a), drain(b)])
        expect(ra.values).toEqual([0, 1, 2])
        expect(rb.values).toEqual([0, 1, 2])
        expect(runs).toBe(1) // coalesced onto a single generation
    })

    test('a late joiner within ttl replays the full transcript with NO re-run', async () => {
        let runs = 0
        const c = cell<{ n: number }, AsyncIterable<number>>(
            async function* (args) {
                runs++
                for (let i = 0; i < args.n; i++) yield i
            },
            { ttl: 10_000 },
        )

        expect((await drain(await c({ n: 3 }))).values).toEqual([0, 1, 2]) // first read closes the stream
        expect((await drain(await c({ n: 3 }))).values).toEqual([0, 1, 2]) // late joiner replays
        expect(runs).toBe(1)
    })
})

describe('cell streaming — TTL lifecycle', () => {
    test('ttl:0 disposes on drain; the next read is a cold re-run', async () => {
        let runs = 0
        const c = cell<{ n: number }, AsyncIterable<number>>(
            async function* (args) {
                runs++
                for (let i = 0; i < args.n; i++) yield i
            },
            { ttl: 0 },
        )

        expect((await drain(await c({ n: 2 }))).values).toEqual([0, 1])
        expect(runs).toBe(1)
        expect((await drain(await c({ n: 2 }))).values).toEqual([0, 1]) // slot disposed on drain → re-run
        expect(runs).toBe(2)
    })

    test('the ttl clock starts at CLOSE: within-ttl replays, past-ttl re-runs', async () => {
        let runs = 0
        const c = cell<{ n: number }, AsyncIterable<number>>(
            async function* (args) {
                runs++
                for (let i = 0; i < args.n; i++) yield i
            },
            { ttl: 40 },
        )

        await drain(await c({ n: 2 })) // closes; loadedAt stamped at close
        expect(runs).toBe(1)
        expect((await drain(await c({ n: 2 }))).values).toEqual([0, 1]) // within ttl → replay
        expect(runs).toBe(1)

        await sleep(80) // exceed ttl-from-close
        expect((await drain(await c({ n: 2 }))).values).toEqual([0, 1]) // expired → re-run
        expect(runs).toBe(2)
    })
})

describe('cell streaming — reactive peek (latest) / chunks / done', () => {
    test('peek returns the latest chunk reactively; chunks/done reflect the transcript', async () => {
        const c = cell<Record<string, never>, AsyncIterable<number>>(async function* () {
            for (let i = 0; i < 3; i++) {
                await sleep(5)
                yield i
            }
        })

        // An effect reading `peek` (the latest chunk) re-runs as chunks arrive — reading it kicks the source.
        const seen: Array<number | undefined> = []
        const dispose = effect(() => {
            seen.push(c.peek({}) as number | undefined)
        })

        await sleep(60)
        dispose()

        expect(c.peek({}) as number | undefined).toBe(2) // most-recent chunk = the "current value"
        expect(c.chunks({})).toEqual([0, 1, 2]) // full transcript snapshot
        expect(c.done({})).toBe(true) // closed
        // the effect observed the progression, not just a single value
        expect(seen).toContain(0)
        expect(seen).toContain(1)
        expect(seen).toContain(2)
    })

    test('chunks/done are inert on a value cell; peek still returns the value', async () => {
        const c = cell<Record<string, never>, number>(() => 42)
        await c({})
        expect(c.peek({})).toBe(42) // value read: peek is the value, unchanged
        expect(c.chunks({})).toBeUndefined()
        expect(c.done({})).toBe(false)
    })

    test("error() surfaces a stream's terminal failure (not the slot state)", async () => {
        const boom = new Error('stream-err')
        const c = cell<Record<string, never>, AsyncIterable<number>>(async function* () {
            yield 0
            throw boom
        })
        await drain(await c({}))
        expect(c.error({})).toBe(boom)
    })
})

describe('cell streaming — error & invalidate', () => {
    test('a source that throws mid-stream replays the prefix then throws to every consumer', async () => {
        const boom = new Error('mid-stream')
        const c = cell<Record<string, never>, AsyncIterable<number>>(async function* () {
            yield 0
            yield 1
            throw boom
        })

        const { values, thrown } = await drain(await c({}))
        expect(values).toEqual([0, 1])
        expect(thrown).toBe(boom)
    })

    test('invalidate on an OPEN stream aborts the source and ends live consumers gracefully', async () => {
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        let runs = 0
        const c = cell<Record<string, never>, AsyncIterable<number>>(async function* () {
            runs++
            yield 0
            yield 1
            await gate // park the source open
            yield 2
        })

        const collected: number[] = []
        let caught: unknown
        const reader = (async () => {
            try {
                for await (const v of await c({})) collected.push(v)
            } catch (e) {
                caught = e
            }
        })()

        await sleep(10) // let 0,1 flush; source now parked
        expect(collected).toEqual([0, 1])

        c.invalidate({}) // abort the open stream
        await reader
        expect(collected).toEqual([0, 1]) // graceful end at chunks-so-far
        expect(caught).toBeUndefined() // abort is not an error to the consumer

        // Slot was reset to idle by invalidate → the next read is a fresh run.
        release() // let the dangling source generator unwind
        expect((await drain(await c({}))).values.slice(0, 2)).toEqual([0, 1])
        expect(runs).toBe(2)
    })

    test('invalidate on a retained (closed) stream drops it; the next read re-runs', async () => {
        let runs = 0
        const c = cell<Record<string, never>, AsyncIterable<number>>(
            async function* () {
                runs++
                yield 0
            },
            { ttl: 10_000 },
        )

        await drain(await c({}))
        expect(runs).toBe(1)
        c.invalidate({})
        await drain(await c({}))
        expect(runs).toBe(2)
    })
})
