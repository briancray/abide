// The claims that need a click.
//
// A case's `interact` face has never been tested. The headless runner reports it as `— browser only` and
// skips it, because a claim that needs a click is a claim no test can make — and that was true right up
// until this file, which is a browser. Every `interact` body in the repo has been unverified machinery
// until now: it could throw on its first click and every gate in the project would stay green.
//
// The `/tests` table is also the one page whose whole content is the result of RUNNING something, so it is
// the page where "renders" and "works" are the same claim.

import { expect, test } from 'abide-kit/e2e'

test('every case on a suite page runs, and says so in its own row', async ({ page }) => {
    await page.goto('/tests/state')

    const rows = page.locator('[data-case]')
    const count = await rows.count()
    expect(count, 'the suite has no rows').toBeGreaterThan(5)

    // The queue runs them ONE AT A TIME, so the last row is the one that settles last — waiting for it is
    // waiting for all of them.
    const statuses = page.locator('[data-case] summary span:last-child')
    await expect(statuses.nth(count - 1)).not.toHaveText('waiting', { timeout: 60_000 })

    // Nothing red. `failed` is the status a thrown assertion writes, and it is the only one that means
    // this repo is broken rather than merely interactive.
    for (let at = 0; at < count; at++) {
        const status = (await statuses.nth(at).innerText()).trim()
        const title = await rows.nth(at).getAttribute('data-case')
        expect(status, `${title} is ${status}`).not.toBe('failed')
    }
})

test('an interact face survives being poked — the claim no headless run can make', async ({ page }) => {
    await page.goto('/tests/state')

    // The `state` suite's interactive case: a field that writes a cell, and an effect that paints it.
    // Opening the row is what puts its controls on screen; the case itself already ran.
    //
    // `summary` is taken FIRST rather than by itself: a row contains source panes, which are `<details>`
    // with summaries of their own, so the bare locator is three elements and playwright refuses it.
    const row = page.locator('[data-case="live — a state driving the DOM by hand"]')
    await row.locator('summary').first().click()

    const field = row.locator('input').first()
    await expect(field).toBeVisible()
    await field.fill('hello e2e')
    await field.press('Enter')

    // The effect ran on the write, which is the whole claim of that card — and it is the assertion no
    // `run` body can make, because nothing headless types.
    //
    // A case-sensitive REGEX, and that is the difference between a gate and a decoration: `hasText` with
    // a string matches case-insensitively, so `hasText: 'HELLO E2E'` also matched the un-uppercased
    // `hello e2e`. Breaking the card's `toUpperCase()` left this test green, which is how it was caught.
    await expect(row.locator('p').filter({ hasText: /^HELLO E2E$/ }).first()).toBeVisible()
})

/**
 * The filter, which is browser-only twice over: it is typed into and clicked, and what it does is DROP
 * rows rather than dim them — so the claim is about how many `[data-case]` there are, which is a count
 * only a rendered page has.
 *
 * The `interact` chip is the point of the thing. A case's interactive half appears nowhere else on the
 * site — `/docs/<suite>` is the ladder and `/bench` is the measurements — so until this chip existed
 * there was no way to find the rows that have one.
 */
test('the filter drops rows, and the interact chip finds the ones with a click in them', async ({ page }) => {
    await page.goto('/tests/state')

    const rows = page.locator('[data-case]')
    const all = await rows.count()

    await page.getByRole('button', { name: 'interact', exact: true }).click()
    const interactive = await rows.count()
    expect(interactive, 'no case in the suite carries an interact face').toBeGreaterThan(0)
    expect(interactive, 'the chip showed every row, so it filtered nothing').toBeLessThan(all)
    // The face the chip names, in the row it left: the pane is only rendered for a case that has one.
    await expect(rows.first().locator('details', { hasText: 'the interactive half' }).first()).toHaveCount(1)

    await page.getByRole('button', { name: 'all', exact: true }).click()
    await expect(rows).toHaveCount(all)

    await page.getByPlaceholder('filter').fill('peek')
    const narrowed = await rows.count()
    expect(narrowed).toBeGreaterThan(0)
    expect(narrowed).toBeLessThan(all)
    // A query nothing answers says so, rather than showing an empty table that reads as "no tests".
    await page.getByPlaceholder('filter').fill('zzzz no case says this')
    await expect(rows).toHaveCount(0)
    await expect(page.getByText('Nothing matches')).toBeVisible()
})

test('a row opens to the code that made its lines', async ({ page }) => {
    await page.goto('/tests/memo')

    const row = page.locator('[data-case]').first()
    await row.locator('summary').first().click()

    // The source pane is asked for on OPEN rather than on mount — a page of twenty rows would otherwise
    // fetch two dozen bodies nobody looked at — so this is also the test that the rpc behind it answers.
    const pane = row.locator('details').filter({ hasText: 'the assertions' }).first()
    await pane.locator('summary').click()
    await expect(pane.locator('pre')).toContainText('is(')
})
