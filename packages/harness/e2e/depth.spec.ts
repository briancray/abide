// DOES THE STRUCTURAL WALK LOSE ON A DEEP TREE? It is O(bindings x depth) where a marker walk is
// O(nodes) once, so the grid — which is two levels deep — could not have told. This is the case
// that distinguishes them, and it is the only reason markers might still be right somewhere.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { Sample } from 'harness/report'
import { type Report, reportScript } from './reportScript.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const REPORT = reportScript()
const CASES: [number, number][] = [
    [2, 200],
    [8, 200],
    [16, 200],
    [32, 200],
    [8, 2000],
    [32, 2000],
]

const trees = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { tree, wide } from './packages/harness/scripts/depthTree.ts'
const out = []
for (const [d, n] of ${JSON.stringify(CASES)})
    for (const s of ['structural', 'cursor', 'markers'])
        out.push({ scheme: s, shape: 'deep', ...tree(d, n, s) })
// WIDE: 500 parents x 4 bindings, four levels down. A single shared prefix hoists almost
// nothing here, which is the case that would justify hoisting per subtree.
for (const s of ['structural', 'cursor', 'markers'])
    out.push({ scheme: s, shape: 'wide', ...wide(4, 500, 4, s) })
console.log(JSON.stringify(out))
`,
        ],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as {
    scheme: string
    shape: 'deep' | 'wide'
    markup: string
    script: string
    bindings: number
    depth: number
}[]

// WEBKIT CANNOT PRICE THESE INSIDE A GATE: its clock is 1 ms, so 44.11's bar is 100 ms a sample
// and `batch()` refuses rather than report the clock. `list.spec.ts` carries the whole reason.
test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit coarsens its clock to 1 ms; 44.11 cannot be met inside a gate budget',
)

/**
 * A scheme's slot script, re-pointed from the document at the root it is handed.
 *
 * The three schemes share one page so `batch()` can interleave them, and each script finds its
 * tree by id — so each is scoped to its own container rather than to whichever tree comes first.
 */
function rooted(script: string): string {
    const scoped = script.replaceAll(
        'document.querySelector(',
        'scope.querySelector(',
    )
    if (scoped === script)
        throw new Error(
            'a depth script no longer finds its tree the way this re-points',
        )
    return scoped
}

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
        await page.goto('about:blank')
        await page.setContent(
            `<!doctype html><html><body>${here.map((built) => `<div data-scheme="${built.scheme}">${built.markup}</div>`).join('')}</body></html>`,
        )
        await page.addScriptTag({ content: REPORT })
        const measured = await page.evaluate(
            (schemes) => {
                const { batch, claimOf, emulatedDom, ratio } = (
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
                const timed = batch({
                    case: 'the hydration walk',
                    arms: {
                        markers: walks.markers as () => void,
                        cursor: walks.cursor as () => void,
                        structural: walks.structural as () => void,
                    },
                    emulated: emulatedDom(),
                    work,
                    budgetNanoseconds: 20_000_000_000,
                })
                const markers = timed.samples.markers as Sample
                const cursor = timed.samples.cursor as Sample
                const structural = timed.samples.structural as Sample
                const verdict = ratio(cursor, markers, { floor: timed.floor })
                return {
                    markers: markers.nanoseconds,
                    cursor: cursor.nanoseconds,
                    structural: structural.nanoseconds,
                    claim: claimOf(verdict),
                    workDisagreement: verdict.workDisagreement,
                    found,
                    n: timed.n,
                    floor: timed.floor,
                }
            },
            here.map((built) => ({
                scheme: built.scheme,
                script: rooted(built.script),
            })),
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
    console.log(lines.join('\n'))
})
