// The derivation backing, driven DIRECTLY — no `memo()` around it.
//
// This is the seam the tests always needed and no caller crosses. Roughly half of `memo.test.ts` drives
// this state machine through the whole memo surface, which means every case there also exercises slot
// allocation, the store, the probe surface and the read classifier in order to assert something about a
// `computed`. The cases below construct the backing with eight fields and assert its own contract.
//
// What this does NOT claim: the gate's TIMING still runs on real timers (`refetchWindow` owns
// `setTimeout`), so the sleeping cases in `memo.test.ts` stay where they are until that clock is
// injectable too. The seam is the first half of that; nothing here sleeps because nothing here needs a
// window to elapse.

import { describe, expect, test } from 'bun:test'
import { type AutoBackingContext, createAutoBacking } from './autoBacking.ts'
import { state } from './reactive.ts'

function contextFor<T>(
    body: () => Promise<T> | T,
    overrides: Partial<AutoBackingContext<T>> = {},
): AutoBackingContext<T> {
    return {
        body,
        // The real memo passes its fail-closed wrapper; the identity function is the honest stand-in
        // for a test that is not about scope exit.
        runFillBody: (call) => call(),
        clockMs: 0,
        clockIsDebounce: false,
        crossRequest: false,
        ownerDisposal: undefined,
        disposeSlot: () => {},
        warnUntracked: () => {},
        ...overrides,
    }
}

describe('the auto-tracked derivation backing', () => {
    test('a synchronous body settles as a value on the first pull', () => {
        const backing = createAutoBacking(contextFor(() => 41 + 1))
        expect(backing.filled()).toBe(false)
        expect(backing.merged().value).toBe(42)
        expect(backing.filled()).toBe(true)
    })

    test("the body's synchronous reads ARE the declared inputs", () => {
        const n = state(1)
        let runs = 0
        const backing = createAutoBacking(
            contextFor(() => {
                runs += 1
                return n() * 10
            }),
        )
        expect(backing.merged().value).toBe(10)
        n.set(3)
        expect(backing.merged().value).toBe(30)
        expect(runs).toBe(2)
    })

    test('a re-run producing the same result keeps state IDENTITY, so propagation cuts', () => {
        // The recorded defect: a freshly built wrapper defeats an identity check, and every propagation
        // cutoff downstream of it silently stops working. Asserting the VALUE would pass either way.
        const n = state(1)
        const backing = createAutoBacking(contextFor(() => n() > 0))
        const first = backing.merged()
        n.set(2) // still > 0 — the body re-runs, the result does not move
        expect(backing.merged()).toBe(first)
    })

    test('a throwing body settles as an error rather than escaping the pull', () => {
        const boom = new Error('nope')
        const backing = createAutoBacking(
            contextFor(() => {
                throw boom
            }),
        )
        const settled = backing.merged()
        expect(settled.status).toBe('error')
        expect(settled.error).toBe(boom)
    })

    test('an async body is handed BACK as deferred rather than tracked', () => {
        // ADR 0024 §2: only the produced value can tell, and half-tracked is worse than untracked. The
        // classifier reads this to send the run to the coalesced loading path instead.
        let warned = ''
        const backing = createAutoBacking(
            contextFor(async () => 1, { warnUntracked: (produced) => (warned = produced) }),
        )
        const first = backing.fill.peek()
        expect('deferred' in first).toBe(true)
        expect(warned).toBe('a promise')
    })

    test('version bumps force a re-run with no dependency change', () => {
        // What `refresh`/`invalidate` reach for: a derivation whose inputs did not move still re-fills.
        let runs = 0
        const backing = createAutoBacking(
            contextFor(() => {
                runs += 1
                return runs
            }),
        )
        expect(backing.merged().value).toBe(1)
        backing.version.set(backing.version.peek() + 1)
        expect(backing.merged().value).toBe(2)
    })

    test('a publish override holds only while the run it stamped is still current', () => {
        // The whole of the retired `state.linked`: provisional until re-fill (ADR 0024 §Context).
        const n = state(1)
        const backing = createAutoBacking(contextFor(() => n() * 10))
        expect(backing.merged().value).toBe(10)

        backing.override.set({
            run: backing.currentRun(),
            state: { status: 'value', value: 999, error: undefined },
        })
        expect(backing.merged().value).toBe(999)

        n.set(2) // a dependency moved → a new run → the override is stale and drops
        expect(backing.merged().value).toBe(20)
    })

    test('a stale override — stamped against an older run — is ignored outright', () => {
        const n = state(1)
        const backing = createAutoBacking(contextFor(() => n() * 10))
        const staleRun = backing.currentRun()
        n.set(2)
        expect(backing.merged().value).toBe(20)

        backing.override.set({
            run: staleRun,
            state: { status: 'value', value: 999, error: undefined },
        })
        expect(backing.merged().value).toBe(20)
    })

    test('the owner disposal registration tears down BOTH halves of the leak', () => {
        // The computed nodes hold an observer edge in whatever the body read; the SLOT holds an entry in
        // the tab-global map. Disposing the backing alone fixed the work and left the memory.
        const registered: Array<() => void> = []
        let slotDisposed = 0
        const n = state(1)
        const backing = createAutoBacking(
            contextFor(() => n(), {
                ownerDisposal: { register: (dispose) => registered.push(dispose) },
                disposeSlot: () => {
                    slotDisposed += 1
                },
            }),
        )
        backing.merged()
        expect(registered).toHaveLength(1)

        for (const dispose of registered) dispose()
        expect(slotDisposed).toBe(1)
    })

    test('no clock configured means no gate to cancel', () => {
        const backing = createAutoBacking(contextFor(() => 1))
        expect(backing.gate).toBeUndefined()
    })

    test('a configured clock exposes its window, so both carriers are cancellable', () => {
        // `cancelClock`'s recorded defect: a slot has one refetch window conceptually and two possible
        // carriers, and cancelling only the pulled one left a scheduled auto publication armed.
        const backing = createAutoBacking(contextFor(() => 1, { clockMs: 50 }))
        expect(backing.gate).toBeDefined()
    })
})
