// The node's own clauses — what a read returns, what a write does to the status
// bitfield, and the two ordering defects that are gates rather than correctness tests
// only because nothing about the rendered output moves when they bite.

import { expect, test } from 'bun:test'
import {
    type Failed,
    memo,
    refuse,
    state,
    structural,
    watch,
} from '#shared/index.ts'
// 12.12 — a write schedules its readers, so a case asserting a RUN COUNT drains the
// queue where a tick would have.
import { flushEffects } from '#shared/reactive/graph.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// 2.2 — `undefined` where no value has landed and no producer has failed. 3.11 — a
// value with no producer reports `s.success` true from construction.
test('a settled state reads and reports success from construction', () => {
    const s = state(1)
    expect(s()).toBe(1)
    expect(s.success()).toBe(true)
    expect(s.done()).toBe(true)
    expect(s.pending()).toBe(false)
})

test('a loaded state reads undefined and pends until it lands', async () => {
    const s = state(Promise.resolve(4))
    expect(s()).toBeUndefined()
    expect(s.pending()).toBe(true)
    // 3.13 — `s.success` does not move for a load in flight.
    expect(s.success()).toBe(false)
    expect(s.done()).toBe(false)
    await tick()
    expect(s()).toBe(4)
    expect(s.success()).toBe(true)
    expect(s.done()).toBe(true)
    expect(s.pending()).toBe(false)
})

// 3.14 — a load given to `s.set` over a landed value that is not stale reports
// `s.refreshing` and does NOT report `s.pending`.
test('a load over a landed value refreshes rather than pends', async () => {
    const s = state(1)
    s.set(Promise.resolve(2))
    expect(s.refreshing()).toBe(true)
    expect(s.pending()).toBe(false)
    // 7.4 — what is held goes on being served.
    expect(s()).toBe(1)
    // 3.8 — `s.done` stays true through a revalidation.
    expect(s.done()).toBe(true)
    await tick()
    expect(s()).toBe(2)
    expect(s.refreshing()).toBe(false)
})

// 2.3 against 2.4 and 2.5, which is the whole reason `ERRORED` and `PRODUCER_FAILED`
// are two bits.
test('a read throws where a producer failed and nothing has landed', async () => {
    const failed = state(Promise.reject(new Error('gone')))
    await tick()
    expect(() => failed()).toThrow('gone')
    expect(failed.error()).toBeInstanceOf(Error)
    // 3.10 — `s.success` and `s.error` are orthogonal.
    expect(failed.success()).toBe(false)
})

test('a failed revalidation leaves the value served and does not throw', async () => {
    const s = state(1)
    s.set(Promise.reject(new Error('offline')))
    await tick()
    // 2.5, 4.12 — the held value is still being served.
    expect(s()).toBe(1)
    expect(s.success()).toBe(true)
    expect((s.error() as Error).message).toBe('offline')
})

// 2.4 — a rejected write does not make a read throw.
test('a refused write fills s.error and does not make a read throw', () => {
    const tooBig = refuse.typed<'TooBig', number>('TooBig')
    const s = state<number, number, Failed<'TooBig', number>>(1, {
        transform: (value) => (value > 10 ? tooBig(value) : value),
    })
    const answer = s.set(99)
    // 4.10 — it fills `s.error` and does not reach a `{:catch}`; the refusal is
    // handed back rather than thrown.
    expect((answer as { name: string }).name).toBe('TooBig')
    // 4.9 — stores nothing and mints no production.
    expect(s()).toBe(1)
    expect(s.isError(s.error(), 'TooBig')).toBe(true)
})

// 4.11 — an accepted write clears the standing `s.error`.
test('an accepted write clears the standing error', () => {
    const tooBig = refuse.typed<'TooBig', number>('TooBig')
    const s = state<number, number, Failed<'TooBig', number>>(1, {
        transform: (value) => (value > 10 ? tooBig(value) : value),
    })
    s.set(99)
    expect(s.error()).toBeDefined()
    s.set(2)
    expect(s.error()).toBeUndefined()
})

