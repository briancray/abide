import { expect, test } from './fixtures.ts'

// Drives /watch: the effect that carries a reactive value OUT of the graph, in both forms — the
// auto-tracked `watch(thunk)` (dependencies inferred from the body) and the change-only
// `watch(source, handler)` (whose first argument is dependency position, so a bare cell stays the
// node). Ordered inferred-then-declared to match /memo, since it is the same rule in both.

const PAGE = '/watch'

test('watch(thunk) runs on mount and re-runs on every tracked read', async ({ page }) => {
    await page.goto(PAGE)
    const label = page.getByTestId('wt-label')
    // Runs immediately — the effect has already written before any interaction.
    await expect(label).toHaveText('count is 0')

    await page.getByTestId('wt-inc').click()
    await expect(label).toHaveText('count is 1')
    await page.getByTestId('wt-inc').click()
    await expect(label).toHaveText('count is 2')
})

// Several declared inputs are just what the source thunk RETURNS (ADR 0025): next/previous carry it,
// so the handler can say WHICH one changed by name rather than by position.
test('watch(() => ({ a, b }), handler) fires for either input, with next/previous keyed by name', async ({
    page,
}) => {
    await page.goto(PAGE)
    const last = page.getByTestId('ws-multi-last')
    await expect(last).toHaveText('nothing yet') // change-only, as with one source

    await page.getByTestId('ws-multi-w').click()
    await expect(last).toHaveText('width: 3 → 4')

    await page.getByTestId('ws-multi-h').click()
    await expect(last).toHaveText('height: 4 → 5')
})

// The RETURNED teardown is the cleanup half of the effect, and the only unmount hook the grammar has.
// It must fire at both moments: before a re-run (so the re-subscribe drops the previous resource) and
// when the component holding the watch is unmounted.
test('the returned teardown runs before each re-run, and once on unmount', async ({ page }) => {
    await page.goto(PAGE)
    const log = page.getByTestId('wtd-log')
    // SSR runs the effect too, but the timer is browser work — the first line lands on hydration.
    await expect(log).toHaveText('start 800ms')

    // The interval is a tracked read: changing it re-runs the effect, cleanup FIRST.
    await page.getByTestId('wtd-speed').click()
    await expect(log).toHaveText('start 800ms → stop 800ms → start 300ms')

    // The timer belongs to the effect, so it is really running.
    await expect
        .poll(async () => Number(await page.getByTestId('wtd-ticks').innerText()))
        .toBeGreaterThan(0)

    // Unmounting the component disposes its watch — the same function, one last time.
    await page.getByTestId('wtd-toggle').click()
    await expect(page.getByTestId('wtd-ticks')).toHaveCount(0)
    await expect(log).toHaveText('start 800ms → stop 800ms → start 300ms → stop 300ms')
})

test('watch(source, handler) pushes a side effect into the DOM on change only', async ({
    page,
}) => {
    await page.goto(PAGE)
    const changes = page.getByTestId('changes')
    // Handler does NOT run on the initial read.
    await expect(changes).toHaveText('0')

    await page.getByTestId('ws-inc').click()
    await expect(changes).toHaveText('1')
    await page.getByTestId('ws-inc').click()
    await page.getByTestId('ws-dec').click()
    await expect(changes).toHaveText('3')
})
