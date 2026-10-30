// HOW LONG HYDRATION TAKES ON A GRID, in a real engine, for each marker scheme.
//
// This is the number the marker question turns on. Bytes are a table (`bun run bench:grid`) and
// node counts are a count; CLAUDE.md records a marker-elision change dropped because 998 fewer
// records moved the clock +0.053 ms and then -0.033 ms. The rule it left behind is that a COUNT
// must be converted to a COST before anything is built on it, and this is that conversion.
//
// The walk goes through `batch()` because a browser coarsens `performance.now` to ~100 µs and a
// sub-millisecond op timed once returns the clock rather than the code (43.11) — and because the
// three schemes have to be INTERLEAVED, so all three are on one page, each under its own root.

import { execFileSync } from 'node:child_process'

import type { Sample } from '@abide/harness/report'
import { expect, test } from '@playwright/test'

import { type Report, reportScript } from './reportScript.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const REPORT = reportScript()

const SHAPES: [number, number][] = [
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
import { grid } from './packages/abide/bench/gridPage.ts'
const out = []
for (const [r, c] of ${JSON.stringify(SHAPES)})
    for (const v of ${JSON.stringify(VARIANTS)})
        out.push({ variant: v, rows: r, columns: c, ...grid(r, c, v, 'dense') })
console.log(JSON.stringify(out))
`,
        ],
        // A dense 100x50 grid is ~700 KB of markup per variant, well past the default
        // 1 MB stdout buffer — which fails as ENOBUFS and reads like a spawn problem.
        { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
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

// WEBKIT CANNOT PRICE THESE INSIDE A GATE: its clock is 1 ms, so 43.11's bar is 100 ms a sample
// and `batch()` refuses rather than report the clock. `list.spec.ts` carries the whole reason.
test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit coarsens its clock to 1 ms; 43.11 cannot be met inside a gate budget',
)

/**
 * A variant's slot script, re-pointed from the document at the root it is handed.
 *
 * Three schemes share one page so `batch()` can interleave them, and each script finds its table
 * by id — so each is scoped to its own container rather than to whichever table comes first.
 */
function rooted(script: string): string {
    const scoped = script.replaceAll(
        'document.querySelector(',
        'scope.querySelector(',
    )
    if (scoped === script)
        throw new Error(
            'a grid script no longer finds its table the way this re-points',
        )
    return scoped
}

test('the hydration walk, per scheme, in this engine', async ({
    page,
}, testInfo) => {
    test.setTimeout(5 * 60 * 1000)
    const lines = [`\n=== ${testInfo.project.name} — one hydration walk ===`]

    for (const [rows, columns] of SHAPES) {
        const here = pages.filter(
            (built) => built.rows === rows && built.columns === columns,
        )
        await page.goto('about:blank')
        await page.setContent(
            `<!doctype html><html><body>${here.map((built) => `<div data-variant="${built.variant}">${built.markup}</div>`).join('')}</body></html>`,
        )
        await page.addScriptTag({ content: REPORT })
        const measured = await page.evaluate(
            (variants) => {
                const { batch, claimOf, emulatedDom, ratio } = (
                    globalThis as unknown as { __REPORT__: Report }
                ).__REPORT__
                const slotsOf = (): (Text | null)[] =>
                    (globalThis as unknown as { __SLOTS__: (Text | null)[] })
                        .__SLOTS__
                const walks: Record<string, () => void> = {}
                const found: Record<string, number> = {}
                for (const { variant, script } of variants) {
                    const root = document.querySelector(
                        `[data-variant="${variant}"]`,
                    )
                    const walk = new Function('scope', script) as (
                        root: Element | null,
                    ) => void
                    walks[variant] = () => walk(root)
                    // EVERY ARM MUST FIND EVERY SLOT. An arm that walked nothing is the fastest
                    // one on the table, and the only thing that tells it from a quick one is the
                    // count.
                    walk(root)
                    let count = 0
                    for (const slot of slotsOf()) if (slot != null) count += 1
                    found[variant] = count
                }
                // THE WALK IS NOT HYDRATION. Finding a slot is the cheap half; RUNNING its
                // binding — evaluating the expression and writing the node — is the half an app
                // actually pays, and it is the denominator the walk's ratio has to be read
                // against. One bind arm, over the slots `no-markers` found: the writes are the
                // same text nodes' whichever scheme found them.
                walks['no-markers']?.()
                const slots = slotsOf()
                let call = 0
                const bind = (): void => {
                    call += 1
                    for (let i = 0; i < slots.length; i += 1) {
                        const node = slots[i]
                        if (node == null) continue
                        // A deliberately ordinary expression: a few arithmetic ops and a string
                        // build, which is what a formatted cell costs.
                        const value = `${((i * 31) % 97) + call} / ${((i * 7) % 13) + 1}`
                        if (node.data !== value) node.data = value
                    }
                }
                const work: Record<string, Record<string, number>> = {}
                for (const variant in found)
                    work[variant] = { slotsFound: found[variant] as number }
                const timed = batch({
                    case: 'the hydration walk',
                    // `no-markers` FIRST: it is the denominator, and the first arm is the A/A
                    // control.
                    arms: {
                        'no-markers': walks['no-markers'] as () => void,
                        'one-marker': walks['one-marker'] as () => void,
                        'two-markers': walks['two-markers'] as () => void,
                        bind,
                    },
                    emulated: emulatedDom(),
                    work,
                    budgetNanoseconds: 20_000_000_000,
                })
                const base = timed.samples['no-markers'] as Sample
                const out: {
                    variant: string
                    nanoseconds: number
                    claim: string
                    workDisagreement: string[]
                }[] = []
                for (const { variant } of variants) {
                    const sample = timed.samples[variant] as Sample
                    const verdict =
                        variant === 'no-markers'
                            ? null
                            : ratio(sample, base, { floor: timed.floor })
                    out.push({
                        variant,
                        nanoseconds: sample.nanoseconds,
                        claim:
                            verdict === null ? '' : `${claimOf(verdict)} none`,
                        workDisagreement: verdict?.workDisagreement ?? [],
                    })
                }
                return {
                    rows: out,
                    bind: (timed.samples.bind as Sample).nanoseconds,
                    found,
                    n: timed.n,
                    floor: timed.floor,
                }
            },
            here.map((built) => ({
                variant: built.variant,
                script: rooted(built.script),
            })),
        )

        const cells = here[0]?.cells ?? 0
        lines.push(
            `  ${cells} slots (dense cells, 3 slots each)   [n=${measured.n} floor=${(measured.floor * 100).toFixed(2)}%]`,
        )
        for (const row of measured.rows) {
            const total = row.nanoseconds + measured.bind
            lines.push(
                `    ${row.variant.padEnd(12)} walk ${(row.nanoseconds / 1e6).toFixed(2)} ms  bind ${(measured.bind / 1e6).toFixed(2)} ms  total ${(total / 1e6).toFixed(2)} ms   walk is ${((row.nanoseconds / total) * 100).toFixed(0)}% of hydration   ${row.claim}`,
            )
            if (row.workDisagreement.length > 0)
                lines.push(
                    `      WORK DISAGREES — ${row.workDisagreement.join('; ')}`,
                )
        }
        const worst = measured.rows.find((row) => row.variant === 'two-markers')
        const base = measured.rows.find((row) => row.variant === 'no-markers')
        if (worst !== undefined && base !== undefined) {
            // NAME THE SHARE. What eliding markers can win is capped by the fraction of hydration
            // the walk is — everything else is the bindings, which no addressing scheme touches.
            const totalWorst = worst.nanoseconds + measured.bind
            const saved = worst.nanoseconds - base.nanoseconds
            lines.push(
                `    eliding markers saves ${(saved / 1e6).toFixed(2)} ms of a ${(totalWorst / 1e6).toFixed(2)} ms hydration — a ceiling of ${((saved / totalWorst) * 100).toFixed(1)}%`,
            )
            // THE N AT WHICH IT WOULD MATTER, stated rather than left to be imagined. Under a
            // frame nothing here is visible however large the multiple, and a ratio quoted
            // without this number is a ratio nobody can act on.
            const crossing = Math.round((16e6 / worst.nanoseconds) * cells)
            lines.push(
                `    under one frame; the walk would cross 16 ms at ~${crossing.toLocaleString()} cells`,
            )
        }
        for (const variant in measured.found)
            expect(
                measured.found[variant],
                `${variant} at ${cells} slots`,
            ).toBe(cells)
    }
    console.log(lines.join('\n'))
})
