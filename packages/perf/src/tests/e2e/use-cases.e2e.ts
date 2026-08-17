// The use cases, driven the way the external harness drives them.
//
// `#tests/unit/pages.test.ts` asserts that every page server-renders and still carries the ids a harness clicks.
// This asserts that CLICKING them does something — which is the half that needs a browser, and the half
// that breaks silently: a button whose handler throws leaves the markup exactly as the server wrote it,
// so every assertion in that file still passes.
//
// Nothing here quotes a duration. Click-to-paint is frame quantised, so every implementation under one
// frame reads the same ~16.7 ms and a wall clock here is a perception detector rather than a measurement.
// What the ops are PRICED at is the cross-repo comparison's job, against other frameworks on the same
// input; what this file says is that the op happens at all.

import { expect, interactive, test } from 'harness/e2e'

test('the simple page counts', async ({ page }) => {
    await page.goto('/')
    // `#inc` is the client's, and `goto` resolves before it adopts. See `interactive`.
    await interactive(page)
    await expect(page.locator('#count')).toHaveText('count 0')
    await page.locator('#inc').click()
    await expect(page.locator('#count')).toHaveText('count 1')
})

test('the complex page creates, updates and swaps a thousand rows', async ({ page }) => {
    await page.goto('/complex')
    await interactive(page)

    await page.locator('#create').click()
    const rows = page.locator('#rows tr')
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(100)
    const before = await rows.count()

    // The distinguishing op, and the reason `by` exists: two rows change places and the rest must not be
    // rebuilt. What that COSTS is counted on `/bench`; what is asserted here is that the list survives it,
    // because a reconcile that corrupts the order produces exactly the same row count.
    //
    // Rows 1 and 998, which is what the page swaps — js-framework-benchmark's own pair, chosen because a
    // swap of NEIGHBOURS is the case a naive reconcile gets right by accident. So the first row never
    // moves, and asserting on it would have been asserting nothing.
    const at = async (index: number): Promise<string> => (await rows.nth(index).innerText()).trim()
    const [wasOne, was998] = [await at(1), await at(998)]
    expect(wasOne, 'the two rows were already identical').not.toBe(was998)

    await page.locator('#swap').click()
    await expect.poll(() => at(1)).toBe(was998)
    expect(await at(998), 'the other end did not come back').toBe(wasOne)
    expect(await rows.count(), 'the swap changed the row count').toBe(before)

    await page.locator('#update').click()
    await expect(rows.first()).toBeVisible()
})

test('the data page answers over an rpc, and filtering it re-runs the work', async ({ page }) => {
    await page.goto('/data')
    await interactive(page)

    // It starts COLD and over a wire, which is the shape the async work is for: a pending arm the server
    // streams, then the answer.
    await expect(page.locator('#summary')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#rows')).toBeVisible()

    await page.locator('#query').fill('a')
    // The counters are BODY RUNS — the work, which is what moving one cell is supposed to change and what
    // nothing about the rendered numbers can tell you.
    await page.locator('#sample').click()
    await expect(page.locator('#runs')).not.toHaveText('press sample')
})

test('the wake ladder runs, and each rung reports a number', async ({ page }) => {
    await page.goto('/wake')
    await interactive(page)

    await page.locator('#wake-run').click()
    const out = page.locator('#wake-out')
    await expect.poll(() => out.innerText(), { timeout: 120_000 }).toContain('vanilla')

    // Four rungs, each naming what it has between the write and the attribute. A ladder that reported one
    // number would be a ladder with nothing to compare.
    const reported = await out.innerText()
    expect(reported).toContain('abide')
    expect(reported.split('\n').filter((line) => line.trim() !== '').length).toBeGreaterThan(3)
})
