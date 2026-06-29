import { beforeAll, describe, expect, test } from 'bun:test'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/*
The reentrancy/teardown dance `mountSwappableRange` owns (extracted from when+switch):
a branch swap nulls `dispose` before building the new branch, so a reentrant flip
DURING that build can't re-enter with the already-disposed disposer and clear it
twice. These probes assert each live branch's scope disposes exactly once across
reentrant flips, rapid alternation, and owner teardown — no double-dispose, no leak.
*/
describe('mountSwappableRange reentrancy + teardown', () => {
    /* A reentrant flip: the then-branch, while building, synchronously writes the gate
       back to false, re-entering the swap effect mid-build. No scope may double-dispose,
       and no rebuild may throw. */
    test('when: a reentrant flip during the build never double-disposes a branch', () => {
        const host = document.createElement('div')
        const gate = state(false)
        const disposeCounts = { then: 0, else: 0 } as Record<string, number>
        let reentered = false
        scope(() =>
            when(
                host,
                () => gate.value,
                () => {
                    effect(() => () => {
                        disposeCounts.then += 1
                    })
                    /* Reentrant write while still building the then-branch. */
                    if (!reentered) {
                        reentered = true
                        gate.value = false
                    }
                },
                () => {
                    effect(() => () => {
                        disposeCounts.else += 1
                    })
                },
            ),
        )
        expect(disposeCounts).toEqual({ then: 0, else: 0 })
        // Flip on: builds then (which reenters, writes false), settles. No double-dispose.
        expect(() => {
            gate.value = true
        }).not.toThrow()
        expect(disposeCounts.then).toBeLessThanOrEqual(1)
        expect(disposeCounts.else).toBeLessThanOrEqual(1)
        // Stays reactive and throw-free under further flips.
        expect(() => {
            gate.value = false
            gate.value = true
            gate.value = false
        }).not.toThrow()
    })

    /* Rapid alternation: each flip disposes the prior branch's scope exactly once. */
    test('when: rapid flips dispose the prior branch exactly once per swap', () => {
        const host = document.createElement('div')
        const gate = state(true)
        let disposals = 0
        scope(() =>
            when(
                host,
                () => gate.value,
                () => {
                    effect(() => () => {
                        disposals += 1
                    })
                },
                () => {
                    effect(() => () => {
                        disposals += 1
                    })
                },
            ),
        )
        for (let i = 0; i < 6; i += 1) {
            gate.value = !gate.value
        }
        // Each of the 6 flips swapped a branch out, disposing exactly that one scope.
        expect(disposals).toBe(6)
    })

    /* Owner teardown after rapid case switches disposes only the live case, once. */
    test('switch: owner teardown after rapid switches disposes the live case once', () => {
        const host = document.createElement('div')
        const choice = state(0)
        const disposals: number[] = [0, 0, 0]
        const makeCase = (n: number) => ({
            match: () => n,
            render: () => {
                effect(() => () => {
                    disposals[n] += 1
                })
            },
        })
        const disposeOwner = scope(() =>
            switchBlock(host, () => choice.value, [makeCase(0), makeCase(1), makeCase(2)]),
        )
        // Walk through cases; each switch disposes the prior case once.
        choice.value = 1
        choice.value = 2
        choice.value = 0
        // case0 (→1), case1 (→2), case2 (→0) each disposed once on swap-out.
        expect(disposals).toEqual([1, 1, 1])
        // Owner teardown disposes the now-live case0 (its 2nd mount) once more.
        disposeOwner()
        expect(disposals).toEqual([2, 1, 1])
    })
})
