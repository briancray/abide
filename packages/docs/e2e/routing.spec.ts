import { expect, test } from '@playwright/test'

// Routing bucket: file-based pages, [param] routes, route() (kind/name/params/url), navigate(target),
// url(path, params?, query?) href building (params + query string, compose via navigate(url(...))),
// and soft client-side navigation (content swaps, no reload) + Back/forward. Each test drives the
// REAL docs app in a real browser.

test('hub page SSRs route() info and url()-built param links', async ({ page }) => {
    await page.goto('/pages/routing')

    await expect(page.locator('h1')).toHaveText('File-based routing & navigation')

    // route() is populated during SSR / after hydration.
    await expect(page.getByTestId('route-name')).toHaveText('/pages/routing')
    await expect(page.getByTestId('route-kind')).toHaveText('nav')
    await expect(page.getByTestId('route-url')).toHaveText('/pages/routing')

    // url("/pages/routing/[slug]", { slug }) filled the dynamic segment.
    await expect(page.getByTestId('slug-link-alpha')).toHaveAttribute('href', '/pages/routing/alpha')
    await expect(page.getByTestId('slug-link-beta')).toHaveAttribute('href', '/pages/routing/beta')
    await expect(page.getByTestId('slug-link-gamma')).toHaveAttribute('href', '/pages/routing/gamma')
})

test('url() builds hrefs with a query string — (path, params, query) and (path, query)', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    // url("/pages/routing/[slug]", { slug }, { ref, page }) fills the segment AND appends the query.
    await expect(page.getByTestId('url-params-query')).toHaveText('/pages/routing/alpha?ref=docs&page=2')
    // A no-[name] path collapses to url(path, query).
    await expect(page.getByTestId('url-query-only')).toHaveText('/pages/routing?tab=links')
    // The same built href flows straight into an <a href>.
    await expect(page.getByTestId('query-link')).toHaveAttribute(
        'href',
        '/pages/routing/alpha?ref=docs&page=2',
    )
})

test('navigate(url(...)) soft-navigates to a params + query href, and route() sees the query', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    // Marker survives a soft nav but is wiped by a full document reload.
    await page.evaluate(() => {
        ;(window as unknown as { __routingMarker?: boolean }).__routingMarker = true
    })

    await page.getByTestId('navigate-query').click()

    await expect(page).toHaveURL(/\/pages\/routing\/alpha\?ref=nav&page=3$/)
    await expect(page.getByTestId('route-slug')).toHaveText('alpha')
    await expect(page.getByTestId('route-query')).toHaveText('?ref=nav&page=3')

    const survived = await page.evaluate(
        () => (window as unknown as { __routingMarker?: boolean }).__routingMarker === true,
    )
    expect(survived).toBe(true)
})

test('param route captures the slug into route().params and feeds an RPC', async ({ page }) => {
    await page.goto('/pages/routing/alpha')

    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: alpha')
    await expect(page.getByTestId('route-slug')).toHaveText('alpha')
    await expect(page.getByTestId('route-kind')).toHaveText('nav')

    // The captured param flowed into the routingTopic RPC and its value is in the HTML.
    await expect(page.getByTestId('topic')).toContainText('Topic: alpha')
    await expect(page.getByTestId('topic')).toContainText('"alpha" param captured')
})

test('clicking a param link soft-navigates: URL + content swap, no reload, params update', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    // Marker survives a soft nav but is wiped by a full document reload.
    await page.evaluate(() => {
        ;(window as unknown as { __routingMarker?: boolean }).__routingMarker = true
    })

    await page.getByTestId('slug-link-beta').click()

    await expect(page).toHaveURL(/\/pages\/routing\/beta$/)
    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: beta')
    await expect(page.getByTestId('route-slug')).toHaveText('beta')

    const survived = await page.evaluate(
        () => (window as unknown as { __routingMarker?: boolean }).__routingMarker === true,
    )
    expect(survived).toBe(true)
})

