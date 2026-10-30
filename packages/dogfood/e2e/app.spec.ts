// THE DOCS, AS A READER GETS THEM: `abide build`, then `abide start`, then a browser. The server
// tests in `packages/abide/tests/serve.test.ts` assert what goes out on the wire; nothing there
// can tell a document that hydrated from one that merely looks right, which is what this is for
// and the one thing only a browser can say.
//
// THE APP IS THE DOCUMENTATION NOW, so these are gates on the real thing rather than on a pair
// of demo pages: eighty-five markdown files compiled into pages, one nav, one rail, and every
// example running inline as a component of the page it is on.

import { expect, test } from '@playwright/test'

import { SECTIONS } from '../src/lib/sitePages.ts'

// TWO PROJECTS, ONE BUILD: served at the root and again below `/docs` (16.10). Every address a
// spec asks for goes through `underMount`, so the same spec runs at either mount.
function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return new URL(base).pathname.replace(/\/$/, '') + address
}

// THE SUB-PATH ARM'S WHOLE POINT, made to fail: a request outside the mount is REFUSED rather than
// answered. The server answers an address that is not under its mount as it came (a proxy that
// took the prefix off), so a URL built by assuming `/` would load from the origin's root and every
// assertion would pass over it. Inert at the root, where nothing is outside.
let outside: string[] = []
test.beforeEach(async ({ context }) => {
    outside = []
    const mount = underMount('')
    const origin = new URL(test.info().project.use.baseURL ?? '').origin
    await context.route(
        (url) =>
            url.origin === origin &&
            url.pathname !== mount &&
            !url.pathname.startsWith(`${mount}/`),
        (route) => {
            outside.push(route.request().url())
            return route.abort()
        },
    )
})
test.afterEach(() => {
    expect(outside).toEqual([])
})

test('a page the server painted carries its own prose', async ({ page }) => {
    await page.goto(underMount('/guide/edit-a-contact'))

    await expect(page.locator('main h1')).toHaveText('Edit a contact')
    await expect(page).toHaveTitle('Edit a contact — abide')
    // 32.24 THROUGH A PAGE. The body is markdown the build rendered, carried into the page as a
    // `raw` slot — so a table in it is a table rather than the source of one, which is exactly
    // what a client binding over the same slot would have left on screen.
    await expect(page.locator('main table').first()).toBeVisible()
})

test('a direct hit is painted by the server, with no script at all', async ({
    page,
}) => {
    await page.context().route('**/__abide/client/**', (route) => route.abort())
    await page.context().route('**/docs.js', (route) => route.abort())
    await page.goto(underMount('/reference/reactive'))

    await expect(page.locator('main h1')).toHaveText('reactive')
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText(
        'reactive',
    )
})

test('a link to another page navigates without reloading — 30.7', async ({
    page,
}) => {
    await page.goto(underMount('/guide/edit-a-contact'))
    // A marker a document reload erases, which is the only way to tell the two apart.
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
        ;(
            document.querySelector('nav.sidebar') as { __KEPT__?: string }
        ).__KEPT__ = 'yes'
    })

    await page.click(`nav a[href="${underMount('/guide/talk-to-the-server')}"]`)

    await expect(page.locator('main h1')).toHaveText('Talk to the server')
    // 39.6 — the incoming page's head replaced the outgoing page's, by key.
    await expect(page).toHaveTitle('Talk to the server — abide')
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
    expect(new URL(page.url()).pathname).toBe(
        underMount('/guide/talk-to-the-server'),
    )
    // THE NAV IS THE ONE THING SHARED BETWEEN TWO PAGES, and the mark on it is the only part
    // that differs — so a navigation that rebuilt the nav from the wrong page's slug shows
    // here and nowhere else.
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText(
        'Talk to the server',
    )
    // AND IT IS THE SAME NAV. It is the layout's, and a layout is not rebuilt between
    // navigations (41.11) — a marker on the node before the click is still on it after.
    expect(
        await page.evaluate(
            () =>
                (
                    document.querySelector('nav.sidebar') as {
                        __KEPT__?: string
                    } | null
                )?.__KEPT__,
        ),
    ).toBe('yes')
})

