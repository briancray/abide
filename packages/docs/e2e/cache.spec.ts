import { expect, type Page, test } from '@playwright/test'

// Drives the /cache page in a real browser: SSR → hydration → cache verbs + probes over live RPC
// fetches. Every assertion is RELATIVE (server run counters are process-global and monotonic), so
// the specs prove behaviour — reuse, re-fetch, partial match, pending, error — not absolute numbers.

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('cached read is reused (call count holds), refresh + invalidate re-fetch, peek + watch react', async ({
    page,
}) => {
    await page.goto('/cache')

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

    // peek() exposes the retained value without a load.
    await expect(page.getByTestId('counter-peek')).toHaveText(String(firstRuns))

    // refresh() forces a re-fetch: the count climbs.
    await page.getByTestId('counter-refresh').click()
    await expect.poll(() => intOf(page, 'counter-runs')).toBeGreaterThan(firstRuns)
    const afterRefresh = await intOf(page, 'counter-runs')

    // invalidate() drops the slot → next read re-fetches: climbs again.
    await page.getByTestId('counter-invalidate').click()
    await expect.poll(() => intOf(page, 'counter-runs')).toBeGreaterThan(afterRefresh)

    // watch(source, handler) fired on the slot changes.
    await expect.poll(() => intOf(page, 'counter-watch')).toBeGreaterThan(0)
})

