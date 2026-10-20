// SECTION 45 IN A REAL BROWSER, against `abide start`. A service worker exists nowhere else: no
// emulator installs one, so whether a page comes back with the network gone is a question only a
// browser can answer.
//
// CHROMIUM ALONE: playwright drives a service worker in chromium, and its webkit leaves
// `navigator.serviceWorker` unregistered under automation.
//
// `node:child_process` rather than `Bun.spawn`: playwright runs on node.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

// ONE TREE AND ONE WORKER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const LAYOUT = `<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`

const HOME = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<main id="home"><h1>Home</h1><p id="n">{count}</p><button id="bump" onclick={() => { count = count + 1 }}>+</button><a id="to-about" href="/about">about</a><a id="to-never" href="/never">never</a></main>`

let server: ChildProcess | undefined
let base = ''

// biome-ignore lint/correctness/noEmptyPattern: playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'abide') return
    const app = join(REPO, `.test-modules/e2e-offline-${testInfo.project.name}`)
    rmSync(app, { recursive: true, force: true })
    mkdirSync(`${app}/about`, { recursive: true })
    mkdirSync(`${app}/never`, { recursive: true })
    mkdirSync(`${app}/note`, { recursive: true })
    mkdirSync(`${app}/data`, { recursive: true })
    writeFileSync(
        `${app}/data/getNote.ts`,
        `import { GET } from '@abide/abide/server'

export default GET(() => ({ text: 'a saved note' }))
`,
    )
    writeFileSync(
        `${app}/note/index.abide`,
        `<script>
import { reactive } from '@abide/abide'
import getNote from '#src/data/getNote.ts'

const note = reactive(() => getNote())
</script>

<main id="note"><p id="text">{note().text}</p></main>`,
    )
    writeFileSync(
        `${app}/package.json`,
        JSON.stringify({
            name: 'offline-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
    )
    writeFileSync(`${app}/layout.abide`, LAYOUT)
    writeFileSync(`${app}/index.abide`, HOME)
    writeFileSync(
        `${app}/about/index.abide`,
        '<main id="about"><h1>About</h1><a id="to-home" href="/">home</a></main>',
    )
    writeFileSync(
        `${app}/never/index.abide`,
        '<main id="never"><h1>Never visited</h1></main>',
    )
    const cli = join(REPO, 'packages/abide/bin/abide.ts')
    execFileSync(
        'bun',
        [cli, 'build', '--root', app, '--out', `${app}/.abide`],
        { cwd: REPO, encoding: 'utf8' },
    )
    const started = spawn(
        'bun',
        [cli, 'start', '--root', app, '--out', `${app}/.abide`, '--port', '0'],
        // ON BY DEFAULT (45.14): nothing in the environment asks for the worker.
        { cwd: REPO, stdio: ['ignore', 'pipe', 'inherit'] },
    )
    server = started
    base = await new Promise<string>((resolve, reject) => {
        let said = ''
        started.stdout?.on('data', (chunk: Buffer) => {
            said += chunk.toString()
            const found = /(http:\/\/localhost:\d+)/.exec(said)
            if (found !== null) resolve(found[1] as string)
        })
        started.on('exit', (code) =>
            reject(new Error(`abide start exited ${code}: ${said}`)),
        )
    })
})

test.afterAll(() => {
    server?.kill()
})

// biome-ignore lint/correctness/noEmptyPattern: playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeEach(({}, testInfo) => {
    test.skip(
        testInfo.project.name !== 'abide',
        'a service worker is driven in chromium alone',
    )
})

/**
 * Loads `path` online and waits until the worker controls the page and has saved it (45.3, 45.13).
 *
 * POLLED FROM HERE: `waitForFunction` does not await a predicate that returns a promise, and a
 * promise is truthy, so an async predicate passed at once — before the worker had even activated.
 */
async function visit(
    page: Page,
    path: string,
    alsoSaved: string[] = [],
): Promise<void> {
    await page.goto(`${base}${path}`)
    await expect
        .poll(() =>
            page.evaluate(async (others) => {
                if (navigator.serviceWorker.controller === null) return false
                const saved = await caches.open('abide:saved')
                for (const address of [location.href, ...others])
                    if (
                        (await saved.match(new URL(address, location.href))) ===
                        undefined
                    )
                        return false
                return true
            }, alsoSaved),
        )
        .toBe(true)
}

// 45.1, 45.3, 45.6, 45.13 — A PAGE VISITED COMES BACK OFFLINE, live, and so does the one that
// installed the worker. THE REVERT: answer `answerWorker(undefined)` from `builtSources`' lane
// whatever `ABIDE_OFFLINE` says; the worker removes itself, and `visit` never sees the page saved.
test('a page visited online loads again offline, live — 45.3', async ({
    page,
    context,
}) => {
    await visit(page, '/')
    await visit(page, '/about')
    await context.setOffline(true)
    try {
        await page.reload()
        await expect(page.locator('#about h1')).toHaveText('About')
        await page.goto(`${base}/`)
        await page.click('#bump')
        await expect(page.locator('#n')).toHaveText('1')
    } finally {
        await context.setOffline(false)
    }
})

// 45.11 — A PAGE NEVER VISITED IS ANSWERED 503, saying why. THE REVERT: return `saved` alone from the
// worker's `page`; the navigation is answered with nothing, and chromium's own error page shows.
test('a page never visited is answered offline with a page saying so — 45.11', async ({
    page,
    context,
}) => {
    await visit(page, '/')
    await context.setOffline(true)
    try {
        const answer = await page.goto(`${base}/never`)
        expect(answer?.status()).toBe(503)
        await expect(page.locator('body')).toContainText("You're offline")
    } finally {
        await context.setOffline(false)
    }
})

// 45.12 AND 30.32 — AN OFFLINE CLICK LOADS A SAVED PAGE AND KEEPS AN UNSAVED ONE'S PAGE STANDING. THE
// REVERT: drop the `savedOffline` arm from `Router.go`; the click to `/about` leaves the page as it
// stood, and `#about` never shows.
test('an offline click loads a saved page, and stays put for an unsaved one — 45.12', async ({
    page,
    context,
}) => {
    await visit(page, '/about')
    await visit(page, '/')
    await context.setOffline(true)
    try {
        await page.click('#bump')
        await page.click('#to-never')
        await expect(page.locator('#n')).toHaveText('1')
        await expect(page.locator('#home h1')).toHaveText('Home')
        await page.click('#to-about')
        await expect(page.locator('#about h1')).toHaveText('About')
    } finally {
        await context.setOffline(false)
    }
})

// 45.3 — A PAGE'S DATA COMES BACK OFFLINE WITH IT: the handler's answer was saved as the page read it.
// THE REVERT: return from the worker's `fetch` before `answer` for anything but a page; the read
// offline is refused, and `#text` never shows.
test("a page's data loads again offline — 45.3", async ({ page, context }) => {
    await visit(page, '/')
    await visit(page, '/note', ['/data/getNote'])
    await context.setOffline(true)
    try {
        await page.reload()
        await expect(page.locator('#text')).toHaveText('a saved note')
    } finally {
        await context.setOffline(false)
    }
})
