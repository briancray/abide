import { describe, expect, test } from 'bun:test'
import { state } from './internal/reactive.ts'
import { watch } from './watch.ts'

// Effect re-runs are microtask-batched; a macrotask tick guarantees they have flushed.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('watch(thunk) — the auto-tracked effect', () => {
    test('runs immediately and again on every tracked read', async () => {
        const count = state(0)
        const seen: number[] = []
        const stop = watch(() => {
            seen.push(count())
        })
        expect(seen).toEqual([0]) // seeded on construction
        count.set(1)
        await tick()
        count.set(2)
        await tick()
        expect(seen).toEqual([0, 1, 2])
        stop()
    })

    test('the disposer detaches it', async () => {
        const count = state(0)
        let runs = 0
        const stop = watch(() => {
            count()
            runs++
        })
        stop()
        count.set(1)
        await tick()
        expect(runs).toBe(1)
    })
})

describe('watch(source, handler) — one declared input', () => {
    test('fires on CHANGE only, never on the initial read', async () => {
        const count = state(0)
        const seen: Array<[number, number]> = []
        const stop = watch(count, (next, previous) => seen.push([next, previous]))
        expect(seen).toEqual([]) // not on the initial read
        count.set(1)
        await tick()
        count.set(2)
        await tick()
        expect(seen).toEqual([
            [1, 0],
            [2, 1],
        ])
        stop()
    })

    test('the handler runs untracked — its own reads do not subscribe', async () => {
        const count = state(0)
        const other = state(100)
        let runs = 0
        const stop = watch(count, () => {
            other()
            runs++
        })
        count.set(1)
        await tick()
        expect(runs).toBe(1)
        other.set(200) // read inside the handler, never a declared input
        await tick()
        expect(runs).toBe(1)
        stop()
    })
})

// The RETURNED TEARDOWN is the cleanup half of the effect — the same hook a component unmount fires,
// which is why the grammar needs no `onDestroy`.
describe('the returned teardown', () => {
    test('a thunk teardown runs before each re-run and once on dispose', async () => {
        const count = state(0)
        const events: string[] = []
        const stop = watch(() => {
            const at = count()
            events.push(`run:${at}`)
            return () => events.push(`clean:${at}`)
        })
        expect(events).toEqual(['run:0']) // nothing to clean up yet

        count.set(1)
        await tick()
        expect(events).toEqual(['run:0', 'clean:0', 'run:1']) // cleanup precedes the re-run

        stop()
        expect(events).toEqual(['run:0', 'clean:0', 'run:1', 'clean:1'])

        count.set(2) // detached — no further run, and no second cleanup
        await tick()
        expect(events).toEqual(['run:0', 'clean:0', 'run:1', 'clean:1'])
    })

    test('a handler teardown runs the same way — the two forms are symmetric', async () => {
        const count = state(0)
        const events: string[] = []
        const stop = watch(count, (next) => {
            events.push(`run:${next}`)
            return () => events.push(`clean:${next}`)
        })
        expect(events).toEqual([]) // change-only: no run, so nothing to clean

        count.set(1)
        await tick()
        expect(events).toEqual(['run:1'])

        count.set(2)
        await tick()
        expect(events).toEqual(['run:1', 'clean:1', 'run:2'])

        stop()
        expect(events).toEqual(['run:1', 'clean:1', 'run:2', 'clean:2'])
    })
})

// Several inputs need no API of their own (ADR 0025) — they are just what the source thunk returns.
describe('watch(() => ({ a, b }), handler) — several inputs via the thunk', () => {
    test('every read inside the thunk is tracked, and next/previous carry all of them', async () => {
        const a = state(1)
        const b = state(10)
        const seen: Array<{ next: { a: number; b: number }; previous: { a: number; b: number } }> =
            []
        const stop = watch(
            () => ({ a: a(), b: b() }),
            (next, previous) => seen.push({ next, previous }),
        )
        expect(seen).toEqual([]) // change-only, as with one source

        a.set(2)
        await tick()
        expect(seen).toHaveLength(1)
        expect(seen[0]?.next).toEqual({ a: 2, b: 10 })
        expect(seen[0]?.previous).toEqual({ a: 1, b: 10 })

        b.set(20) // the SECOND read drives it too
        await tick()
        expect(seen).toHaveLength(2)
        expect(seen[1]?.next).toEqual({ a: 2, b: 20 })
        expect(seen[1]?.previous).toEqual({ a: 2, b: 10 })

        stop()
    })

    test('the disposer detaches every read', async () => {
        const a = state(1)
        const b = state(10)
        let runs = 0
        const stop = watch(
            () => ({ a: a(), b: b() }),
            () => {
                runs++
            },
        )
        a.set(2)
        await tick()
        expect(runs).toBe(1)
        stop()
        a.set(3)
        b.set(20)
        await tick()
        expect(runs).toBe(1)
    })
})
