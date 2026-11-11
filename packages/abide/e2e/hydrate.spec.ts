// 41.24-41.27 IN A REAL BROWSER, against `abide start`. What the server painted and what the
// browser's setup reads race: the bundle and the page's early calls (41.20) are on the wire at once,
// and which lands first decides whether a value is settled or in flight where the page adopts. Only
// a browser with a real network races them, so only one can say the page adopted the arm it shows.

import { expect, type Page, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

// ONE TREE AND ONE WORKER PER PROJECT, for `routing.spec.ts`'s reason: this file runs in both
// engines at once, and two tests of one project would each build into one tree.
test.describe.configure({ mode: 'default' })

// One handler file apiece (16.73), so each page imports its own as the file's default (16.74).
const HANDLERS = {
    getValue: `import { GET } from '@abide/abide/server'

export default GET(({ id }: { id: string }) => ({ id, word: 'settled' }))
`,
    // Slower than the render's turn, so the server paints it in flight (41.4).
    getSlow: `import { GET } from '@abide/abide/server'

export default GET(async ({ id }: { id: string }) => {
    await new Promise((done) => setTimeout(done, 100))
    return { id, word: 'settled' }
})
`,
}

// EACH ARM'S BUTTON HAS A HANDLER OF ITS OWN, and the two are one element apiece, so no walk can
// refuse an arm bound to the other's nodes (41.10). What witnesses it is the handler a click runs,
// and the static `class` — the one thing an arm bound to the other's button never writes.
const pageOver = (handler: string) => `<script>
import { reactive } from '@abide/abide'
import ${handler} from '#src/data/${handler}.handler.ts'

const value = reactive(() => ${handler}({ id: 'one' }))
const pressed = reactive('')
</script>

<main>{#if value.busy()}<button id="act" class="cancel" onclick={() => pressed.set('cancel')}>cancel</button>{:else}<button id="act" class="buy" onclick={() => pressed.set('buy')}>buy {value().word}</button>{/if}<p id="pressed">{pressed()}</p></main>`

let server: Subprocess | undefined
let base = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    const files: Record<string, string> = {
        'armed/index.abide': pageOver('getValue'),
        'slow/index.abide': pageOver('getSlow'),
    }
    for (const [name, text] of Object.entries(HANDLERS))
        files[`data/${name}.handler.ts`] = text
    ;({ base, server } = await servedFixture(
        `e2e-hydrate-${testInfo.project.name}`,
        files,
    ))
})

test.afterAll(() => {
    server?.kill()
})

/** Every `abide:hydrate` line the page logs. */
function hydrateWarnings(page: Page): string[] {
    const said: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('abide:hydrate')) said.push(message.text())
    })
    return said
}

// 41.25 — A VALUE PAINTED SETTLED IS SETTLED WHERE THE PAGE ADOPTS, however late its early call
// answers. The call is held 400 ms and the bundle is not, so the bundle wins the race. The button is
// pressed until a press does something, and the FIRST press that does is the one read: a press
// before hydration lands on markup with no handler, and one after it runs whichever arm was bound.
//
// THE REVERT: have `Router.hydrate` not wait on `paintedCallsLanded()`. The client adopts with the
// value in flight and the first press that does anything runs `cancel` — the loading arm's handler,
// filled in by 41.24 where, with that reverted too, it is bound to the painted `buy` button.
test('a value painted settled is settled where the page adopts — 41.25', async ({
    page,
}) => {
    const warned = hydrateWarnings(page)
    await page.route('**/data/**', async (route) => {
        await new Promise((done) => setTimeout(done, 400))
        await route.continue()
    })
    await page.goto(`${base}/armed`)
    let pressed = ''
    for (let tries = 0; tries < 300 && pressed === ''; tries += 1) {
        await page.click('#act')
        pressed = (await page.textContent('#pressed')) ?? ''
    }
    expect(pressed).toBe('buy')
    expect(await page.getAttribute('#act', 'class')).toBe('buy')
    expect(warned).toEqual([])
})

// 41.27 — A VALUE PAINTED IN FLIGHT IS IN FLIGHT WHERE THE PAGE ADOPTS, however early its call
// answers. The bundle is held 400 ms, so the early call has answered before setup reads it: the
// page adopts the `cancel` arm it was painted with, and the answer then swaps it as any answer
// does — no arm adopted over another's nodes, and so nothing to warn about.
//
// THE REVERT: settle every early answer that has arrived at once in `wire`. The client chooses
// `buy` over the painted `cancel` and 41.24 fills it, warning. With 41.24 reverted as well, the `buy`
// arm binds its handler and its text to the painted button, which keeps `class="cancel"`.
test('a value painted in flight is in flight where the page adopts — 41.27', async ({
    page,
}) => {
    const warned = hydrateWarnings(page)
    await page.route('**/__abide/client/**', async (route) => {
        await new Promise((done) => setTimeout(done, 400))
        await route.continue()
    })
    await page.goto(`${base}/slow`)
    await expect(page.locator('#act')).toHaveText('buy settled')
    await page.click('#act')
    await expect.poll(() => page.textContent('#pressed')).toBe('buy')
    expect(await page.getAttribute('#act', 'class')).toBe('buy')
    expect(warned).toEqual([])
})
