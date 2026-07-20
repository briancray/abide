import { expect, test } from '@playwright/test'

// The Build & Deploy section — documentation pages (CLI reference + deploy guide). They are prose +
// code blocks (no live RPC demos), so the checks are: they SSR + hydrate, render their code blocks,
// appear in the sidebar, and soft-nav between each other like any other in-app page.

test('CLI page renders its command reference', async ({ page }) => {
    await page.goto('/cli')
    await expect(page.locator('h1')).toHaveText('CLI')
    // Representative commands from the code blocks are present.
    await expect(page.locator('main.page')).toContainText('abide scaffold my-app')
    await expect(page.locator('pre.code', { hasText: 'abide build' })).toBeVisible()
    // Active in the sidebar under the Build & Deploy group.
    await expect(page.locator('.idx-link.idx-active')).toHaveText('CLI')
})

test('Deploy page documents build → serve with the dist layout', async ({ page }) => {
    await page.goto('/deploy')
    await expect(page.locator('h1')).toHaveText('Build & deploy')
    await expect(page.locator('main.page')).toContainText('manifest.json')
    await expect(page.locator('main.page')).toContainText('immutable')
})

test('Deploy page shows both Docker options under the deploy tag', async ({ page }) => {
    await page.goto('/deploy')
    // Both container shapes: `abide start` and the `abide compile` standalone binary, tagged `deploy`.
    await expect(page.locator('main.page')).toContainText('docker build -t deploy')
    await expect(page.locator('main.page')).toContainText('bun run abide compile')
    await expect(page.locator('main.page')).toContainText('ENTRYPOINT ["server"]')
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
    await expect(table.locator('tbody tr')).toHaveCount(18)
})

test('soft-nav from CLI to Deploy swaps content without a full reload', async ({ page }) => {
    await page.goto('/cli')
    await page.evaluate(() => ((window as unknown as { __nav: boolean }).__nav = true))
    // The sidebar nav link (the CLI page prose also links to /deploy — scope to the sidebar).
    await page.locator('.sidebar').getByRole('link', { name: 'Build & deploy', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Build & deploy')
    expect(await page.evaluate(() => (window as unknown as { __nav?: boolean }).__nav)).toBe(true)
})
