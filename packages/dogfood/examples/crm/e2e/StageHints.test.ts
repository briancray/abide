import { expect, test } from '@playwright/test'

// THE REVERT: open on every `focusin`, and the click opens the hint at once rather than after the
// hover delay.
test('a click on a stage leaves its hint to the hover delay, and a key into it opens it', async ({
    page,
}) => {
    await page.goto('pipeline', { waitUntil: 'networkidle' })
    const proposal = page.locator('span[aria-description]', {
        hasText: /^proposal$/,
    })
    const opened = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('[role=tooltip]:popover-open')].map(
                (each) => each.textContent,
            ),
        )
    await proposal.click()
    // Read once, well inside the 300 ms delay: only the click's focus could have opened it.
    expect(await opened()).toEqual([])
    await expect(proposal).toBeFocused()
    await page.mouse.move(0, 0)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(proposal).toBeFocused()
    // 50.36 — one popover, however many `Tooltips` the page stands: the docs' and the example's.
    expect(await opened()).toEqual([
        'proposalA quote is out, waiting on an answer.',
    ])
})
