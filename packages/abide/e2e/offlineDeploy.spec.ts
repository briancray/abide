// SECTION 45 ACROSS A RESTART — the app stopped and started again on the address it had, as a deploy
// or a setting changed does: a browser keeps a service worker per origin, so what is asserted is
// what the worker one start installed does under the next.

import { expect, type Page, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture, startedFixture } from './servedFixture.ts'

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

const FILES = {
    'layout.abide': LAYOUT,
    'app.css': 'body { color: rgb(255, 0, 0) }',
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
