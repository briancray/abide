import { expect, test } from '@playwright/test'

// These specs drive the REAL docs app in a real browser: SSR HTML, client hydration, live
// reactivity, and soft client-side navigation. They are the proof the harness works end-to-end.

test('home page loads with the abide heading and capability nav', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toHaveText('abide')

    // The sidebar (the app's root layout) indexes every sample by capability.
    const sidebar = page.locator('aside.sidebar')
    await expect(sidebar.getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'State & computed' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Cache verbs' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Beyond the browser' })).toBeVisible()

    // The capability cards (in the page content) are rendered from the `capabilities` RPC.
    await expect(
        page.locator('.content').getByRole('link', { name: 'Isomorphic RPC' }),
    ).toBeVisible()
})

test('reactivity counter increments in the live DOM after hydration', async ({ page }) => {
    await page.goto('/reactivity')

    const count = page.locator('p', { hasText: 'Count:' }).locator('strong')
    const doubled = page.locator('p', { hasText: 'Doubled' }).locator('strong')

    // SSR'd initial values.
    await expect(count).toHaveText('0')
    await expect(doubled).toHaveText('0')

    const increment = page.getByRole('button', { name: 'Increment' })

    // Click three times — proves client reactivity + the computed cell both update.
    await increment.click()
    await expect(count).toHaveText('1')
    await expect(doubled).toHaveText('2')

    await increment.click()
    await increment.click()
    await expect(count).toHaveText('3')
    await expect(doubled).toHaveText('6')

    // Reset is a plain function mutating the same cell.
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(count).toHaveText('0')
    await expect(doubled).toHaveText('0')
})

test('clicking an in-app nav link soft-navigates without a full page reload', async ({ page }) => {
    await page.goto('/')

    // Plant a marker on the window object. A full page reload would wipe it; a soft nav keeps it.
    await page.evaluate(() => {
        ;(window as unknown as { __abideNoReload?: boolean }).__abideNoReload = true
    })

    await page.locator('aside.sidebar').getByRole('link', { name: 'State & computed' }).click()

    await expect(page).toHaveURL(/\/reactivity$/)
    await expect(page.locator('h1')).toHaveText('State & computed')

    const survived = await page.evaluate(
        () => (window as unknown as { __abideNoReload?: boolean }).__abideNoReload === true,
    )
    expect(survived).toBe(true)
})

test('machines page loads', async ({ page }) => {
    await page.goto('/machines')
    await expect(page.locator('h1')).toHaveText('Beyond the browser')
    await expect(page.getByRole('link', { name: '/openapi.json' })).toBeVisible()
})

test('agent() loop streams AgentFrames — text, a tool run, and completion', async ({ page }) => {
    await page.goto('/machines')
    await page.getByTestId('agent-btn').click()
    const log = page.getByTestId('agent-log')
    // The scripted engine emits text → a tool-call the loop executes in-proc → a tool-result → final
    // text → done. Assert the streamed frames land in the DOM as the async iterable drains.
    await expect(log).toContainText('Let me check the clock…')
    await expect(log.locator('[data-kind="tool-call"]')).toContainText('clock()')
    await expect(log.locator('[data-kind="tool-result"]')).toContainText('2026-01-01T00:00:00.000Z')
    await expect(log.locator('[data-kind="done"]')).toContainText('✓ complete')
})
