// SECTION 45 ACROSS A RESTART — the app stopped and started again on the address it had, as a deploy
// or a setting changed does: a browser keeps a service worker per origin, so what is asserted is
// what the worker one start installed does under the next.

import { expect, type Page, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import {
    buildFixture,
    servedFixture,
    startedFixture,
    writeFixture,
} from './servedFixture.ts'

// ONE APP PER TEST, each restarting its own server.
test.describe.configure({ mode: 'default' })

const LAYOUT = `<script>
import './app.css'
</script>
<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`

const RED = 'rgb(255, 0, 0)'
const BLUE = 'rgb(0, 0, 255)'

const FILES = {
    'layout.abide': LAYOUT,
    'app.css': `body { color: ${RED} }`,
    'index.abide': '<main id="home"><h1>Home</h1></main>',
}

let server: Subprocess | undefined

test.afterEach(async () => {
    server?.kill()
    await server?.exited
    server = undefined
})

/** The port `base` is served on, for the restart to take the same origin. */
const portOf = (base: string): number => Number(new URL(base).port)

/** Serves `FILES` with `ABIDE_OFFLINE` on, as this test's app. */
async function served(
    testInfo: { project: { name: string } },
    name: string,
): Promise<{ app: string; base: string }> {
    const started = await servedFixture(
        `e2e-offline-${name}-${testInfo.project.name}`,
        FILES,
        { ABIDE_OFFLINE: '1' },
    )
    server = started.server
    return started
}

/**
 * A deploy: the server stopped, the app's stylesheet painting `color` built, and the build started on
 * the address it had.
 */
async function deployed(app: string, base: string, color: string) {
    server?.kill()
    await server?.exited
    writeFixture(app, { 'app.css': `body { color: ${color} }` })
    await buildFixture(app)
    ;({ server } = await startedFixture(
        app,
        { ABIDE_OFFLINE: '1' },
        portOf(base),
    ))
}

/** The color `page`'s stylesheet paints its body — black where none applies. */
const painted = (page: Page): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).color)

/** Waits until the worker has saved the page `page` is on (45.13, 45.28). */
async function saved(page: Page): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(
                async () =>
                    (await (
                        await caches.open('abide:saved')
                    ).match(location.href)) !== undefined,
            ),
        )
        .toBe(true)
}

/**
 * Waits until the worker of the build `base` now serves has taken over: its stylesheet saved, and no
 * worker installing or waiting behind the one active.
 */
async function activated(page: Page, base: string): Promise<void> {
    const sheet = /href="([^"]+\.css)"/.exec(
        await (await fetch(`${base}/`)).text(),
    )?.[1] as string
    await expect
        .poll(() =>
            page.evaluate(async (href) => {
                const registration =
                    await navigator.serviceWorker.getRegistration()
                return (
                    (await (
                        await caches.open('abide:bundle')
                    ).match(new URL(href, location.href))) !== undefined &&
                    registration?.installing === null &&
                    registration.waiting === null &&
                    registration.active?.state === 'activated'
                )
            }, sheet),
        )
        .toBe(true)
}

/** Waits until a worker controls `page` and has saved the build's bundle (45.5). */
async function installed(page: Page): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(
                async () =>
                    navigator.serviceWorker.controller !== null &&
                    (await caches.keys()).includes('abide:bundle'),
            ),
        )
        .toBe(true)
}

// 45.9, 45.14 — A BROWSER THAT KEPT THE APP WHILE `ABIDE_OFFLINE` WAS ON DROPS IT ALL once it is off:
// the visit after the restart is answered by the old worker, the browser's update check fetches the
// worker address, and what it answers now unregisters and empties every cache — once, with no reload.
// THE REVERT: drop `self.registration.unregister()` from the removing worker in `answerWorker`; the
// registration stays, `1 registrations`.
test('a worker installed while ABIDE_OFFLINE was on removes itself once it is off — 45.9, 45.14', async ({
    page,
}, testInfo) => {
    const started = await servedFixture(
        `e2e-offline-off-${testInfo.project.name}`,
        FILES,
        { ABIDE_OFFLINE: '1' },
    )
    server = started.server
    await page.goto(started.base)
    await installed(page)
    server.kill()
    await server.exited
    ;({ server } = await startedFixture(started.app, {}, portOf(started.base)))
    let loads = 0
    page.on('load', () => {
        loads++
    })
    await page.goto(started.base)
    await expect
        .poll(() =>
            page.evaluate(
                async () =>
                    `${(await navigator.serviceWorker.getRegistrations()).length} registrations, ${(await caches.keys()).length} caches`,
            ),
        )
        .toBe('0 registrations, 0 caches')
    // No reload in a loop: the visit is the one load.
    await page.waitForTimeout(500)
    expect(`loads: ${loads}`).toBe('loads: 1')
    await expect(page.locator('#home h1')).toHaveText('Home')
})

