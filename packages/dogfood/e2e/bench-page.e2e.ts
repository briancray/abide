// What a bench row actually PRINTS, which is a claim only a real engine can be asked.
//
// Nothing headless can make it: the numbers on `/bench` exist only after arms have been timed against a
// clock this repo does not control, so every gate in the project stayed green while the page reported a
// per-row number and nothing else. That is the failure this file exists for — `1.26 µs` is invisible or a
// dropped frame depending on an `n` the row was not printing, and no assertion anywhere could tell.
//
// The second thing it gates is the DISCLOSURE, which has the same shape of failure: a row that quietly
// stopped opening, or a run button that toggles the row shut under whoever pressed it, leaves every
// number on the page correct and the page unusable.

import type { Page } from '@playwright/test'
import { expect, interactive, test } from 'harness/e2e'

/**
 * A `/bench` page ready to be DRIVEN, which is two barriers and not one.
 *
 * `interactive` is the first: `goto` resolves before the client has adopted anything at all. It is not
 * enough here, and the gap is the interesting part — every one of these pages draws its table from
 * `memo(async () => benchRows())`, so the table the server rendered sits there looking live inside a
 * region the client has not resolved yet. Nothing is listening to it. Typing into the filter in that
 * window is not merely early: when the memo lands the region re-renders, the `.value` binding writes
 * its cell back over the field, and the text is GONE. Measured — the wipe and `exposeBench` land on the
 * same tick, 136 ms after commit, ~100 ms after `interactive` is satisfied.
 *
 * So the second barrier is the page's own content, and `abideBench` is exactly that signal: it is set
 * inside that memo, from the rows the table is about to draw.
 */
async function driveable(page: Page): Promise<void> {
    await interactive(page)
    await page.waitForFunction(() => (globalThis as { abideBench?: unknown }).abideBench !== undefined)
}

const DURATION = /^\d+(\.\d+)? (ns|µs|ms)$/
const PER_ROW = /^\d+(\.\d+)? (ns|µs|ms)\/row$/
// A BARE multiple, which is the whole point of the column: under one is abide ahead.
const DIFFERENCE = /^(\d+(\.\d+)?|∞)×$/

/** `1.26 µs` back to nanoseconds, so an ordering can be asserted across mixed units. */
function nanos(text: string): number {
    const [, n, unit] = /^([\d.]+) (ns|µs|ms)$/.exec(text.trim()) ?? []
    return Number(n) * (unit === 'ms' ? 1e6 : unit === 'µs' ? 1e3 : 1)
}

const CARD = (n: number): string => `[data-bench="the whole round trip at ${n} rows: render, parse, adopt"]`

