// HOW LONG HYDRATION TAKES ON A GRID, in a real engine, for each marker scheme.
//
// This is the number the marker question turns on. Bytes are a table (`bun run bench:grid`) and
// node counts are a count; CLAUDE.md records a marker-elision change dropped because 998 fewer
// records moved the clock +0.053 ms and then -0.033 ms. The rule it left behind is that a COUNT
// must be converted to a COST before anything is built on it, and this is that conversion.
//
// The walk is batched because a browser coarsens `performance.now` to ~100 µs and a sub-
// millisecond op timed once returns the clock rather than the code (44.11).

import { execFileSync } from 'node:child_process'
import { test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

type Row = {
    variant: string
    cells: number
    nanoseconds: number
    found: number
}

const SHAPES: [number, number][] = [
    [10, 10],
    [50, 20],
    [100, 50],
]
const VARIANTS = ['two-markers', 'one-marker', 'no-markers'] as const

const pages = JSON.parse(
    execFileSync(
        'bun',
        [
            '-e',
            `
import { grid } from './packages/harness/scripts/GRID.ts'
const out = []
for (const [r, c] of ${JSON.stringify(SHAPES)})
    for (const v of ${JSON.stringify(VARIANTS)})
        out.push({ variant: v, rows: r, columns: c, ...grid(r, c, v) })
console.log(JSON.stringify(out))
`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
        .trim()
        .split('\n')
        .pop() as string,
) as {
    variant: string
    rows: number
    columns: number
    markup: string
    script: string
    cells: number
}[]

test('the hydration walk, per scheme, in this engine', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const rows: Row[] = []

    for (const built of pages) {
        await page.goto('about:blank')
        await page.setContent(
            `<!doctype html><html><body>${built.markup}</body></html>`,
        )
        const measured = (await page.evaluate(
            ({ script, cells }) => {
                const run = new Function(script)
                // Warm the shapes before timing: the first run of a walk pays for the
                // megamorphic sites it is about to make monomorphic, and timing it reports the
                // warm-up rather than the walk.
                for (let at = 0; at < 5; at += 1) run()

                // Enough repetitions that the sample is far above a coarsened clock.
                const reps = cells >= 5000 ? 40 : cells >= 1000 ? 200 : 2000
                const start = performance.now()
                for (let at = 0; at < reps; at += 1) run()
                const elapsed = performance.now() - start
                const found = (
                    globalThis as unknown as { __SLOTS__: unknown[] }
                ).__SLOTS__.filter((n) => n != null).length
                return { nanoseconds: (elapsed * 1e6) / reps, found }
            },
            { script: built.script, cells: built.cells },
        )) as { nanoseconds: number; found: number }

        rows.push({
            variant: built.variant,
            cells: built.cells,
            nanoseconds: measured.nanoseconds,
            found: measured.found,
        })
    }

    const lines = [`\n=== ${testInfo.project.name} — one hydration walk ===`]
    for (const [r, c] of SHAPES) {
        const cells = r * c
        const here = rows.filter((row) => row.cells === cells)
        const base = here.find((row) => row.variant === 'no-markers')
        lines.push(`  ${r}x${c} = ${cells} cells`)
        for (const row of here) {
            // EVERY ARM MUST HAVE FOUND EVERY SLOT. An arm that walked nothing is the fastest one
            // on the table, and the only thing that tells it from a quick one is the count.
            const ok =
                row.found === cells ? '' : `  !! found ${row.found} of ${cells}`
            const ms = row.nanoseconds / 1e6
            lines.push(
                `    ${row.variant.padEnd(12)} ${ms.toFixed(3)} ms   ${(row.nanoseconds / cells).toFixed(0)} ns/cell   ${base ? `${(row.nanoseconds / base.nanoseconds).toFixed(2)}x none` : ''}${ok}`,
            )
        }
        // WHERE IT CROSSES PERCEPTION, which is the only place the ratio matters. Under a frame
        // nothing here is visible however large the multiple.
        const worst = here.find((row) => row.variant === 'two-markers')
        if (worst !== undefined) {
            // THE N AT WHICH IT WOULD MATTER, stated rather than left to be imagined. Under a
            // frame nothing here is visible however large the multiple, and a ratio quoted
            // without this number is a ratio nobody can act on.
            const crossing = Math.round((16e6 / worst.nanoseconds) * cells)
            lines.push(
                `    under one frame; the walk would cross 16 ms at ~${crossing.toLocaleString()} cells`,
            )
        }
    }
    console.log(lines.join('\n'))
})
