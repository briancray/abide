// The measurement lane the PAGE cannot have: retained memory, and the work the engine actually did.
//
// Everything on `/bench` is taken from inside the tab, and three numbers are simply not reachable from
// there. `performance.memory` reads 9.5 MB against a renderer holding 2.8 GB, because DOM nodes are not
// on the JS heap and no browser exposes the heap they are on. A net node count cannot stand in either:
// detaching a subtree of ten thousand is ONE `remove`, so the counter reads the same whether those nodes
// are collectable or pinned by a live effect. And nothing in a page can ask for a collection, which is
// the only thing that makes the difference between those two states observable at all.
//
// The devtools protocol can do all three. `HeapProfiler.collectGarbage` then `Memory.getDOMCounters` is
// RETAINED rather than not-yet-swept, and `Performance.getMetrics` carries `RecalcStyleCount` and
// `LayoutCount` — the counters this project's own rules require before believing an existence proof,
// and which nothing here measured until now.
//
// Two things this lane is NOT. It is not a timing measurement: `/bench` owns that, its arms are
// interleaved on purpose, and a forced collection dropped between its passes would wreck the number it
// exists to take — so this drives `profile()` instead, which runs one arm alone with no clock involved.
// And it is not portable: CDP is Chromium, so every number here describes Blink. That is the substrate
// rule rather than a gap, but it does mean a leak that only shows in WebKit will not show here.
//
// Off by default because it is minutes rather than seconds. `bun run profile` turns it on.

// `BenchHandle` is the page's own declaration of what it hangs on the global — imported rather than
// re-typed here, because `page.evaluate` erases everything at the boundary and three spellings of one
// shape type-check on both sides while failing at runtime. Type-only, so nothing enters the runtime graph.
import type { BenchHandle } from 'abide-kit'
import { expect, test } from 'abide-kit/e2e'

/** The suites to profile, and how many ops of each arm to bracket. */
const SUITES = (process.env.ABIDE_PROFILE_SUITES ?? 'hydrate,client').split(',')
const OPS = Number(process.env.ABIDE_PROFILE_OPS ?? 20)

/** What a reading IS — every field below is one a column reads. See `read`. */
interface Reading {
    nodes: number
    heap: number
    layout: number
    recalc: number
}

const NAMED = ['LayoutCount', 'RecalcStyleCount'] as const

test.skip(process.env.ABIDE_PROFILE === undefined, 'set ABIDE_PROFILE=1, or run `bun run profile`')

