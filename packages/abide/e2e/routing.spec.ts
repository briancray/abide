// 30.7 IN A REAL BROWSER. happy-dom runs a router without ever telling you whether the document
// reloaded, and "MUST NOT reload" is the whole clause — so this arm serves the built app over
// http, navigates, and asserts on a marker on `window` that a reload would erase.
//
// THE DESTINATION'S MARKUP IS NOT FETCHED. The route CHUNK is, and the page fills itself from the
// template that chunk carries (30.11) — so a navigation asks the server for JS and nothing else.
// `/about` is served as an EMPTY shell on purpose: it is the direct-hit case, and it proves the
// same module both hydrates what a server painted and builds what it did not.

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs' // bun has no sync mkdir/rm/stat of its own
import { join, normalize } from 'node:path' // bun has no path helpers of its own

import {
    abideModules,
    type Compilation,
    serveCompilation,
} from '@abide/abide/compiler'
import { render } from '@abide/abide/server'
import { expect, test } from '@playwright/test'
import type { Server } from 'bun'

const REPO = new URL('../../../', import.meta.url).pathname
// ONE FIXTURE TREE PER PROJECT, and the project name is what separates them. This spec runs in
// BOTH engines, playwright runs the two as separate workers at the same time, and a `beforeAll`
// that begins by deleting a fixed directory is then two processes racing one path: the loser
// reports `ENOENT` writing a page it just created, or `ENOTEMPTY` removing a tree the other is
// filling. It passed under `--project=harness` alone for as long as it existed, which is the
// reading CLAUDE.md calls honest and the one that hid this.
//
// AND ONE WORKER PER PROJECT, because `fullyParallel` otherwise hands this file's two tests to two
// workers of the SAME project, each running `beforeAll` into the one tree: one build's `rm` of
// `.abide/client` lands under the other's precompress (`ENOENT … entry-*.js`). `default` runs the
// tests in order in one worker — one build per engine, and unlike `serial` a failure does not skip
// the test after it.
test.describe.configure({ mode: 'default' })

let APP = ''

const HOME = `<head><title>Home</title><meta name="description" content="the home page"></head>
<main id="home"><h1>Home</h1><p id="n">{count}</p><button id="bump" onclick={() => { count = count + 1 }}>+</button><a id="go" href="/about">about</a><a id="plain" href="/plain">plain</a><button id="step-forward" onclick={() => navigate(1).then(() => Object.assign(window, { __FORWARD__: document.querySelector('#about') !== null }))}>forward</button></main>`
// WHAT THE SERVER ACTUALLY RENDERS, taken from the page's own server module rather than written
// out here. A hand-copied shell is a hydration mismatch waiting to happen, and 41.10 answers one
// by warning and stopping — so the page comes up looking right and dead, which is the failure
// this arm exists to catch and would instead have been written into it.
let PAINTED = ''
let PAINTED_HEAD = ''
// `/plain` as the server paints it on a direct load: no title at all.
let PLAIN = ''
let PLAIN_HEAD = ''

let server: Server<undefined> | null = null

