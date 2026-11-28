// 51.202 — A SELECT'S LIST OPENS IN THE TOP LAYER, and a press on an option picks it without taking
// focus from the trigger, so the keys go on working where the pointer left off.
//
// THE REVERT: drop the popup's `onmousedown` — the press focuses the option's list, the trigger
// blurs, the list shuts before the click lands, and nothing is picked.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a press on an option picks it and focus stays on the trigger — 51.202', async ({
    page,
}) => {
    await page.goto(underMount('headless/select'), {
        waitUntil: 'networkidle',
    })
    const trigger = page.locator('#stage')
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    const popup = page.locator('#stage-listbox').locator('xpath=..')
    await expect(popup).toBeVisible()
    expect(
        await popup.evaluate((element) => element.matches(':popover-open')),
    ).toBe(true)
    await page
        .locator('#stage-listbox [role=option]', { hasText: /^proposal$/ })
        .click()
    await expect(page.locator('#stage-listbox')).toHaveCount(0)
    await expect(trigger).toHaveText(/^\s*proposal\s*$/)
    expect(
        await trigger.evaluate((element) => document.activeElement === element),
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect(
        page.locator('#stage-listbox [role=option][data-active]'),
    ).toHaveText('proposal')
})
