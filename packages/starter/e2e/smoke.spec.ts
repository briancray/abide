import { expect, test } from '@playwright/test'

// Drives the REAL scaffolded starter app in a real browser: SSR HTML from a type-derived GET RPC,
// the hydration seed, and a clean client-bundle load. This is the end-to-end proof that
// `abide scaffold`'s output actually builds, serves, and hydrates — the gap that let the harness
// regress silently before.

test('SSR renders the greeting from the greet() RPC', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toHaveText('Hello, world!')
})

test('the page ships a hydration seed carrying the RPC read', async ({ page }) => {
    await page.goto('/')
    const seed = await page.locator('#__abide-seed').textContent()
    expect(seed).toBeTruthy()
    const parsed = JSON.parse(seed ?? '{}')
    expect(parsed.reads).toContainEqual(
        expect.objectContaining({ name: 'greet', value: 'Hello, world!' }),
    )
})

test('the client bundle hydrates with no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/')
    // Wait for the loader module to run — the app root stays mounted (attach-hydration, no clear).
    await expect(page.locator('#__abide-app h1')).toHaveText('Hello, world!')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
})

test('the greet RPC responds over HTTP', async ({ request }) => {
    const res = await request.get('/__abide/rpc/greet', {
        params: { name: 'abide' },
    })
    expect(res.ok()).toBe(true)
    expect(await res.json()).toBe('Hello, abide!')
})

// THE PER-READ MIDDLEWARE RUNG, on the door that is easiest to lose.
//
// `greet` declares its own `middleware`, and the handler renders differently depending on whether it ran
// ("(ungreeted)" if not). So the greeting in the SSR HTML is a direct assertion that the rung ran on an
// IN-PROCESS read — the page's own render — and not merely on the browser's fetch.
//
// This is the assertion the scaffold could not make before: with no middleware anywhere in the starter,
// nothing here would have failed if the rung stopped running. It also covers the doors most likely to
// regress, because both are derived rather than requested: the chain is installed at boot, and `abide dev`
// re-derives it on every rebuild.
test('the per-RPC middleware runs on the SSR read, not just the HTTP one', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).not.toContainText('ungreeted')
    await expect(page.locator('h1')).toHaveText('Hello, world!')
})
