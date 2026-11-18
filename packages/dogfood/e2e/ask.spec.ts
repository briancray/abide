// THE PROMPT AT THE TOP OF EVERY PAGE (`Ask.abide`), as a reader meets it unpaired: its key, the
// label the server wrote for that key, and the pairing `Pairing` shows in its panel.

import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return new URL(base).pathname.replace(/\/$/, '') + address
}

// 53.3, 53.11 — the label is the platform's and the key is the one it names. THE REVERT: bind
// `meta+k` in place of `mod+k`, and Ctrl+K on this Linux-agented page focuses nothing.
test('the prompt’s key is the one its label names, and its panel pairs — 53.42', async ({
    browser,
}) => {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    })
    const page = await context.newPage()
    await page.goto(underMount('/reactive/reactive'), {
        waitUntil: 'networkidle',
    })
    await expect(page.locator('.ask kbd')).toHaveText('Ctrl+K')
    await page.locator('main').click()
    await page.keyboard.press('Control+k')
    await expect(page.locator('#ask')).toBeFocused()
    const pairing = page.locator('.answers [data-step]')
    await expect(pairing).toHaveAttribute('data-step', 'click')
    await expect(pairing.locator('[data-part=command]')).toContainText(
        'bunx @abide/bridge@',
    )
    await expect(pairing.locator('[data-part=pair]')).toHaveText(
        'Pair with a click',
    )
    await context.close()
})
