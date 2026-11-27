// DOES THE STRUCTURAL WALK LOSE ON A DEEP TREE? It is O(bindings x depth) where a marker walk is
// O(nodes) once, so the grid — which is two levels deep — could not have told. This is the case
// that distinguishes them, and it is the only reason markers might still be right somewhere.

import { expect, test } from '@playwright/test'

import type { ArmsRow } from '../bench/armsRun.ts'
import { buildBench, type Report } from '../bench/buildBench.ts'
import { loadCompiledPage } from '../bench/buildCompiledPage.ts'
import { type Scheme, type Tree, tree, wide } from '../bench/depthTree.ts'
import { BENCH_SIZING } from './BENCH_SIZING.ts'
import { skipWebkitClock } from './skipWebkitClock.ts'

const REPORT = await buildBench('report')
const CASES: [number, number][] = [
    [2, 200],
    [8, 200],
    [16, 200],
    [32, 200],
    [8, 2000],
    [32, 2000],
]

const SCHEMES: Scheme[] = ['structural', 'cursor', 'markers']
const trees: ({ scheme: Scheme; shape: 'deep' | 'wide' } & Tree)[] = []
for (const [depth, leaves] of CASES)
    for (const scheme of SCHEMES)
        trees.push({ scheme, shape: 'deep', ...tree(depth, leaves, scheme) })
// WIDE: 500 parents x 4 bindings, four levels down. A single shared prefix hoists almost
// nothing here, which is the case that would justify hoisting per subtree.
for (const scheme of SCHEMES)
    trees.push({ scheme, shape: 'wide', ...wide(4, 500, 4, scheme) })

skipWebkitClock()

test('the walk against tree depth, in this engine', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const lines = [`\n=== ${testInfo.project.name} — one hydration walk ===`]
    const groups: {
        label: string
        shape: 'deep' | 'wide'
        depth: number
        bindings: number
    }[] = []
    for (const [depth, bindings] of CASES)
        groups.push({
            label: `deep  ${String(depth).padStart(2)} x ${String(bindings).padStart(4)}`,
            shape: 'deep',
            depth,
            bindings,
        })
    groups.push({
        label: 'wide   4 x 2000 (500 parents)',
        shape: 'wide',
        depth: -1,
        bindings: -1,
    })

    for (const group of groups) {
        const here = trees.filter(
            (built) =>
                built.shape === group.shape &&
                (group.shape === 'wide' ||
                    (built.depth === group.depth &&
                        built.bindings === group.bindings)),
        )
        const bindings = here[0]?.bindings ?? 0
        await loadCompiledPage(page, {
            markup: here
                .map(
                    (built) =>
                        `<div data-scheme="${built.scheme}">${built.markup}</div>`,
                )
                .join(''),
            script: REPORT,
        })
        const measured = await page.evaluate(
            ({ schemes, sizing }) => {
                const { runArms } = (
                    globalThis as unknown as { __REPORT__: Report }
                ).__REPORT__
                const walks: Record<string, () => void> = {}
                const found: Record<string, number> = {}
                for (const { scheme, script } of schemes) {
                    const root = document.querySelector(
                        `[data-scheme="${scheme}"]`,
                    )
                    const walk = new Function('scope', script) as (
                        root: Element | null,
                    ) => void
                    walks[scheme] = () => walk(root)
                    // An arm that found nothing is the fastest on the table.
                    walk(root)
                    let count = 0
                    for (const slot of (
                        globalThis as unknown as { __SLOTS__: unknown[] }
                    ).__SLOTS__)
                        if (slot != null) count += 1
                    found[scheme] = count
                }
                const work: Record<string, Record<string, number>> = {}
                for (const scheme in found)
                    work[scheme] = { slotsFound: found[scheme] as number }
                // `markers` FIRST: it is the denominator, and the first arm is the A/A control.
                const [row] = runArms(
                    [
                        {
                            name: 'the hydration walk',
                            arms: {
                                markers: walks.markers as () => void,
                                cursor: walks.cursor as () => void,
                                structural: walks.structural as () => void,
                            },
                            work: () => work,
                        },
                    ],
                    20_000_000_000,
                    sizing,
                ) as [ArmsRow]
                return {
                    markers: row.arms.markers as number,
                    cursor: row.arms.cursor as number,
                    structural: row.arms.structural as number,
                    claim: row.claims.cursor as string,
                    workDisagreement: row.workDisagreement,
                    found,
                    n: row.n,
                    floor: row.floor,
                }
            },
            {
                schemes: here.map((built) => ({
                    scheme: built.scheme,
                    script: built.script,
                })),
                sizing: BENCH_SIZING,
            },
        )

        lines.push(
            `  ${group.label}   naive ${(measured.structural / 1e6).toFixed(3)}   cursor ${(measured.cursor / 1e6).toFixed(3)}   markers ${(measured.markers / 1e6).toFixed(3)} ms   cursor/markers ${measured.claim}   [n=${measured.n} floor=${(measured.floor * 100).toFixed(2)}%]`,
        )
        if (measured.workDisagreement.length > 0)
            lines.push(
                `    WORK DISAGREES — ${measured.workDisagreement.join('; ')}`,
            )
        for (const scheme in measured.found)
            expect(measured.found[scheme], `${scheme} in ${group.label}`).toBe(
                bindings,
            )
    }
    if (!BENCH_SIZING) console.log(lines.join('\n'))
})
