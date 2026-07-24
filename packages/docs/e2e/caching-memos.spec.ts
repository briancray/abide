import { expect, type Page, test } from '@playwright/test'

// Drives /caching/memo + /caching/probes: the bare memo() primitive and the reactive probes over a
// plain CLIENT-SIDE memo (no RPC, no transport). Proves the probe vocabulary is a property of the memo
// itself — reuse holds a run count, and peek/pending/refreshing/error/watch behave as documented.

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('memo() — repeated reads reuse the slot, invalidate re-runs', async ({ page }) => {
    await page.goto('/caching/memo')

    await page.getByTestId('memo-start').click()
    await expect(page.getByTestId('memo-runs')).toHaveText('1', { timeout: 15_000 })
    await expect(page.getByTestId('memo-value')).toHaveText('1')

    await page.getByTestId('memo-read').click()
    await page.getByTestId('memo-read').click()
    await expect(page.getByTestId('memo-reads')).toHaveText('2')
    await expect(page.getByTestId('memo-runs')).toHaveText('1') // reuse — count holds

    await page.getByTestId('memo-invalidate').click()
    await page.getByTestId('memo-read').click()
    await expect(page.getByTestId('memo-runs')).toHaveText('2', { timeout: 15_000 }) // re-ran
})

test('peek() — undefined while pending, then the value', async ({ page }) => {
    await page.goto('/caching/probes')

    await expect(page.getByTestId('memopeek-value')).toHaveText('idle')
    await page.getByTestId('memopeek-read').click()
    await expect(page.getByTestId('memopeek-value')).toHaveText('hello a', { timeout: 15_000 })
})

test('pending() — yes during the first load, no once settled', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('memopending-read').click()
    await expect(page.getByTestId('memopending-flag')).toHaveText('yes')
    await expect(page.getByTestId('memopending-value')).toHaveText('ready a', { timeout: 15_000 })
    await expect(page.getByTestId('memopending-flag')).toHaveText('no')
})

test('refreshing() — yes over a retained value while pending stays no', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('memorefreshing-read').click()
    await expect(page.getByTestId('memorefreshing-value')).toHaveText('1', { timeout: 15_000 })

    await page.getByTestId('memorefreshing-refresh').click()
    await expect(page.getByTestId('memorefreshing-flag')).toHaveText('yes')
    await expect(page.getByTestId('memorefreshing-pending')).toHaveText('no')
    await expect(page.getByTestId('memorefreshing-value')).toHaveText('1') // stale retained
    await expect(page.getByTestId('memorefreshing-value')).toHaveText('2', { timeout: 15_000 })
    await expect(page.getByTestId('memorefreshing-flag')).toHaveText('no')
})

test('error() — holds a rejected load, clears on fix + retry', async ({ page }) => {
    await page.goto('/caching/probes')

    await page.getByTestId('memoerror-trigger').click()
    await expect(page.getByTestId('memoerror-error')).toHaveText('memo boom for a', {
        timeout: 15_000,
    })

    await page.getByTestId('memoerror-fix').click()
    await expect(page.getByTestId('memoerror-error')).toHaveText('none', { timeout: 15_000 })
    await expect(page.getByTestId('memoerror-value')).toHaveText('ok a')
})

test('isomorphic state — a server-side reactive graph (state + computed + watch across modules)', async ({
    page,
}) => {
    await page.goto('/caching/memo')
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

    await page.getByTestId('memowatch-read').click()
    await expect(page.getByTestId('memowatch-value')).toHaveText('1', { timeout: 15_000 })
    await expect.poll(() => intOf(page, 'memowatch-hits')).toBeGreaterThan(0)
    const hits = await intOf(page, 'memowatch-hits')

    await page.getByTestId('memowatch-refresh').click()
    await expect.poll(() => intOf(page, 'memowatch-hits')).toBeGreaterThan(hits)
})
