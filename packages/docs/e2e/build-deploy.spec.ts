import { expect, test } from './fixtures.ts'

// The Build & Deploy section — documentation pages (CLI reference + deploy guide). They are prose +
// code blocks (no live RPC demos), so the checks are: they SSR + hydrate, render their code blocks,
// appear in the sidebar, and soft-nav between each other like any other in-app page.

test('CLI page renders its command reference', async ({ page }) => {
    await page.goto('/platform/cli')
    await expect(page.locator('h1')).toHaveText('CLI')
    // Representative commands from the code blocks are present.
    await expect(page.locator('main.page')).toContainText('abide scaffold my-app')
    await expect(page.locator('pre.code', { hasText: 'abide build' })).toBeVisible()
    // Active in the sidebar under the Build & Deploy group.
    await expect(page.locator('.idx-link.idx-active')).toHaveText('CLI')
})

test('Deploy page documents build → serve with the dist layout', async ({ page }) => {
    await page.goto('/platform/deploy')
    await expect(page.locator('h1')).toHaveText('Build & deploy')
    await expect(page.locator('main.page')).toContainText('manifest.json')
    await expect(page.locator('main.page')).toContainText('immutable')
})

test('Deploy page shows both Docker options under the deploy tag', async ({ page }) => {
    await page.goto('/platform/deploy')
    // Both container shapes: `abide start` and the `abide compile` standalone binary, tagged `deploy`.
    await expect(page.locator('main.page')).toContainText('docker build -t deploy')
    await expect(page.locator('main.page')).toContainText('bun run abide compile')
    // `serve` is spelled out: the binary's DEFAULT is the interactive command surface, so an
    // entrypoint that omits it would start a REPL with no console instead of a server.
    await expect(page.locator('main.page')).toContainText('ENTRYPOINT ["server", "serve"]')
    // The full env list moved to the Config page — not duplicated here.
    await expect(page.locator('main.page')).not.toContainText('ABIDE_MAX_STREAM_BUFFER_SIZE')
})

test('Config page lists all built-in env vars', async ({ page }) => {
    await page.goto('/platform/config')
    const table = page.locator('table.envtable')
    await expect(table).toBeVisible()
    // Spot-check the required var + a few spread across the table.
    await expect(table).toContainText('ABIDE_IDENTITY_SECRET')
    await expect(table).toContainText('ABIDE_MAX_STREAM_BUFFER_SIZE')
    await expect(table).toContainText('ABIDE_RPC_TIMEOUT')
    // The log feed is opt-in, so the ONLY way to discover how to turn it on is this table — and the
    // page is billed (and linked from Deploy) as the full list. It shipped without them.
    await expect(table).toContainText('ABIDE_LOGS')
    await expect(table).toContainText('ABIDE_LOG_BUFFER')
    // Four rows were removed as never-implemented: `ABIDE_APP_DIR` (a built-output path is neither a
    // runtime env var nor, as a first correction claimed, `compile --out` — that names the
    // executable; nothing renames `dist/_app/<hash>/`), `ABIDE_DEV_SURFACE`, and the two inspector
    // vars gating a route that does not exist. The count is what caught the page advertising them,
    // which is the whole reason it is asserted rather than spot-checked — a var a reader cannot use
    // and a var a reader cannot find are the same failure from opposite ends.
    await expect(table).not.toContainText('ABIDE_APP_DIR')
    await expect(table).not.toContainText('ABIDE_DEV_SURFACE')
    await expect(table).not.toContainText('ABIDE_ENABLE_INSPECTOR')
    await expect(table).not.toContainText('ABIDE_INSPECT')
    await expect(table.locator('tbody tr')).toHaveCount(16)
})

test('soft-nav from CLI to Deploy swaps content without a full reload', async ({ page }) => {
    await page.goto('/platform/cli')
    await page.evaluate(() => ((window as unknown as { __nav: boolean }).__nav = true))
    // The sidebar nav link (the CLI page prose also links to /deploy — scope to the sidebar).
    await page
        .locator('.sidebar')
        .getByRole('link', { name: 'Build & deploy', exact: true })
        .click()
    await expect(page.locator('h1')).toHaveText('Build & deploy')
    expect(await page.evaluate(() => (window as unknown as { __nav?: boolean }).__nav)).toBe(true)
})