// REVERT: apply `CLEARED_BY_A_PRODUCTION` in `produce` only, so both refusal paths
// return before they reach it. REPORTS: `s.pending()` true FOREVER where this asserts
// false — the spinner spinning with the error already in `s.error`.
test('a load whose settle is refused clears the in-flight bits', async () => {
    const tooBig = refuse.typed<'TooBig', number>('TooBig')
    const s = state<number, number, Failed<'TooBig', number>>(
        Promise.resolve(99),
        { transform: (value) => (value > 10 ? tooBig(value) : value) },
    )
    expect(s.pending()).toBe(true)
    await tick()
    expect(s.pending()).toBe(false)
    expect(s.isError(s.error(), 'TooBig')).toBe(true)
})

test('a load that rejects clears the in-flight bits', async () => {
    const s = state<number>(Promise.reject(new Error('no')))
    expect(s.pending()).toBe(true)
    await tick()
    expect(s.pending()).toBe(false)
})

// REVERT: bump `epoch` in `load` alone. REPORTS: the value reverts eight hundred
// milliseconds later — the stale async settle lands over the newer synchronous write,
// and a rejection fires `fail` against a node holding a good value.
test('a settled load does not overwrite a newer synchronous write', async () => {
    const s = state(0)
    s.set(new Promise<number>((resolve) => setTimeout(() => resolve(1), 5)))
    s.set(2)
    expect(s()).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(s()).toBe(2)
    expect(s.refreshing()).toBe(false)
})

