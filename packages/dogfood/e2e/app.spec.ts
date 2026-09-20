// THE DOGFOOD APP, AS A READER GETS IT: `abide build`, then `abide start`, then a browser. The
// server tests in `packages/abide/tests/serve.test.ts` assert what goes out on the wire; nothing
// there can tell a document that hydrated from one that merely looks right, which is what this is
// for and the one thing only a browser can say.

import { expect, test } from '@playwright/test'

// SERVING UNDER A SUB-PATH IS NOT BUILT. The client entry's address is absolute (`CLIENT_BUILD`)
// and nothing mounts the route table below a prefix, so the second project has nothing to run
// against yet — skipped by name rather than deleted, since the arm is what will catch the URL the
// framework built by assuming '/'.
// biome-ignore lint/correctness/noEmptyPattern: playwright refuses a first parameter that is not a destructuring pattern, and this hook reads only the second.
test.beforeEach(({}, testInfo) => {
    testInfo.skip(
        testInfo.project.name === 'sub-path',
        'a sub-path mount is not implemented',
    )
})

test('the page the server painted is live where it stands', async ({
    page,
}) => {
    await page.goto('/')

    // THE SERVER'S MARKUP, not the client's: the button carries its count already.
    await expect(page.locator('#clicks')).toHaveText('clicked 0 times')
    await expect(page).toHaveTitle('abide')

    // And it is wired, which is the whole of the hydration claim.
    await page.click('#clicks')
    await expect(page.locator('#clicks')).toHaveText('clicked 1 times')
})

test('a link to another page navigates without reloading — 30.7', async ({
    page,
}) => {
    await page.goto('/')
    // A marker a document reload erases, which is the only way to tell the two apart.
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
    })

    await page.click('#to-about')

    await expect(page.locator('h1')).toHaveText('about')
    // 39.7 — the incoming page's head replaced the outgoing page's, by key.
    await expect(page).toHaveTitle('about · abide')
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
    expect(new URL(page.url()).pathname).toBe('/about')
})

test('a direct hit on the second page is painted by the server', async ({
    page,
}) => {
    // NO SCRIPT AT ALL, so what is asserted is the document rather than anything the client did.
    await page.context().route('**/__abide/client/**', (route) => route.abort())
    await page.goto('/about')

    await expect(page.locator('h1')).toHaveText('about')
    await expect(page).toHaveTitle('about · abide')
})

// 38.24 IN A BROWSER, which is the only arm that can say the stylesheet ARRIVED. The server test
// asserts the `<link>` and that its address answers; neither can tell a sheet the document
// applied from one it fetched and ignored, and the page looks plausible either way.
test('the bundled stylesheet reaches the page', async ({ page }) => {
    await page.goto('/')

    // The heading token out of `app.css`, computed. `--heading` is #8E4426, and a document with
    // no stylesheet leaves an h1 at the UA's near-black.
    const colour = await page
        .locator('h1')
        .evaluate((node) => getComputedStyle(node).color)
    expect(colour).toBe('rgb(142, 68, 38)')
})

test('a file under public is answered at its own address — 36.11', async ({
    page,
}) => {
    const robots = await page.request.get('/robots.txt')
    expect(robots.status()).toBe(200)
    expect(await robots.text()).toContain('User-agent: *')

    const icon = await page.request.get('/favicon.svg')
    expect(icon.status()).toBe(200)
    expect(icon.headers()['content-type']).toContain('image/svg+xml')
})
