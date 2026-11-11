// SECTION 8'S BROWSER STORES IN A REAL BROWSER, against `abide start`. The emulator has neither
// IndexedDB nor a `cookieStore`, and a cookie a SERVER renders from (8.37) is a request a browser
// sends — so what `stores.test.ts` can only show inert is shown here working.

import { expect, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

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

let server: Subprocess | undefined
let base = ''
let app = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    const directory = `e2e-stores-${testInfo.project.name}`
    // The fixture's `package.json` names it, and 8.29 keeps every key under that name.
    app = `${directory}-fixture`
    ;({ base, server } = await servedFixture(directory, {
        'layout.abide': LAYOUT,
        'cookie/index.abide': `<script>
import { cookiesStore, reactive } from '@abide/abide'

let theme = reactive('system', { store: cookiesStore('theme') })
</script>

<main id="cookie"><p id="theme">{theme}</p><button id="dark" onclick={() => { theme = 'dark' }}>dark</button><button id="light" onclick={() => { theme = 'light' }}>light</button></main>`,
        'indexed/index.abide': `<script>
import { indexedDBStore, reactive } from '@abide/abide'

let count = reactive(0, { store: indexedDBStore('count') })
</script>

<main id="indexed"><p id="count">{count.ready() ? count : 'loading'}</p><button id="bump" onclick={() => { count = count + 1 }}>+</button></main>`,
    }))
})

test.afterAll(() => {
    server?.kill()
})

// 8.37: THE SERVER RENDERS THE COOKIE'S VALUE. The page's own HTML, fetched with the browser's
// cookies and no script run, already says `dark` — the fallback never reaches the screen.
//
// THE REVERT: have `get` answer `undefined` where `typeof document === 'undefined'`, and the HTML
// says `system` where `dark` is due.
test('a cookie store’s value is what the server renders — 8.37, 8.29', async ({
    page,
    context,
}) => {
    await page.goto(`${base}/cookie`)
    await expect(page.locator('#theme')).toHaveText('system')
    await page.locator('#dark').click()
    await expect(page.locator('#theme')).toHaveText('dark')
    const names = (await context.cookies()).map((cookie) => cookie.name)
    expect(names).toContain(encodeURIComponent(`${app}:theme`))
    const html = await (await page.request.get(`${base}/cookie`)).text()
    expect(html).toContain('<p id="theme">dark</p>')
})

// 8.40: ANOTHER DOCUMENT'S COOKIE WRITE IS READ BACK, where the browser reports one (22.6).
test('a cookie store follows another document’s write — 8.40', async ({
    context,
}) => {
    const first = await context.newPage()
    const second = await context.newPage()
    await first.goto(`${base}/cookie`)
    await second.goto(`${base}/cookie`)
    test.skip(
        !(await second.evaluate(() => 'cookieStore' in globalThis)),
        'this engine reports no cookie change (22.7)',
    )
    await first.locator('#light').click()
    await expect(first.locator('#theme')).toHaveText('light')
    await expect(second.locator('#theme')).toHaveText('light')
})

// 8.34, 8.36: INDEXEDDB KEEPS THE VALUE ACROSS A RELOAD, and a write in one document reaches
// another through the broadcast.
//
// THE REVERT: drop the `postMessage` from `written`, and the second page stays at its old count.
test('an IndexedDB store restores, and follows another document’s write — 8.34, 8.36', async ({
    context,
}) => {
    const first = await context.newPage()
    await first.goto(`${base}/indexed`)
    await expect(first.locator('#count')).toHaveText('0')
    await first.locator('#bump').click()
    await first.locator('#bump').click()
    await expect(first.locator('#count')).toHaveText('2')
    // THE WRITE IS ASYNCHRONOUS, and a reload before it commits loses it: 8.10 holds the second
    // write until the first settles. So the restore is checked once the database holds the value.
    await expect
        .poll(() =>
            first.evaluate(
                (key) =>
                    new Promise<unknown>((resolve) => {
                        const opened = indexedDB.open('abide')
                        opened.onsuccess = () => {
                            const read = opened.result
                                .transaction('abide_store')
                                .objectStore('abide_store')
                                .get(key)
                            read.onsuccess = () => {
                                opened.result.close()
                                resolve(read.result)
                            }
                        }
                    }),
                `${app}:count`,
            ),
        )
        .toBe('{"value":2,"expires":null}')
    await first.reload()
    await expect(first.locator('#count')).toHaveText('2')

    const second = await context.newPage()
    await second.goto(`${base}/indexed`)
    await expect(second.locator('#count')).toHaveText('2')
    await first.locator('#bump').click()
    await expect(first.locator('#count')).toHaveText('3')
    await expect(second.locator('#count')).toHaveText('3')
})
