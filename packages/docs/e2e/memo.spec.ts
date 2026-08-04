import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// Drives /memo + /memo/probes: the bare memo() primitive and the reactive probes over a
// plain CLIENT-SIDE memo (no RPC, no transport). Proves the probe vocabulary is a property of the memo
// itself — reuse holds a run count, and live/pending/refreshing/error/watch behave as documented.
// The argless derivation cards (auto-tracked memo, memo(source, transform).state()) live here too:
// ADR 0024 made them the same primitive, so the docs and this spec keep them on one page.

async function intOf(page: Page, testId: string): Promise<number> {
    const text = (await page.getByTestId(testId).textContent()) ?? ''
    return Number.parseInt(text, 10)
}

test('argless memo auto-tracks and derives reactively from the counter', async ({ page }) => {
    await page.goto('/memo')
    const doubled = page.getByTestId('doubled')
    await expect(doubled).toHaveText('0') // SSR value — a sync memo renders in the initial HTML

    await page.getByTestId('c-inc').click()
    await expect(doubled).toHaveText('2')
    await page.getByTestId('c-inc').click()
    await expect(doubled).toHaveText('4')
})

// memo(source, transform) declares its dependency: the source THUNK is tracked, the transform is not.
test('memo(source, transform) recomputes on the source only — the transform runs untracked', async ({
    page,
}) => {
    await page.goto('/memo')
    const scaled = page.getByTestId('src-scaled')
    await expect(scaled).toHaveText('10') // count 1 × factor 10

    // The transform READS factor, but that read does not subscribe — no recompute.
    await page.getByTestId('src-factor').click()
    await expect(page.getByTestId('src-factor-val')).toHaveText('11')
    await expect(scaled).toHaveText('10')

    // Changing the declared source recomputes, and picks up factor's current value.
    await page.getByTestId('src-count').click()
    await expect(page.getByTestId('src-count-val')).toHaveText('2')
    await expect(scaled).toHaveText('22')
})

// Several declared inputs are just what the source thunk RETURNS (ADR 0025) — every read inside it is
// tracked, and the transform still takes one argument.
test('memo(() => ({ a, b }), transform) recomputes on either declared input', async ({ page }) => {
    await page.goto('/memo')
    const area = page.getByTestId('area')
    await expect(area).toHaveText('12') // 3 × 4

    await page.getByTestId('area-w').click()
    await expect(page.getByTestId('area-w-val')).toHaveText('4')
    await expect(area).toHaveText('16')

    await page.getByTestId('area-h').click()
    await expect(page.getByTestId('area-h-val')).toHaveText('5')
    await expect(area).toHaveText('20')
})

test('a memo writable projection is independently writable and reseeds on re-fill', async ({
    page,
}) => {
    await page.goto('/memo')
    const draft = page.getByTestId('draft')
    await expect(draft).toHaveText('0') // seeded to count(0) * 100

    // Local writes hold until the next reseed.
    await page.getByTestId('bump-draft').click()
    await page.getByTestId('bump-draft').click()
    await expect(draft).toHaveText('2')

    // Changing the source (count) reseeds the projection, discarding the local edits.
    await page.getByTestId('proj-inc').click() // count -> 1
    await expect(draft).toHaveText('100')

    await page.getByTestId('proj-inc').click() // count -> 2
    await expect(draft).toHaveText('200')
})

// The args rung, still synchronous: the argument is the cache key, one slot per key, and the read is a
// VALUE — so it is present in the server HTML before any hydration.
test('a keyed SYNC memo renders its value, and each key is its own slot', async ({ page }) => {
    await page.goto('/memo')
    const area = page.getByTestId('keyed-area')
    await expect(area).toHaveText('12') // 3 × 4, server-rendered

    await page.getByTestId('keyed-w').click()
    await expect(page.getByTestId('keyed-w-val')).toHaveText('4')
    await expect(area).toHaveText('16')

    await page.getByTestId('keyed-h').click()
    await expect(area).toHaveText('20')

    // A different key is a different slot — untouched by either button.
    await expect(page.getByTestId('keyed-other')).toHaveText('10')
})

test('a keyed sync read lands in the SSR HTML with no client involvement', async ({ page }) => {
    // Fetch the raw document: a promise-returning read would leave the node empty until hydration.
    const response = await page.request.get('/memo')
    const html = await response.text()
    expect(html).toContain('data-testid="keyed-area"')
    expect(html).toMatch(/data-testid="keyed-area"[^>]*>12</)
})

