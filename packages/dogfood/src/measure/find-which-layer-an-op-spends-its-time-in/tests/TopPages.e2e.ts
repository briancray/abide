import { shares, traceOp } from '@abide/harness/engine'
import { expect, test } from '@playwright/test'

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP is Chromium')

test('the sort is a share of the click, priced against a frame', async ({
    page,
}) => {
    await page.goto('/measure/find-which-layer-an-op-spends-its-time-in')
    const trace = await traceOp(page, 'rank by signups', async () => {
        await page.evaluate(async () => {
            performance.mark('click:start')
            document
                .querySelectorAll<HTMLElement>('#share-of-a-sort button')[1]
                ?.click()
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
    expect(sort.ceilingObserved).toBe(sort.underOneFrame ? 0 : sort.ceilingCpu)
    expect(trace.counters.forcedLayout).toBe(0)
})
