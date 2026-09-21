// THE DOCS, AS A READER GETS THEM: `abide build`, then `abide start`, then a browser. The server
// tests in `packages/abide/tests/serve.test.ts` assert what goes out on the wire; nothing there
// can tell a document that hydrated from one that merely looks right, which is what this is for
// and the one thing only a browser can say.
//
// THE APP IS THE DOCUMENTATION NOW, so these are gates on the real thing rather than on a pair
// of demo pages: eighty-five markdown files compiled into pages, one nav, one rail, and the card
// machinery `assets/docs.js` wires to whatever page is on screen.

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

test('a page the server painted carries its own prose', async ({ page }) => {
    await page.goto('/values/show-a-value-that-changes')

    await expect(page.locator('main h1')).toHaveText(
        'Show a value that changes',
    )
    await expect(page).toHaveTitle('Show a value that changes — abide')
    // 32.25 THROUGH A PAGE. The body is markdown the build rendered, carried into the page as a
    // `raw` slot — so a table in it is a table rather than the source of one, which is exactly
    // what a client binding over the same slot would have left on screen.
    await expect(page.locator('main table').first()).toBeVisible()
})

test('a direct hit is painted by the server, with no script at all', async ({
    page,
}) => {
    await page.context().route('**/__abide/client/**', (route) => route.abort())
    await page.context().route('**/docs.js', (route) => route.abort())
    await page.goto('/reference/reactive')

    await expect(page.locator('main h1')).toHaveText('reactive()')
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText(
        'reactive',
    )
})

test('a link to another page navigates without reloading — 30.7', async ({
    page,
}) => {
    await page.goto('/values/show-a-value-that-changes')
    // A marker a document reload erases, which is the only way to tell the two apart.
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
    })

    await page.click('nav a[href="/values/derive-a-value-from-other-values"]')

    await expect(page.locator('main h1')).toHaveText(
        'Derive a value from other values',
    )
    // 39.6 — the incoming page's head replaced the outgoing page's, by key.
    await expect(page).toHaveTitle('Derive a value from other values — abide')
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
    expect(new URL(page.url()).pathname).toBe(
        '/values/derive-a-value-from-other-values',
    )
    // THE NAV IS THE ONE THING SHARED BETWEEN TWO PAGES, and the mark on it is the only part
    // that differs — so a navigation that rebuilt the nav from the wrong page's slug shows
    // here and nowhere else.
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText(
        'Derived values',
    )
})

// `assets/docs.js` is evaluated ONCE and a navigation re-runs none of it, so what this asserts
// is the MutationObserver that finds the new page: the rail of the page a reader navigated to is
// wired to its headings, not to the ones they arrived on.
test('the rail follows the page a reader navigated to', async ({ page }) => {
    await page.goto('/values/show-a-value-that-changes')
    await page.click('nav a[href="/values/patch-a-list-from-a-live-feed"]')
    await expect(page.locator('main h1')).toHaveText(
        'Patch a list from a live feed',
    )

    const first = page.locator('.toc a[href^="#"]').first()
    await expect(first).toHaveAttribute(
        'href',
        '#patch-mutates-the-held-value-and-mints-its-production',
    )
    // The scroll spy marks where you are, and it only can where it re-measured after the
    // navigation — offsets taken against the page a reader left are every heading at once.
    await expect(first).toHaveAttribute('aria-current', 'true')
})

// An example card is an iframe the page fills from a `srcdoc` it carries, and the fill is
// `assets/docs.js` again — on a page the reader NAVIGATED to, which is the arm that was dead
// while the docs were a tree of files and every page load ran the script fresh.
test('an example card runs on a page a reader navigated to', async ({
    page,
}) => {
    await page.goto('/values/show-a-value-that-changes')
    await page.click('nav a[href="/values/patch-a-list-from-a-live-feed"]')
    const frame = page.locator('iframe.ex-result').first()
    await expect(frame).toBeVisible()
    await expect(frame.contentFrame().locator('body')).not.toBeEmpty()
})

test('a file under public is answered at its own address — 36.11', async ({
    page,
}) => {
    const robots = await page.request.get('/robots.txt')
    expect(robots.status()).toBe(200)
    expect(await robots.text()).toContain('User-agent: *')

    // 40.4's markdown twin, which is a public file rather than a page.
    const markdown = await page.request.get(
        '/values/show-a-value-that-changes.md',
    )
    expect(markdown.status()).toBe(200)
    expect(await markdown.text()).toContain('# Show a value that changes')

    const bundle = await page.request.get('/abide.md')
    expect(bundle.status()).toBe(200)
    expect(await bundle.text()).toContain('# abide documentation')
})

// 38.24 IN A BROWSER, which is the only arm that can say the stylesheet ARRIVED. The server test
// asserts the `<link>` and that its address answers; neither can tell a sheet the document
// applied from one it fetched and ignored, and the page looks plausible either way.
test('the bundled stylesheet reaches the page', async ({ page }) => {
    await page.goto('/')

    // The heading token out of `app.css`, computed. `--heading` is #8E4426, and a document with
    // no stylesheet leaves an h1 at the UA's near-black.
    const colour = await page
        .locator('main h1')
        .evaluate((node) => getComputedStyle(node).color)
    expect(colour).toBe('rgb(142, 68, 38)')
})