// The async rung: argless + async is still ONE slot. Reads reuse it, and because an async body is
// NOT auto-tracked, a dependency change alone never re-runs it — refresh does.
test('argless async memo() — one slot, reused; untracked until refresh', async ({ page }) => {
    await page.goto('/memo')

    await page.getByTestId('async-read').click()
    await expect(page.getByTestId('async-runs')).toHaveText('1', { timeout: 15_000 })
    await expect(page.getByTestId('async-value')).toHaveText('alpha #1')

    await page.getByTestId('async-read').click()
    await page.getByTestId('async-read').click()
    await expect(page.getByTestId('async-reads')).toHaveText('3')
    await expect(page.getByTestId('async-runs')).toHaveText('1') // reuse — count holds

    // The body reads `label`, but an async body is untracked: renaming re-runs nothing.
    await page.getByTestId('async-rename').click()
    await expect(page.getByTestId('async-label')).toHaveText('beta')
    await expect(page.getByTestId('async-runs')).toHaveText('1')
    await expect(page.getByTestId('async-value')).toHaveText('alpha #1')

    // refresh re-fills, picking up label's current value.
    await page.getByTestId('async-refresh').click()
    await expect(page.getByTestId('async-value')).toHaveText('beta #2', { timeout: 15_000 })
    await expect(page.getByTestId('async-runs')).toHaveText('2')
})

// The args rung: the argument is the KEY, so the one slot above becomes one slot per key.
test('memo(fn) with args — a slot per key; invalidate drops only that key', async ({ page }) => {
    await page.goto('/memo')

    await page.getByTestId('args-read-alpha').click()
    await expect(page.getByTestId('args-alpha')).toHaveText('alpha #1', { timeout: 15_000 })

    await page.getByTestId('args-read-beta').click()
    await expect(page.getByTestId('args-beta')).toHaveText('beta #2', { timeout: 15_000 })
    await expect(page.getByTestId('args-runs')).toHaveText('2')

    // Re-reading alpha reuses its own settled slot.
    await page.getByTestId('args-read-alpha').click()
    await expect(page.getByTestId('args-alpha-reads')).toHaveText('2')
    await expect(page.getByTestId('args-runs')).toHaveText('2')

    // Invalidating one key leaves the other's value intact.
    await page.getByTestId('args-invalidate-alpha').click()
    await page.getByTestId('args-read-alpha').click()
    await expect(page.getByTestId('args-alpha')).toHaveText('alpha #3', { timeout: 15_000 })
    await expect(page.getByTestId('args-beta')).toHaveText('beta #2')
})

test('live() — undefined while pending, then the value', async ({ page }) => {
    await page.goto('/memo/probes')

    await expect(page.getByTestId('memolive-value')).toHaveText('idle')
    await page.getByTestId('memolive-read').click()
    await expect(page.getByTestId('memolive-value')).toHaveText('hello a', { timeout: 15_000 })
})

// The negative half of the read split, which is the only half a value assertion can get wrong: `peek`
// returning `undefined` proves nothing on its own (so does a load that has not finished). What proves it
// is that the value NEVER arrives while only `peek` is asking — and then does, the moment `live` asks.
test('peek() — never subscribes and never loads, so it never fills in on its own', async ({ page }) => {
    await page.goto('/memo/probes')

    await expect(page.getByTestId('memopeek-value')).toHaveText('undefined (nothing there)')

    // Ask repeatedly. Each click re-renders the line, so a `peek` that kicked a load would have had
    // three chances plus the settle time below to show one.
    await page.getByTestId('memopeek-peek').click()
    await page.getByTestId('memopeek-peek').click()
    await page.getByTestId('memopeek-peek').click()
    await page.waitForTimeout(600) // > the memo's 300ms body, so a kicked load would have landed
    await expect(page.getByTestId('memopeek-value')).toHaveText('undefined (nothing there)')

    // The DISPLAY read is the one that acquires — and now the same untracked read sees the value.
    await page.getByTestId('memopeek-load').click()
    await expect(page.getByTestId('memopeek-live')).toHaveText('hello a', { timeout: 15_000 })
    await page.getByTestId('memopeek-peek').click()
    await expect(page.getByTestId('memopeek-value')).toHaveText('hello a')
})

