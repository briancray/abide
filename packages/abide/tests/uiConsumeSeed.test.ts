import { afterEach, describe, expect, test } from 'bun:test'
import { consumeSeed } from '../src/lib/ui/runtime/consumeSeed.ts'
import { runHydrationPass } from '../src/lib/ui/runtime/runHydrationPass.ts'
import { SEED_MARKS } from '../src/lib/ui/runtime/SEED_MARKS.ts'

/*
Two-phase warm-seed consume (ADR-0048). A hydration pass MARKS each seed it adopts rather
than deleting it: a clean pass exit deletes the marked keys (the one-shot contract — an SPA
re-nav to the same render-path re-inits fresh, never a stale boot snapshot), while a
DESYNC THROW leaves every value in place, so the router's discard→cold-rebuild recovery
re-adopts the SSR-resolved values instead of refetching — a cold refetch would leave
blocking `await` cells pending and throw an uncaught SuspenseSignal at mount (a dead page).
This replaces the old warmSeedBackup/restoreWarmSeeds shadow-copy recovery.
*/
describe('consumeSeed two-phase adoption', () => {
    afterEach(() => {
        SEED_MARKS.current = undefined
    })

    test('outside a pass: plain one-shot — read once, gone after', () => {
        const store: Record<string, string> = { 'a:0': 'v' }
        expect(consumeSeed(store, 'a:0')).toBe('v')
        expect(store['a:0']).toBeUndefined()
        expect(consumeSeed(store, 'a:0')).toBeUndefined()
    })

    test('a clean pass deletes the adopted seeds on exit, untouched ones survive', () => {
        const store: Record<string, string> = { adopted: 'v', untouched: 'w' }
        runHydrationPass(() => {
            expect(consumeSeed(store, 'adopted')).toBe('v')
            /* Marked, not yet deleted — the pass may still throw. */
            expect(store['adopted']).toBe('v')
        })
        expect(store['adopted']).toBeUndefined()
        expect(store['untouched']).toBe('w')
    })

    test('a repeat read within one pass misses (one adoption per seed)', () => {
        const store: Record<string, string> = { 'a:0': 'v' }
        runHydrationPass(() => {
            expect(consumeSeed(store, 'a:0')).toBe('v')
            expect(consumeSeed(store, 'a:0')).toBeUndefined()
        })
    })

    test('a throwing pass leaves every seed in place for the cold rebuild', () => {
        const store: Record<string, string> = { 'a:0': 'v' }
        expect(() =>
            runHydrationPass(() => {
                consumeSeed(store, 'a:0')
                throw new Error('hydration desync')
            }),
        ).toThrow('hydration desync')
        /* Still present — the recovery rebuild (outside the pass) re-adopts and spends it. */
        expect(store['a:0']).toBe('v')
        expect(consumeSeed(store, 'a:0')).toBe('v')
        expect(store['a:0']).toBeUndefined()
    })

    test('marks distinguish stores sharing a key format', () => {
        const cells: Record<string, string> = { 'p:0': 'cell' }
        const docs: Record<string, string> = { 'p:0': 'doc' }
        runHydrationPass(() => {
            expect(consumeSeed(cells, 'p:0')).toBe('cell')
            expect(consumeSeed(docs, 'p:0')).toBe('doc')
        })
        expect(cells['p:0']).toBeUndefined()
        expect(docs['p:0']).toBeUndefined()
    })
})
