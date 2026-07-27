import { expect, test } from './fixtures.ts'

// Drives the `state` primitive page in a real browser: SSR values, client hydration, and the owned
// side of the reactive graph — the writable cell and `state.shared`. Its neighbours have their own
// pages and specs: derivation on /memo (memo.spec.ts), effects on /watch (watch.spec.ts).

const PAGE = '/state'

test('props() reader renders the fallback heading', async ({ page }) => {
    await page.goto(PAGE)
    // A page's props are empty, so the destructuring fallback from props() is what renders.
    await expect(page.locator('h1')).toHaveText('state — the owned value')
})

// Card 1 is the primitive alone: declare, write, read.
test('state(v) — a write updates every reader', async ({ page }) => {
    await page.goto(PAGE)
    const count = page.getByTestId('count')
    await expect(count).toHaveText('0') // SSR value

    const inc = page.getByTestId('inc')
    await inc.click()
    await expect(count).toHaveText('1')
    await inc.click()
    await inc.click()
    await expect(count).toHaveText('3')
})

// Card 2 layers the one extra argument on: an invariant the cell can never hold a value outside of.
test('state(v, transform) clamps every write, from either direction', async ({ page }) => {
    await page.goto(PAGE)
    const count = page.getByTestId('t-count')
    await expect(count).toHaveText('0')

    const inc = page.getByTestId('t-inc')
    await inc.click()
    await expect(count).toHaveText('1')

    // Clamped at the bottom: 1 - 1 - 1 cannot go below 0.
    await page.getByTestId('t-dec').click()
    await page.getByTestId('t-dec').click()
    await expect(count).toHaveText('0')

    // And at the top — hammering increment never exceeds 10.
    for (let i = 0; i < 15; i++) await inc.click()
    await expect(count).toHaveText('10')

    await page.getByTestId('t-reset').click()
    await expect(count).toHaveText('0')
})

test('state.shared: two component instances share one cell by key', async ({ page }) => {
    await page.goto(PAGE)
    const aVal = page.getByTestId('tally-a-val')
    const bVal = page.getByTestId('tally-b-val')

    // Both instances start from the shared initial (also the SSR value).
    await expect(aVal).toHaveText('0')
    await expect(bVal).toHaveText('0')

    // Bumping instance A updates BOTH — they share the same backing cell by key.
    await page.getByTestId('tally-a-bump').click()
    await expect(aVal).toHaveText('1')
    await expect(bVal).toHaveText('1')

    // Bumping instance B advances the same shared value.
    await page.getByTestId('tally-b-bump').click()
    await expect(aVal).toHaveText('2')
    await expect(bVal).toHaveText('2')
})

test('state.shared: a write syncs across browser tabs via BroadcastChannel', async ({
    context,
}) => {
    const tabOne = await context.newPage()
    await tabOne.goto(PAGE)
    const tabTwo = await context.newPage()
    await tabTwo.goto(PAGE)

    // Bump in tab one; tab two's shared cell reflects it without any reload.
    await tabOne.getByTestId('tally-a-bump').click()
    await expect(tabTwo.getByTestId('tally-a-val')).toHaveText('1')

    await tabOne.close()
    await tabTwo.close()
})
