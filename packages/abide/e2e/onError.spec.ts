// 37.16, 37.17 IN A REAL BROWSER, against `abide start`: a layout's `onError` hears what nothing on
// the page caught — a call's refusal no handler awaited or caught, and an effect's throw — once
// each, and does not hear what the page caught. Only a browser says what an unhandled rejection
// and an uncaught throw are, so only one can say the hook hears exactly those.

import { expect, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

// ONE TREE AND ONE WORKER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const HANDLER = `import { POST, refuse } from '@abide/abide/server'

export default POST(() => {
    throw refuse(409, 'already taken')
})
`

const ANSWERED = `import { POST } from '@abide/abide/server'

export default POST(() => ({ answered: true }))
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
import answer from '#src/data/answer.handler.ts'
import claim from '#src/data/claim.handler.ts'

let broken = reactive(false)
let saving = reactive<typeof claim | typeof answer>()
let caught = reactive('')
watch(() => {
    if (broken) throw new Error('effect broke')
})

async function claimUncaught() {
    await claim()
}

function claimKept() {
    saving = claim()
    saving.then(() => {})
}

function answerThrows() {
    saving = answer()
    saving.then(() => {
        throw new Error('follow-up broke')
    })
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
<button id="kept" onclick={claimKept}>claim, kept</button>
<button id="follow-up" onclick={answerThrows}>answer, then throw</button>
<p id="caught-said">{caught}</p>
<p id="kept-said">{saving.error()?.message ?? ''}</p>
</main>`

let server: Subprocess | undefined
let base = ''

test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-on-error-${testInfo.project.name}`,
        {
            'data/claim.handler.ts': HANDLER,
            'data/answer.handler.ts': ANSWERED,
            'claims/layout.abide': LAYOUT,
            'claims/index.abide': PAGE,
        },
    ))
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

// 2.15 — A KEPT CALL'S REFUSAL IS ON `error`, NOT AN UNHANDLED REJECTION, where the page's `then` had no
// `onFailed`. Read in both engines, since what it rests on is when each reports a rejection: after the
// microtask checkpoint the handler is attached in. THE REVERT: drop the `onFailed === undefined` arm
// from `then` in `Reactive.ts`, and the list reads `already taken` once per press.
test('a kept call refused under then(onDone) stays on error, and onError hears nothing — 2.15', async ({
    page,
}) => {
    await page.goto(`${base}/claims`)
    await pressUntil(
        page,
        '#kept',
        async () => (await page.textContent('#kept-said')) === 'already taken',
    )
    await page.waitForTimeout(100)
    await expect(page.locator('#heard li')).toHaveCount(0)
})

// THE CONTROL beside the test above: what 2.15 leaves alone is a throw from the follow-up, which is
// still reported — so the test above cannot pass on a `then` that swallows everything.
test('a follow-up that throws under then(onDone) reaches onError — 2.15, 37.17', async ({
    page,
}) => {
    await page.goto(`${base}/claims`)
    const items = page.locator('#heard li')
    await pressUntil(page, '#follow-up', async () => (await items.count()) > 0)
    for (const said of await items.allTextContents())
        expect(said).toBe('follow-up broke')
})
