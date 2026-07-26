import { expect, type Locator, type Page, test } from '@playwright/test'

// The live frontend render bench (`/platform/bench`). A streaming `GET` compiles a fixed corpus of
// `.abide` templates and times each one's SSR `render` path, `jsonl`-streaming one row per scenario —
// so the page's top-level `{#for await}` fills the table live. Because the bench runs INSIDE the page
// render, each measured render is isolated from the page's ambient streaming scope (benchFrontend.ts);
// a regression there floods the page with stray patches and pegs the render. This drives the real
// browser to prove the table fills, streams against a `<template>` list sentinel, hydrates, and re-runs
// on demand.
//
// The row-count assertions carry an explicit timeout: every scenario is now measured TWICE (abide, then
// its hand-written vanilla baseline), so a full corpus takes noticeably longer than Playwright's 5s
// default to stream in.

// The server-renderable scenarios of the shared `@abide/bench/scenarios` corpus, in corpus order (the
// four `server: false` interaction-only scenarios are not render-benched). Kept in sync with that corpus.
const SCENARIOS = [
    'static-text',
    'interpolation',
    'attributes',
    'if-else',
    'for-list-100',
    'for-list-1000',
    'for-list-10000',
    'nested-for-if-50',
    'switch',
    'class-style-directives',
    'await-block',
]

// Assert that `.refresh()` genuinely re-invoked the streaming source and repainted the table.
//
// This deliberately does NOT compare a measured value before/after. Both re-run tests used to assert
// the `iters` cell CHANGED — but the bench measures live, and two runs of the same scenario producing
// the identical iteration count is a legitimate outcome, not a failure. That made both tests flaky
// under CPU contention (they failed in a full-suite run while passing 3/3 in isolation).
//
// What actually proves a re-invoke is structural: a `{#for await}` whose source is refreshed does
// CLEAR-AND-RESTREAM, so every row node from the previous run is torn down and replaced. Tag the
// current nodes, then require all of them to vanish before the full corpus streams back in. This is
// strictly stronger than the old assertion — it would also catch a regression to in-place patching,
// which the value comparison could not distinguish from a genuine re-run.
async function expectRerunRepaints(
    page: Page,
    rows: Locator,
    scenarioCount: number,
): Promise<void> {
    await page.evaluate(() => {
        for (const row of document.querySelectorAll('[data-testid="bench-row"]'))
            row.setAttribute('data-prev-run', '1')
    })

    await page.getByTestId('rerun').click()

    // Teardown: not one node from the previous run survives the restream.
    await expect(page.locator('[data-testid="bench-row"][data-prev-run]')).toHaveCount(0, {
        timeout: 30_000,
    })
    // Refill: the fresh transcript streams the whole corpus back in, with no scenario failing.
    await expect(rows).toHaveCount(scenarioCount, { timeout: 30_000 })
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')
}

test('bench table fills live from the streamed corpus and stays bounded', async ({ page }) => {
    // The RAW first-load HTML actually STREAMED the rows against a `<template id="ab-l:N">` sentinel with
    // append patches (the bench's first scenario blows past the 4ms deadline), NOT one buffered blob — and
    // it carries none of the stray slot fill-patches a scope leak from the measured `await-block` template
    // would emit into the page stream.
    const raw = await (await page.request.get('/platform/bench')).text()
    expect(raw).toContain('<template id="ab-l:0"')
    expect(raw).toContain('data-ab-append')
    expect(raw).not.toContain('ab-patch')

    await page.goto('/platform/bench')

    // Every scenario lands one row; the corpus is fixed so the count is exact.
    const rows = page.getByTestId('bench-row')
    await expect(rows).toHaveCount(SCENARIOS.length, { timeout: 30_000 })
    for (const name of SCENARIOS) {
        await expect(page.getByTestId('bench-table')).toContainText(name)
    }

    // No scenario failed — the `{:catch}` fallback never rendered.
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')

    // The list scenarios report a ns/row figure (the linear-scaling column); the scalar scenarios show
    // the em-dash placeholder. Both prove the row payload decoded and rendered, not just the row shell.
    const listRow = rows.filter({ hasText: 'for-list-10000' })
    await expect(listRow).toContainText(/ns|µs|ms/)
    const scalarRow = rows.filter({ hasText: 'static-text' })
    await expect(scalarRow).toContainText('—')
})

test('re-run button re-invokes the corpus and repaints the table', async ({ page }) => {
    await page.goto('/platform/bench')

    const rows = page.getByTestId('bench-row')
    await expect(rows).toHaveCount(SCENARIOS.length, { timeout: 30_000 })

    // `.refresh()` re-invokes the streaming source: the table tears down and repaints from the fresh
    // transcript, settling back to the full corpus.
    await expectRerunRepaints(page, rows, SCENARIOS.length)
})

