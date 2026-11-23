import { expect, test } from '@playwright/test'

// Setup draws the menu's id again at hydration (41.6), and both attributes are bound to it, so the
// two are rewritten together rather than left at the server's.
test('the trigger names the menu it controls once the page hydrates', async ({
    page,
}) => {
    await page.goto('deals', { waitUntil: 'networkidle' })
    const trigger = page.locator('[aria-haspopup=menu]').first()
    const controls = await trigger.getAttribute('aria-controls')
    await trigger.click()
    await expect(page.locator(`#${controls}`)).toHaveAttribute('role', 'menu')
    await expect(page.locator(`#${controls}`)).toBeVisible()
})

// THE REVERT: drop the rule in `crm.css` hiding a closed menu, and its `display` keeps the menu on
// the page shut — before it opens, after a pick, and after Escape.
test('a closed menu is hidden, before it opens and however it closes', async ({
    page,
}) => {
    await page.goto('deals', { waitUntil: 'networkidle' })
    const trigger = page.locator('[aria-haspopup=menu]').first()
    const menu = page.locator(`#${await trigger.getAttribute('aria-controls')}`)
    await expect(menu).toBeHidden()
    await trigger.click()
    await expect(menu).toBeVisible()
    await menu.locator('[role=menuitem]:not([disabled])').first().click()
    await expect(menu).toBeHidden()
    await trigger.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
})
