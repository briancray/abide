import { expect, type Page, test } from '@playwright/test'

// Drives /caching/cell + /caching/probes: the bare cell() primitive and the reactive probes over a
// plain CLIENT-SIDE cell (no RPC, no transport). Proves the probe vocabulary is a property of the cell
// itself — reuse holds a run count, and peek/pending/refreshing/error/watch behave as documented.

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('cell() — repeated reads reuse the slot, invalidate re-runs', async ({ page }) => {
    await page.goto('/caching/cell')

    await page.getByTestId('cell-start').click()
    await expect(page.getByTestId('cell-runs')).toHaveText('1', { timeout: 15_000 })
    await expect(page.getByTestId('cell-value')).toHaveText('1')

    await page.getByTestId('cell-read').click()
    await page.getByTestId('cell-read').click()
    await expect(page.getByTestId('cell-reads')).toHaveText('2')
    await expect(page.getByTestId('cell-runs')).toHaveText('1') // reuse — count holds

    await page.getByTestId('cell-invalidate').click()
    await page.getByTestId('cell-read').click()
    await expect(page.getByTestId('cell-runs')).toHaveText('2', { timeout: 15_000 }) // re-ran
})

test('peek() — undefined while pending, then the value', async ({ page }) => {
    await page.goto('/caching/probes')

    await expect(page.getByTestId('cellpeek-value')).toHaveText('idle')
    await page.getByTestId('cellpeek-read').click()
    await expect(page.getByTestId('cellpeek-value')).toHaveText('hello a', { timeout: 15_000 })
})

test('pending() — yes during the first load, no once settled', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('cellpending-read').click()
    await expect(page.getByTestId('cellpending-flag')).toHaveText('yes')
    await expect(page.getByTestId('cellpending-value')).toHaveText('ready a', { timeout: 15_000 })
    await expect(page.getByTestId('cellpending-flag')).toHaveText('no')
})

test('refreshing() — yes over a retained value while pending stays no', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('cellrefreshing-read').click()
    await expect(page.getByTestId('cellrefreshing-value')).toHaveText('1', { timeout: 15_000 })

    await page.getByTestId('cellrefreshing-refresh').click()
    await expect(page.getByTestId('cellrefreshing-flag')).toHaveText('yes')
    await expect(page.getByTestId('cellrefreshing-pending')).toHaveText('no')
    await expect(page.getByTestId('cellrefreshing-value')).toHaveText('1') // stale retained
    await expect(page.getByTestId('cellrefreshing-value')).toHaveText('2', { timeout: 15_000 })
    await expect(page.getByTestId('cellrefreshing-flag')).toHaveText('no')
})

test('error() — holds a rejected load, clears on fix + retry', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('cellerror-trigger').click()
    await expect(page.getByTestId('cellerror-error')).toHaveText('cell boom for a', {
        timeout: 15_000,
    })

    await page.getByTestId('cellerror-fix').click()
    await expect(page.getByTestId('cellerror-error')).toHaveText('none', { timeout: 15_000 })
    await expect(page.getByTestId('cellerror-value')).toHaveText('ok a')
})

test('isomorphic state — a server-side reactive graph (state + computed + watch across modules)', async ({
    page,
}) => {
    await page.goto('/caching/cell')
    await page.getByTestId('sr-read').click()
    await expect(page.getByTestId('sr-total')).toHaveText(/^\d+$/, { timeout: 15_000 })
    const total0 = await intOf(page, 'sr-total')
    const fires0 = await intOf(page, 'sr-fires')

    await page.getByTestId('sr-bump').click()
    // The server write propagates through the derived computed and fires the server-side watch.
    await expect(page.getByTestId('sr-total')).toHaveText(String(total0 + 1), { timeout: 15_000 })
    await expect(page.getByTestId('sr-doubled')).toHaveText(String((total0 + 1) * 2))
    await expect.poll(() => intOf(page, 'sr-fires')).toBeGreaterThan(fires0)
})

test('watch(args, cb) — fires on every load and refresh', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('cellwatch-read').click()
    await expect(page.getByTestId('cellwatch-value')).toHaveText('1', { timeout: 15_000 })
    await expect.poll(() => intOf(page, 'cellwatch-hits')).toBeGreaterThan(0)
    const hits = await intOf(page, 'cellwatch-hits')

    await page.getByTestId('cellwatch-refresh').click()
    await expect.poll(() => intOf(page, 'cellwatch-hits')).toBeGreaterThan(hits)
})
