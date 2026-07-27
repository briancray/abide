import { expect, test } from './fixtures.ts'

// C6.2 nav-perf gate. A param nav keeps the page (and its layouts) ALIVE, so its cost is O(the route-
// driven bindings that actually change), NOT O(page size). We prove it by timing the SAME param nav on a
// page padded to two very different sizes (`?pad=`) — the times must stay roughly FLAT. A regression to a
// full rebuild would scale with `pad` (or hard-reload), blowing the ratio apart.

async function timeParamNav(page: import('@playwright/test').Page, pad: number): Promise<number> {
    await page.goto(`/pages/layouts/alpha?pad=${pad}`)
    await expect(page.getByTestId('carousel-heading')).toHaveText('Item: alpha')
    // The filler rendered at the requested size (SSR + hydrate agree).
    await expect(page.getByTestId('carousel-filler').locator('span')).toHaveCount(pad)
    // Time the param nav alpha → bravo up to the reactive heading update (setClientRoute is synchronous;
    // the background middleware fetch is not on this path).
    return await page.evaluate(async () => {
        const heading = () =>
            document.querySelector('[data-testid="carousel-heading"]')?.textContent
        const start = performance.now()
        ;(document.querySelector('[data-testid="card-bravo"]') as HTMLElement).click()
        while (heading() !== 'Item: bravo') {
            await new Promise((r) => requestAnimationFrame(r))
        }
        return performance.now() - start
    })
}

test('param nav cost is flat across page size (O(changed bindings), not O(page))', async ({
    page,
}) => {
    const small = await timeParamNav(page, 100)
    const large = await timeParamNav(page, 5000)
    // eslint-disable-next-line no-console
    console.log(`param-nav ms — pad=100: ${small.toFixed(1)}, pad=5000: ${large.toFixed(1)}`)
    // Flat: a 50× page-size increase must not scale nav time. A full rebuild would; keep-alive doesn't.
    // Generous bound (4× + 60ms baseline) so it gates the O(page) regression without being CI-noise-flaky.
    expect(large).toBeLessThan(small * 4 + 60)
})
