import { expect, type Page, test } from '@playwright/test'

// Drives the /memo/verbs page in a real browser: SSR → hydration → surface VERBS + behaviour over live RPC
// fetches. Every assertion is RELATIVE (server run counters are process-global and monotonic), so the
// specs prove behaviour — reuse, re-fetch, partial match, publish, shared, ttl — not absolute numbers.
// The reactive probes moved to /rpc/probes + /memo/probes; the global tag selectors to /memo/global.

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('cached read is reused (call count holds), refresh + invalidate re-fetch', async ({
    page,
}) => {
    await page.goto('/memo/verbs')

    const runs = page.getByTestId('counter-runs')
    await expect(runs).toHaveText('idle') // SSR: nothing loaded yet

    await page.getByTestId('counter-start').click()
    await expect(runs).toHaveText(/^\d+$/) // fetched
    const firstRuns = await intOf(page, 'counter-runs')

    // Reuse: repeated reads hit the cache — the server run count must NOT move.
    await page.getByTestId('counter-read').click()
    await page.getByTestId('counter-read').click()
    await page.getByTestId('counter-read').click()
    await expect(page.getByTestId('counter-reads')).toHaveText('3')
    await expect(runs).toHaveText(String(firstRuns))

    // invalidate() drops the slot → the next read re-fetches: the count climbs.
    await page.getByTestId('counter-invalidate').click()
    await expect.poll(() => intOf(page, 'counter-runs')).toBeGreaterThan(firstRuns)
})

test('cache: false — the read re-runs every call while a default cached read holds', async ({
    page,
}) => {
    await page.goto('/memo/verbs')

    await page.getByTestId('cf-read').click()
    await expect(page.getByTestId('cf-off')).toHaveText(/^\d+$/, { timeout: 15_000 })
    const off1 = await intOf(page, 'cf-off')
    const on1 = await intOf(page, 'cf-on')

    // A second and third read: the cache:false counter CLIMBS each time; the cached one HOLDS.
    await page.getByTestId('cf-read').click()
    await expect(page.getByTestId('cf-off')).not.toHaveText(String(off1))
    await expect.poll(() => intOf(page, 'cf-off')).toBeGreaterThan(off1)
    await expect(page.getByTestId('cf-on')).toHaveText(String(on1))

    const off2 = await intOf(page, 'cf-off')
    await page.getByTestId('cf-read').click()
    await expect.poll(() => intOf(page, 'cf-off')).toBeGreaterThan(off2)
    await expect(page.getByTestId('cf-on')).toHaveText(String(on1))
})

test('invalidate with a partial selector matches every superset slot (red re-fetches, blue untouched)', async ({
    page,
}) => {
    await page.goto('/memo/verbs')

    await page.getByTestId('metric-start').click()
    await expect(page.getByTestId('metric-red1')).toHaveText(/^\d+$/)
    await expect(page.getByTestId('metric-blue1')).toHaveText(/^\d+$/)

    const red1Before = await intOf(page, 'metric-red1')
    const blueBefore = await intOf(page, 'metric-blue1')

    // Partial selector { team: "red" } → both red slots re-fetch, blue is left alone.
    await page.getByTestId('metric-invalidate-red').click()
    await expect.poll(() => intOf(page, 'metric-red1')).toBeGreaterThan(red1Before)
    await expect(page.getByTestId('metric-blue1')).toHaveText(String(blueBefore))
})

test('publish(args, value|updater) mutates the slot in place with no re-fetch', async ({
    page,
}) => {
    await page.goto('/memo/verbs')

    await page.getByTestId('publish-start').click()
    await expect(page.getByTestId('publish-value')).toHaveText(/^\d+$/)

    // value-form: the slot value is replaced by 999 (not a server run count) — proof it never re-ran.
    await page.getByTestId('publish-value-form').click()
    await expect(page.getByTestId('publish-value')).toHaveText('999')
    await expect(page.getByTestId('publish-peek')).toHaveText('999')

    // updater-form: derive the next value from the current (999 + 100).
    await page.getByTestId('publish-updater').click()
    await expect(page.getByTestId('publish-value')).toHaveText('1099')
    await expect(page.getByTestId('publish-peek')).toHaveText('1099')
})

test('cache: { shared } is a cross-request cache; a per-request read climbs', async ({ page }) => {
    await page.goto('/memo/verbs')

    await page.getByTestId('shared-probe').click()
    await expect(page.getByTestId('shared-r1')).toHaveText(/^\d+$/, { timeout: 5000 })

    // Shared read: two separate requests served by ONE handler run → identical count.
    const s1 = await intOf(page, 'shared-r1')
    const s2 = await intOf(page, 'shared-r2')
    expect(s2).toBe(s1)

    // Non-shared read: per-request context re-runs the handler → the count climbs.
    const p1 = await intOf(page, 'shared-p1')
    const p2 = await intOf(page, 'shared-p2')
    expect(p2).toBeGreaterThan(p1)
})

test('cache: { ttl } serves from cache in-window, then expires and re-fetches', async ({
    page,
}) => {
    await page.goto('/memo/verbs')

    await page.getByTestId('ttl-probe').click()
    await expect(page.getByTestId('ttl-after')).toHaveText(/^\d+$/, { timeout: 10000 })

    const first = await intOf(page, 'ttl-first')
    const immediate = await intOf(page, 'ttl-immediate')
    const after = await intOf(page, 'ttl-after')
    expect(immediate).toBe(first) // within the 700ms window → cached
    expect(after).toBeGreaterThan(immediate) // after the window → re-fetched
})