test('navigating between sibling param values re-captures route().params', async ({ page }) => {
    await page.goto('/pages/routing/alpha')
    await expect(page.getByTestId('route-slug')).toHaveText('alpha')

    await page.getByTestId('sibling-beta').click()
    await expect(page).toHaveURL(/\/pages\/routing\/beta$/)
    await expect(page.getByTestId('route-slug')).toHaveText('beta')
    await expect(page.getByTestId('topic')).toContainText('Topic: beta')
})

test('navigate() reaches the exact static sibling over the [slug] param route', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    await page.evaluate(() => {
        ;(window as unknown as { __routingMarker?: boolean }).__routingMarker = true
    })

    await page.getByTestId('navigate-details').click()

    await expect(page).toHaveURL(/\/pages\/routing\/details$/)
    await expect(page.getByTestId('details-heading')).toHaveText('Details')
    await expect(page.getByTestId('route-url')).toHaveText('/pages/routing/details')

    const survived = await page.evaluate(
        () => (window as unknown as { __routingMarker?: boolean }).__routingMarker === true,
    )
    expect(survived).toBe(true)
})

test('navigate(…, { replace: true }) replaces the history entry so Back skips it', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    // Hub → details, but REPLACING the hub entry rather than pushing. Back should therefore land
    // on whatever preceded the hub (the blank about:blank start), not the hub.
    await page.getByTestId('navigate-replace').click()
    await expect(page).toHaveURL(/\/pages\/routing\/details$/)
    await expect(page.getByTestId('details-heading')).toHaveText('Details')

    // The hub entry was replaced, so going Back does not return to /pages/routing.
    await page.goBack()
    await expect(page).not.toHaveURL(/\/pages\/routing$/)
})

test('Back and forward restore the previous soft-nav route and content', async ({ page }) => {
    await page.goto('/pages/routing')
    await expect(page.getByTestId('route-name')).toHaveText('/pages/routing')

    // Hub → slug (soft nav)
    await page.getByTestId('slug-link-gamma').click()
    await expect(page).toHaveURL(/\/pages\/routing\/gamma$/)
    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: gamma')

    // Back → hub content restored
    await page.goBack()
    await expect(page).toHaveURL(/\/pages\/routing$/)
    await expect(page.locator('h1')).toHaveText('File-based routing & navigation')
    await expect(page.getByTestId('route-name')).toHaveText('/pages/routing')

    // Forward → slug content restored, param re-captured
    await page.goForward()
    await expect(page).toHaveURL(/\/pages\/routing\/gamma$/)
    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: gamma')
    await expect(page.getByTestId('route-slug')).toHaveText('gamma')
})

test('page file structure — the route derives from the folder chain', async ({ page }) => {
    await page.goto('/pages/structure')
    await expect(page.locator('h1')).toHaveText('Page file structure')
    // The reused route readout reflects THIS page's route (no [param] segments here).
    await expect(page.getByTestId('route-name')).toHaveText('/pages/structure')
    await expect(page.getByTestId('route-params')).toHaveText('{}')
})

test('data & props — a read awaited in the page lands in the SSR HTML', async ({ page }) => {
    await page.goto('/pages/data')
    await expect(page.locator('h1')).toHaveText('Data & props')
    // The awaited rpcGreet read rendered its value straight into the page.
    await expect(page.getByTestId('page-read')).toHaveText('Hello, pages!')
})

// Layouts: a section layout.abide wraps its whole folder subtree, INSIDE the root layout, and renders
// each page at its <slot/>. Navigating within the subtree is a soft nav (no full reload) and the same
// layout frame surrounds every page.
test('a section layout wraps every page in its folder, over a soft nav', async ({ page }) => {
    await page.goto('/pages/layouts')
    // The section layout frame wraps the hub page.
    await expect(page.getByTestId('section-layout')).toBeVisible()
    await expect(page.locator('h1')).toHaveText('Layouts')

    // Marker survives a soft nav but is wiped by a full document reload.
    await page.evaluate(() => {
        ;(window as unknown as { __layoutsMarker?: boolean }).__layoutsMarker = true
    })

    await page.getByTestId('to-nested').click()

    // Soft-navved to the child, which the SAME section layout wraps; only the outlet content swapped.
    await expect(page).toHaveURL(/\/pages\/layouts\/nested$/)
    await expect(page.getByTestId('nested-heading')).toHaveText('Child page')
    await expect(page.getByTestId('section-layout')).toBeVisible()

    const survived = await page.evaluate(
        () => (window as unknown as { __layoutsMarker?: boolean }).__layoutsMarker === true,
    )
    expect(survived).toBe(true)

    // Back to the hub, still wrapped.
    await page.getByTestId('to-hub').click()
    await expect(page).toHaveURL(/\/pages\/layouts$/)
    await expect(page.getByTestId('section-layout')).toBeVisible()
})