test('a rejected load does not fail a node a newer write has filled', async () => {
    const s = state(0)
    s.set(
        new Promise<number>((_, reject) =>
            setTimeout(() => reject(new Error('late')), 5),
        ),
    )
    s.set(2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(s()).toBe(2)
    expect(s.error()).toBeUndefined()
})

// A DUPLICATE STILL TRANSITIONS. 5.2 keeps a matching production from being retained
// and from waking a reader; it says nothing about the probes, and a probe reader is
// not a reader under the Terms table. Returning early from the whole method is what
// left `s.set(fetchSameThing())` with `PENDING` set forever.
test('a duplicate production still ends the load it settled', async () => {
    const s = state(1)
    s.set(Promise.resolve(1))
    expect(s.refreshing()).toBe(true)
    await tick()
    expect(s.refreshing()).toBe(false)
    expect(s()).toBe(1)
    // 5.2 — not retained. One production in the ring, not two.
    expect([...s.tail()]).toEqual([1])
})

// 4.3 and 4.4 — `schema` runs first, on the settled value, and what it returns is
// what `transform` receives.
test('the schema runs first and hands its result to the transform', () => {
    const seen: unknown[] = []
    const s = state<string, number>('1', {
        // 19.3 — a `Schema` returns what it ACCEPTS, and 19.8 keeps coercion out of
        // it, so what this hands the transform is a `string`.
        schema: (value) => String(value).trim(),
        transform: (value) => {
            seen.push(value)
            return Number(value) * 10
        },
    })
    expect(seen).toEqual(['1'])
    expect(s()).toBe(10)
})

// 4.5 — a `schema` refuses by THROWING, and the throw is caught and converted rather
// than allowed to escape the write. 15.9 — the refusal is `validationError`, at 422.
test('a schema throw becomes a validation refusal rather than escaping', () => {
    const s = state<number, number, Failed<'ValidationError', string[]>>(1, {
        schema: (value) => {
            if (typeof value !== 'number') throw new Error('not a number')
            return value
        },
    })
    const answer = s.set('nope' as never)
    expect((answer as { name: string; status: number }).name).toBe(
        'ValidationError',
    )
    expect((answer as { status: number }).status).toBe(422)
    // `Issues<number>` is the BARE LIST arm of the conditional — there is no `''` key
    // on a primitive, and 19.5's "the `''` entry" is the composite arm's spelling.
    expect((answer as Failed<'ValidationError', string[]>).data).toEqual([
        'not a number',
    ])
    expect(s()).toBe(1)
})

// 4.8 — a `transform` does not run on a promise. It runs once per materialisation of
// a `Stored`, which is after the load settles and not before.
test('a transform does not run on the promise a load was given', async () => {
    let runs = 0
    const s = state<number>(1, {
        transform: (value) => {
            runs += 1
            return value * 2
        },
    })
    expect(runs).toBe(1)
    s.set(Promise.resolve(5))
    flushEffects()
    expect(runs).toBe(1)
    await tick()
    expect(runs).toBe(2)
    expect(s()).toBe(10)
})

// 5.3 — `identity` is discriminated by ARITY. A one-parameter projection invoked as a
// two-argument comparator hands back the projection, which is truthy, and every write
// after the first is swallowed as a duplicate with the right value still on screen.
test('a one-parameter identity is a projection and a two-parameter one is not', () => {
    const projected = state(
        { id: 1, label: 'a' },
        // ANNOTATED, and it has to be: REGISTRY types `identity` as a union of two
        // function signatures, and TypeScript will not contextually type a
        // one-parameter arrow against one arm of such a union — it infers `any` and
        // `noImplicitAny` refuses it. The arity discrimination 5.3 asks for costs the
        // author an annotation on the projection form.
        {
            identity: (value: { id: number; label: string }) => value.id,
        },
    )
    let projectedRuns = 0
    watch(() => {
        projected()
        projectedRuns += 1
    })
    projected.set({ id: 1, label: 'b' })
    flushEffects()
    expect(projectedRuns).toBe(1)
    projected.set({ id: 2, label: 'b' })
    flushEffects()
    expect(projectedRuns).toBe(2)

    const compared = state(1, {
        identity: (next: number, previous: number) => next === previous,
    })
    let comparedRuns = 0
    watch(() => {
        compared()
        comparedRuns += 1
    })
    compared.set(1)
    flushEffects()
    expect(comparedRuns).toBe(1)
    compared.set(2)
    flushEffects()
    expect(comparedRuns).toBe(2)
})

// 5.4 and 5.6 — the default is `structural`, and it answers "not equal" wherever it
// cannot decide.
test('structural is the default and refuses to decide about a Map', () => {
    expect(structural({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(structural([1, 2], [2, 1])).toBe(false)
    expect(structural(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(false)
    const held = new Map([['a', 1]])
    expect(structural(held, held)).toBe(true)
    let runs = 0
    const s = state({ a: 1 })
    watch(() => {
        s()
        runs += 1
    })
    s.set({ a: 1 })
    flushEffects()
    expect(runs).toBe(1)
})

// 5.4 and 5.22 — the leaf of the walk is answered WITHOUT a recursive call, and the
// two places `===` and `Object.is` part company are the whole risk in that: `NaN` is
// not `===` itself and must still compare equal, and `0 === -0` must still not.
//
// REVERT: drop the `held === 0 && !Object.is(...)` arm from either loop in
// `comparator.ts`. REPORTS: `structural([0], [-0])` true where this asserts false, so
// a write of `-0` over `0` is swallowed and the sign never reaches a reader.
test('the inline leaf answers through Object.is on a NaN and on a signed zero', () => {
    expect(structural({ a: Number.NaN }, { a: Number.NaN })).toBe(true)
    expect(structural([Number.NaN], [Number.NaN])).toBe(true)
    expect(structural({ a: 0 }, { a: -0 })).toBe(false)
    expect(structural([0], [-0])).toBe(false)
    // …and the ordinary leaves the fast path exists for still answer.
    expect(structural({ a: 1, b: 'x', c: true }, { a: 1, b: 'x', c: true })).toBe(
        true,
    )
    expect(structural({ a: 1, b: 'x' }, { a: 1, b: 'y' })).toBe(false)
})

// 5.22 — past the bound the walk answers "not equal", which is 5.6's answer wherever
// it cannot decide. BOTH HALVES ARE HERE because the bound is a guard derived from a
// SUMMARY of the input — the visit count — and a case that only satisfies it proves
// nothing: the small array is the case that satisfies what the guard stands for and
// must still be deemed a duplicate.
//
// REVERT: `VISIT_BUDGET = Number.POSITIVE_INFINITY` in `comparator.ts`. REPORTS: the
// 3,000-row write below deemed a DUPLICATE — `runs` 1 where this asserts 2 — and
// 663 µs of walking per write at 20,000 rows, against 46 with the bound in.
test('a value past the visit bound is not deemed a duplicate', () => {
    const rows = (count: number): { id: number; label: string }[] =>
        Array.from({ length: count }, (_, at) => ({ id: at, label: `row ${at}` }))

    // 3,000 rows of two fields is 9,000 visits, past the bound.
    expect(structural(rows(3_000), rows(3_000))).toBe(false)
    // 100 rows of two fields is 300, inside it, and structurally equal.
    expect(structural(rows(100), rows(100))).toBe(true)

    let woken = 0
    const wide = state(rows(3_000))
    watch(() => {
        wide()
        woken += 1
    })
    expect(woken).toBe(1)
    wide.set(rows(3_000))
    flushEffects()
    expect(woken).toBe(2)

    let swallowed = 0
    const narrow = state(rows(100))
    watch(() => {
        narrow()
        swallowed += 1
    })
    expect(swallowed).toBe(1)
    narrow.set(rows(100))
    flushEffects()
    expect(swallowed).toBe(1)
})

// 5.7 against 5.9 — a production `s.set` mints is PUSHED; `s.patch` REPLACES the head.
test('a set pushes a production and a patch replaces the head', () => {
    const s = state<number[]>([1], { tail: 8 })
    s.set([1, 2])
    expect([...s.tail()].length).toBe(2)
    s.patch((held) => {
        held.push(3)
    })
    expect([...s.tail()].length).toBe(2)
    expect(s()).toEqual([1, 2, 3])
})

// 7.7 — `s.refresh` and `s.invalidate` are inert on a value with no producer, and 7.3
// has `s.invalidate` move no node.
test('the triggers are inert on a value with no producer', () => {
    const s = state(1)
    let runs = 0
    watch(() => {
        s()
        runs += 1
    })
    s.invalidate()
    s.refresh()
    expect(runs).toBe(1)
    expect(s()).toBe(1)
})

// 7.8, 7.9, 7.10, 7.11, 7.12 in one sequence, which is the only way to read them: the
// mark is set, the value goes on being served, the next load PENDS rather than
// refreshes, `s.done` is false while it does, and the production clears the mark.
test('an invalidated memo pends over its stale value and clears the mark', async () => {
    let answer = 1
    const loaded = memo(() => Promise.resolve(answer))
    loaded()
    await tick()
    expect(loaded()).toBe(1)

    answer = 2
    loaded.invalidate()
    // 7.10 — still served.
    expect(loaded()).toBe(1)
    loaded.refresh()
    // 7.9 and 7.12 — a load over a value marked stale pends, and is not done.
    expect(loaded.pending()).toBe(true)
    expect(loaded.done()).toBe(false)
    await tick()
    // 7.11 — an accepted production clears the stale mark.
    expect(loaded()).toBe(2)
    expect(loaded.pending()).toBe(false)
    expect(loaded.done()).toBe(true)
})

// 7.4 and 7.5 — `s.refresh` keeps serving what is held and reports `s.refreshing`
// while the reload is in flight. 3.8 — `s.done` stays true through it.
test('a refresh serves the held value and reports refreshing', async () => {
    let answer = 1
    const loaded = memo(() => Promise.resolve(answer))
    loaded()
    await tick()
    answer = 2
    loaded.refresh()
    expect(loaded.refreshing()).toBe(true)
    expect(loaded()).toBe(1)
    expect(loaded.done()).toBe(true)
    await tick()
    expect(loaded()).toBe(2)
})

// 2.12 and 2.13 — `s.then` resolves with the value where `s.pending` becomes false,
// and rejects with what 2.3 throws. 1.6 — `catch` and `finally` derive from it.
test('a Reactive is thenable and settles with its value', async () => {
    const s = state(Promise.resolve(3))
    expect(await s).toBe(3)
    const settled = state(1)
    expect(await settled).toBe(1)
    let ran = false
    expect(
        await settled.finally(() => {
            ran = true
        }),
    ).toBe(1)
    expect(ran).toBe(true)
})

test('a Reactive rejects with what a read would throw', async () => {
    const failed = state(Promise.reject(new Error('gone')))
    expect(await failed.catch((error) => (error as Error).message)).toBe('gone')
})

// 1.7 and D95 — once 1.5 makes a `Reactive` thenable, the thenable test alone no
// longer tells a load from a value, so a `Reactive` handed to a write is STORED.
test('a Reactive given to a write is stored as a value', () => {
    const inner = state(1)
    const outer = state<unknown>(0)
    outer.set(inner)
    expect(outer()).toBe(inner)
    expect(outer.pending()).toBe(false)
})

// 2.6 — `s.peek` reads as `s` does, except that it does not join the flow.
test('s.peek reads without joining the flow', () => {
    const s = state(1)
    let runs = 0
    watch(() => {
        s.peek()
        runs += 1
    })
    s.set(2)
    flushEffects()
    expect(runs).toBe(1)
    expect(s.peek()).toBe(2)
})

// 12.1 — a `Disposer` runs before each rerun of its `Effect`, and once more at
// teardown. 12.2 — the `Effect` runs immediately.
test('a disposer runs before each rerun and once at teardown', () => {
    const s = state(1)
    const log: string[] = []
    const stop = watch(() => {
        const value = s()
        log.push(`run ${value}`)
        return () => log.push(`dispose ${value}`)
    })
    s.set(2)
    // 12.12 — the write schedules the rerun, and `stop()` in the same tick would
    // cancel it: a stopped reader is skipped by the drain, which is 12.1 holding
    // rather than a rerun lost. So the tick happens here, where it would have.
    flushEffects()
    stop()
    expect(log).toEqual(['run 1', 'dispose 1', 'run 2', 'dispose 2'])
})

// 12.4 and 14.6 — where sources are given to `watch`, the `Effect` runs only when
// those sources change.
test('a watch over named sources ignores what its effect reads', () => {
    const named = state(1)
    const other = state(1)
    let runs = 0
    watch([named], () => {
        other()
        runs += 1
    })
    other.set(2)
    flushEffects()
    expect(runs).toBe(1)
    named.set(2)
    flushEffects()
    expect(runs).toBe(2)
})

// 12.9 — an `Effect` that threw stops its `watch`, and D9 is why. 12.7's `onError` is
// group 37's and has not landed; what is asserted here is the stop.
test('an effect that threw stops its watch', () => {
    const s = state(1)
    let runs = 0
    watch(() => {
        runs += 1
        if (s() === 2) throw new Error('bad')
    })
    s.set(2)
    flushEffects()
    expect(runs).toBe(2)
    s.set(3)
    flushEffects()
    expect(runs).toBe(2)
})

// 14.10 — a `Transformer` does not track. A write performed with a live reader on the
// stack would otherwise plant an edge on it from inside the author's own gate.
test('a transform does not join the flow', () => {
    const gate = state(10)
    const s = state<number>(1, {
        transform: (value) => value + (gate.peek() as number),
    })
    let runs = 0
    watch(() => {
        s()
        runs += 1
    })
    s.set(2)
    flushEffects()
    expect(runs).toBe(2)
    expect(s()).toBe(12)
})

// 11.5 — an unkeyed `memo` recomputes when a value its body read changes. 11.7 and
// 11.8 — it accepts a write, and the write stands until the next recompute replaces
// it. 11.9 — no warning.
test('a memo recomputes on a source change and accepts a write between', () => {
    const source = state(1)
    const doubled = memo(() => (source() as number) * 2)
    expect(doubled()).toBe(2)
    doubled.set(99)
    expect(doubled()).toBe(99)
    source.set(2)
    expect(doubled()).toBe(4)
})

// 11.59 and D71 — a PROVISIONAL run, one that read a value which had not landed,
// mints no production.
test('a provisional memo run mints no production', () => {
    const slow = state(new Promise<number>(() => {}))
    const derived = memo(() => slow())
    expect(derived()).toBeUndefined()
    expect(derived.success()).toBe(false)
    expect([...derived.tail()]).toEqual([])
})
