// A list that drops its rows must let go of them.
//
// This is a "does less work" contract in its purest form — nothing about the rendered page moves. The
// rows leave the screen either way, every assertion in `usecases.e2e.ts` passes either way, and the
// markup is byte-identical. What differed was that `ChildPart.owned` held the range `take` claimed at
// adoption, `set`'s array arm reaches `clearExcept('list')` which returns early once a list exists, and
// so the FIRST generation of every `{#for}` was pinned for the part's lifetime. Found by heap snapshot:
// the retainer path ran `ChildPart --owned--> Array --> <article class="entry">`.
//
// RETAINED, not merely detached, which is why `{ collect: true }`. Without a forced collection a
// released subtree and a pinned one read the same — the counter is "not yet swept" rather than "alive"
// — and this gate would have passed against the bug.
//
// TWO PAGES, because the bug was general and a one-page gate would let a fix that only covered the
// keyed grid look complete. `data` is a keyed `{#for}` over an rpc payload; `complex` is a `<table>`
// built and cleared by its own buttons.
//
// Playwright's own trace is off for the same reason as `data-at-scale.e2e.ts`: the document at this
// size is 30 MB and `retain-on-failure` buffers it.

import { engine } from 'harness/engine'
import { expect, interactive, test } from 'harness/e2e'

/** The size the `data` arm asks for, rather than whatever `DEFAULT_SIZE` happens to be. */
const ENTRIES = 10_000

/**
 * How many of the 10,000 rows' nodes must come back.
 *
 * The rows are ~74 nodes each, so a full release is ~740,000. Bounded well under that because the
 * page keeps living around the measurement and a collection is not obliged to be exhaustive — the
 * failure this exists for is ZERO freed, which is what the bug read.
 */
const MUST_FREE = 400_000

test.use({ trace: 'off' })

test('the data grid releases the rows a filter drops', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto(`/demos/data?size=${ENTRIES}`)
    await interactive(page)
    await expect(page.locator('#summary')).toBeVisible({ timeout: 120_000 })
    expect(await page.locator('.entry').count(), 'the grid did not render what it was asked for').toBe(
        ENTRIES,
    )

    const reading = await engine(page, { collect: true })
    const work = await reading.around(async () => {
        await page.evaluate(() => {
            const box = document.querySelector('.usecase-live') as HTMLElement
            const input = box.querySelector('#query') as HTMLInputElement
            input.value = 'zzzzzznomatch'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await expect(page.locator('.entry')).toHaveCount(0)
        await page.waitForTimeout(600)
    })

    console.log(
        `\n  filtering ${ENTRIES.toLocaleString()} rows away released ${(-work.nodes).toLocaleString()} retained nodes\n`,
    )

    // NEGATIVE is the whole claim: the nodes are gone, not merely off screen.
    expect(
        work.nodes,
        `the dropped rows are still alive (${work.nodes.toLocaleString()} node delta) — is ChildPart.owned holding the list's range again?`,
    ).toBeLessThan(-MUST_FREE)

    await reading.close()
})

test('a table releases its rows when cleared', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/demos/complex')
    await interactive(page)
    const rows = page.locator('.usecase-live tbody tr')
    await expect(rows).toHaveCount(1_000, { timeout: 60_000 })

    const reading = await engine(page, { collect: true })
    const work = await reading.around(async () => {
        await page.locator('#clear').click()
        await expect(rows).toHaveCount(0)
        await page.waitForTimeout(600)
    })

    console.log(`\n  clearing 1,000 table rows released ${(-work.nodes).toLocaleString()} retained nodes\n`)

    // ~19 nodes a row, so a full release is ~19,000. The bug read approximately zero.
    expect(
        work.nodes,
        `the cleared rows are still alive (${work.nodes.toLocaleString()} node delta)`,
    ).toBeLessThan(-10_000)

    await reading.close()
})
