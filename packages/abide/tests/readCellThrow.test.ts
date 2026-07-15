import { describe, expect, test } from 'bun:test'
import type { AsyncComputed } from '../src/lib/shared/types/AsyncComputed.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { readCell } from '../src/lib/ui/dom/readCell.ts'
import { AsyncCellError } from '../src/lib/ui/runtime/AsyncCellError.ts'
import { SuspenseSignal } from '../src/lib/ui/runtime/SuspenseSignal.ts'
import { state } from '../src/lib/ui/state.ts'
import { trackedComputed } from '../src/lib/ui/trackedComputed.ts'
import { settle } from './support/settle.ts'

/* The value-aware throwing peek (ADR-0019 D3.2) — the read the compiler lowers async-cell
   references to. peek()/error() themselves never throw; only this codegen read does. Whether a
   PENDING read pauses is decided by the cell's own `blocking` bit (ADR-0042), not the read site. */
describe('readCell — value-aware throwing peek', () => {
    test('pending BLOCKING cell (no value, no error) → suspends (throws SuspenseSignal)', () => {
        // a primitive async computed joins the SSR barrier (streaming off) → blocking → a pending
        // read pauses its reader rather than handing it `undefined`
        const cell = computed(async () => 1) as AsyncComputed<number>
        expect(() => readCell(cell)).toThrow(SuspenseSignal)
    })

    test('pending STREAMING cell (no value, no error) → undefined, no throw (peeks)', () => {
        // a streaming cell ships pending and composes with `?.`/`??`, so its pending read peeks
        const cell = trackedComputed(async () => 1, true) as AsyncComputed<number>
        expect(readCell(cell)).toBeUndefined()
    })

    test('pending STREAM (async-iterable) cell → undefined, no throw — a stream is never blocking', () => {
        // A stream never settles, so it PEEKS its latest frame (`undefined` before the first) —
        // it must NOT pause even though the compiler emits it as `trackedComputed(thunk)` with the
        // same default `streaming` flag an `await` cell carries (ADR-0046: blocking is resolved
        // from the produced source, not the flag alone).
        async function* frames() {
            await new Promise((resolve) => setTimeout(resolve, 50))
            yield 1
        }
        const cell = trackedComputed(() => frames()) as unknown as AsyncComputed<number> & {
            blocking?: boolean
        }
        expect(cell.blocking).toBe(false)
        expect(readCell(cell)).toBeUndefined()
    })

    test('resolved → the value', async () => {
        const cell = computed(async () => 7) as AsyncComputed<number>
        await settle()
        expect(readCell(cell)).toBe(7)
    })

    test('error AND no retained value → throws AsyncCellError carrying the cell', async () => {
        const boom = new Error('boom')
        const cell = computed(async () => {
            throw boom
        }) as AsyncComputed<number>
        await settle()
        try {
            readCell(cell)
            throw new Error('expected a throw')
        } catch (thrown) {
            expect(thrown).toBeInstanceOf(AsyncCellError)
            expect((thrown as AsyncCellError).cell).toBe(cell)
            expect((thrown as AsyncCellError).cause).toBe(boom)
        }
        // the probe itself never throws — it just returns the error
        expect(cell.error()).toBe(boom)
    })

    test('error WITH a retained value → returns the stale value (SWR), no throw', async () => {
        let fail = false
        const cell = computed(async () => {
            if (fail) {
                throw new Error('later')
            }
            return 'ok'
        }) as AsyncComputed<string>
        await settle()
        fail = true
        cell.refresh()
        await settle()
        expect(readCell(cell)).toBe('ok') // stale value held, no throw
    })

    test('a sync State/derive reference never throws', () => {
        const s = state(3)
        expect(readCell(s)).toBe(3)
        expect(readCell(() => 42)).toBe(42) // a derive reader (function form)
    })
})