test('invalidate with a partial selector matches every superset slot (red re-fetches, blue untouched)', async ({
    page,
}) => {
    await page.goto('/cache')

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

test('pending probe is true during a slow load; refresh keeps the stale value while re-fetching', async ({
    page,
}) => {
    await page.goto('/cache')

    await page.getByTestId('slow-start').click()
    // The slow read is in flight → pending is observably true.
    await expect(page.getByTestId('slow-pending')).toHaveText('loading')
    // …then it resolves: a value lands and pending clears.
    await expect(page.getByTestId('slow-value')).toHaveText(/^\d+$/, { timeout: 5000 })
    await expect(page.getByTestId('slow-pending')).toHaveText('idle')
    const firstValue = await intOf(page, 'slow-value')

    // refresh() re-runs the read; the count climbs once the new load resolves.
    await page.getByTestId('slow-refresh').click()
    await expect
        .poll(() => intOf(page, 'slow-value'), { timeout: 5000 })
        .toBeGreaterThan(firstValue)
})

test('error probe holds the HttpError from a failing read, and clears on invalidate', async ({
    page,
}) => {
    await page.goto('/cache')

    await expect(page.getByTestId('flaky-error')).toHaveText('idle')
    await page.getByTestId('flaky-start').click()
    await expect(page.getByTestId('flaky-error')).toHaveText('flaky boom')

    await page.getByTestId('flaky-clear').click()
    await expect(page.getByTestId('flaky-error')).toHaveText('idle')
})

test('reachable(host) reports a live host reachable and a dead port unreachable', async ({
    page,
}) => {
    await page.goto('/cache')

    await page.getByTestId('reach-start').click()
    await expect(page.getByTestId('reach-self')).toHaveText('true')
    await expect(page.getByTestId('reach-dead')).toHaveText('false')
})

test('refreshing(args) is true over a RETAINED value while pending stays false', async ({
    page,
}) => {
    await page.goto('/cache')

    await page.getByTestId('refreshing-start').click()
    // First load resolves to a value; refreshing/pending both settle to no.
    await expect(page.getByTestId('refreshing-value')).toHaveText(/^\d+$/, { timeout: 5000 })
    await expect(page.getByTestId('refreshing-flag')).toHaveText('no')
    const firstValue = await intOf(page, 'refreshing-value')

    // Refresh: the value is RETAINED, refreshing flips to yes, and pending stays no the whole time.
    await page.getByTestId('refreshing-refresh').click()
    await expect(page.getByTestId('refreshing-flag')).toHaveText('yes')
    await expect(page.getByTestId('refreshing-pending')).toHaveText('no')
    await expect(page.getByTestId('refreshing-value')).toHaveText(String(firstValue)) // stale value held

    // Then the new value lands and refreshing clears.
    await expect
        .poll(() => intOf(page, 'refreshing-value'), { timeout: 5000 })
        .toBeGreaterThan(firstValue)
    await expect(page.getByTestId('refreshing-flag')).toHaveText('no')
})

test('watch(args, cb) method form fires when the slot value changes', async ({ page }) => {
    await page.goto('/cache')

    await page.getByTestId('watchmethod-start').click()
    await expect(page.getByTestId('watchmethod-value')).toHaveText(/^\d+$/)
    // The load itself moved the slot → the watch callback fired at least once.
    await expect.poll(() => intOf(page, 'watchmethod-hits')).toBeGreaterThan(0)
    const hitsAfterLoad = await intOf(page, 'watchmethod-hits')

    // A refresh changes the slot again → the callback fires more.
    await page.getByTestId('watchmethod-refresh').click()
    await expect.poll(() => intOf(page, 'watchmethod-hits')).toBeGreaterThan(hitsAfterLoad)
})

test('amend(args, value|updater) mutates the slot in place with no re-fetch', async ({ page }) => {
    await page.goto('/cache')

    await page.getByTestId('amend-start').click()
    await expect(page.getByTestId('amend-value')).toHaveText(/^\d+$/)

    // value-form: the slot value is replaced by 999 (not a server run count) — proof it never re-ran.
    await page.getByTestId('amend-value-form').click()
    await expect(page.getByTestId('amend-value')).toHaveText('999')
    await expect(page.getByTestId('amend-peek')).toHaveText('999')

    // updater-form: derive the next value from the current (999 + 100).
    await page.getByTestId('amend-updater').click()
    await expect(page.getByTestId('amend-value')).toHaveText('1099')
    await expect(page.getByTestId('amend-peek')).toHaveText('1099')
})

test('cache: { shared } is a cross-request cache; a per-request read climbs', async ({ page }) => {
    await page.goto('/cache')

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
    await page.goto('/cache')

    await page.getByTestId('ttl-probe').click()
    await expect(page.getByTestId('ttl-after')).toHaveText(/^\d+$/, { timeout: 10000 })

    const first = await intOf(page, 'ttl-first')
    const immediate = await intOf(page, 'ttl-immediate')
    const after = await intOf(page, 'ttl-after')
    expect(immediate).toBe(first) // within the 700ms window → cached
    expect(after).toBeGreaterThan(immediate) // after the window → re-fetched
})

test('global invalidate({tags}) drops BOTH tagged reads together; pending({tags}) probes true', async ({
    page,
}) => {
    await page.goto('/cache')

    await page.getByTestId('tags-load').click()
    await expect(page.getByTestId('tags-a')).toHaveText(/^\d+$/, { timeout: 5000 })
    const a1 = await intOf(page, 'tags-a')
    const b1 = await intOf(page, 'tags-b')

    // One server-side invalidate({tags:["docs"]}) drops both slots → both re-fetch and climb together.
    await page.getByTestId('tags-bust').click()
    await expect.poll(() => intOf(page, 'tags-a'), { timeout: 5000 }).toBeGreaterThan(a1)
    await expect(page.getByTestId('tags-b')).not.toHaveText(String(b1))
    expect(await intOf(page, 'tags-b')).toBeGreaterThan(b1)

    // refresh({tags}) is the eager sibling — both climb again.
    const a2 = await intOf(page, 'tags-a')
    await page.getByTestId('tags-refresh').click()
    await expect.poll(() => intOf(page, 'tags-a'), { timeout: 5000 }).toBeGreaterThan(a2)

    // pending({tags}) reactive aggregate reports true mid first-load.
    await page.getByTestId('tags-probe-pending').click()
    await expect(page.getByTestId('tags-pending')).toHaveText('true')
})
