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
import { reactive, store } from '@abide/abide'

let theme = reactive('system', { store: store.cookies('theme') })
</script>

<main id="cookie"><p id="theme">{theme}</p><button id="dark" onclick={() => { theme = 'dark' }}>dark</button><button id="light" onclick={() => { theme = 'light' }}>light</button></main>`,
        'indexed/index.abide': `<script>
import { reactive, store } from '@abide/abide'

let count = reactive(0, { store: store.indexedDB('count') })
</script>

<main id="indexed"><p id="count">{count.ready() ? count : 'loading'}</p><button id="bump" onclick={() => { count = count + 1 }}>+</button></main>`,
        'visits/index.abide': `<script>
import { ledger, store } from '@abide/abide'

const visits = ledger<string>({ store: store.indexedDB('visits') })
</script>

<main id="visits"><p id="head">{visits.length}</p><button id="visit" onclick={() => visits.append('visit')}>visit</button></main>`,
        'drafts/index.abide': `<script>
import { ledger, store } from '@abide/abide'

const drafts = ledger<string>({ store: store.indexedDB('drafts'), retain: 1 })
</script>

<main id="drafts"><p id="last">{drafts.at(-1)?.seq ?? 0}</p><button id="save" onclick={() => drafts.append('save', { key: 'k1' })}>save</button><button id="other" onclick={() => drafts.append('other')}>other</button></main>`,
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

// 58.9, 58.12: A LEDGER IN INDEXEDDB IS KEPT ACROSS A RELOAD, AND HEARD BY ANOTHER DOCUMENT. Two appends
// are two entries after the page reloads, and a third appended in a second tab moves the first tab's
// `head` with no reload. THE REVERT: drop the `watch` subscription from `ledger`, and the first tab
// stays at 2.
test('a ledger in store.indexedDB is kept, and another tab’s append is heard — 58.9, 58.12', async ({
    context,
}) => {
    const first = await context.newPage()
    await first.goto(`${base}/visits`)
    await first.locator('#visit').click()
    await expect(first.locator('#head')).toHaveText('1')
    await first.locator('#visit').click()
    await expect(first.locator('#head')).toHaveText('2')
    await first.reload()
    await expect(first.locator('#head')).toHaveText('2')
    const second = await context.newPage()
    await second.goto(`${base}/visits`)
    await expect(second.locator('#head')).toHaveText('2')
    await second.locator('#visit').click()
    await expect(second.locator('#head')).toHaveText('3')
    await expect(first.locator('#head')).toHaveText('3')
})

// 58.10, 58.16: IN INDEXEDDB A TRIM TAKES AN ENTRY'S KEY WITH IT. Saved under `k1`, then trimmed by
// the next entry under `retain: 1`, a save under `k1` again is a new entry. THE REVERT: drop the key
// deletes from the IndexedDB `trim`, and the third click answers the first entry — `last` stays 2.
test('a trimmed IndexedDB ledger lets a key go with its entry — 58.10, 58.16', async ({
    page,
}) => {
    await page.goto(`${base}/drafts`)
    await page.locator('#save').click()
    await expect(page.locator('#last')).toHaveText('1')
    await page.locator('#other').click()
    await expect(page.locator('#last')).toHaveText('2')
    await page.locator('#save').click()
    await expect(page.locator('#last')).toHaveText('3')
})
