// 51.58, 51.59, 51.64, 51.95, 51.96, 51.166 — A GRID MEASURED IN A REAL BROWSER: the docs' deal grid lays its
// items out with CSS alone, and `virtualList` makes only the rows in view, derives how many a row holds
// from the layout, and jumps by letter. The emulator lays nothing out, so this is where layout is real.
//
// THE REVERT: take one item a row whatever the host's width, and the grid makes a column's worth of
// items, packed by CSS into a few rows that leave the rest of the view empty.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a grid of three thousand deals makes only the rows in view, and jumps by letter — 51.58, 51.59, 51.64, 51.95, 51.96, 51.166', async ({
    page,
}) => {
    await page.goto(underMount('headless/virtual-list'), {
        waitUntil: 'networkidle',
    })
    const frame = page.locator('.result').nth(1)
    await frame.scrollIntoViewIfNeeded()
    const items = frame.locator('[data-index]')
    // Measured: a screenful of rows, each holding what fits across the grid.
    await expect.poll(async () => await items.count()).toBeLessThan(200)
    const made = await items.count()
    expect(made).toBeGreaterThan(6)
    const tops = await items.evaluateAll((each) =>
        each.slice(0, 2).map((item) => item.getBoundingClientRect().top),
    )
    // The first two items share a row: the grid's columns, not one a row.
    expect(tops[0]).toBe(tops[1])
    const scroller = frame.locator('.overflow-auto')
    // What is made fills the view: as many items as its rows of columns hold, not one a row.
    const covered = await scroller.evaluate((element) => {
        const bottom = element.getBoundingClientRect().bottom
        const made = [...element.querySelectorAll('[data-index]')]
        const last = made.at(-1)?.getBoundingClientRect().bottom ?? 0
        return last >= bottom
    })
    expect(covered).toBe(true)
    // A jump to D brings the first D deal to the top, and marks D current.
    await frame.getByRole('button', { name: 'D', exact: true }).click()
    await expect(
        frame.getByRole('button', { name: 'D', exact: true }),
    ).toHaveAttribute('aria-current', 'true')
    const firstInView = await scroller.evaluate((element) => {
        const top = element.getBoundingClientRect().top
        for (const item of element.querySelectorAll('[data-index]'))
            if (item.getBoundingClientRect().bottom > top + 1)
                return item.textContent ?? ''
        return ''
    })
    expect(firstInView.startsWith('D')).toBe(true)
    // G has no deal, and its jump is disabled.
    await expect(
        frame.getByRole('button', { name: 'G', exact: true }),
    ).toBeDisabled()
})
