import { expect, test } from '@playwright/test'

// THE REVERT: open on every `focusin`, and the click opens the hint at once rather than after the
// hover delay.
test('a click on a stage leaves its hint to the hover delay, and a key into it opens it', async ({
    page,
}) => {
    await page.goto('pipeline', { waitUntil: 'networkidle' })
    const proposal = page.locator('span[aria-describedby]', {
        hasText: /^proposal$/,
    })
    const opened = () =>
        proposal.evaluate((anchor) =>
            document
                .getElementById(anchor.getAttribute('aria-describedby') ?? '')
                ?.matches(':popover-open'),
        )
    await proposal.click()
    // Read once, well inside the 300 ms delay: only the click's focus could have opened it.
    expect(await opened()).toBe(false)
    await expect(proposal).toBeFocused()
    await page.mouse.move(0, 0)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(proposal).toBeFocused()
    expect(await opened()).toBe(true)
})
