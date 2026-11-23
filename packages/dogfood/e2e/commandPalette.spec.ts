// 51.65, 51.68, 51.69 — THE PALETTE IN A BROWSER: its key opens it over the page with focus in its
// input, Enter runs the command once it has shut, and Escape shuts it — each handing focus back to
// what had it when it opened, which is the native modal's to do and no emulator does.
//
// THE REVERT: swallow Escape in the input (51.69) — the dialog stays open.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a key opens the palette, Enter runs a command, Escape shuts it, and focus comes back — 51.65, 51.68, 51.69', async ({
    page,
}) => {
    await page.goto(underMount('headless/command-palette'), {
        waitUntil: 'networkidle',
    })
    // `mod` as the page reads it (53.3): the project's device names its own platform.
    const mod = (await page.evaluate(() =>
        /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    ))
        ? 'Meta'
        : 'Control'
    const opener = page.getByRole('button', { name: 'Commands' })
    await opener.focus()
    await page.keyboard.press(`${mod}+j`)
    const dialog = page.locator('dialog[aria-label="Jump anywhere"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('new')
    await expect(
        dialog.locator('[role=option] [data-command-palette=label]'),
    ).toHaveText(['Add a deal'])
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(
        page.locator('.result').getByText('Ran: Add a deal.'),
    ).toBeVisible()
    await expect(opener).toBeFocused()

    await page.keyboard.press(`${mod}+j`)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('option')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
})
