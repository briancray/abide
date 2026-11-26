// THE DOCS, AS A READER GETS THEM: `abide build`, then `abide start`, then a browser. The server
// tests in `packages/abide/tests/serve.test.ts` assert what goes out on the wire; nothing there
// can tell a document that hydrated from one that merely looks right, which is what this is for
// and the one thing only a browser can say.
//
// THE APP IS THE DOCUMENTATION NOW, so these are gates on the real thing rather than on a pair
// of demo pages: a page per export, one nav, one rail, and each page's tests and rules read from
// the workspace as it renders.

import { expect, test } from '@playwright/test'

import { SITE } from '../src/lib/SITE.ts'

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
    await page.goto(underMount('/abide-files/expressions'))

    await expect(page.locator('main h1')).toHaveText(
        'Expressions and attributes',
    )
    await expect(page).toHaveTitle('Expressions and attributes — abide')
    // 32.24 THROUGH A PAGE. The Syntax rows are markdown cells rendered as the page builds, carried
    // in as `raw` slots — so a table is a table rather than the source of one, which is exactly
    // what a client binding over the same slot would have left on screen.
    await expect(page.locator('main table').first()).toBeVisible()
})

test('a direct hit is painted by the server, with no script at all', async ({
    page,
}) => {
    await page.context().route('**/__abide/client/**', (route) => route.abort())
    await page.context().route('**/docs.js', (route) => route.abort())
    await page.goto(underMount('/reactive/reactive'))

    await expect(page.locator('main h1')).toHaveText('reactive')
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText(
        'reactive',
    )
})

test('a link to another page navigates without reloading — 30.7', async ({
    page,
}) => {
    await page.goto(underMount('/abide-files/expressions'))
    // A marker a document reload erases, which is the only way to tell the two apart.
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
        ;(
            document.querySelector('nav.sidebar') as { __KEPT__?: string }
        ).__KEPT__ = 'yes'
    })

    await page.click(`nav a[href="${underMount('/handlers/rpc')}"]`)

    await expect(page.locator('main h1')).toHaveText('rpc')
    // 39.6 — the incoming page's head replaced the outgoing page's, by key.
    await expect(page).toHaveTitle('rpc — abide')
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
    expect(new URL(page.url()).pathname).toBe(underMount('/handlers/rpc'))
    // THE NAV IS THE ONE THING SHARED BETWEEN TWO PAGES, and the mark on it is the only part
    // that differs — so a navigation that rebuilt the nav from the wrong page's slug shows
    // here and nowhere else.
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('rpc')
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

// THE RAIL IS THE ARRIVING PAGE'S `scrollSpy` (51.169-51.177): its host is the rail, and the page a
// reader left unbound its own. So scrolling a page a reader NAVIGATED to marks that page's heading —
// measured against its own headings, not the ones they arrived on. THE REVERT: measure once as the host
// is bound rather than a frame on, and the rail of a navigated page marks nothing it scrolls to.
test('the rail follows the page a reader navigated to', async ({ page }) => {
    await page.goto(underMount('/abide-files/expressions'))
    await page.click(`nav a[href="${underMount('/reactive/reactive')}"]`)
    await expect(page.locator('main h1')).toHaveText('reactive')

    const links = page.locator('.toc a[href^="#"]')
    const first = links.first()
    await expect(first).toHaveAttribute('href', '#syntax')
    // At the top, the first heading is current.
    await expect(first).toHaveAttribute('aria-current', 'true')
    const second = links.nth(1)
    const id = ((await second.getAttribute('href')) ?? '').slice(1)
    await page.evaluate((heading) => {
        document.getElementById(heading)?.scrollIntoView()
    }, id)
    await expect(second).toHaveAttribute('aria-current', 'true')
    await expect(first).not.toHaveAttribute('aria-current', 'true')
})

// A PAGE'S TESTS AND RULES ARE READ BY ITS OWN CALLS, so on a page the reader NAVIGATED to they are
// asked for by the client rather than answered from the seed the server painted — the arm a direct
// hit never runs. THE REVERT: have `Rules.abide` read `clauseTexts` only where `isServer()`, and the
// navigated page's Rules are empty.
test('a page a reader navigated to reads its tests and rules', async ({
    page,
}) => {
    await page.goto(underMount('/abide-files/expressions'))
    await page.click(`nav a[href="${underMount('/reactive/watch')}"]`)
    await expect(page.locator('main h1')).toHaveText('watch')
    await expect(page.locator('#tests ~ figure').first()).toContainText(
        "test('",
    )
    await expect(page.locator('ul.rules li').first()).toContainText('12.1')
})

// EVERY PAGE, on a direct hit: the page renders on the server, adopts on the client and its
// handlers answer. A page that throws is a 500, and one that mis-adopts rebuilds itself with only a
// warning — so what is collected is the page error, the hydration warning and a document or module
// that FAILED.
// A GROUP A TEST, so the walk runs in parallel rather than as one long one — and a group listed in
// runs, a run a test: each page waits out `networkidle`, so a group of fifty walks past the timeout.
const WALKS: { name: string; routes: string[] }[] = [
    { name: 'the home page', routes: ['/'] },
]
for (const group of SITE) {
    const runs = new Map<string, string[]>()
    for (const page of group.pages) {
        const name =
            page.subgroup === undefined
                ? group.group
                : `${group.group}, ${page.subgroup}`
        runs.set(name, [...(runs.get(name) ?? []), page.route])
    }
    for (const [name, routes] of runs) WALKS.push({ name, routes })
}
for (const walk of WALKS)
    test(`every page under ${walk.name} renders, adopts and answers`, async ({
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
        underMount('/abide-files/expressions.md'),
    )
    expect(markdown.status()).toBe(200)
    expect(await markdown.text()).toContain('# Expressions and attributes')

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

// 44.75, 16.93 — THE PAIRING PANEL MOUNTED AS THE PAGE LOADS, and the page still goes idle: the panel
// reads its pairing once and follows it over the socket, so no fetch stays open while it watches.
// THE REVERT: answer `/__abide/pairing` as `provider.claudeCode.bridge`'s stream again and read it in
// `pairing.ts` as one; the open stream holds a connection and `networkidle` never comes.
test('the pairing panel shows its command and the page reaches networkidle — 44.75', async ({
    page,
}) => {
    // The CRM's assistant page, which mounts its bridge panel as it loads (40.24).
    await page.goto(underMount('/assistant'), {
        waitUntil: 'networkidle',
        timeout: 15_000,
    })
    await expect(page.getByText('bunx @abide/bridge@').first()).toBeVisible()
})
