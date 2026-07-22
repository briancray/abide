import { expect, test } from '@playwright/test'

// The live frontend render bench (`/platform/bench`). A streaming `GET` compiles a fixed corpus of
// `.abide` templates and times each one's SSR `render` path, `jsonl`-streaming one row per scenario —
// so the page's top-level `{#for await}` fills the table live. Because the bench runs INSIDE the page
// render, each measured render is isolated from the page's ambient streaming scope (benchFrontend.ts);
// a regression there floods the page with stray patches and pegs the render. This drives the real
// browser to prove the table fills, streams as an `<abide-list>`, hydrates, and re-runs on demand.

const SCENARIOS = [
    'static-text',
    'interpolation',
    'attributes',
    'if-else',
    'switch',
    'await-block',
    'for-list-100',
    'for-list-1000',
    'for-list-10000',
]

test('bench table fills live from the streamed corpus and stays bounded', async ({ page }) => {
    // The RAW first-load HTML actually STREAMED the rows as an `<abide-list>` with append patches (the
    // bench's first scenario blows past the 4ms deadline), NOT one buffered blob — and it carries none of
    // the stray `<abide-slot>` fill-patches a scope leak from the measured `await-block` template would
    // emit into the page stream.
    const raw = await (await page.request.get('/platform/bench')).text()
    expect(raw).toContain('<abide-list')
    expect(raw).toContain('data-ab-append')
    expect(raw).not.toContain('ab-patch')

    await page.goto('/platform/bench')

    // Every scenario lands one row; the corpus is fixed so the count is exact.
    const rows = page.getByTestId('bench-row')
    await expect(rows).toHaveCount(SCENARIOS.length)
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
    await expect(rows).toHaveCount(SCENARIOS.length)

    // Capture the first scenario's iteration count, then re-run: `.refresh()` re-invokes the streaming
    // source, the table repaints from the fresh transcript, and it settles back to the full corpus. The
    // iteration count is measured live so it will differ run-to-run — proving a genuine re-measure.
    const iterCell = rows.filter({ hasText: 'static-text' }).locator('td').last()
    const before = (await iterCell.textContent())?.trim() ?? ''

    await page.getByTestId('rerun').click()

    await expect(rows).toHaveCount(SCENARIOS.length)
    await expect(iterCell).not.toHaveText(before)
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')
})

test('reached via soft-nav, the streamed list still adopts and re-runs (seedOverride path)', async ({
    page,
}) => {
    // A streamed top-level `{#for await}` reached by IN-APP navigation seeds through the soft-nav envelope
    // (`seedOverride`), not the inline first-load script. Prove that path warms the cell too: the table
    // fills after the soft-nav, and the re-run button re-measures — a regression here would strand #52's
    // sibling on the soft-nav route.
    await page.goto('/platform')
    await page.evaluate(() => {
        ;(window as unknown as { __abideNoReload?: boolean }).__abideNoReload = true
    })

    await page.locator('aside.sidebar').getByRole('link', { name: 'Render bench' }).click()
    await expect(page).toHaveURL(/\/platform\/bench$/)

    const rows = page.getByTestId('bench-row')
    await expect(rows).toHaveCount(SCENARIOS.length)

    // It was a soft-nav (no full document reload wiped the marker).
    const survived = await page.evaluate(
        () => (window as unknown as { __abideNoReload?: boolean }).__abideNoReload === true,
    )
    expect(survived).toBe(true)

    // The adopted stream is reactive after the soft-nav: re-run re-measures the corpus.
    const iterCell = rows.filter({ hasText: 'static-text' }).locator('td').last()
    const before = (await iterCell.textContent())?.trim() ?? ''
    await page.getByTestId('rerun').click()
    await expect(rows).toHaveCount(SCENARIOS.length)
    await expect(iterCell).not.toHaveText(before)
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')
})
