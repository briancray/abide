// 30.7 IN A REAL BROWSER. happy-dom runs a router without ever telling you whether the document
// reloaded, and "MUST NOT reload" is the whole clause — so this arm serves the built app over
// http, navigates, and asserts on a marker on `window` that a reload would erase.
//
// THE DESTINATION'S MARKUP IS NOT FETCHED. The route CHUNK is, and the page fills itself from the
// template that chunk carries (30.11) — so a navigation asks the server for JS and nothing else.
// `/about` is served as an EMPTY shell on purpose: it is the direct-hit case, and it proves the
// same module both hydrates what a server painted and builds what it did not.
//
// `node:http` rather than `Bun.serve` for `panel.spec.ts`'s reason: playwright runs on node.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join, normalize } from 'node:path'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
// ONE FIXTURE TREE PER PROJECT, and the project name is what separates them. This spec runs in
// BOTH engines, playwright runs the two as separate workers at the same time, and a `beforeAll`
// that begins by deleting a fixed directory is then two processes racing one path: the loser
// reports `ENOENT` writing a page it just created, or `ENOTEMPTY` removing a tree the other is
// filling. It passed under `--project=harness` alone for as long as it existed, which is the
// reading CLAUDE.md calls honest and the one that hid this.
let APP = join(REPO, '.test-modules/e2e-routeapp')

const HOME = `<head><title>Home</title><meta name="description" content="the home page"></head>
<main id="home"><h1>Home</h1><p id="n">{count}</p><button id="bump" onclick={() => { count = count + 1 }}>+</button><a id="go" href="/about">about</a></main>`
// WHAT THE SERVER ACTUALLY RENDERS, taken from the page's own server module rather than written
// out here. A hand-copied shell is a hydration mismatch waiting to happen, and 41.11 answers one
// by warning and stopping — so the page comes up looking right and dead, which is the failure
// this arm exists to catch and would instead have been written into it.
let PAINTED = ''
let PAINTED_HEAD = ''

let server: Server | null = null
let port = 0

test.beforeAll(async ({}, testInfo) => {
    APP = join(REPO, `.test-modules/e2e-routeapp-${testInfo.project.name}`)
    // WRITTEN FROM HERE, not from a `bun -e`. Nothing about laying the fixture out is bun-only —
    // only the build and the server render below are — and a heredoc inside an argv string is
    // three layers of quoting to get right every time the page changes.
    rmSync(APP, { recursive: true, force: true })
    mkdirSync(`${APP}/ui/pages/about`, { recursive: true })
    writeFileSync(
        `${APP}/ui/pages/page.abide`,
        `<script>\nimport { reactive } from 'abide'\n\nlet count = reactive(0)\n</script>\n${HOME}`,
    )
    writeFileSync(
        `${APP}/ui/pages/about/page.abide`,
        '<head><title>About</title><meta name="description" content="the about page"></head>\n<main id="about"><h1>About</h1><a id="back" href="/">home</a></main>',
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
            include: ['ui'],
        }),
    )
    execFileSync(
        'bun',
        [
            join(REPO, 'packages/abide/bin/abide.ts'),
            'build',
            '--root',
            APP,
            '--out',
            `${APP}/.abide`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )
    // `__ALIVE__` is what a reload erases, and the whole of "MUST NOT reload the document".
    writeFileSync(
        `${APP}/.abide/entry.ts`,
        "import { start } from './routes.ts'\nstart(document.body)\nwindow.__ALIVE__ = true\n",
    )
    execFileSync(
        'bun',
        [
            'build',
            `${APP}/.abide/entry.ts`,
            '--target=browser',
            '--format=esm',
            '--splitting',
            `--outdir=${APP}/.abide/bundle`,
        ],
        { cwd: REPO, encoding: 'utf8' },
    )

    // The server's own painting of `/`, HEAD AND BODY, produced by the page's server module. The
    // head matters as much as the body here: serving an empty one would make the first load's
    // title empty, and every assertion below would then be about `applyHead` alone rather than
    // about a navigation REPLACING what a server wrote.
    const painted = JSON.parse(
        execFileSync(
            'bun',
            [
                '-e',
                `import { render } from 'abide/server'
const { default: C } = await import(${JSON.stringify(`${APP}/.abide/ui/pages/page.ts`)})
let html = ''
for await (const c of render(C, '<!doctype html><html><head></head><body></body></html>')) html += new TextDecoder().decode(c)
console.log(JSON.stringify({
    body: html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')),
    head: html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>')),
}))`,
            ],
            { cwd: REPO, encoding: 'utf8' },
        )
            .trim()
            .split('\n')
            .pop() as string,
    ) as { body: string; head: string }
    PAINTED = painted.body
    PAINTED_HEAD = painted.head
    if (PAINTED_HEAD === '')
        throw new Error(
            'the server rendered no head, so this arm tests nothing',
        )

    const root = join(APP, '.abide/bundle')
    server = createServer((request, response) => {
        const asked = (request.url ?? '/').split('?')[0] ?? '/'
        if (asked.endsWith('.js')) {
            const file = join(root, normalize(asked))
            if (
                file.startsWith(root) &&
                existsSync(file) &&
                statSync(file).isFile()
            ) {
                readFile(file).then((text) => {
                    response.writeHead(200, {
                        'content-type': 'text/javascript',
                    })
                    response.end(text)
                })
                return
            }
            response.writeHead(404)
            response.end('404')
            return
        }
        const body = asked === '/' ? PAINTED : ''
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(
            `<!doctype html><html><head>${asked === '/' ? PAINTED_HEAD : ''}<script type="module" src="/entry.js"></script></head><body>${body}</body></html>`,
        )
    })
    const listening = server
    await new Promise<void>((resolve) => {
        listening.listen(0, () => {
            port = (listening.address() as { port: number }).port
            resolve()
        })
    })
})

test.afterAll(() => {
    server?.close()
})

test('a navigation swaps the page without reloading the document — 30.7', async ({
    page,
}) => {
    const base = `http://localhost:${port}`
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
    // 39.7 — THE INCOMING PAGE'S CONTRIBUTIONS REPLACED THE OUTGOING PAGE'S, BY KEY. The head the
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
// nothing for it, so the document arrives with the opening anchor as its only child and the page
// builds itself from its own module (30.11). This is where `pageRegion` put the close anchor
// BEFORE the open one and the region could never be filled: the navigation arm above still
// passed, because it never asked for a page the server had not painted.
test('a page the server painted nothing for builds itself on a direct hit — 30.11', async ({
    page,
}) => {
    const base = `http://localhost:${port}`
    await page.goto(`${base}/about`)
    await page.waitForFunction(
        () => (window as { __ALIVE__?: boolean }).__ALIVE__ === true,
    )
    await expect(page.locator('#about h1')).toHaveText('About')

    // and it is a working page, not just markup: its link routes back.
    await page.click('#back')
    await expect(page.locator('#home h1')).toHaveText('Home')
})
