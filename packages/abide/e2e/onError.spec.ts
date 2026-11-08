// 37.16, 37.17 IN A REAL BROWSER, against `abide start`: a layout's `onError` hears what nothing on
// the page caught — a call's refusal no handler awaited or caught, and an effect's throw — once
// each, and does not hear what the page caught. Only a browser says what an unhandled rejection
// and an uncaught throw are, so only one can say the hook hears exactly those.
//
// `node:child_process` rather than `Bun.spawn`: playwright runs on node.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

// ONE TREE AND ONE WORKER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const HANDLER = `import { POST, refuse } from '@abide/abide/server'

export default POST(() => {
    throw refuse(409, 'already taken')
})
`

// What the layout's hook hears, painted in a list the test reads.
const LAYOUT = `<script>
import { onError, reactive } from '@abide/abide'

let heard = reactive<string[]>([])
onError((error) => {
    heard = [...heard, error instanceof Error ? error.message : String(error)]
})
</script>

<ol id="heard">{#for message of heard}<li>{message}</li>{/for}</ol>
<slot />`

const PAGE = `<script>
import { reactive, watch } from '@abide/abide'
import claim from '#src/data/claim.handler.ts'

let broken = reactive(false)
let caught = reactive('')
watch(() => {
    if (broken) throw new Error('effect broke')
})

async function claimUncaught() {
    await claim()
}

async function claimCaught() {
    try {
        await claim()
    } catch (error) {
        caught = claim.isError(error, 'HttpError') ? 'handled' : 'other'
    }
}
</script>

<main>
<button id="uncaught" onclick={claimUncaught}>claim</button>
<button id="caught" onclick={claimCaught}>claim, caught</button>
<button id="break" onclick={() => (broken = true)}>break</button>
<p id="caught-said">{caught}</p>
</main>`

let server: ChildProcess | undefined
let base = ''

test.beforeAll(async ({}, testInfo) => {
    const app = join(
        REPO,
        `.test-modules/e2e-on-error-${testInfo.project.name}`,
    )
    rmSync(app, { recursive: true, force: true })
    mkdirSync(`${app}/data`, { recursive: true })
    mkdirSync(`${app}/claims`, { recursive: true })
    writeFileSync(
        `${app}/package.json`,
        JSON.stringify({
            name: 'on-error-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
    )
    writeFileSync(`${app}/data/claim.handler.ts`, HANDLER)
    writeFileSync(`${app}/claims/layout.abide`, LAYOUT)
    writeFileSync(`${app}/claims/index.abide`, PAGE)
    const cli = join(REPO, 'packages/abide/bin/abide.ts')
    execFileSync(
        'bun',
        [cli, 'build', '--root', app, '--out', `${app}/.abide`],
        { cwd: REPO, encoding: 'utf8' },
    )
    const started = spawn(
        'bun',
        [cli, 'start', '--root', app, '--out', `${app}/.abide`, '--port', '0'],
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

// Pressed until the press is heard: one before hydration lands on markup with no handler.
async function pressUntil(
    page: import('@playwright/test').Page,
    selector: string,
    heard: () => Promise<boolean>,
): Promise<void> {
    for (let tries = 0; tries < 100 && !(await heard()); tries += 1) {
        await page.click(selector)
        await page.waitForTimeout(50)
    }
}

// THE REVERT: drop the `unhandledrejection` listener in `onError.ts`, and the list stays empty —
// the refusal reaches the console and nothing else.
test('a refusal nothing caught reaches the layout onError — 37.17', async ({
    page,
}) => {
    await page.goto(`${base}/claims`)
    const items = page.locator('#heard li')
    await pressUntil(page, '#uncaught', async () => (await items.count()) > 0)
    // A loaded machine can land a second press while the first call is on the wire, and each is a
    // refusal of its own — so every entry is read, not their count.
    await expect(items.first()).toHaveText('already taken')
    for (const said of await items.allTextContents())
        expect(said).toBe('already taken')
})

// THE CONTROL beside the test above: nothing in `onError.ts` stands for a caught refusal — the
// browser does not raise `unhandledrejection` for one — so there is no line to revert, and this is
// what keeps the first from passing on a hook that hears every call.
test('a refusal the page caught does not reach onError — 37.17', async ({
    page,
}) => {
    await page.goto(`${base}/claims`)
    await pressUntil(
        page,
        '#caught',
        async () => (await page.textContent('#caught-said')) === 'handled',
    )
    await page.waitForTimeout(100)
    await expect(page.locator('#heard li')).toHaveCount(0)
})

// 12.6 hands the throw through `UNEXPECTED`, and 12.7 then surfaces it from the drain as uncaught.
//
// THE REVERT: hand every `surfaced` error on without reading `SURFACING`, and the list reads
// `effect broke` twice.
test('an effect that threw reaches onError once — 12.6, 12.7, 37.17', async ({
    page,
}) => {
    await page.goto(`${base}/claims`)
    const items = page.locator('#heard li')
    await pressUntil(page, '#break', async () => (await items.count()) > 0)
    await page.waitForTimeout(100)
    await expect(items).toHaveText(['effect broke'])
})
