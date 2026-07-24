import { expect, test } from '@playwright/test'

// The live server-dispatch bench (`/platform/bench/server`) — the counterpart to the frontend render
// bench. A streaming `GET` times abide's in-process per-request/per-read primitives (route classification,
// cache-key building, the `memo` read + cache-verb surface) with the SHARED `@abide/bench` recipes the CLI
// `bun run bench:server` uses, `jsonl`-streaming one row per bench so the page's top-level `{#for await}`
// fills the table live. Unlike the CLI runner it omits the loopback `createTestApp` dispatch benches.

const BENCHES = [
    'matchRoute',
    'canonicalKey/scalar',
    'canonicalKey/object',
    'read-warm',
    'invalidate-scan-100',
]

test('server bench table fills live from the streamed primitives', async ({ page }) => {
    // The RAW first-load HTML STREAMED the rows as an `<abide-list>` with append patches — not one buffered
    // blob — and carries none of the stray fill-patches a scope leak would emit into the page stream.
    const raw = await (await page.request.get('/platform/bench/server')).text()
    expect(raw).toContain('<abide-list')
    expect(raw).toContain('data-ab-append')
    expect(raw).not.toContain('ab-patch')

    await page.goto('/platform/bench/server')

    // Every recipe lands exactly one row; the recipe set is fixed.
    const rows = page.getByTestId('bench-row')
    await expect(rows).toHaveCount(BENCHES.length)
    for (const name of BENCHES) {
        await expect(page.getByTestId('bench-table')).toContainText(name)
    }
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')

    // Each row carries a real ns/op timing figure — proof the recipe ran and a measurement decoded.
    const timing = /\d+(\.\d+)?\s*(ns|µs|ms)/
    const matchRow = rows.filter({ hasText: 'matchRoute' })
    await expect(matchRow).toContainText(timing)
})

test('re-running streams a fresh set of rows', async ({ page }) => {
    await page.goto('/platform/bench/server')
    await expect(page.getByTestId('bench-row')).toHaveCount(BENCHES.length)
    await page.getByTestId('rerun').click()
    // The clear-and-restream tears the list down and rebuilds it to the same fixed count.
    await expect(page.getByTestId('bench-row')).toHaveCount(BENCHES.length)
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')
})