test('what each arm RETAINS, and what it made the engine do', async ({ page }) => {
    test.setTimeout(1_800_000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    await cdp.send('HeapProfiler.enable')

    /**
     * A reading, taken after a FORCED COLLECTION.
     *
     * The collection is the whole reason this lane exists. Without it `nodes` counts whatever has not
     * been swept yet, which drifts on its own between two reads of an idle page — so a delta would be
     * noise with a leak somewhere inside it rather than the leak.
     */
    const read = async (): Promise<Reading> => {
        await cdp.send('HeapProfiler.collectGarbage')
        const perf = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }
        const dom = (await cdp.send('Memory.getDOMCounters')) as { nodes: number }
        const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
        const named = new Map(perf.metrics.map((m) => [m.name, m.value]))
        for (const name of NAMED) expect(named.has(name), `${name} is not in Performance.getMetrics`).toBe(true)
        return {
            nodes: dom.nodes,
            heap: heap.usedSize,
            layout: named.get('LayoutCount') as number,
            recalc: named.get('RecalcStyleCount') as number,
        }
    }

    const per = (a: number, b: number): number => (b - a) / OPS
    const cell = (n: number, digits = 1): string => n.toFixed(digits).padStart(11)

    const runArm = (title: string, label: string): Promise<void> =>
        page.evaluate(
            ([forTitle, forLabel, ops]) => {
                const held = globalThis as { abideBench?: BenchHandle }
                if (held.abideBench === undefined) throw new Error('the page exposed no bench')
                return held.abideBench.run(forTitle as string, forLabel as string, ops as number)
            },
            [title, label, OPS] as const,
        )

    // Every style and layout tick the run caused, so a column of zeros can say WHY it is zeros.
    let layouts = 0

    for (const suite of SUITES) {
        await page.goto(`/bench/${suite}`)
        // The rows are an async load and `exposeBench` runs when it lands, so `goto` returning is not
        // the handle existing. Waiting on the TABLE rather than on the global: the same load produces
        // both, and one of them is a thing the page is required to show.
        await expect(page.locator('[data-bench]').first()).toBeAttached({ timeout: 60_000 })
        const listed = await page.evaluate(
            () => (globalThis as { abideBench?: BenchHandle }).abideBench?.list() ?? [],
        )
        expect(listed.length, `/bench/${suite} exposed no arms — is \`exposeBench\` still called?`).toBeGreaterThan(0)

        console.log(`\n  ${suite} · two windows of ${OPS} ops · retained after a forced collection`)
        console.log(
            `  ${'arm'.padEnd(54)}${'nodes/op'.padStart(11)}${'bytes/op'.padStart(11)}${'resident'.padStart(11)}${'recalc/op'.padStart(11)}${'layout/op'.padStart(11)}`,
        )

        for (const row of listed) {
            console.log(`  ${row.title} · ${row.kind}`)
            for (const arm of row.arms) {
                // TWO windows, and that is the whole instrument. One window cannot tell a LEAK from a
                // RESIDUE: an arm that correctly keeps one live 10000-row tree shows +40,000 nodes
                // over twenty ops, which divided by twenty reads as a 2,000-per-op leak and is not
                // one. The residue is established by the first window, so the SECOND window's delta
                // is what actually scales with ops — and the difference between them is the fixed
                // set the arm holds. This is the repo's own retention rule: prove it with a ratio
                // between two sizes of the same structure, never with one size and a division.
                const start = await read()
                await runArm(row.title, arm)
                const settled = await read()
                await runArm(row.title, arm)
                const again = await read()

                const leak = (a: keyof Reading): number => per(settled[a], again[a])
                const resident = (a: keyof Reading): number =>
                    settled[a] - start[a] - (again[a] - settled[a])
                console.log(
                    `    ${arm.slice(0, 50).padEnd(50)}${cell(leak('nodes'))}${cell(leak('heap'), 0)}${cell(resident('nodes'), 0)}${cell(leak('recalc'), 2)}${cell(leak('layout'), 2)}`,
                )
                layouts += leak('layout') + leak('recalc')
                // A REPORT NOBODY ASSERTS ROTS, and this one is measuring the exact failure that
                // motivated it. A bench arm holds a bounded set and hands the rest back; anything
                // that grows with the op count is a leak, and a leak in an arm is a leak in what the
                // arm is measuring. The bound is far above zero and far below the thing it catches —
                // an undisposed 10000-row mount reads 42,007 nodes an op against this 64.
                expect(
                    leak('nodes'),
                    `${row.title} · ${arm} retains ${leak('nodes').toFixed(1)} nodes per op`,
                ).toBeLessThan(64)
            }
        }
    }

    // NO SILENT ZEROS. `recalc` and `layout` read 0.00 for every arm above and that is a fact about
    // the benches rather than a broken counter: a bench arm builds into a DETACHED host, which never
    // has style resolved or a box laid out. The counters are here because this repo's own rules
    // require them before believing an existence proof — the "4.5x faster" arm that was one CSS rule
    // — and they will start moving the moment something profiles an attached tree.
    if (layouts === 0) {
        console.log(
            '\n  recalc and layout are zero throughout: every arm above builds into a DETACHED host,',
        )
        console.log('  which is never styled and never laid out. The counters are live, the work is not.')
    }
})
