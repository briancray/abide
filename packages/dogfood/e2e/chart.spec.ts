// 50.47 — A HINT NEVER TAKES THE POINTER: a chart's readout opens beside its crosshair, often right
// under the pointer, and a readout the pointer could land on is a `pointerleave` on the chart that
// closes it, a `pointerenter` that opens it again, and a flicker for as long as the pointer moves.
//
// THE REVERT: hand the chart's `tip` to `anchored` as `interactive`, and the chart reads a leave and an
// enter per pixel the pointer moves.
import { expect, test } from '@playwright/test'

function underMount(address: string): string {
    const base = test.info().project.use.baseURL ?? ''
    return `${base.endsWith('/') ? base : `${base}/`}${address}`
}

test("a pointer moving under a chart's readout keeps it open — 50.47", async ({
    page,
}) => {
    await page.goto(underMount('headless/chart'), {
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
    const tip = page.locator('[role=tooltip]:popover-open')
    await expect(tip).toContainText('Won')
    expect(await chart.getAttribute('data-hovering')).toBe('')
    expect(
        await page.evaluate(
            () => (window as unknown as { crossings: string[] }).crossings,
        ),
    ).toEqual([])
})

// 52.81, 52.116 — A CHART DRAWN IN HTML IS LAID OUT BY ITS PERCENTAGES: each column a `span` inside the
// `div` it is spread on, as tall against the others as its count.
// THE REVERT: place a column by a `transform` in its `style` again, as an SVG rect once was — it
// moves and scales each `span` out of the chart. Px in place of the percentages passes here:
// once the box is measured the two agree, and the CRM's test, with no layout, is what tells them apart.
test('columns drawn as spans stand inside their div, each as tall as its count — 52.116', async ({
    page,
}) => {
    await page.goto(underMount('headless/chart'), {
        waitUntil: 'networkidle',
    })
    const chart = page.locator('div[aria-label="Deals closed by week"]')
    const box = (await chart.boundingBox()) as NonNullable<
        Awaited<ReturnType<typeof chart.boundingBox>>
    >
    const columns = await chart
        .locator('[data-chart=bar]')
        .evaluateAll((bars) =>
            bars.map((bar) => bar.getBoundingClientRect().toJSON()),
        )
    expect(columns).toHaveLength(4)
    for (const column of columns) {
        expect(column.left).toBeGreaterThanOrEqual(box.x - 0.5)
        expect(column.right).toBeLessThanOrEqual(box.x + box.width + 0.5)
        expect(column.top).toBeGreaterThanOrEqual(box.y - 0.5)
        expect(column.bottom).toBeLessThanOrEqual(box.y + box.height + 0.5)
    }
    // 6 deals against 2.
    expect(columns[3].height / columns[2].height).toBeCloseTo(3, 1)
})