// Playwright reads the FIRST parameter to decide which fixtures to build, and `{}` is how it is
// told "none" while still handing back `testInfo` in the second. A named parameter there asks for
// the whole fixtures object instead.
// Playwright's "no fixtures" spelling — see above.
test.beforeAll(async ({}, testInfo) => {
    APP = join(REPO, `.test-modules/e2e-routeapp-${testInfo.project.name}`)
    rmSync(APP, { recursive: true, force: true })
    mkdirSync(`${APP}/plain`, { recursive: true })
    mkdirSync(`${APP}/about`, { recursive: true })
    writeFileSync(
        `${APP}/plain/index.abide`,
        '<main id="plain"><h1>Plain</h1></main>',
    )
    writeFileSync(
        `${APP}/index.abide`,
        `<script>\nimport { navigate, reactive } from '@abide/abide'\n\nlet count = reactive(0)\n</script>\n${HOME}`,
    )
    writeFileSync(
        `${APP}/about/index.abide`,
        `<script>\nimport { navigate, route } from '@abide/abide'\n</script>\n<head><title>About</title><meta name="description" content="the about page"></head>\n<main id="about"><h1>About</h1><a id="back" href="/">home</a><p id="at">{route.index}</p><button id="step-back" onclick={() => navigate(-1).then(() => Object.assign(window, { __LANDED__: document.querySelector('#home') !== null }))}>back</button></main>`,
    )
    // A package's own directory, so the tsconfig beside its manifest is no file of an address (23.22).
    writeFileSync(
        `${APP}/package.json`,
        JSON.stringify({ name: 'routing-fixture', type: 'module' }),
    )
    writeFileSync(
        `${APP}/tsconfig.json`,
        JSON.stringify({
            compilerOptions: {
                strict: true,
                target: 'esnext',
                module: 'preserve',
                moduleResolution: 'bundler',
                allowImportingTsExtensions: true,
                types: [],
            },
            include: ['**/*'],
        }),
    )
    await Bun.$`${process.execPath} ${join(REPO, 'packages/abide/bin/abide.ts')} build --root ${APP} --out ${APP}/.abide`
        .cwd(REPO)
        .quiet()
    const compilation: Compilation = await Bun.file(
        `${APP}/.abide/compilation.json`,
    ).json()
    // `__ALIVE__` is what a reload erases, and the whole of "MUST NOT reload the document". The
    // entry carrying it is one more of the build's own modules, bundled through the plugin that
    // serves the rest (`abideModules`).
    compilation.tables['alive.ts'] =
        "import { start } from '../__abide/routes.ts'\nstart(document.body)\nwindow.__ALIVE__ = true\n"
    const bundled = await Bun.build({
        entrypoints: [`${APP}/__abide/alive.ts`],
        root: APP,
        target: 'browser',
        format: 'esm',
        splitting: true,
        naming: { entry: 'entry.[ext]' },
        outdir: `${APP}/.abide/bundle`,
        plugins: [abideModules(APP, compilation)],
    })
    if (!bundled.success)
        throw new AggregateError(bundled.logs, 'the routing app did not bundle')

    // The server's own painting of `/`, HEAD AND BODY, produced by the page's server module. The
    // head matters as much as the body here: serving an empty one would make the first load's
    // title empty, and every assertion below would then be about `applyHead` alone rather than
    // about a navigation REPLACING what a server wrote.
    serveCompilation(
        APP,
        await Bun.file(`${APP}/.abide/compilation.json`).json(),
    )
    const painted: Record<string, { body: string; head: string }> = {}
    for (const page of ['index', 'plain/index']) {
        const { default: component } = await import(
            `${APP}/${page}.abide?component`
        )
        const html = new TextDecoder().decode(await render(component))
        painted[page] = {
            body: html.slice(
                html.indexOf('<body>') + 6,
                html.indexOf('</body>'),
            ),
            head: html.slice(
                html.indexOf('<head>') + 6,
                html.indexOf('</head>'),
            ),
        }
    }
    PAINTED = painted.index?.body ?? ''
    PAINTED_HEAD = painted.index?.head ?? ''
    PLAIN = painted['plain/index']?.body ?? ''
    PLAIN_HEAD = painted['plain/index']?.head ?? ''
    if (PAINTED_HEAD === '')
        throw new Error(
            'the server rendered no head, so this arm tests nothing',
        )

    const root = join(APP, '.abide/bundle')
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const asked = new URL(request.url).pathname
            if (asked.endsWith('.js')) {
                const file = join(root, normalize(asked))
                if (
                    file.startsWith(root) &&
                    existsSync(file) &&
                    statSync(file).isFile()
                )
                    return new Response(Bun.file(file), {
                        headers: { 'content-type': 'text/javascript' },
                    })
                return new Response('404', { status: 404 })
            }
            // 30.16 — THE ROUTER ASKING, answered the way abide's own server does when no
            // `middleware` objects: 204 and no body.
            if (request.headers.has('abide-navigation'))
                return new Response(null, { status: 204 })
            // AN ADDRESS THIS SERVER PAINTS NOTHING FOR still gets the page's pair, empty — the
            // shape `render` writes for a page with no markup (41.9), and the one the router finds.
            const body =
                asked === '/'
                    ? PAINTED
                    : asked === '/plain'
                      ? PLAIN
                      : '<!--[--><!--]-->'
            const head =
                asked === '/'
                    ? PAINTED_HEAD
                    : asked === '/plain'
                      ? PLAIN_HEAD
                      : ''
            return new Response(
                `<!doctype html><html><head>${head}<script type="module" src="/entry.js"></script></head><body>${body}</body></html>`,
                { headers: { 'content-type': 'text/html' } },
            )
        },
    })
})

test.afterAll(() => {
    server?.stop(true)
})

