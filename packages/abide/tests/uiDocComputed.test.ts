import { describe, expect, test } from 'bun:test'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { PATCH_BUS } from '../src/lib/ui/runtime/PATCH_BUS.ts'

describe('doc computed slots (derive) — the data-collapse spike', () => {
    test('a computed slot derives its value and tracks its deps', () => {
        const d = doc({ count: 2 })
        const doubled = d.derive('doubled', () => d.read<number>('count') * 2)

        expect(doubled()).toBe(4) // bound reader (hoisted form)
        expect(d.read<number>('doubled')).toBe(4) // path form resolves the computed too

        d.replace('count', 5)
        expect(doubled()).toBe(10)
        expect(d.read<number>('doubled')).toBe(10)
    })

    test('a computed slot is not stored — snapshot omits it', () => {
        const d = doc({ count: 2 })
        const doubled = d.derive('doubled', () => d.read<number>('count') * 2)
        doubled() // force a compute

        expect(d.snapshot()).toEqual({ count: 2 }) // no `doubled` in the truth
    })

    test('a recompute never hits the patch bus — a derive emits no patch of its own', () => {
        const d = doc({ count: 0 })
        const doubled = d.derive('doubled', () => d.read<number>('count') * 2)

        let patches = 0
        const unsubscribe = PATCH_BUS.subscribe(() => {
            patches += 1
        })
        d.replace('count', 3)
        expect(doubled()).toBe(6) // the computed followed the source change
        unsubscribe()

        expect(patches).toBe(1) // only the `count` replace — the recompute added NO patch of its own
    })

    test('chained computeds recompute through the graph', () => {
        const d = doc({ n: 1 })
        d.derive('twice', () => d.read<number>('n') * 2)
        const quad = d.derive('quad', () => d.read<number>('twice') * 2)

        expect(quad()).toBe(4)
        d.replace('n', 3)
        expect(quad()).toBe(12) // n→twice→quad all re-computed
    })
})
