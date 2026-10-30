// 38.4 AND 38.15 IN A BROWSER — the loop `abide dev` exists for: a file is saved and the tab a
// reader has open shows the new app. The bun-side tests in `packages/abide/tests/dev.test.ts`
// assert everything up to the socket; what they cannot see is the RELOAD, which is a client
// holding a socket open, the listener force-closing it, and the page coming back by itself.
//
// THE DEV SERVER IS THIS SPEC'S OWN. The config's `webServer` runs `abide start` for every other
// spec, and a second one here would be two servers over one tree — so this spawns `abide dev`
// on a socket of its own and kills it afterwards.
//
// OVER A COPY OF THE APP, not the app. A save to the docs' own tree reloads every `abide dev`
// watching it — the reader's `bun run dev` included, whose Tests page is what runs this spec, so
// the page it reported to reloaded out from under the run. The copy sits as deep in the repo as
// the app does, so its tsconfig's `extends` and every workspace import resolve the same.

import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
const BIN = `${REPO}packages/abide/bin/abide.ts`
const APP = `${REPO}packages/dogfood`
const COPY = `${REPO}.test-modules/dogfood-dev`
const ROOT = `${COPY}/src`
// A file every page carries: a marker in the nav is visible from whatever address the browser is
// standing on.
const BAR = `${ROOT}/lib/SiteBar.abide`

let dev: ChildProcess | undefined
let base = ''
let original = ''

// ONE PROJECT RUNS IT. Every project over this directory would spawn a dev server of its own
// and EDIT THE SAME FILE to provoke a reload, which is two writers on one tree — and the second
// answers a question the first already did, since the address here is this spec's own rather
// than the project's base.
//
// SKIPPED IN `beforeAll`, not `beforeEach`: a `beforeAll` runs before the first `beforeEach` does,
// so a skip there still spawned the second dev server — over a copy made fresh in the directory
// `root`'s was being served from.
// Playwright refuses a first parameter that is not a destructuring pattern, and this hook reads only the second.
test.beforeAll(async ({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'root', 'one dev server is enough')
    rmSync(COPY, { recursive: true, force: true })
    mkdirSync(COPY, { recursive: true })
    for (const kept of [
        'package.json',
        'tsconfig.json',
        'bunfig.toml',
        '.env',
        'src',
    ])
        cpSync(`${APP}/${kept}`, `${COPY}/${kept}`, { recursive: true })
    original = readFileSync(BAR, 'utf8')
    dev = spawn('bun', [BIN, 'dev', '--root', ROOT, '--port', '0'], {
        cwd: REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    base = await new Promise<string>((resolve, reject) => {
        let seen = ''
        dev?.stdout?.on('data', (chunk: Buffer) => {
            seen += chunk.toString()
            const found = /http:\/\/[^\s]+/.exec(seen)
            if (found) resolve(new URL(found[0]).origin)
        })
        dev?.on('exit', (code) => {
            reject(new Error(`abide dev exited with ${code}: ${seen}`))
        })
    })
})

test.afterAll(() => {
    if (dev === undefined) return
    dev.kill()
    rmSync(COPY, { recursive: true, force: true })
})

// THE REVERT: drop the socket terminate from `serveDev`'s `replace`, and this waits out its
// timeout on a page that is serving the old markup with nothing to tell it so.
test('a save reloads the tab a reader has open — 38.4, 38.15', async ({
    page,
}) => {
    await page.goto(`${base}/guide/edit-a-contact`)
    await expect(page.locator('main h1')).toHaveText('Edit a contact')
    // A marker the reload erases, so what is asserted is a new DOCUMENT rather than a patched
    // one — the reload client asks for the page again and nothing survives that.
    await page.evaluate(() => {
        ;(window as { __BEFORE__?: string }).__BEFORE__ = 'yes'
    })

    writeFileSync(
        BAR,
        original.replace('abide<span>docs</span>', 'abide<span>SAVED</span>'),
    )

    await expect(page.locator('.site .brand')).toHaveText('abideSAVED', {
        timeout: 30_000,
    })
    expect(
        await page.evaluate(
            () => (window as { __BEFORE__?: string }).__BEFORE__,
        ),
    ).toBeUndefined()

    // AND BACK. The loop is not one-way: the next save reaches the same tab, which is what an
    // author actually does with it.
    writeFileSync(BAR, original)
    await expect(page.locator('.site .brand')).toHaveText('abidedocs', {
        timeout: 30_000,
    })
})
