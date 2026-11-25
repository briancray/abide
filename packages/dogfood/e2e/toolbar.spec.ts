// 51.186, 51.187 — ONE TAB STOP IN A REAL BROWSER: Tab enters the toolbar at one control and leaves
// it at the next, and Shift+Tab comes back to the control focused last. A DOM emulator moves no
// focus on Tab, so this is where the tab order itself is read.
//
// THE REVERT: leave every item's `tabindex` alone in `toolbar`, and Tab from `Bold` reaches `Italic`.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('Tab reaches the toolbar once, at the control focused last — 51.186', async ({
    page,
}) => {
    await page.goto(underMount('headless/toolbar'), {
        waitUntil: 'networkidle',
    })
    const bar = page.getByRole('toolbar', { name: 'Note formatting' })
    const bold = bar.getByRole('button', { name: 'Bold' })
    const italic = bar.getByRole('button', { name: 'Italic' })
    await bold.focus()
    await page.keyboard.press('ArrowRight')
    await expect(italic).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(bar.locator(':focus')).toHaveCount(0)
    await page.keyboard.press('Shift+Tab')
    await expect(italic).toBeFocused()
})

test('a menubar opens a menu on ArrowDown and switches menus on ArrowRight — 50.57', async ({
    page,
}) => {
    await page.goto(underMount('headless/toolbar'), {
        waitUntil: 'networkidle',
    })
    const bar = page.getByRole('menubar', { name: 'Deal' })
    await bar.getByRole('menuitem', { name: 'Deal' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menuitem', { name: 'Board' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(bar.getByRole('menuitem', { name: 'View' })).toBeFocused()
})
