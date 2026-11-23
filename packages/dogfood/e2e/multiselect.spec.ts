// 51.98-51.103 — A LIST OR A TREE SELECTING MANY, pressed and clicked in a browser: the keys a real
// browser dispatches, and focus moved by them, which a DOM emulator only stands in for.
//
// THE REVERT: drop the run from Shift with an arrow in `tree` — focus reaches Babbage & Co with Europe
// alone selected.
import { expect, type Page, test } from '@playwright/test'

// The key `mod` is on the platform the page's agent names: ⌘ where it is Apple's, Ctrl elsewhere.
async function modOf(page: Page): Promise<'Meta' | 'Control'> {
    const apple = await page.evaluate(() =>
        /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    )
    return apple ? 'Meta' : 'Control'
}

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a listbox selecting many takes a click, mod, Shift, Space and mod+a — 51.99-51.103', async ({
    page,
}) => {
    await page.goto(underMount('helpers/listbox'), {
        waitUntil: 'networkidle',
    })
    const mod = await modOf(page)
    const list = page.locator('[aria-label="Leads to hand over"]')
    const option = (name: string) =>
        list.locator('[role=option]', { hasText: name })
    const selected = () =>
        list.locator('[aria-selected=true]').allTextContents()
    await option('Acme renewal').click()
    await expect.poll(selected).toEqual(['Acme renewal'])
    await option('Hopper & Co').click({ modifiers: ['Shift'] })
    await expect
        .poll(selected)
        .toEqual(['Acme renewal', 'Engines upgrade', 'Hopper & Co'])
    // Dispatched rather than clicked: a host's Ctrl+click is its context menu on a Mac, whatever agent
    // the page is told it runs under.
    await option('Engines upgrade').dispatchEvent('click', {
        bubbles: true,
        metaKey: mod === 'Meta',
        ctrlKey: mod === 'Control',
    })
    await expect.poll(selected).toEqual(['Acme renewal', 'Hopper & Co'])
    await expect(list).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    await expect.poll(selected).toEqual(['Acme renewal'])
    await page.keyboard.press('Shift+ArrowUp')
    await expect.poll(selected).toEqual(['Engines upgrade', 'Hopper & Co'])
    await page.keyboard.press(`${mod}+a`)
    await expect.poll(selected).toHaveLength(3)
})

test('a tree selecting many keeps focus with the keys as Shift carries the run — 51.98, 51.103', async ({
    page,
}) => {
    await page.goto(underMount('helpers/tree'), { waitUntil: 'networkidle' })
    const mod = await modOf(page)
    const tree = page.locator('[aria-label="Campaign accounts"]')
    await expect(tree).toHaveAttribute('aria-multiselectable', 'true')
    const item = (name: string) =>
        tree.locator('[role=treeitem]', { hasText: name }).last()
    await item('Europe').click()
    await expect(item('Europe')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(item('Babbage & Co')).toBeFocused()
    await expect(tree.locator('[aria-selected=true]')).toHaveCount(3)
    await page.keyboard.press(`${mod}+a`)
    // Every node, the two regions shut or open.
    await expect(tree.locator('[aria-selected=true]')).toHaveCount(5)
})