// C6.2 layout PERSISTENCE: a cross-route soft-nav between two pages sharing a layout keeps the shared
// layout instances ALIVE (only the diverging page suffix is grafted + claimed). Proven by pinning a
// DOM attribute on the kept layout node — a full rebuild would drop it.
test('a cross-route nav keeps the shared layout nodes alive (not rebuilt)', async ({ page }) => {
    await page.goto('/pages/layouts/alpha')
    await expect(page.getByTestId('carousel-heading')).toHaveText('Item: alpha')

    // Pin the shared section layout + the root sidebar, and a reload marker.
    await page.evaluate(() => {
        document.querySelector('[data-testid="section-layout"]')?.setAttribute('data-pin', 'SEC')
        document.querySelector('aside.sidebar')?.setAttribute('data-pin', 'ROOT')
        ;(window as unknown as { __kept?: boolean }).__kept = true
    })

    // Cross-route to the hub (shares root + section layout; only the page diverges).
    await page.getByTestId('to-hub').click()
    await expect(page).toHaveURL(/\/pages\/layouts$/)
    await expect(page.locator('main h1')).toHaveText('Layouts')

    // The shared layouts are the SAME live nodes (pins survive) and it was a soft-nav (marker survives).
    await expect(page.locator('[data-testid="section-layout"]')).toHaveAttribute('data-pin', 'SEC')
    await expect(page.locator('aside.sidebar')).toHaveAttribute('data-pin', 'ROOT')
    await expect(page.locator('abide-slot')).toHaveCount(0)
    const kept = await page.evaluate(
        () => (window as unknown as { __kept?: boolean }).__kept === true,
    )
    expect(kept).toBe(true)

    // The grafted+claimed hub is reactive: navigating on into a carousel item works (another cross-route).
    await page.getByTestId('to-nested').click()
    await expect(page).toHaveURL(/\/pages\/layouts\/nested$/)
    await expect(page.locator('[data-testid="section-layout"]')).toHaveAttribute('data-pin', 'SEC')
})

// The definitive proof: a kept layout's `state` (not just its DOM node) survives, across BOTH a
// cross-route nav and a param nav within its subtree.
test('layout state survives cross-route and param navigation within the subtree', async ({ page }) => {
    await page.goto('/pages/layouts')
    for (let i = 0; i < 3; i++) await page.getByTestId('layout-inc').click()
    await expect(page.getByTestId('layout-count')).toHaveText('3')

    // Cross-route → a carousel item (shares root + section layout): the layout is kept alive, state intact.
    await page.getByTestId('to-carousel').click()
    await expect(page).toHaveURL(/\/pages\/layouts\/alpha$/)
    await expect(page.getByTestId('carousel-heading')).toHaveText('Item: alpha')
    await expect(page.getByTestId('layout-count')).toHaveText('3')

    // Param nav between items (same page pattern → whole chain kept alive): state intact.
    await page.getByTestId('card-charlie').click()
    await expect(page).toHaveURL(/\/pages\/layouts\/charlie$/)
    await expect(page.getByTestId('carousel-heading')).toHaveText('Item: charlie')
    await expect(page.getByTestId('layout-count')).toHaveText('3')

    // Cross-route back to the hub: still alive, still 3.
    await page.getByTestId('to-hub').click()
    await expect(page).toHaveURL(/\/pages\/layouts$/)
    await expect(page.getByTestId('layout-count')).toHaveText('3')
})
