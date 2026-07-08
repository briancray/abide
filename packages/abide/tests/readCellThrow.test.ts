import { describe, expect, test } from 'bun:test'
import type { AsyncComputed } from '../src/lib/shared/types/AsyncComputed.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { readCell } from '../src/lib/ui/dom/readCell.ts'
import { AsyncCellError } from '../src/lib/ui/runtime/AsyncCellError.ts'
import { state } from '../src/lib/ui/state.ts'
import { settle } from './support/settle.ts'

/* The value-aware throwing peek (ADR-0019 D3.2) — the read the compiler lowers async-cell
   references to. peek()/error() themselves never throw; only this codegen read does. */
describe('readCell — value-aware throwing peek', () => {
    test('pending (no value, no error) → undefined, no throw', () => {
        const cell = computed(async () => 1) as AsyncComputed<number>
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
