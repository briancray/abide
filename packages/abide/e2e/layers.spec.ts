// 50.25, 53.14, 53.15 IN A REAL BROWSER, against `abide start`: an Escape closes ONE layer, the
// innermost — and a native `<dialog>` cancels only on an Escape no layer took. The emulator has no
// close request for a `<dialog>` to cancel on, so only a browser can say whether a layer's
// `preventDefault` kept the dialog open — in both engines, since each ships its own.

import { expect, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

// ONE TREE AND ONE SERVER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const LAYOUT = `<script>
import Tooltips from '@abide/abide/Tooltips.abide'
</script>

<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
    <Tooltips />
</body>
</html>`

const PAGE = `<script>
import { tooltip } from '@abide/abide'

let dialog: HTMLDialogElement | undefined
</script>

<button id="open" onclick={() => dialog?.showModal()}>Open</button>
<dialog bind:element={(element) => { dialog = element as HTMLDialogElement }}>
    <button id="hinted" bind:element={tooltip('Saves the deal', { trigger: 'bound' })}>Save</button>
</dialog>`

let server: Subprocess | undefined
let base = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-layers-${testInfo.project.name}`,
        {
            'layout.abide': LAYOUT,
            'index.abide': PAGE,
        },
    ))
})

test.afterAll(() => {
    server?.kill()
})

// THE REVERT: close the hint from a `keydown` listener of its own on the document, as `tooltip` did —
// the first Escape closes the hint and cancels the dialog with it.
test('an Escape closes the hint over a dialog, and the next the dialog — 50.25, 53.15', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    await page.click('#open')
    const dialog = page.locator('dialog')
    const tip = page.locator('[role=tooltip]')
    await expect(dialog).toHaveJSProperty('open', true)
    await expect(tip).toHaveText('Saves the deal')
    await page.keyboard.press('Escape')
    await expect(tip).not.toHaveAttribute('data-open', '')
    await expect(dialog).toHaveJSProperty('open', true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveJSProperty('open', false)
})
