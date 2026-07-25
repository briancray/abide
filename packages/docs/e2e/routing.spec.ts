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
    await expect(page.getByTestId('slug-link-alpha')).toHaveAttribute(
        'href',
        '/pages/routing/alpha',
    )
    await expect(page.getByTestId('slug-link-beta')).toHaveAttribute('href', '/pages/routing/beta')
    await expect(page.getByTestId('slug-link-gamma')).toHaveAttribute(
        'href',
        '/pages/routing/gamma',
    )
})

test('url() builds hrefs with a query string — (path, params, query) and (path, query)', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    // url("/pages/routing/[slug]", { slug }, { ref, page }) fills the segment AND appends the query.
    await expect(page.getByTestId('url-params-query')).toHaveText(
        '/pages/routing/alpha?ref=docs&page=2',
    )
    // A no-[name] path collapses to url(path, query).
    await expect(page.getByTestId('url-query-only')).toHaveText('/pages/routing?tab=links')
    // The same built href flows straight into an <a href>.
    await expect(page.getByTestId('query-link')).toHaveAttribute(
        'href',
        '/pages/routing/alpha?ref=docs&page=2',
    )
})

test('url() builds optional and rest hrefs — absent optional dropped, rest `/`-joined', async ({
    page,
}) => {
    await page.goto('/pages/routing')

    // An absent optional [[page]] param drops the whole segment; url("…/blog/[[page]]", {}) → /blog.
    await expect(page.getByTestId('url-optional-absent')).toHaveText('/pages/routing/blog')
    // A present optional param fills it.
    await expect(page.getByTestId('url-optional-present')).toHaveText('/pages/routing/blog/2')
    // A rest [...path] param expands the `/`-joined string into path segments.
    await expect(page.getByTestId('url-rest')).toHaveText('/pages/routing/files/guide/intro')

    // The built hrefs flow straight into <a href>.
    await expect(page.getByTestId('optional-link-bare')).toHaveAttribute(
        'href',
        '/pages/routing/blog',
    )
    await expect(page.getByTestId('optional-link-paged')).toHaveAttribute(
        'href',
        '/pages/routing/blog/2',
    )
    await expect(page.getByTestId('rest-link')).toHaveAttribute(
        'href',
        '/pages/routing/files/guide/intro',
    )
})

test('an optional [[page]] route SSRs both with and without the segment', async ({ page }) => {
    // Absent: /pages/routing/blog matches blog/[[page]]/page.abide with the param omitted.
    await page.goto('/pages/routing/blog')
    await expect(page.getByTestId('blog-heading')).toHaveText('Blog')
    await expect(page.getByTestId('blog-has-page')).toHaveText('absent')
    await expect(page.getByTestId('blog-page')).toHaveText('')

    // Present: /pages/routing/blog/2 captures page=2 into route().params.
    await page.goto('/pages/routing/blog/2')
    await expect(page.getByTestId('blog-has-page')).toHaveText('present')
    await expect(page.getByTestId('blog-page')).toHaveText('2')
})

test('a rest [...path] route captures the remaining segments as a `/`-joined string', async ({
    page,
}) => {
    await page.goto('/pages/routing/files/guide/intro')
    await expect(page.getByTestId('files-heading')).toHaveText('Files')
    await expect(page.getByTestId('files-path')).toHaveText('guide/intro')

    // A single trailing segment still resolves to the same catch-all page.
    await page.goto('/pages/routing/files/readme')
    await expect(page.getByTestId('files-path')).toHaveText('readme')
})

test('an exact route beats the rest catch-all sharing its prefix', async ({ page }) => {
    // /pages/routing/files/latest matches BOTH files/latest (exact) and files/[...path] (rest).
    // Precedence literal > rest → the exact page wins.
    await page.goto('/pages/routing/files/latest')
    await expect(page.getByTestId('files-latest-heading')).toHaveText('Latest file')
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

test('the section layout proves it was server-rendered AND cleanly hydrated (not re-rendered)', async ({
    page,
}) => {
    // The badge value is a SEEDED `state(typeof document === 'undefined' ? 'server' : 'client')`: the
    // initializer reads "server" only where there's no `document` — i.e. during SSR — and that value is
    // seeded into the HTML, then REPLAYED (not re-run) on hydrate. So:
    // 1) It must be present as "server" in the RAW SSR bytes — the server rendered it.
    const raw = await (await page.request.get('/pages/layouts')).text()
    expect(raw).toContain('data-testid="ssr-origin">server')

    // 2) After hydration it must STILL read "server". Hydration CLAIMED the server node and replayed the
    // seed; a failed claim (create-fallback) would re-run the initializer in the browser and flip it to
    // "client". So a stable "server" is a live proof of SSR + a clean claim — not seed-masked.
    await page.goto('/pages/layouts')
    await expect(page.getByTestId('ssr-origin')).toHaveText('server')
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
    await expect(page.locator('template[id^="ab-p:"]')).toHaveCount(0)
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
test('layout state survives cross-route and param navigation within the subtree', async ({
    page,
}) => {
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
