import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// Drives /rpc/probes: the reactive read surface over a live RPC — live/pending/error in a template,
// pending vs refreshing, the error probe, and the watch(args, cb) method form. Assertions are relative
// (server run counters are process-global and monotonic).

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('in-template fn.live()/pending()/error() resolve to the value', async ({ page }) => {
    await page.goto('/rpc/probes')
    // The probe block settles to the greeting value once the read resolves.
    await expect(page.getByTestId('probe-value')).toHaveText('Hello, probe!', { timeout: 15_000 })
    await expect(page.getByTestId('probe-pending-flag')).toHaveText('false', { timeout: 15_000 })
    await expect(page.getByTestId('probe-error-flag')).toHaveText('none')
})

test('refreshing(args) is true over a RETAINED value while pending stays false', async ({
    page,
}) => {
    await page.goto('/rpc/probes')

    await page.getByTestId('refreshing-start').click()
    await expect(page.getByTestId('refreshing-value')).toHaveText(/^\d+$/, { timeout: 5000 })
    await expect(page.getByTestId('refreshing-flag')).toHaveText('no')
    const firstValue = await intOf(page, 'refreshing-value')

    await page.getByTestId('refreshing-refresh').click()
    await expect(page.getByTestId('refreshing-flag')).toHaveText('yes')
    await expect(page.getByTestId('refreshing-pending')).toHaveText('no')
    await expect(page.getByTestId('refreshing-value')).toHaveText(String(firstValue)) // stale held

    await expect
        .poll(() => intOf(page, 'refreshing-value'), { timeout: 5000 })
        .toBeGreaterThan(firstValue)
    await expect(page.getByTestId('refreshing-flag')).toHaveText('no')
})

test('error probe holds the HttpError from a failing read, and clears on invalidate', async ({
    page,
}) => {
    await page.goto('/rpc/probes')

    await expect(page.getByTestId('flaky-error')).toHaveText('idle')
    await page.getByTestId('flaky-start').click()
    await expect(page.getByTestId('flaky-error')).toHaveText('flaky boom')

    await page.getByTestId('flaky-clear').click()
    await expect(page.getByTestId('flaky-error')).toHaveText('idle')
})

test('watch(args, cb) method form fires when the slot value changes', async ({ page }) => {
    await page.goto('/rpc/probes')

    await page.getByTestId('watchmethod-start').click()
    await expect(page.getByTestId('watchmethod-value')).toHaveText(/^\d+$/)
    await expect.poll(() => intOf(page, 'watchmethod-hits')).toBeGreaterThan(0)
    const hitsAfterLoad = await intOf(page, 'watchmethod-hits')

    await page.getByTestId('watchmethod-refresh').click()
    await expect.poll(() => intOf(page, 'watchmethod-hits')).toBeGreaterThan(hitsAfterLoad)
})
