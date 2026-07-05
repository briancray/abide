import { afterEach, describe, expect, test } from 'bun:test'
import { CURRENT_SCOPE } from '../src/lib/ui/runtime/CURRENT_SCOPE.ts'
import { state } from '../src/lib/ui/state.ts'

/* The ambient scope is lazily minted the first time `state.share`/`.shared`
   reaches for it; reset between tests so each measures its own scope. */
afterEach(() => {
    CURRENT_SCOPE.current = undefined
})

describe('state — the imported reactive callable with attached members', () => {
    test('state(initial) mints a writable cell and reads back', () => {
        const cell = state('x')
        expect(cell.value).toBe('x')
        cell.value = 'y'
        expect(cell.value).toBe('y')
    })

    test('state.computed(compute) is a read-only derived cell', () => {
        const source = state(2)
        const doubled = state.computed(() => (source.value ?? 0) * 2)
        expect(doubled.value).toBe(4)
        source.value = 5
        expect(doubled.value).toBe(10)
        /* read-only: the Computed shape exposes only a getter */
        expect(Object.getOwnPropertyDescriptor(doubled, 'value')?.set).toBeUndefined()
    })

    test('state.linked(seed) reseeds from its reactive source', () => {
        const source = state(1)
        const draft = state.linked(() => source.value)
        expect(draft.value).toBe(1)
        source.value = 9
        expect(draft.value).toBe(9)
        /* linked owns a local store: an explicit write holds until the next reseed */
        draft.value = 3
        expect(draft.value).toBe(3)
    })

    test('state.share(key, value) then state.shared(key) round-trips on the ambient scope', () => {
        state.share('theme', 'dark')
        expect(state.shared<string>('theme')).toBe('dark')
        expect(state.shared<string>('missing')).toBeUndefined()
    })
})
