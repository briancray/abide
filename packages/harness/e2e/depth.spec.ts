// DOES THE STRUCTURAL WALK LOSE ON A DEEP TREE? It is O(bindings x depth) where a marker walk is
// O(nodes) once, so the grid — which is two levels deep — could not have told. This is the case
// that distinguishes them, and it is the only reason markers might still be right somewhere.

import { execFileSync } from 'node:child_process'
import { test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
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
import { tree } from './packages/harness/scripts/DEPTH.ts'
const out = []
for (const [d, n] of ${JSON.stringify(CASES)})
    for (const s of ['structural', 'hoisted', 'markers'])
        out.push({ scheme: s, ...tree(d, n, s) })
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
    markup: string
    script: string
    bindings: number
    depth: number
}[]

test('the walk against tree depth, in this engine', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const rows: {
        scheme: string
        depth: number
        bindings: number
        ns: number
        found: number
    }[] = []

    for (const built of trees) {
        await page.goto('about:blank')
        await page.setContent(
            `<!doctype html><html><body>${built.markup}</body></html>`,
        )
        const measured = (await page.evaluate(
            ({ script, bindings }) => {
                const run = new Function(script)
                for (let at = 0; at < 5; at += 1) run()
                const reps = bindings >= 2000 ? 200 : 2000
                const start = performance.now()
                for (let at = 0; at < reps; at += 1) run()
                const elapsed = performance.now() - start
                const slots = (
                    globalThis as unknown as { __SLOTS__: unknown[] }
                ).__SLOTS__
                return {
                    ns: (elapsed * 1e6) / reps,
                    // An arm that found nothing is the fastest on the table.
                    found: slots.filter((n) => n != null).length,
                }
            },
            { script: built.script, bindings: built.bindings },
        )) as { ns: number; found: number }
        rows.push({
            scheme: built.scheme,
            depth: built.depth,
            bindings: built.bindings,
            ns: measured.ns,
            found: measured.found,
        })
    }

    const lines = [`\n=== ${testInfo.project.name} — one hydration walk ===`]
    for (const [depth, bindings] of CASES) {
        const here = rows.filter(
            (row) => row.depth === depth && row.bindings === bindings,
        )
        const naive = here.find((row) => row.scheme === 'structural')
        const hoisted = here.find((row) => row.scheme === 'hoisted')
        const markers = here.find((row) => row.scheme === 'markers')
        if (
            naive === undefined ||
            hoisted === undefined ||
            markers === undefined
        )
            continue
        const wrong = here.filter((row) => row.found !== bindings)
        const ok =
            wrong.length === 0
                ? ''
                : `  !! ${wrong.map((row) => `${row.scheme} found ${row.found}`).join(', ')} of ${bindings}`
        lines.push(
            `  depth ${String(depth).padStart(2)} x ${String(bindings).padStart(4)}   naive ${(naive.ns / 1e6).toFixed(3)}   hoisted ${(hoisted.ns / 1e6).toFixed(3)}   markers ${(markers.ns / 1e6).toFixed(3)} ms    hoisted/markers ${(hoisted.ns / markers.ns).toFixed(2)}x${ok}`,
        )
    }
    console.log(lines.join('\n'))
})