test('a navigation swaps the page without reloading the document — 30.7', async ({
    page,
}) => {
    const base = `http://localhost:${server?.port}`
    await page.goto(`${base}/`)
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )

    // HYDRATED, not rebuilt: the markup was the server's and its button is live.
    await expect(page.locator('#home h1')).toHaveText('Home')
    // The head the SERVER wrote, and `hydrate` left alone.
    await expect(page).toHaveTitle('Home')
    await page.click('#bump')
    await expect(page.locator('#n')).toHaveText('1')

    // A marker a document reload would erase.
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
    })
    await page.click('#go')

    await expect(page.locator('#about h1')).toHaveText('About')
    // 39.6 — THE INCOMING PAGE'S CONTRIBUTIONS REPLACED THE OUTGOING PAGE'S, BY KEY. The head the
    // server wrote for `/` is what is being replaced here, which is the whole clause: there is one
    // `<title>` afterwards and it is the page the reader is on.
    await expect(page).toHaveTitle('About')
    expect(
        await page.evaluate(
            () => document.head.querySelectorAll('title').length,
        ),
    ).toBe(1)
    expect(
        await page.evaluate(() =>
            document.head
                .querySelector('meta[name="description"]')
                ?.getAttribute('content'),
        ),
    ).toBe('the about page')
    expect(
        await page.evaluate(
            () =>
                document.head.querySelectorAll('meta[name="description"]')
                    .length,
        ),
    ).toBe(1)
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
    expect(new URL(page.url()).pathname).toBe('/about')
    expect(await page.locator('#home').count()).toBe(0)

    // BACK, still no reload.
    await page.goBack()
    await expect(page.locator('#home h1')).toHaveText('Home')
    // And back again — the title follows the page in both directions.
    await expect(page).toHaveTitle('Home')
    expect(
        await page.evaluate(
            () => document.head.querySelectorAll('title').length,
        ),
    ).toBe(1)
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
})

// THE DIRECT HIT — a reader who pastes `/about` rather than clicking to it. The server paints
// nothing for it, so the document arrives with the page's pair empty and the page builds itself
// from its own module (30.11). The navigation arm above cannot catch a region that will not fill
// here, because it never asks for a page the server had not painted.
test('a page the server painted nothing for builds itself on a direct hit — 30.11', async ({
    page,
}) => {
    const base = `http://localhost:${server?.port}`
    await page.goto(`${base}/about`)
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )
    await expect(page.locator('#about h1')).toHaveText('About')

    // and it is a working page, not just markup: its link routes back.
    await page.click('#back')
    await expect(page.locator('#home h1')).toHaveText('Home')
})

// 39.14 — A TITLE THE READER LEFT DOES NOT OUTLIVE THE PAGE THAT SET IT. The home page sets a
// `<title>` and `/plain` sets none, nor does any layout above it, so the server paints `/plain`
// with none — and a navigation there has to end on no title too, as a direct load does.
//
// THE REVERT: return from `withdrawHead` at its top; the tab reads `Home` on `/plain`.
test('a navigation to a page with no title ends on the title a direct load paints — 39.14', async ({
    page,
}) => {
    const base = `http://localhost:${server?.port}`
    await page.goto(`${base}/plain`)
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )
    const direct = await page.title()
    expect(direct).toBe('')

    await page.goto(`${base}/`)
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )
    await expect(page).toHaveTitle('Home')
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
    })
    await page.click('#plain')
    await expect(page.locator('#plain h1')).toHaveText('Plain')
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')
    expect(await page.title()).toBe(direct)
    expect(
        await page.evaluate(
            () => document.head.querySelectorAll('title').length,
        ),
    ).toBe(0)
})

// 30.38 — A STEP THROUGH THE HISTORY SETTLES ONCE IT HAS ARRIVED, in a real browser, where the bar
// moves later and says so only by `popstate`: the page stepped to is mounted when `navigate(-1)` and
// `navigate(1)` settle, and the document was never reloaded. 23.28 — `route.index` is the entry's
// place, through a push and a reload.
//
// THE REVERT, run: settle `step` as soon as `history.go` returns; `__LANDED__` reads false where
// true is due.
test('navigate by a number settles once the step has arrived — 30.38, 23.28', async ({
    page,
}) => {
    const base = `http://localhost:${server?.port}`
    await page.goto(`${base}/`)
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )
    await page.click('#go')
    await expect(page.locator('#at')).toHaveText('1')
    await page.evaluate(() => {
        ;(window as { __KEPT__?: string }).__KEPT__ = 'yes'
    })

    await page.click('#step-back')
    await page.waitForFunction(
        () => (window as { __LANDED__?: boolean }).__LANDED__ !== undefined,
    )
    expect(
        await page.evaluate(
            () => (window as { __LANDED__?: boolean }).__LANDED__,
        ),
    ).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/')

    await page.click('#step-forward')
    await page.waitForFunction(
        () => (window as { __FORWARD__?: boolean }).__FORWARD__ !== undefined,
    )
    expect(
        await page.evaluate(
            () => (window as { __FORWARD__?: boolean }).__FORWARD__,
        ),
    ).toBe(true)
    await expect(page.locator('#at')).toHaveText('1')
    expect(
        await page.evaluate(() => (window as { __KEPT__?: string }).__KEPT__),
    ).toBe('yes')

    // A RELOAD keeps the entry's place.
    await page.reload()
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )
    await expect(page.locator('#at')).toHaveText('1')
})
