// 51.88 — A THUMB PRESSED KEEPS FOCUS, so the keys step the thumb the pointer just moved: the
// press's own focusing would put focus back on the page, a track being nothing that takes it.
//
// THE REVERT: drop the `preventDefault` from `slider`'s press, and the arrows after a drag step nothing.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test('a thumb dragged takes the keys after it — 51.88', async ({ page }) => {
    await page.goto(underMount('headless/slider'), {
        waitUntil: 'networkidle',
    })
    // The first example of two thumbs: the page opens on one thumb.
    const frame = page
        .locator('.result')
        .filter({ has: page.locator('[data-thumb=high]') })
        .first()
    await frame.scrollIntoViewIfNeeded()
    const track = frame.locator('[data-slider=track]')
    const box = (await track.boundingBox()) as NonNullable<
        Awaited<ReturnType<typeof track.boundingBox>>
    >
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * 0.75, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 })
    await page.mouse.up()
    await expect(frame.locator('p')).toHaveText('20 to 60')
    await page.keyboard.press('ArrowLeft')
    await expect(frame.locator('p')).toHaveText('20 to 59')
})
