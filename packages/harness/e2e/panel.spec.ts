// THE RESULTS PANEL, END TO END, in the browsers a reader actually brings. One panel
// per card now: a count over the source rendered at build, and everything a page can
// see about itself measured here when the reader asks.
// Everything
// below this line is verified elsewhere — the counts in `substrates.spec.ts`, the
// refusals in `bun test` — and none of that catches the seam this file is about: a
// sandboxed frame, an injected instrument, a message channel, and a page script built
// from a template literal inside a template literal.
//
// FOUR SEPARATE ESCAPING BUGS shipped through that seam while it was being written,
// and every one produced a page that looked fine and did nothing: a raw `</script>`
// that ended the tag early, a `\/` that collapsed, a nested quote, and a stylesheet
// fetched into a script tag. The build now parses its own inline scripts, and this
// asserts the whole path actually runs.

import { expect, test } from '@playwright/test'

import { BASE } from '../../../playwright.config.ts'

// THE DOCS ARE AN APP, and the config's own `webServer` is what serves it — built and started
// for the whole run (38.6). This spec used to build the docs itself and serve the output over
// `node:http`, which was two answers to "what does this address serve" and a docs build per
// browser project.
const PAGE = `${BASE}/values/patch-a-list-from-a-live-feed`

test('an example measures itself in the reader’s own browser', async ({
    page,
    browserName,
}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(PAGE)

    // The third card is the one whose manifest names a repeatable op, so it is the
    // one that exercises the timing half as well as the counts.
    const example = page.locator('.example').nth(2)
    await example.getByRole('tab', { name: 'Bench' }).click()
    await example
        .getByRole('button', { name: 'Measure in this browser' })
        .click()
    await example
        .locator('.ex-measure table, .ex-measure-refused')
        .first()
        .waitFor({ timeout: 120_000 })

    // A REFUSAL IS A RESULT AND A DEAD PANEL IS NOT. The instrument failing to load
    // reads the same as a slow machine unless this is asserted.
    await expect(example.locator('.ex-measure-refused')).toHaveCount(0)
    const text = await example.locator('.ex-measure').innerText()

    // FOUR COLUMNS, the same shape as the Bench table one tab away: a reading that
    // does not show where the ratio would go reads as a measurement with no arm.
    expect(text).toContain('Elements moved')
    expect(text).toContain('Nodes created')
    expect(text).toContain('Time per op')
    for (const column of ['ABIDE', 'HAND-WRITTEN', 'RATIO'])
        expect(text.toUpperCase()).toContain(column)
    // The abide arm does not run yet, and the panel says so rather than showing a
    // column of zeros. Reverted to omitting the column, a reader sees a table that
    // never intended to compare.
    expect(text).toContain('does not run yet')
    // The provenance, which is the half that is not.
    expect(text).toContain(browserName === 'chromium' ? 'V8' : 'JavaScriptCore')
    expect(text).toMatch(/counted over the first \d+ ms/)
    // The timing half, present because this card names an op.
    expect(text).toMatch(/floor ±\d+\.\d\d%/)
    expect(text).toMatch(/n=\d+/)
    // A unit that got uppercased by the wrong class once: `1.16 ΜS`.
    expect(text).not.toContain('ΜS')

    expect(errors).toEqual([])
})

// A card with no repeatable op still reports — counts, paint and size — and says why
// there is no duration rather than showing an empty cell. Reverted to rendering the
// timing row regardless, this reads `0 ns` and publishes the clock.
test('a card naming no op reports counts and says why there is no duration', async ({
    page,
}) => {
    await page.goto(PAGE)
    const example = page.locator('.example').first()
    await example.getByRole('tab', { name: 'Bench' }).click()
    await example
        .getByRole('button', { name: 'Measure in this browser' })
        .click()
    await example
        .locator('.ex-measure table')
        .first()
        .waitFor({ timeout: 120_000 })
    const text = await example.locator('.ex-measure').innerText()
    expect(text).toContain('No repeatable op is named here')
    expect(text).not.toMatch(/floor ±/)
    expect(text).toContain('Elements moved')
    // No op means no second table, so there is no `Time per op` row to price.
    expect(text).not.toContain('Time per op')
})