test('reached via soft-nav, the streamed list still adopts and re-runs (seedOverride path)', async ({
    page,
}) => {
    // A streamed top-level `{#for await}` reached by IN-APP navigation seeds through the soft-nav envelope
    // (`seedOverride`), not the inline first-load script. Prove that path warms the memo too: the table
    // fills after the soft-nav, and the re-run button re-measures — a regression here would strand #52's
    // sibling on the soft-nav route.
    await page.goto('/platform')
    await page.evaluate(() => {
        ;(window as unknown as { __abideNoReload?: boolean }).__abideNoReload = true
    })

    await page.locator('aside.sidebar').getByRole('link', { name: 'Render bench' }).click()
    await expect(page).toHaveURL(/\/platform\/bench$/)

    const rows = page.getByTestId('bench-row')
    await expect(rows).toHaveCount(SCENARIOS.length, { timeout: 30_000 })

    // It was a soft-nav (no full document reload wiped the marker).
    const survived = await page.evaluate(
        () => (window as unknown as { __abideNoReload?: boolean }).__abideNoReload === true,
    )
    expect(survived).toBe(true)

    // The adopted stream is reactive after the soft-nav: re-run tears the list down and re-streams it.
    await expectRerunRepaints(page, rows, SCENARIOS.length)
})

// The measurement gate. Read the raw `jsonl` transcript the page renders and assert the property the
// page claims and a regression would break: SSR `render` is O(n) in element count, so ns/row holds
// roughly FLAT across 100 → 1000 → 10000 and total op-time grows ~linearly, never quadratically. The
// checks are RATIO-based — they compare measurements from the same run on the same machine — so they
// gate the algorithmic complexity without any absolute-time threshold that would flake across CI
// hardware. An accidental O(n²) in the render path (e.g. a quadratic list build) blows these out
// decisively (~100× per decade) while ordinary run-to-run noise (~1.5×) stays comfortably inside.
interface BenchRow {
    name: string
    nsPerOp: number
    iters: number
    rows: number | null
    nsPerRow: number | null
}

test('render scales linearly with element count (the O(n) gate)', async ({ page }) => {
    // The page consumes this exact stream; read it straight so the gate is on the numbers, not on parsing
    // formatted table cells. A direct fetch runs the bench in a plain request scope (no ambient stream).
    const res = await page.request.get('/__abide/rpc/benchFrontend')
    expect(res.ok()).toBe(true)
    const transcript: BenchRow[] = (await res.text())
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as BenchRow)

    // The full, fixed corpus streamed — every scenario measured exactly once, in order.
    expect(transcript.map((r) => r.name)).toEqual(SCENARIOS)
    for (const row of transcript) {
        expect(Number.isFinite(row.nsPerOp)).toBe(true)
        expect(row.nsPerOp).toBeGreaterThan(0)
        expect(row.iters).toBeGreaterThan(0)
    }

    const byName = new Map(transcript.map((r) => [r.name, r]))
    const at = (name: string): BenchRow => {
        const row = byName.get(name)
        if (row === undefined) throw new Error(`missing bench row: ${name}`)
        return row
    }
    const list100 = at('for-list-100')
    const list1000 = at('for-list-1000')
    const list10000 = at('for-list-10000')

    // Only the list scenarios carry ns/row; the scalar scenarios report none.
    for (const row of transcript) {
        if (row.rows === null) expect(row.nsPerRow).toBeNull()
        else expect(row.nsPerRow).toBeGreaterThan(0)
    }

    // Per-op cost rises with the list (10× the rows costs more), but SUB-QUADRATICALLY: each 10× step
    // is well under a quadratic 100× blow-up. Linear is ~10×; the 30× ceiling leaves ~3× noise headroom
    // yet still fails hard on any O(n²) regression.
    expect(list1000.nsPerOp).toBeGreaterThan(list100.nsPerOp)
    expect(list10000.nsPerOp).toBeGreaterThan(list1000.nsPerOp)
    expect(list1000.nsPerOp / list100.nsPerOp).toBeLessThan(30)
    expect(list10000.nsPerOp / list1000.nsPerOp).toBeLessThan(30)

    // The direct statement of O(n): per-row cost stays roughly flat as the list grows two orders of
    // magnitude. A generous 8× band absorbs fixed-overhead skew on the small list and GC jitter, while
    // a quadratic path (per-row cost climbing ~100× from 100 → 10000) fails it outright.
    const perRow = [list100.nsPerRow!, list1000.nsPerRow!, list10000.nsPerRow!]
    const spread = Math.max(...perRow) / Math.min(...perRow)
    expect(spread).toBeLessThan(8)
})