test('a row is what, abide, by hand and the difference — and the evidence is behind it', async ({ page }) => {
    await page.goto('/bench/hydrate')
    await driveable(page)
    const row = page.locator(CARD(100))

    // What one op IS, on the summary itself: the two numbers beside it cannot be read without it.
    await expect(row.getByText('100 rows per op')).toBeVisible()
    // Closed to start with. The note and the arms are IN the document — this is a disclosure, not a
    // second fetch — so `toBeHidden` rather than a count is the only thing that can tell them apart.
    await expect(row.getByText('abide ÷ arm')).toBeHidden()

    await row.getByRole('button', { name: 'run' }).click()
    await expect(row.getByText('median of many batches')).toBeAttached({ timeout: 120_000 })

    // Running must not TOGGLE the row. The button is inside the summary, and it stays closed only
    // because a summary skips its toggle for a click on an interactive descendant — a behaviour of the
    // browser rather than of this page, which is exactly the kind a gate has to hold rather than trust.
    await expect(row.getByText('abide ÷ arm')).toBeHidden()

    // The four columns, in the order the header names them. A DURATION rather than merely non-empty:
    // `—` is what an unrun row holds and it is `.toBeVisible()` too.
    const cells = row.locator('summary .number')
    expect(await cells.nth(0).innerText()).toMatch(DURATION) // abide, whole op
    expect(await cells.nth(1).innerText()).toMatch(PER_ROW) //  abide, per row
    expect(await cells.nth(2).innerText()).toMatch(DURATION) // by hand, whole op
    expect(await cells.nth(3).innerText()).toMatch(PER_ROW) //  by hand, per row
    expect(await row.locator('summary > span').last().innerText()).toMatch(DIFFERENCE)
    // The memory column: DOM nodes abide made per op, over the same count per row. The sub-line means
    // the same thing here as in the two columns left of it, which is the whole reason it is a RATE and
    // not the hand-written arm's count — that one was read as `30,003` over its own tenth part.
    expect(await cells.nth(4).innerText()).toMatch(/^[\d,]+$/)
    expect(await cells.nth(5).innerText()).toMatch(/^\d+\.\d\/row$/)

    // Open it: the prose and every arm come back, which is where they went rather than away.
    await row.locator('summary').click()
    await expect(row.getByText('abide ÷ arm')).toBeVisible()
    const detail = row.locator('.arm-row:not(.arm-head)')
    await expect(detail).toHaveCount(6)
    // The distribution the summary's one number cannot carry. Ordering rather than values, because
    // the values are this machine's — but min ≤ p50 ≤ max holds on every machine, and it is what
    // fails when the median is taken off an unsorted list or indexed off by one. p50 is the FIRST
    // column and the one the summary repeats, so it is read from the value cell; `min` has taken its
    // place among the spans, which is what catches the two being swapped.
    const first = detail.first()
    const p50 = nanos(await first.locator('.cell-right .number').first().innerText())
    const stats = first.locator('span.number')
    const ns = async (i: number): Promise<number> => nanos(await stats.nth(i).innerText())
    const [min, max] = [await ns(0), await ns(1)]
    expect(min).toBeGreaterThan(0)
    expect(min).toBeLessThanOrEqual(p50)
    expect(p50).toBeLessThanOrEqual(max)
    // The sample size those three are averages of, and then the arm's own node count. The shape is
    // the claim: both are COUNTS, so a duration landing in either column — the whole failure mode of
    // reordering a grid whose cells are positional — fails here and nowhere else. That `ops` is a
    // CALIBRATED count rather than one batch per pass is `harness.test.ts`'s to assert, and it does.
    expect(await stats.nth(2).innerText()).toMatch(/^[\d,]+$/)
    expect(await stats.nth(3).innerText()).toMatch(/^[\d,]+$/)
})

// The 100-row card is the one this file RUNS, because the presentation claim above does not depend on
// `n` and the two large cards cost half a minute between them. What they are owed is that they EXIST:
// a per-row cost is only readable across sizes, and a card silently dropped from the ladder takes the
// comparison with it while every other gate stays green.
test('the round trip is measured at three sizes, each saying what one op is', async ({ page }) => {
    await page.goto('/bench/hydrate')

    for (const n of [100, 1000, 10000]) {
        const card = page.locator(CARD(n))
        await expect(card.getByText(`${n} rows per op`)).toBeAttached()
        await expect(card.locator('.arm-row:not(.arm-head)')).toHaveCount(6)
    }
})

// The filter, which is the difference between a page of sixty rows and the four somebody is reading —
// and it narrows what `run everything` runs, so it is a control over minutes rather than over a view.
test('typing narrows the table, by title and by ARM label', async ({ page }) => {
    await page.goto('/bench')
    await driveable(page)
    const rows = page.locator('[data-bench]')
    const all = await rows.count()
    expect(all).toBeGreaterThan(20)

    const field = page.getByPlaceholder('filter — title, suite or arm')
    await field.fill('round trip')
    await expect(rows).toHaveCount(3)

    // EVERY term, not any: narrowing is what the field is for, and an `any` filter would widen here.
    await field.fill('round trip 10000')
    await expect(rows).toHaveCount(1)

    // The discriminating case, and the one a title-only filter passes: `innerHTML` is spelled by arms
    // and by no title on the page, so a filter that never opened a row cannot find it.
    await field.fill('innerhtml')
    const byArm = await rows.count()
    expect(byArm).toBeGreaterThan(0)
    for (let at = 0; at < byArm; at++) {
        expect((await rows.nth(at).getAttribute('data-bench'))?.toLowerCase()).not.toContain('innerhtml')
    }

    // Nothing matching says so rather than showing an empty table that reads as "there are none".
    await field.fill('zzzz no such bench')
    await expect(rows).toHaveCount(0)
    await expect(page.getByText('Nothing matches')).toBeVisible()

    await field.fill('')
    await expect(rows).toHaveCount(all)
})
