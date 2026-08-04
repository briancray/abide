// Memo streaming integration — build step 1b (replayable-streams.md §2, §4, §Build).
//
// A handler that yields a raw AsyncIterable is wrapped in a ReplayableStream on the slot: concurrent /
// late reads fan out over ONE source run, ttl clocks from stream CLOSE, ttl:0 disposes on drain, and an
// open stream is never expired. Value-slot behavior is covered by the existing memo.test.ts (regression
// guard = the full suite staying green).

import { describe, expect, test } from 'bun:test'
import { until } from '../test/internal/until.ts'
import { effect } from './internal/reactive.ts'
import { memo } from './memo.ts'

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

describe('memo streaming — one source run, fanned out', () => {
    test('two concurrent reads share ONE source run; each gets the full transcript', async () => {
        let runs = 0
        const c = memo<{ n: number }, AsyncIterable<number>>(async function* (args) {
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
        const c = memo<{ n: number }, AsyncIterable<number>>(
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

describe('memo streaming — TTL lifecycle', () => {
    test('ttl:0 disposes on drain; the next read is a cold re-run', async () => {
        let runs = 0
        const c = memo<{ n: number }, AsyncIterable<number>>(
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
        const c = memo<{ n: number }, AsyncIterable<number>>(
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

describe('memo streaming — reactive peek (latest) / chunks / done', () => {
    test('peek returns the latest chunk reactively; chunks/done reflect the transcript', async () => {
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
            for (let i = 0; i < 3; i++) {
                await sleep(5)
                yield i
            }
        })

        // An effect reading `peek` (the latest chunk) re-runs as chunks arrive — reading it kicks the source.
        const seen: Array<number | undefined> = []
        const dispose = effect(() => {
            seen.push(c.live({}) as number | undefined)
        })

        // Waited for, not slept past: three 5ms chunks are ~15ms of work and the sleep was 60ms, which
        // only looks like margin until the suite's other fifteen files are on the same scheduler.
        await until('the stream closed', () => c.done({}))
        dispose()

        expect(c.live({}) as number | undefined).toBe(2) // most-recent chunk = the "current value"
        expect(c.chunks({})).toEqual([0, 1, 2]) // full transcript snapshot
        expect(c.done({})).toBe(true) // closed
        // the effect observed the progression, not just a single value
        expect(seen).toContain(0)
        expect(seen).toContain(1)
        expect(seen).toContain(2)
    })

    test('chunks/done are inert on a value memo; peek still returns the value', async () => {
        const c = memo<Record<string, never>, number>(() => 42)
        await c({})
        expect(c.live({})).toBe(42) // value read: peek is the value, unchanged
        expect(c.chunks({})).toBeUndefined()
        expect(c.done({})).toBe(false)
    })

    test("error() surfaces a stream's terminal failure (not the slot state)", async () => {
        const boom = new Error('stream-err')
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
            yield 0
            throw boom
        })
        await drain(await c({}))
        expect(c.error({})).toBe(boom)
    })
})

describe('memo streaming — error & invalidate', () => {
    test('a source that throws mid-stream replays the prefix then throws to every consumer', async () => {
        const boom = new Error('mid-stream')
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
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
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
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

        // The source parks on `gate` after yielding 1, so this cannot overshoot however long it waits —
        // which is exactly why it can be a condition instead of a guess at how long two yields take.
        await until('0 and 1 flushed to the consumer', () => collected.length === 2)
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
        const c = memo<Record<string, never>, AsyncIterable<number>>(
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

// The distinction these two probes exist for. `done` is `close()` ALONE, so it cannot see a stream that
// stopped without finishing — and "stopped without finishing" is every interesting failure: a timeout, an
// invalidate, a buffer-cap overflow. A view rendering a spinner off `!done()` spins forever on all three.
describe('memo streaming — settled/streaming vs done', () => {
    test('a stream that FAILS is settled but never done', async () => {
        const boom = new Error('mid-stream')
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
            yield 0
            throw boom
        })

        await drain(await c({}))

        // The whole point: `done` says "still going" about a transcript that threw and will never
        // deliver another chunk. `settled` reads the terminal union, so it says "ended".
        expect(c.done({})).toBe(false)
        expect(c.settled({})).toBe(true)
        expect(c.streaming({})).toBe(false)
        expect(c.error({})).toBe(boom)
    })

    test('a stream ABORTED by invalidate is settled but never done', async () => {
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
            for (let i = 0; i < 100; i++) {
                await sleep(5)
                yield i
            }
        })

        void c.live({}) // kick the source
        await until('the source is open and delivering', () => c.streaming({}))
        expect(c.streaming({})).toBe(true) // open and delivering

        c.invalidate({})
        // `invalidate` drops the slot, so the probes answer about a fresh COLD slot rather than the
        // aborted transcript — cold is neither streaming nor settled, which is the "never asked" reading.
        expect(c.streaming({})).toBe(false)
        expect(c.settled({})).toBe(false)
    })

    test('the three states are disjoint across one stream lifetime', async () => {
        const c = memo<Record<string, never>, AsyncIterable<number>>(async function* () {
            await sleep(10)
            yield 0
            await sleep(10)
            yield 1
        })

        // COLD: none of the three claims it. This is the reading `pending`/`peek` alone cannot give —
        // both answer identically for a slot never asked for and a slot holding a settled `undefined`.
        expect(c.pending({})).toBe(false)
        expect(c.streaming({})).toBe(false)
        expect(c.settled({})).toBe(false)

        void c.live({}) // kick
        // STREAMING: waited for rather than slept to. Stopping at the FIRST chunk is also what makes
        // the `settled` assertion below meaningful — a fixed 15ms could land anywhere in the stream's
        // life, including after it ended, at which point it would be asserting the wrong phase.
        await until('the first chunk opened the stream', () => c.streaming({}))
        expect(c.streaming({})).toBe(true)
        expect(c.settled({})).toBe(false)

        await until('the stream ended', () => c.settled({}))
        expect(c.streaming({})).toBe(false)
        expect(c.settled({})).toBe(true)
        expect(c.done({})).toBe(true) // closed CLEANLY, so here done and settled agree
    })

    test('streaming()/settled() OBSERVE: asking does not start the source', async () => {
        let calls = 0
        // The counter sits OUTSIDE the generator on purpose. An async generator's body does not run
        // until the first `next()`, so a `calls++` inside one stays 0 through a `startLoad` that has
        // already created the iterator — this test passed against a deliberately-kicking implementation
        // until the counter moved out here.
        //
        // The memo takes a DECLARED ARG for the second half of the same reason: an argless memo is
        // `autoEligible`, so any probe calling `resolveMode` runs the body once to classify it (see the
        // sibling test below). The observe-only claim is about the probe's own path, not about
        // classification, and only a keyed memo isolates the two.
        const c = memo<{ id: number }, AsyncIterable<number>>((_args) => {
            calls++
            return (async function* () {
                yield 0
            })()
        })

        // The ACTIVE/STATUS split (client-sockets.md CS4.1). `chunks` kicks a cold slot; these two
        // must not, or a `{#if feed.streaming()}` guard would be what causes the streaming it guards.
        expect(c.streaming({ id: 1 })).toBe(false)
        expect(c.settled({ id: 1 })).toBe(false)
        expect(calls).toBe(0)
        expect(c.pending({ id: 1 })).toBe(false) // and the slot is still COLD, not merely un-run

        await drain(await c({ id: 1 }))
        expect(calls).toBe(1)
    })

    test('chunks() still KICKS — the contrast the ACTIVE/STATUS split rests on', async () => {
        let calls = 0
        const c = memo<{ id: number }, AsyncIterable<number>>((_args) => {
            calls++
            return (async function* () {
                await sleep(5)
                yield 0
            })()
        })

        c.chunks({ id: 1 })
        expect(calls).toBe(1) // ACTIVE: reading the transcript is what opens it
    })

    // The ARGLESS shape, which is where a probe's kick used to hide. An argless memo is `autoEligible`, so
    // anything calling `resolveMode` classifies it by RUNNING the body — and on a deferred body that starts
    // the source. No status probe classifies any more, so asking costs nothing on this shape either.
    test('on an ARGLESS memo, no status probe runs the body', async () => {
        let calls = 0
        const c = memo<void, AsyncIterable<number>>(() => {
            calls++
            return (async function* () {
                yield 0
            })()
        })

        expect(c.settled()).toBe(false)
        expect(c.streaming()).toBe(false)
        expect(c.done()).toBe(false)
        expect(c.error()).toBeUndefined()
        expect(calls).toBe(0)

        // `chunks` is the transcript READ and still acquires — the contrast that keeps the line visible.
        c.chunks()
        expect(calls).toBe(1)
    })

    test('a value memo is settled once loaded, and never streaming', async () => {
        const c = memo<Record<string, never>, number>(async () => 42)

        expect(c.settled({})).toBe(false) // cold
        await c({})
        expect(c.settled({})).toBe(true)
        expect(c.streaming({})).toBe(false)
        expect(c.done({})).toBe(false) // a scalar slot has no transcript to close
    })

    test('a rejected value memo is settled — the error channel is an outcome', async () => {
        const boom = new Error('nope')
        const c = memo<Record<string, never>, number>(async () => {
            throw boom
        })

        await c({}).catch(() => {})
        expect(c.settled({})).toBe(true)
        expect(c.error({})).toBe(boom)
    })
})
