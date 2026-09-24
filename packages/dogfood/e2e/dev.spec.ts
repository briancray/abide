// 38.4 AND 38.16 IN A BROWSER — the loop `abide dev` exists for: a file is saved and the tab a
// reader has open shows the new app. The bun-side tests in `packages/abide/tests/dev.test.ts`
// assert everything up to the socket; what they cannot see is the RELOAD, which is a client
// holding a socket open, the listener force-closing it, and the page coming back by itself.
//
// THE DEV SERVER IS THIS SPEC'S OWN. The config's `webServer` runs `abide start` for every other
// spec, and a second one here would be two servers over one tree — so this spawns `abide dev`
// on a socket of its own and kills it afterwards.

import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
const BIN = `${REPO}packages/abide/bin/abide.ts`
const ROOT = `${REPO}packages/dogfood/src`
// A file an author WROTE rather than one the generator owns, and one every page carries: a
// marker in the nav is visible from whatever address the browser is standing on.
const NAV = `${ROOT}/ui/components/DocsNav.abide`

let dev: ChildProcess | undefined
let base = ''
let original = ''

// ONE PROJECT RUNS IT. Every project over this directory would spawn a dev server of its own
// and EDIT THE SAME FILE to provoke a reload, which is two writers on one tree — and the second
// answers a question the first already did, since the address here is this spec's own rather
// than the project's base.
//
// SKIPPED IN `beforeAll`, not `beforeEach`: a `beforeAll` runs before the first `beforeEach` does,
// so a skip there still spawned the second dev server and read `NAV` — and its `afterAll` wrote
// that reading back, which is the marked file if `root` had saved it by then.
// biome-ignore lint/correctness/noEmptyPattern: playwright refuses a first parameter that is not a destructuring pattern, and this hook reads only the second.
test.beforeAll(async ({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'root', 'one dev server is enough')
    original = readFileSync(NAV, 'utf8')
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
    writeFileSync(NAV, original)
    dev.kill()
})

// THE REVERT: drop the socket terminate from `serveDev`'s `replace`, and this waits out its
// timeout on a page that is serving the old markup with nothing to tell it so.
test('a save reloads the tab a reader has open — 38.4, 38.16', async ({
    page,
}) => {
    await page.goto(`${base}/values/show-a-value-that-changes`)
    await expect(page.locator('main h1')).toHaveText(
        'Show a value that changes',
    )
    // A marker the reload erases, so what is asserted is a new DOCUMENT rather than a patched
    // one — the reload client asks for the page again and nothing survives that.
    await page.evaluate(() => {
        ;(window as { __BEFORE__?: string }).__BEFORE__ = 'yes'
    })

    writeFileSync(
        NAV,
        original.replace('abide<span>docs</span>', 'abide<span>SAVED</span>'),
    )

    await expect(page.locator('nav .brand')).toHaveText('abideSAVED', {
        timeout: 30_000,
    })
    expect(
        await page.evaluate(
            () => (window as { __BEFORE__?: string }).__BEFORE__,
        ),
    ).toBeUndefined()

    // AND BACK. The loop is not one-way: the next save reaches the same tab, which is what an
    // author actually does with it.
    writeFileSync(NAV, original)
    await expect(page.locator('nav .brand')).toHaveText('abidedocs', {
        timeout: 30_000,
    })
})