// `#src/lib/installDocs.ts` is a module and is evaluated ONCE, but the INSTALL is the page's own: the
// arriving page hands `installDocs` its `<main>` and the page a reader left ran the `Disposer`
// that took its listeners (32.9). So the rail here is wired to this page's headings rather than
// to the ones they arrived on.
test('the rail follows the page a reader navigated to', async ({ page }) => {
    await page.goto(underMount('/guide/edit-a-contact'))
    await page.click(`nav a[href="${underMount('/guide/keep-it-current')}"]`)
    await expect(page.locator('main h1')).toHaveText('Keep it current')

    const first = page.locator('.toc a[href^="#"]').first()
    await expect(first).toHaveAttribute(
        'href',
        '#a-call-with-the-same-arguments-is-one-load',
    )
    // The scroll spy marks where you are, and it only can where it re-measured after the
    // navigation — offsets taken against the page a reader left are every heading at once.
    await expect(first).toHaveAttribute('aria-current', 'true')
})

// AN EXAMPLE CARD IS A COMPONENT THE PAGE INVOKES, so a card on a page the reader NAVIGATED to is
// built by the client rather than adopted from the server's markup — the arm a direct hit never
// runs. Pressed rather than looked at: a card that painted and never hydrated reads the same.
test('an example card runs on a page a reader navigated to', async ({
    page,
}) => {
    await page.goto(underMount('/guide/edit-a-contact'))
    await page.click(`nav a[href="${underMount('/guide/start-an-app')}"]`)
    const card = page.locator('#crm-01-star .ex-render')
    await card.getByRole('button', { name: '☆ Star' }).click()
    await expect(card.getByRole('button')).toHaveText('★ Starred')
})

// EVERY CARD ON EVERY PAGE, on a direct hit: the component renders on the server, adopts on the
// client and its handlers answer. A card that throws takes its whole page with it, and one that
// mis-adopts rebuilds itself with only a warning — so what is collected is the page error, the
// hydration warning and a document or module that FAILED. A handler's 5xx is not collected: a card
// about a refusal, a timeout or an error report answers one on purpose.
// TWENTY PAGES A TEST, so the walk runs in parallel rather than as one long one — the reference
// alone is a page per export.
const WALKS: { name: string; routes: string[] }[] = []
for (const group of SECTIONS)
    for (let at = 0; at < group.pages.length; at += 20)
        WALKS.push({
            name: `${group.section} ${at / 20 + 1}`,
            routes: group.pages.slice(at, at + 20).map((page) => page.route),
        })
for (const walk of WALKS)
    test(`every card under ${walk.name} renders, adopts and answers`, async ({
        page,
    }) => {
        const problems: string[] = []
        let at = ''
        page.on('pageerror', (error) =>
            problems.push(`${at}: ${error.message}`),
        )
        page.on('console', (message) => {
            if (message.text().includes('abide:hydrate'))
                problems.push(`${at}: ${message.text()}`)
        })
        page.on('response', (response) => {
            const kind = response.request().resourceType()
            if (
                response.status() >= 500 &&
                (kind === 'document' || kind === 'script')
            )
                problems.push(`${at}: ${response.status()} ${response.url()}`)
        })
        for (const route of walk.routes) {
            at = route
            await page.goto(underMount(route), {
                waitUntil: 'networkidle',
            })
        }
        expect(problems).toEqual([])
    })

test('a public file and the markdown twins are answered at their own addresses — 36.11', async ({
    page,
}) => {
    const robots = await page.request.get(underMount('/robots.txt'))
    expect(robots.status()).toBe(200)
    expect(await robots.text()).toContain('User-agent: *')

    // A page's markdown twin, which the app derives from the page rather than serving a file.
    const markdown = await page.request.get(
        underMount('/guide/edit-a-contact.md'),
    )
    expect(markdown.status()).toBe(200)
    expect(await markdown.text()).toContain('# Edit a contact')

    const bundle = await page.request.get(underMount('/abide.md'))
    expect(bundle.status()).toBe(200)
    expect(await bundle.text()).toContain('# abide documentation')
})

// 38.23 IN A BROWSER, which is the only arm that can say the stylesheet ARRIVED. The server test
// asserts the `<link>` and that its address answers; neither can tell a sheet the document
// applied from one it fetched and ignored, and the page looks plausible either way.
test('the bundled stylesheet reaches the page', async ({ page }) => {
    await page.goto(underMount('/'))

    // The heading token out of `app.css`, computed. `--color-heading` is #8E4426, and a document
    // with no stylesheet leaves an h1 at the UA's near-black.
    const color = await page
        .locator('main h1')
        .evaluate((node) => getComputedStyle(node).color)
    expect(color).toBe('rgb(142, 68, 38)')
})