// `settled` is the only probe that separates a COLD slot from a settled one: `pending()` is false for
// both, and a settled `undefined` reads exactly like nothing-yet. So assert the three phases, not the
// flag — the flag alone cannot show what the probe is for.
test('settled() — never asked vs pending vs settled, and asking starts nothing', async ({ page }) => {
    await page.goto('/memo/probes')

    await expect(page.getByTestId('settled-phase')).toHaveText('never asked')
    await expect(page.getByTestId('settled-flag')).toHaveText('no')

    // Rendering the probe must not be what starts the load: still cold after the body's own duration.
    await page.waitForTimeout(600)
    await expect(page.getByTestId('settled-phase')).toHaveText('never asked')

    await page.getByTestId('settled-load').click()
    await expect(page.getByTestId('settled-phase')).toHaveText('settled', { timeout: 15_000 })
    await expect(page.getByTestId('settled-flag')).toHaveText('yes')
    await expect(page.getByTestId('settled-value')).toHaveText('answer a')
})

test('pending() — yes during the first load, no once settled', async ({ page }) => {
    await page.goto('/memo/probes')

    await page.getByTestId('memopending-read').click()
    await expect(page.getByTestId('memopending-flag')).toHaveText('yes')
    await expect(page.getByTestId('memopending-value')).toHaveText('ready a', { timeout: 15_000 })
    await expect(page.getByTestId('memopending-flag')).toHaveText('no')
})

test('refreshing() — yes over a retained value while pending stays no', async ({ page }) => {
    await page.goto('/memo/probes')

    await page.getByTestId('memorefreshing-read').click()
    await expect(page.getByTestId('memorefreshing-value')).toHaveText('1', { timeout: 15_000 })

    await page.getByTestId('memorefreshing-refresh').click()
    await expect(page.getByTestId('memorefreshing-flag')).toHaveText('yes')
    await expect(page.getByTestId('memorefreshing-pending')).toHaveText('no')
    await expect(page.getByTestId('memorefreshing-value')).toHaveText('1') // stale retained
    await expect(page.getByTestId('memorefreshing-value')).toHaveText('2', { timeout: 15_000 })
    await expect(page.getByTestId('memorefreshing-flag')).toHaveText('no')
})

test('error() — holds a rejected load, clears on fix + retry', async ({ page }) => {
    await page.goto('/memo/probes')

    await page.getByTestId('memoerror-trigger').click()
    await expect(page.getByTestId('memoerror-error')).toHaveText('memo boom for a', {
        timeout: 15_000,
    })

    await page.getByTestId('memoerror-fix').click()
    await expect(page.getByTestId('memoerror-error')).toHaveText('none', { timeout: 15_000 })
    await expect(page.getByTestId('memoerror-value')).toHaveText('ok a')
})

test('isomorphic state — a server-side reactive graph (state + memo + watch across modules)', async ({
    page,
}) => {
    await page.goto('/memo')
    await page.getByTestId('sr-read').click()
    await expect(page.getByTestId('sr-total')).toHaveText(/^\d+$/, { timeout: 15_000 })
    const total0 = await intOf(page, 'sr-total')
    const fires0 = await intOf(page, 'sr-fires')

    await page.getByTestId('sr-bump').click()
    // The server write propagates through the derived memo and fires the server-side watch.
    await expect(page.getByTestId('sr-total')).toHaveText(String(total0 + 1), { timeout: 15_000 })
    await expect(page.getByTestId('sr-doubled')).toHaveText(String((total0 + 1) * 2))
    await expect.poll(() => intOf(page, 'sr-fires')).toBeGreaterThan(fires0)
})

test('watch(args, cb) — fires on every load and refresh', async ({ page }) => {
    await page.goto('/memo/probes')

    await page.getByTestId('memowatch-read').click()
    await expect(page.getByTestId('memowatch-value')).toHaveText('1', { timeout: 15_000 })
    await expect.poll(() => intOf(page, 'memowatch-hits')).toBeGreaterThan(0)
    const hits = await intOf(page, 'memowatch-hits')

    await page.getByTestId('memowatch-refresh').click()
    await expect.poll(() => intOf(page, 'memowatch-hits')).toBeGreaterThan(hits)
})
