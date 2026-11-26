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
    const bar = page.locator('[role=menubar][aria-orientation=horizontal]')
    await bar.getByRole('menuitem', { name: 'Deal' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menuitem', { name: 'Board' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(bar.getByRole('menuitem', { name: 'View' })).toBeFocused()
})

// 50.77, 50.79 — A SUBMENU IN A REAL BROWSER: ArrowRight opens it beside its item, ArrowLeft closes it
// back to the item, and a pick in it closes both menus and hands focus to the first button.
test('a submenu opens on ArrowRight, and a pick in it closes every menu — 50.79', async ({
    page,
}) => {
    await page.goto(underMount('headless/menu'), { waitUntil: 'networkidle' })
    const actions = page.getByRole('button', { name: 'Actions' })
    await actions.focus()
    await page.keyboard.press('ArrowDown')
    const opener = page.getByRole('menuitem', { name: 'Move to' })
    await expect(opener).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menuitem', { name: 'Proposal' })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(opener).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(actions).toBeFocused()
    await expect(page.locator('[role=menu]:popover-open')).toHaveCount(0)
})

// 50.77 — DOWN A VERTICAL MENUBAR, ArrowDown walks the bar and ArrowRight opens a menu beside it.
test('a vertical menubar walks on ArrowDown and opens to the right — 50.77', async ({
    page,
}) => {
    await page.goto(underMount('headless/toolbar'), {
        waitUntil: 'networkidle',
    })
    const bar = page.locator('[role=menubar][aria-orientation=vertical]')
    await bar.getByRole('menuitem', { name: 'Deal' }).focus()
    await page.keyboard.press('ArrowDown')
    const view = bar.getByRole('menuitem', { name: 'View' })
    await expect(view).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(
        page.getByRole('menuitem', { name: 'Board' }).last(),
    ).toBeFocused()
    const menuBox = await page.locator('[role=menu]:popover-open').boundingBox()
    const viewBox = await view.boundingBox()
    expect(
        (menuBox?.x ?? 0) >= (viewBox?.x ?? 0) + (viewBox?.width ?? 0) - 1,
    ).toBe(true)
})
