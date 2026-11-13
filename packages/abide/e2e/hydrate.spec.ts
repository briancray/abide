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
    // Lands a microtask after it starts, inside the turn a render lets run after setup (41.19).
    whoami: `import { GET } from '@abide/abide/server'

export default GET(async () => {
    await Promise.resolve()
    return { owner: true }
})
`,
}

// 41.34 — A MODULE'S VALUE WHOSE BUILD MAKES A CALL, read by the page's own markup and by a child
// whose setup makes a call, which 41.28 builds after the turn.
const MODULE_VALUE = {
    'lib/me.ts': `import { reactive } from '@abide/abide'
import whoami from '#src/data/whoami.handler.ts'

export const me = reactive(() => whoami())
`,
    'lib/canEdit.ts': `import { reactive } from '@abide/abide'
import { me } from './me.ts'

export const canEdit = reactive(() => me.ready() && me().owner)
`,
    'lib/Deferred.abide': `<script>
import { reactive } from '@abide/abide'
import getValue from '#src/data/getValue.handler.ts'
import { canEdit } from './canEdit.ts'

const value = reactive(() => getValue({ id: 'deferred' }))
</script>

<p id="deferred">{#if canEdit()}<b>edit</b>{:else}<i>view</i>{/if}{value.busy() ? '' : value().word}</p>`,
    'owner/index.abide': `<script>
import Deferred from '../lib/Deferred.abide'
import { canEdit } from '../lib/canEdit.ts'
</script>

<main><p id="inline">{#if canEdit()}<b>edit</b>{:else}<i>view</i>{/if}</p><Deferred /></main>`,
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
        ...MODULE_VALUE,
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

// 41.34 — ONE ANSWER FOR A MODULE'S VALUE ACROSS THE PAGE, so the browser, which built it at import,
// adopts every region that reads it. THE REVERT: drop the `buildFiledLoads()` line from
// `composePage`. The server paints the inline region `view` and the deferred child `edit`, and
// hydration rebuilds the region that disagrees with the browser's answer: 1 warning, against 0.
test("a module's value whose build makes a call hydrates with no region rebuilt — 41.34", async ({
    page,
}) => {
    const warned = hydrateWarnings(page)
    await page.goto(`${base}/owner`)
    await expect(page.locator('#inline b')).toHaveText('edit')
    await expect(page.locator('#deferred b')).toHaveText('edit')
    await page.waitForLoadState('networkidle')
    expect(warned).toEqual([])
})
