// The use cases, driven the way a reader drives them.
//
// `#tests/unit/usecases.test.ts` asserts that every demo server-renders and still carries the ids the
// driver clicks. This asserts that CLICKING them does something — which is the half that needs a
// browser, and the half that breaks silently: a button whose handler throws leaves the markup exactly
// as the server wrote it, so every assertion in that file still passes.
//
// Nothing here quotes a duration. Click-to-paint is frame quantised, so every implementation under one
// frame reads the same ~16.7 ms and a wall clock here is a perception detector rather than a
// measurement. What the ops are PRICED at is the cross-repo comparison's job, against other frameworks
// on the same input; what this file says is that the op happens at all.

import { expect, interactive, test } from 'harness/e2e'

test('the simple demo counts', async ({ page }) => {
    await page.goto('/demos/simple')
    // `#inc` is the client's, and `goto` resolves before it adopts. See `interactive`.
    await interactive(page)
    await expect(page.locator('#count')).toHaveText('count 0')
    await page.locator('#inc').click()
    await expect(page.locator('#count')).toHaveText('count 1')
})

test('the complex demo creates, updates and swaps a thousand rows', async ({ page }) => {
    await page.goto('/demos/complex')
    await interactive(page)

    await page.locator('#create').click()
    const rows = page.locator('#rows tr')
    await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(100)
    const before = await rows.count()

    // The distinguishing op, and the reason `by` exists: two rows change places and the rest must not be
    // rebuilt. What that COSTS is counted on the card; what is asserted here is that the list survives
    // it, because a reconcile that corrupts the order produces exactly the same row count.
    //
    // Rows 1 and 998, which is what the demo swaps — js-framework-benchmark's own pair, chosen because a
    // swap of NEIGHBOURS is the case a naive reconcile gets right by accident. So the first row never
    // moves, and asserting on it would have been asserting nothing.
    const at = async (index: number): Promise<string> => (await rows.nth(index).innerText()).trim()
    // Together: two unrelated reads over the driver's wire, and nothing about the page changes between
    // them.
    const [wasOne, was998] = await Promise.all([at(1), at(998)])
    expect(wasOne, 'the two rows were already identical').not.toBe(was998)

    await page.locator('#swap').click()
    await expect.poll(() => at(1)).toBe(was998)
    expect(await at(998), 'the other end did not come back').toBe(wasOne)
    expect(await rows.count(), 'the swap changed the row count').toBe(before)

    await page.locator('#update').click()
    await expect(rows.first()).toBeVisible()
})

test('the data demo answers over an rpc, and filtering it re-runs the work', async ({ page }) => {
    await page.goto('/demos/data')
    await interactive(page)

    // It starts COLD and over a wire, which is the shape the async work is for: a pending arm the server
    // streams, then the answer.
    await expect(page.locator('#summary')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#rows')).toBeVisible()

    await page.locator('#query').fill('a')
    // The counters are BODY RUNS — the work, which is what moving one state is supposed to change and what
    // nothing about the rendered numbers can tell you.
    await page.locator('#sample').click()
    await expect(page.locator('#runs')).not.toHaveText('press sample')
})

test('the wake ladder runs, and each rung reports a number', async ({ page }) => {
    await page.goto('/demos/wake')
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

test('the demo page shows the files it is written in, one tab per file', async ({ page }) => {
    await page.goto('/demos/media')
    await interactive(page)

    // Blank is the failure worth catching here: the text arrives through `?source`, so a loader change
    // turns every pane into an empty `<pre>` while the page still renders perfectly.
    const pane = page.locator('.usecase-source .code')
    await expect(pane).toContainText('Poster')

    // FOUR files for this demo, and the tab strip is how a reader reaches the other three. `Progress`
    // appears in `Poster.abide` as an import as well as being a file of its own, so the tab asserted on
    // is the data builder — a string that can only be in the file it names.
    const tabs = page.locator('.usecase-source .tab')
    await expect(tabs).toHaveCount(4)
    await tabs.filter({ hasText: 'media.ts' }).click()
    await expect(pane).toContainText('buildMedia')
    await expect(pane).not.toContainText('<slot/>')
})

test('pressing price drives the ops and reports DOM calls for each', async ({ page }) => {
    await page.goto('/demos/dashboard')
    await interactive(page)

    // Nothing is priced on sight — the demo is the thing being read, and a run that started on mount
    // would be reordering the table while somebody looked at it.
    const metrics = page.locator('.profile-metric')
    await expect(metrics).toHaveCount(0)

    await page.locator('#price').click()
    // Two metrics per op — the work and the clock — over the three ops `USECASES.ts` declares.
    await expect(metrics).toHaveCount(6, { timeout: 60_000 })

    // The number, not just the row. A driver that found no control still emits a metric, and its value
    // is the string `no #filter` — which is a green count and a broken demo.
    await expect(page.locator('.profile-metric').first()).toContainText('DOM calls')
    // The CLASS and not the text. `.badge` is `text-transform: uppercase` and Playwright reads
    // `innerText`, which applies it — so `toHaveText('benched')` waits for a string the page will
    // never contain, and the failure reads as a demo that never finished.
    await expect(page.locator('.usecase-cost .badge')).toHaveClass(/is-benched/)

    // THE SETTLE IS NOT THE OP. The 60 ms quiesce used to sit inside the timing window, so all three
    // ops reported `≈ 63 ms` whether they moved 64 DOM calls or 724 — and it read as plausible
    // precisely because every number looked like every other one. These ops are small, so at least one
    // must land under the clock's floor; with the sleep back in the window, none of them can.
    await expect(page.locator('.usecase-cost')).toContainText('floor')
})
