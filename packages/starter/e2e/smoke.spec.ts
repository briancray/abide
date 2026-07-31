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

// THE COMPONENT + OUTLET PATH, which the console-error assertion above cannot reach on its own.
//
// The scaffold used to be a single `<h1>` with no layout and no component, so the "no console errors"
// test had no component adapter, no `<slot/>` and no child scope to exercise — and stayed green through
// the entire lifetime of a bug where a childless `<slot/>` threw on hydrate while the server's HTML was
// correct. A page that invokes a component through a layout makes that assertion load-bearing.
test('the layout and its component render through <slot/> on both lanes', async ({ page }) => {
    await page.goto('/')
    // The layout wraps the page: both cards are inside its `<main>`.
    await expect(page.locator('main.app .card')).toHaveCount(2)
    // The outlet rendered the caller's children, not nothing.
    await expect(page.locator('main.app .card').first().locator('h1')).toHaveText('Hello, world!')
    // Component-scoped styles reached the component's own markup.
    await expect(page.locator('.card h2').first()).toHaveText('Your first RPC')
})

// Hydration proved by BEHAVIOUR rather than by markup: a bind writes the cell, the cell is the RPC's
// arg, and the read is keyed on its args — so the heading changing is the whole chain (client bundle
// loaded, component adopted, bind wired, memo re-read over the wire) in one assertion.
test('a bind drives a re-read of the RPC after hydration', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toHaveText('Hello, world!')

    await page.locator('#name').fill('abide')
    await expect(page.locator('h1')).toHaveText('Hello, abide!')
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
