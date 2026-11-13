import { shares, traceOp } from '@abide/harness/engine'
import { expect, test } from '@playwright/test'

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP is Chromium')

test('the sort is a share of the click', async ({ page }) => {
    // Relative, so it reaches /reports below whatever base the run serves.
    await page.goto('reports')
    const trace = await traceOp(page, 'rank by idle', async () => {
        await page.evaluate(async () => {
            performance.mark('click:start')
            for (const button of document.querySelectorAll('button'))
                if (button.textContent?.trim() === 'Most idle') button.click()
            // Two frames: the click's update, then the paint that shows it.
            await new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done)),
            )
            performance.measure('click', 'click:start')
        })
    })
    const sort = shares(trace, {
        layer: 'sort',
        of: 'click',
        threshold: 'frame',
    })
    expect(sort.ceilingCpu).toBeGreaterThan(0)
    expect(sort.ceilingCpu).toBeLessThan(1)
})
