// 51.64 — A COMBOBOX'S LIST OPENS IN THE TOP LAYER, so a box that clips its input does not clip the
// list: the list reaches past the box, and the point at an option's center is that option.
//
// THE REVERT: drop `popover` from the popup's binding and its `popover` attribute — the list stays
// in the box's flow, cut off at its bottom edge, and the point lands on what is under the box.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a combobox in a box that clips it opens its list past the box — 51.64', async ({
    page,
}) => {
    await page.goto(underMount('components/combobox'), {
        waitUntil: 'networkidle',
    })
    const input = page.locator('#clipped-name')
    await input.scrollIntoViewIfNeeded()
    await input.click()
    await input.pressSequentially('a')
    const option = page.locator('#clipped-name-listbox [role=option]').last()
    await expect(option).toBeVisible()
    const box = page.locator('#clipped-name').locator('xpath=ancestor::div[2]')
    const clip = (await box.boundingBox()) as { y: number; height: number }
    // The list is placed again before the frame its options grow it in is painted (50.26): read it once it has.
    await expect
        .poll(() =>
            option.evaluate((element) => {
                const at = element.getBoundingClientRect()
                const hit = document.elementFromPoint(
                    at.x + at.width / 2,
                    at.y + at.height / 2,
                )
                return {
                    bottom: at.bottom,
                    hit: hit?.closest('[role=option]') === element,
                }
            }),
        )
        .toEqual({ bottom: expect.any(Number), hit: true })
    const listed = await option.evaluate(
        (element) => element.getBoundingClientRect().bottom,
    )
    expect(listed).toBeGreaterThan(clip.y + clip.height)
})

// 51.99 — ONE PRESS IS ONE GESTURE: the mousedown that focuses the field and the click that follows
// open the list once, and a second press shuts it. THE REVERT: open on the input's mousedown as well as
// toggling on its click — the click shuts what the mousedown opened, and the list never shows.
test('a press on the field opens its list once, and a second press shuts it — 51.99', async ({
    page,
}) => {
    await page.goto(underMount('components/combobox'), {
        waitUntil: 'networkidle',
    })
    const input = page.locator('#deal-team')
    await input.scrollIntoViewIfNeeded()
    const options = page.locator('#deal-team-listbox [role=option]')
    await input.click()
    await expect(options).toHaveCount(3)
    await page.waitForTimeout(200)
    await expect(options).toHaveCount(3)
    await expect(input).toBeFocused()
    await input.click()
    await expect(options).toHaveCount(0)
})
