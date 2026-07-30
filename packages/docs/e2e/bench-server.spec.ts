import { expect, test } from './fixtures.ts'

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
    // The RAW first-load HTML STREAMED the rows against a `<template>` list sentinel with append patches —
    // not one buffered blob — and carries none of the stray fill-patches a scope leak would emit into the
    // page stream. The sentinel sits INSIDE the `<tbody>`: it must be a `<template>` (or a comment) because
    // the HTML parser FOSTER-PARENTS any other element out of a table section, relocating it above the
    // `<table>` — which is what stranded every append patch outside the table (half-formatted rows above it).
    const raw = await (await page.request.get('/platform/bench/server')).text()
    expect(raw).toContain('data-ab-append')
    // The patch MARKUP, not the substring `ab-patch`: `documentPatchPreamble` defines both DOM ops in one
    // deduped script per streaming document, so its `$abideFill` body carries the literal
    // `template[data-ab-patch="` on every page that streams anything at all — including an append-only one
    // like this. The claim here is about a stray FILL PATCH, which is `<template data-ab-patch=…>`.
    expect(raw).not.toContain('<template data-ab-patch')
    expect(raw).toMatch(/<tbody>[\s\S]*<template id="ab-l:0"[^>]*><\/template>[\s\S]*<\/tbody>/)

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

    // REGRESSION LOCK: every streamed row is a real `<tbody>` child, and no row was foster-parented out
    // of the table. A relocated container used to leave the browser-parsed rows as an anonymous table box
    // ABOVE the `<table>` — visibly half-formatted, and never cleaned up because hydration only clears
    // between the block's anchors (which the relocated nodes had escaped).
    await expect(
        page.locator('table[data-testid="bench-table"] > tbody > tr[data-testid="bench-row"]'),
    ).toHaveCount(BENCHES.length)
    // No list sentinel survives hydration either (it is cleared with the rest of the server region).
    await expect(page.locator('template[id^="ab-l:"]')).toHaveCount(0)
})

test('re-running streams a fresh set of rows', async ({ page }) => {
    await page.goto('/platform/bench/server')
    await expect(page.getByTestId('bench-row')).toHaveCount(BENCHES.length)
    await page.getByTestId('rerun').click()
    // The clear-and-restream tears the list down and rebuilds it to the same fixed count.
    await expect(page.getByTestId('bench-row')).toHaveCount(BENCHES.length)
    await expect(page.getByTestId('bench-table')).not.toContainText('bench failed')
})
