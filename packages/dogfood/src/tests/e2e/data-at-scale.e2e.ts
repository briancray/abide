// The `data` demo's default is 10,000 entries, and this is what stops the page laying out all of them.
//
// WHY A GATE AT ALL. The contract is "does less work", so nothing about the rendered page can carry
// it: all 10,000 entries are in the DOM either way, every one of them is scrollable to, and the
// markup is byte-identical. Delete the rule in `app.css` and the page still looks right, still
// passes `usecases.e2e.ts`, and costs 25x the layout. That is exactly the failure CLAUDE.md's "assert
// the work" rule is about.
//
// WHAT IS ASSERTED IS THE COUNT, not the ms — `content-visibility-win-was-the-page` is the reason.
// `layoutMs` on this machine swings run to run while `LayoutObjects` reads to the unit across every
// run taken: 383,762 as shipped without the rule, 15,094 with it. The ms is printed for a reader and
// gated on nothing.
//
// AND THE COUNT IS WHY THIS IS NOT THE SAME ANSWER AS `/demos/media`'s. The same property measured a
// net LOSS on 500 posters, because it does not remove layout work — it trades one layout of
// everything for a relevance check per element. Whether that wins is decided by the OFF-SCREEN
// FRACTION, which is a fact about the page: the demo box is `max-height: 32rem` and the grid inside
// it is 355,003px tall, so 99.86% of it can never be seen. At 500 the relevance checks dominate; at
// 10,000 they are 38 ms against ~500 ms of layout. That is why the rule is scoped to `.entry` and
// not to every demo in a capped box.

import { engine } from 'harness/engine'
import { expect, interactive, test } from 'harness/e2e'

/**
 * Layout boxes the whole page may hold.
 *
 * A quarter of the way between the two readings rather than a tight bound on either: the number the
 * gate is defending is a 25x gap, and a bound that tracks 15,094 would go red on an extra row of
 * chrome. Anything under this is the rule working; the failure it exists for is 383,762.
 */
const MOST_BOXES = 60_000

/**
 * ASKED FOR rather than taken from `DEFAULT_SIZE`, and the difference is the whole gate.
 *
 * The rule is only worth anything at a scale where nearly all of the grid is off screen. Reading the
 * demo's default would mean a session that lowers it turns this green by making the page small —
 * which is a gate that stops testing without ever going red.
 */
const ENTRIES = 10_000

// PLAYWRIGHT'S OWN TRACE IS OFF HERE, and it is the subject of the spec that makes it necessary: the
// document at this size is 30 MB, `retain-on-failure` buffers every response body in case the test
// fails, and the first draft did not fail — it timed out at 180 s with the recorder still swallowing
// the page. The instrument has to be cheaper than the thing it measures.
test.use({ trace: 'off' })

test('the data demo lays out what can be seen, not what it holds', async ({ page }) => {
    test.setTimeout(180_000)

    // Measured across the NAVIGATION, so the delta is this page's boxes rather than a running total.
    // From `/demos`, which is an index of six cards and brings a couple of thousand of its own.
    await page.goto('/demos')
    await interactive(page)
    const reading = await engine(page)

    const work = await reading.around(async () => {
        await page.goto(`/demos/data?size=${ENTRIES}`)
        // The rpc is real and sleeps 120 ms, so the grid arrives after the document. Waiting on the
        // summary rather than on a span of time — before it lands there are no `.entry` boxes to
        // count and the gate would pass by measuring nothing.
        await expect(page.locator('#summary')).toBeVisible({ timeout: 120_000 })
        await expect(page.locator('#rows')).toBeVisible()
        // The relevance check runs off the rendering lifecycle, so the count is not final until a
        // frame has been through it.
        await page.waitForTimeout(1_000)
    })

    const entries = await page.locator('.entry').count()
    console.log(
        `\n  ${entries.toLocaleString()} entries — ${work.layoutObjects.toLocaleString()} layout boxes, ` +
            `${work.nodes.toLocaleString()} nodes, layout ${work.layoutMs.toFixed(0)}ms, ` +
            `style ${work.recalcStyleMs.toFixed(0)}ms\n`,
    )

    // What was asked for actually arrived. Without this the gate goes green on a page that rendered
    // nothing — the cheapest possible way to hold a layout bound, and the one worth ruling out.
    expect(entries, `the page did not render the ${ENTRIES.toLocaleString()} entries it was asked for`).toBe(ENTRIES)

    expect(
        work.layoutObjects,
        `every entry got a layout box (${work.layoutObjects.toLocaleString()}) — ` +
            'is `content-visibility` still on `.usecase-live .entry`?',
    ).toBeLessThan(MOST_BOXES)

    await reading.close()
})
