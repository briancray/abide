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
    mkdirSync(`${app}/data/lib`, { recursive: true })
    mkdirSync(`${app}/outbox`, { recursive: true })
    // 46 — A WRITE MADE OFFLINE, counted by the key it is sent under, so a call delivered twice says so.
    writeFileSync(
        `${app}/data/lib/added.ts`,
        'export const added = new Map<string, number>()\n',
    )
    writeFileSync(
        `${app}/data/addNote.ts`,
        `import { POST, request } from '@abide/abide/server'
import { added } from './lib/added.ts'

export default POST((args: { text: string }) => {
    const key = request().headers.get('idempotency-key') ?? ''
    added.set(key, (added.get(key) ?? 0) + 1)
    return { text: args.text, from: 'server' }
})
`,
    )
    writeFileSync(
        `${app}/data/getAdded.ts`,
        `import { GET } from '@abide/abide/server'
import { added } from './lib/added.ts'

export default GET(() => [...added.values()])
`,
    )
    writeFileSync(
        `${app}/outbox/index.abide`,
        `<script>
import { outbox, reactive } from '@abide/abide'
import addNote from '#src/data/addNote.ts'

let said = reactive('')

async function add() {
    const call = addNote({ text: 'hi' }, { offline: (args) => ({ text: args.text, from: 'device' }) })
    said = JSON.stringify(await call)
}
</script>

<main id="outboxed"><button id="add" onclick={add}>add</button><p id="said">{said}</p><p id="waiting">{outbox().length}</p><p id="kept">{outbox().map((call) => call.value().from + (call.value.synced() ? ' saved' : ' not saved')).join(',')}</p></main>`,
    )
    writeFileSync(
        `${app}/data/getNote.ts`,
        `import { GET } from '@abide/abide/server'

export default GET(() => ({ text: 'a saved note' }))
`,
    )
    writeFileSync(
        `${app}/data/getTags.ts`,
        `import { GET } from '@abide/abide/server'

export default GET(() => ['kept', 'offline'])
`,
    )
    writeFileSync(
        `${app}/note/index.abide`,
        `<script>
import { reactive } from '@abide/abide'
import getNote from '#src/data/getNote.ts'
import getTags from '#src/data/getTags.ts'

const note = reactive(() => getNote())
const tags = getTags()
</script>

<main id="note"><p id="text">{note().text}</p><ul id="tags">{#for tag of tags.ready() ? tags : []}<li>{tag}</li>{/for}</ul></main>`,
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
        '<main id="about"><h1>About</h1><a id="to-home" href="/">home</a><a id="to-tab" href="/about?tab=2">tab</a></main>',
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

// 45.24 — A PAGE REACHED INSIDE THE APP RELOADS OFFLINE, though it was never loaded itself — by a
// click to another route, and by one to another query of the route standing, which asks the server
// nothing. THE REVERT: drop the `reached` call from `Router.follow`; `/about?tab=2` is never saved.
test('a page reached by a click reloads offline — 45.24', async ({
    page,
    context,
}) => {
    const savedHere = () =>
        expect
            .poll(() =>
                page.evaluate(async () => {
                    const saved = await caches.open('abide:saved')
                    return (await saved.match(location.href)) !== undefined
                }),
            )
            .toBe(true)
    await visit(page, '/')
    await page.click('#to-about')
    await expect(page.locator('#about h1')).toHaveText('About')
    await savedHere()
    await page.click('#to-tab')
    await expect(page).toHaveURL(/\?tab=2$/)
    await savedHere()
    await context.setOffline(true)
    try {
        await page.reload()
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

// 45.18, 16.80 — A NETWORK THAT HANGS RATHER THAN FAILS opens a kept page and its data at once: the
// server is stopped, so a connection is accepted and never answered — one bar of signal, which
// `setOffline` cannot stand in for, since it fails a request at once. THE REVERT: drop the
// `life.revalidate` arm from the worker's `answer`; the reload waits on the network, and `#text`
// never shows inside the timeout.
test('a page and its data open at once while the network hangs — 45.18', async ({
    page,
}) => {
    await visit(page, '/')
    await visit(page, '/note', ['/data/getNote'])
    server?.kill('SIGSTOP')
    try {
        await page.reload({ waitUntil: 'commit', timeout: 3_000 })
        await expect(page.locator('#text')).toHaveText('a saved note', {
            timeout: 3_000,
        })
    } finally {
        server?.kill('SIGCONT')
    }
})

// 46.20 — A PAGE WITH NO CALL KEPT OPENS NO DATABASE: the outbox loads with every handler, and reading
// the line there would cost every such page an IndexedDB open and read before it hydrates. THE
// REVERT: drop the `marked()` test from `listen` in `#ui/outboxQueue.ts`; `abide-outbox` is opened.
test('a page with a handler and no call kept opens no outbox database — 46.20', async ({
    page,
}) => {
    await visit(page, '/outbox')
    await expect(page.locator('#waiting')).toHaveText('0')
    const opened = await page.evaluate(async () =>
        (await indexedDB.databases()).map((database) => database.name),
    )
    expect(opened).not.toContain('abide-outbox')
})

// 46.2, 46.7, 46.10, 16.82 — A CALL MADE OFFLINE IS KEPT ACROSS A RELOAD, in the browser's own
// IndexedDB, and delivered once when the network is back: the server counts one send under its key.
// THE REVERT: keep the line in memory alone (`memoryShelf` whatever the browser has); the reload
// shows 0 waiting and the call is never delivered. And 46.18, 46.19 — after the reload the call still
// carries its value, rebuilt from what was kept. THE REVERT: rebuild it in `valueStanding` as
// `reactive(() => settled)`; it reads saved.
test('a call made offline survives a reload and is delivered once online — 46.2, 46.7', async ({
    page,
    context,
}) => {
    await visit(page, '/')
    await visit(page, '/outbox')
    await context.setOffline(true)
    try {
        await page.click('#add')
        await expect(page.locator('#said')).toHaveText(
            JSON.stringify({ text: 'hi', from: 'device' }),
        )
        await expect(page.locator('#waiting')).toHaveText('1')
        await expect(page.locator('#kept')).toHaveText('device not saved')
        await page.reload()
        await expect(page.locator('#waiting')).toHaveText('1')
        // 46.18, 46.19 — no page holds the call's value now, so the outbox rebuilds it.
        await expect(page.locator('#kept')).toHaveText('device not saved')
    } finally {
        await context.setOffline(false)
    }
    await expect(page.locator('#waiting')).toHaveText('0')
    const counts = (await (
        await fetch(`${base}/data/getAdded`)
    ).json()) as number[]
    expect(counts).toEqual([1])
})

// 45.23, 41.30 — A PAGE OPENED FROM ITS KEPT COPY STARTS ITS CALLS EARLY, as the page it was kept from
// did, so it hydrates with its data rather than ahead of it. THE REVERT: drop the `KEEP` header from
// `fromNetwork`'s page request; the kept page carries no early call, and the reload hydrates before
// the note has landed, warning that client and server disagree.
test('a page reopened from its kept copy hydrates with its data — 45.23, 41.30', async ({
    page,
}) => {
    const warned: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('abide:hydrate'))
            warned.push(message.text())
    })
    await visit(page, '/')
    await visit(page, '/note', ['/data/getNote', '/data/getTags'])
    // Kept by the visit above, under the header that has the server write its early calls.
    await page.reload()
    await expect(page.locator('#text')).toHaveText('a saved note')
    await page.reload()
    await expect(page.locator('#text')).toHaveText('a saved note')
    expect(warned).toEqual([])
})