// 45.28 — THE VISIT AFTER A DEPLOY OPENS THE BUILD BEFORE FROM THE DEVICE, at once and whole, and the
// one after the new worker takes over opens the new build: its activation drops the pages the build
// before kept and saves the open one again (45.8, 45.13). THE REVERT: drop the copy arm from the
// worker's `opened`; the first visit after the deploy waits on the network and paints blue.
test('the visit after a deploy opens the kept build at once, and the next the new one — 45.28, 45.8', async ({
    page,
}, testInfo) => {
    const { app, base } = await served(testInfo, 'deploy')
    await page.goto(base)
    await installed(page)
    await saved(page)
    await deployed(app, base, BLUE)
    await page.goto(base)
    const visits = [await painted(page)]
    await activated(page, base)
    await page.goto(base)
    visits.push(await painted(page))
    expect(visits).toEqual([RED, BLUE])
})

// 45.20 — THE RELOAD AFTER A DEPLOY IS THE NEW BUILD: a reload asks the network first, so the reader
// who reloads is never shown the build before. NOT IN WEBKIT, which hands the worker a reload's
// navigation `default` where the fetch standard has it `no-cache`, so the worker cannot tell it from a
// visit — there the reload is 45.28's visit, and the one after it the new build. THE REVERT: drop
// `reloading` from the worker's `opened`; the reload opens the copy, red.
test('a reload after a deploy opens the new build — 45.20', async ({
    page,
}, testInfo) => {
    test.skip(
        testInfo.project.name === 'abide-webkit',
        "webkit asks a reload's navigation `default`",
    )
    const { app, base } = await served(testInfo, 'reload')
    await page.goto(base)
    await installed(page)
    await saved(page)
    await deployed(app, base, BLUE)
    await page.reload()
    expect(await painted(page)).toBe(BLUE)
})

// 45.8 — A PAGE OF THE BUILD BEFORE KEEPS ITS STYLESHEET ONCE THE NEW WORKER TAKES OVER, which it does
// at once, mid-visit: the server serves the new build alone, so a stylesheet dropped with the build
// before's pages is a page painted unstyled — the one the visit after a deploy opened, where the new
// worker activated before its stylesheet landed. THE REVERT: delete the files the new build does not
// name in the worker's `activate`, as before; the build before's stylesheet answers 404.
test('a page of the build before keeps its stylesheet once the new worker takes over — 45.8', async ({
    page,
}, testInfo) => {
    const { app, base } = await served(testInfo, 'retired')
    await page.goto(base)
    await installed(page)
    const sheet = (await page
        .locator('link[rel="stylesheet"]')
        .getAttribute('href')) as string
    await deployed(app, base, BLUE)
    await page.evaluate(() =>
        navigator.serviceWorker.getRegistration().then((r) => r?.update()),
    )
    await activated(page, base)
    const answered = await page.evaluate(
        async (href) => (await fetch(href)).status,
        sheet,
    )
    expect(`${sheet.replace(/-\w+\.css$/, '.css')}: ${answered}`).toBe(
        '/__abide/client/entry.css: 200',
    )
})

// 45.6, 45.28 — THE SECOND LOAD WITH THE SERVER GONE OPENS WHOLE: the page from its copy, its
// stylesheet and its bundle from the device. THE REVERT: drop the `FILES.has` arm from the worker's
// `fetch`; the stylesheet is asked of a server that is gone, and the page paints unstyled, black.
test('the second load with the server gone opens whole, stylesheet included — 45.6, 45.28', async ({
    page,
}, testInfo) => {
    const { base } = await served(testInfo, 'gone')
    await page.goto(base)
    await installed(page)
    await saved(page)
    server?.kill()
    await server?.exited
    server = undefined
    await page.goto(base)
    await expect(page.locator('#home h1')).toHaveText('Home')
    expect(await painted(page)).toBe(RED)
})
