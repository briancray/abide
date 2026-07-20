import { expect, test } from '@playwright/test'

// Routing bucket: file-based pages, [param] routes, route() (kind/name/params/url), navigate(target),
// url(path, params?, query?) href building (params + query string, compose via navigate(url(...))),
// and soft client-side navigation (content swaps, no reload) + Back/forward. Each test drives the
// REAL docs app in a real browser.

test('hub page SSRs route() info and url()-built param links', async ({ page }) => {
    await page.goto('/routing-demo')

    await expect(page.locator('h1')).toHaveText('Routing demo')

    // route() is populated during SSR / after hydration.
    await expect(page.getByTestId('route-name')).toHaveText('/routing-demo')
    await expect(page.getByTestId('route-kind')).toHaveText('nav')
    await expect(page.getByTestId('route-url')).toHaveText('/routing-demo')

    // url("/routing-demo/[slug]", { slug }) filled the dynamic segment.
    await expect(page.getByTestId('slug-link-alpha')).toHaveAttribute('href', '/routing-demo/alpha')
    await expect(page.getByTestId('slug-link-beta')).toHaveAttribute('href', '/routing-demo/beta')
    await expect(page.getByTestId('slug-link-gamma')).toHaveAttribute('href', '/routing-demo/gamma')
})

test('url() builds hrefs with a query string — (path, params, query) and (path, query)', async ({
    page,
}) => {
    await page.goto('/routing-demo')

    // url("/routing-demo/[slug]", { slug }, { ref, page }) fills the segment AND appends the query.
    await expect(page.getByTestId('url-params-query')).toHaveText('/routing-demo/alpha?ref=docs&page=2')
    // A no-[name] path collapses to url(path, query).
    await expect(page.getByTestId('url-query-only')).toHaveText('/routing-demo?tab=links')
    // The same built href flows straight into an <a href>.
    await expect(page.getByTestId('query-link')).toHaveAttribute(
        'href',
        '/routing-demo/alpha?ref=docs&page=2',
    )
})

test('navigate(url(...)) soft-navigates to a params + query href, and route() sees the query', async ({
    page,
}) => {
    await page.goto('/routing-demo')

    // Marker survives a soft nav but is wiped by a full document reload.
    await page.evaluate(() => {
        ;(window as unknown as { __routingMarker?: boolean }).__routingMarker = true
    })

    await page.getByTestId('navigate-query').click()

    await expect(page).toHaveURL(/\/routing-demo\/alpha\?ref=nav&page=3$/)
    await expect(page.getByTestId('route-slug')).toHaveText('alpha')
    await expect(page.getByTestId('route-query')).toHaveText('?ref=nav&page=3')

    const survived = await page.evaluate(
        () => (window as unknown as { __routingMarker?: boolean }).__routingMarker === true,
    )
    expect(survived).toBe(true)
})

test('param route captures the slug into route().params and feeds an RPC', async ({ page }) => {
    await page.goto('/routing-demo/alpha')

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
    await page.goto('/routing-demo')

    // Marker survives a soft nav but is wiped by a full document reload.
    await page.evaluate(() => {
        ;(window as unknown as { __routingMarker?: boolean }).__routingMarker = true
    })

    await page.getByTestId('slug-link-beta').click()

    await expect(page).toHaveURL(/\/routing-demo\/beta$/)
    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: beta')
    await expect(page.getByTestId('route-slug')).toHaveText('beta')

    const survived = await page.evaluate(
        () => (window as unknown as { __routingMarker?: boolean }).__routingMarker === true,
    )
    expect(survived).toBe(true)
})

test('navigating between sibling param values re-captures route().params', async ({ page }) => {
    await page.goto('/routing-demo/alpha')
    await expect(page.getByTestId('route-slug')).toHaveText('alpha')

    await page.getByTestId('sibling-beta').click()
    await expect(page).toHaveURL(/\/routing-demo\/beta$/)
    await expect(page.getByTestId('route-slug')).toHaveText('beta')
    await expect(page.getByTestId('topic')).toContainText('Topic: beta')
})

test('navigate() reaches the exact static sibling over the [slug] param route', async ({
    page,
}) => {
    await page.goto('/routing-demo')

    await page.evaluate(() => {
        ;(window as unknown as { __routingMarker?: boolean }).__routingMarker = true
    })

    await page.getByTestId('navigate-details').click()

    await expect(page).toHaveURL(/\/routing-demo\/details$/)
    await expect(page.getByTestId('details-heading')).toHaveText('Details')
    await expect(page.getByTestId('route-url')).toHaveText('/routing-demo/details')

    const survived = await page.evaluate(
        () => (window as unknown as { __routingMarker?: boolean }).__routingMarker === true,
    )
    expect(survived).toBe(true)
})

test('Back and forward restore the previous soft-nav route and content', async ({ page }) => {
    await page.goto('/routing-demo')
    await expect(page.getByTestId('route-name')).toHaveText('/routing-demo')

    // Hub → slug (soft nav)
    await page.getByTestId('slug-link-gamma').click()
    await expect(page).toHaveURL(/\/routing-demo\/gamma$/)
    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: gamma')

    // Back → hub content restored
    await page.goBack()
    await expect(page).toHaveURL(/\/routing-demo$/)
    await expect(page.locator('h1')).toHaveText('Routing demo')
    await expect(page.getByTestId('route-name')).toHaveText('/routing-demo')

    // Forward → slug content restored, param re-captured
    await page.goForward()
    await expect(page).toHaveURL(/\/routing-demo\/gamma$/)
    await expect(page.getByTestId('slug-heading')).toHaveText('Slug: gamma')
    await expect(page.getByTestId('route-slug')).toHaveText('gamma')
})
