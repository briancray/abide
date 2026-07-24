import { expect, test } from '@playwright/test'

// These specs drive the REAL docs app in a real browser: SSR HTML, client hydration, live
// reactivity, and soft client-side navigation. They are the proof the harness works end-to-end.

test('home page loads with the abide heading and capability nav', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toHaveText('abide')

    // The sidebar (the app's root layout) indexes every sample by capability.
    const sidebar = page.locator('aside.sidebar')
    await expect(sidebar.getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Reactive primitives' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'The memo primitive' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Machine surfaces' })).toBeVisible()

    // The capability cards (in the page content) are rendered from the `capabilities` RPC.
    await expect(
        page.locator('.content').getByRole('link', { name: 'Isomorphic RPC' }),
    ).toBeVisible()
})

test('clicking an in-app nav link soft-navigates without a full page reload', async ({ page }) => {
    await page.goto('/')

    // Plant a marker on the window object. A full page reload would wipe it; a soft nav keeps it.
    await page.evaluate(() => {
        ;(window as unknown as { __abideNoReload?: boolean }).__abideNoReload = true
    })

    await page.locator('aside.sidebar').getByRole('link', { name: 'Reactive primitives' }).click()

    await expect(page).toHaveURL(/\/templating\/reactivity$/)
    await expect(page.locator('h1')).toHaveText('Reactive primitives')

    const survived = await page.evaluate(
        () => (window as unknown as { __abideNoReload?: boolean }).__abideNoReload === true,
    )
    expect(survived).toBe(true)
})

test('machines page loads', async ({ page }) => {
    await page.goto('/platform/machines')
    await expect(page.locator('h1')).toHaveText('Machine surfaces')
    // Scope to the page content: the layout's scroll-spy also mirrors the `openapi` demo card's
    // heading as a `/openapi.json` sub-link in the sidebar, which would otherwise match too.
    await expect(
        page.locator('.content').getByRole('link', { name: '/openapi.json' }),
    ).toBeVisible()
})

test('agent() loop streams AgentFrames — text, a tool run, and completion', async ({ page }) => {
    await page.goto('/platform/machines')
    await page.getByTestId('agent-btn').click()
    const log = page.getByTestId('agent-log')
    // The scripted engine emits text → a tool-call the loop executes in-proc → a tool-result → final
    // text → done. Assert the streamed frames land in the DOM as the async iterable drains.
    await expect(log).toContainText('Let me check the clock…')
    await expect(log.locator('[data-kind="tool-call"]')).toContainText('clock()')
    await expect(log.locator('[data-kind="tool-result"]')).toContainText('2026-01-01T00:00:00.000Z')
    await expect(log.locator('[data-kind="done"]')).toContainText('✓ complete')
})
