// 50.48 — A HINT NEVER TAKES THE POINTER: a chart's readout opens beside its crosshair, often right
// under the pointer, and a readout the pointer could land on is a `pointerleave` on the chart that
// closes it, a `pointerenter` that opens it again, and a flicker for as long as the pointer moves.
//
// THE REVERT: drop the `pointer-events` the `Tooltips` writes, and the chart reads a leave and an enter
// per pixel the pointer moves.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test("a pointer moving under a chart's readout keeps it open — 50.48", async ({
    page,
}) => {
    await page.goto(underMount('components/chart'), {
        waitUntil: 'networkidle',
    })
    const chart = page
        .locator('svg[aria-label="Won revenue against target"]')
        .first()
    await chart.scrollIntoViewIfNeeded()
    await chart.evaluate((svg) => {
        const crossings: string[] = []
        ;(window as unknown as { crossings: string[] }).crossings = crossings
        svg.addEventListener('pointerleave', () => crossings.push('leave'))
    })
    const box = (await chart.boundingBox()) as NonNullable<
        Awaited<ReturnType<typeof chart.boundingBox>>
    >
    // Right of the second month's crosshair, where the readout opens: a pixel back and forth.
    const x = box.x + box.width * 0.36 + 30
    const y = box.y + box.height / 2
    for (let step = 0; step < 10; step += 1)
        await page.mouse.move(x + (step % 2), y)
    const tip = page.locator('[role=tooltip]')
    await expect(tip).toContainText('Won')
    expect(await chart.getAttribute('data-hovering')).toBe('')
    expect(
        await page.evaluate(
            () => (window as unknown as { crossings: string[] }).crossings,
        ),
    ).toEqual([])
})
