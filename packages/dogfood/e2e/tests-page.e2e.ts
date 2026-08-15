// The claims that need a click.
//
// A case's `interact` face has never been tested. The headless runner reports it as `— browser only` and
// skips it, because a claim that needs a click is a claim no test can make — and that was true right up
// until this file, which is a browser. Every `interact` body in the repo has been unverified machinery
// until now: it could throw on its first click and every gate in the project would stay green.
//
// The `/tests` table is also the one page whose whole content is the result of RUNNING something, so it is
// the page where "renders" and "works" are the same claim.

import { expect, interactive, test } from 'harness/e2e'
import { ORDER } from '../demos/SUITES.ts'

// Every suite, not one of them. This ran against `/tests/state` alone for as long as it existed, and a
// case can only be measuring the EMULATOR while `bun test` is the only thing that runs it: `splitText`
// is native in a browser and JS under happy-dom, so the hydrate suite's whitespace case asserted 9
// mutations that no browser performs and was red on this page for as long as anybody had looked at it.
// Derived from `SUITES.ts` for the reason `docs.e2e.ts` is — a capability added to the app is covered
// without anybody remembering to add it here.
const CAPABILITIES = ORDER.filter((name) => name !== 'overview')

/**
 * One test over every suite rather than one test each, which is a load decision and not a style one:
 * a suite page RUNS its cases, benches included, and twenty of those pages against one `abide dev`
 * in parallel starved the rest of this project's specs into 5s timeouts. Sequential here, and every
 * red row is collected before anything is asserted so that one broken suite cannot hide the next.
 */
test('no case on any suite page is red in a browser', async ({ page }) => {
    // The default 30s was enough while the settle-wait below was a no-op, which is what it was. Now that
    // it waits for real, this test is twenty suite drains long and the budget has to say so.
    test.setTimeout(300_000)
    const red: string[] = []
    for (const name of CAPABILITIES) {
        await page.goto(`/tests/${name}`)

        const rows = page.locator('[data-case]')
        const count = await rows.count()
        expect(count, `${name} has no rows`).toBeGreaterThan(0)

        // The queue runs them ONE AT A TIME, so the last row is the one that settles last — waiting
        // for it is waiting for all of them.
        //
        // A REGEX, and case-insensitively, because the badge is uppercased in CSS: `toHaveText` with a
        // string is exact and case-sensitive, so `not.toHaveText('waiting')` was already true of a row
        // reading `WAITING` and this line waited for nothing at all. The columns below were read off a
        // suite still running, which is a gate that cannot see a case that fails late.
        const statuses = page.locator('[data-case] summary span:last-child')
        await expect(statuses.nth(count - 1)).not.toHaveText(/^waiting$/i, { timeout: 120_000 })

        // `failed` is the status a thrown assertion writes, and it is the only one that means this
        // repo is broken rather than merely interactive. Both columns in ONE round trip each rather
        // than one per row: twenty suites of twenty cases is 800 crossings read the other way.
        const [written, titles] = await Promise.all([
            statuses.allInnerTexts(),
            rows.evaluateAll((all) => all.map((one) => one.getAttribute('data-case'))),
        ])
        for (let at = 0; at < written.length; at++) {
            if (written[at]?.trim().toLowerCase() === 'failed') red.push(`${name}: ${titles[at]}`)
        }
    }
    expect(red, 'cases red in a browser and green under `bun test`').toEqual([])
})

test('an interact face survives being poked — the claim no headless run can make', async ({ page }) => {
    await page.goto('/tests/state')
    // The field below is the client's, and typing into it early erases the text. See `interactive`.
    await interactive(page)

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
    await expect(
        row
            .locator('p')
            .filter({ hasText: /^HELLO E2E$/ })
            .first(),
    ).toBeVisible()
})

/**
 * The filter, which is browser-only twice over: it is typed into and clicked, and what it does is DROP
 * rows rather than dim them — so the claim is about how many `[data-case]` there are, which is a count
 * only a rendered page has.
 *
 * The `interact` chip is the point of the thing. A case's interactive half appears nowhere else on the
 * site — `/docs/<callable>` is the ladder and `/bench` is the measurements — so until this chip existed
 * there was no way to find the rows that have one.
 */
test('the filter drops rows, and the interact chip finds the ones with a click in them', async ({ page }) => {
    await page.goto('/tests/state')
    await interactive(page)

    const rows = page.locator('[data-case]')
    const all = await rows.count()

    // Nobody has typed, so nothing is painted — and that is the shape rather than the look: a title
    // with no query against it is one plain run, which is a text node and not an element.
    const marks = page.locator('mark.hit')
    await expect(marks).toHaveCount(0)

    await page.getByRole('button', { name: 'interact', exact: true }).click()
    const withAClick = await rows.count()
    expect(withAClick, 'no case in the suite carries an interact face').toBeGreaterThan(0)
    expect(withAClick, 'the chip showed every row, so it filtered nothing').toBeLessThan(all)
    // The face the chip names, in the row it left: the pane is only rendered for a case that has one.
    await expect(rows.first().locator('details', { hasText: 'the interactive half' }).first()).toHaveCount(1)

    await page.getByRole('button', { name: 'all', exact: true }).click()
    await expect(rows).toHaveCount(all)

    await page.getByPlaceholder('filter').fill('peek')
    const narrowed = await rows.count()
    expect(narrowed).toBeGreaterThan(0)
    expect(narrowed).toBeLessThan(all)

    // And the narrowing says WHY, which is the half a count cannot see: the rows that survived look
    // exactly like the ones that did not, so the word that decided it is painted inside each.
    //
    // EVERY row, and the filter's own scope is what earns an assertion that strong: the claim title is
    // the only thing searched, so a row here with nothing lit is a row kept for a reason the page cannot
    // show. It was `> 0` while the note and the suite name were searched too, which stayed green with
    // most of the column unpainted — one row spelling `peek` in its title answered for all of them.
    await expect(page.locator('[data-case]:has(.case-title mark.hit)')).toHaveCount(narrowed)

    // And nothing painted that nobody typed. `allTextContents` rather than `allInnerTexts`, which reads
    // what has LAYOUT: a row below the fold returns '' and this loop compared 'peek' against nothing at
    // all. Lowered on both sides, since a mark carries the TITLE's casing rather than the query's.
    for (const text of await marks.allTextContents()) {
        expect(text.toLowerCase(), 'a mark on text nobody typed').toBe('peek')
    }
    // A query nothing answers says so, rather than showing an empty table that reads as "no tests".
    await page.getByPlaceholder('filter').fill('zzzz no case says this')
    await expect(rows).toHaveCount(0)
    await expect(page.getByText('Nothing matches')).toBeVisible()
})

/**
 * The outcome chips, which no headless run can reach at all: a status is what a case DID, so it does not
 * exist until the queue has been through the page, and `bun test` renders the table without running one.
 *
 * The load-bearing rule is that an undecided row is dropped by neither chip. Dropping a row skips its
 * case — see `enqueue` — so a page opened on `failing` that dropped the `waiting` rows would empty
 * instantly, run nothing, and say "nothing failed" about a suite it never started. That is the failure
 * this test is shaped around, and it is why the assertion is made on the way BACK: a chip that dropped
 * the undecided rows leaves them still saying `waiting` when `any` puts them back.
 */
test('the outcome chips read a status, and drop no case before it has one', async ({ page }) => {
    // Two suite drains, and the assertions are what they drain INTO — so the budget is the drain's.
    test.setTimeout(180_000)
    await page.goto('/tests/state')
    await interactive(page)

    const rows = page.locator('[data-case]')
    const all = await rows.count()
    const statuses = page.locator('[data-case] summary span:last-child')

    // Asked for the red rows while the suite is still running. Rows leave as they settle, so the table
    // drains to the empty case — which on a green suite is the whole of it.
    await page.getByRole('button', { name: 'failing', exact: true }).click()
    await expect(page.getByText('Nothing failed.')).toBeVisible({ timeout: 120_000 })

    // And every one of them RAN while the chip was on, which is the claim above.
    //
    // LOWERCASED, because the badge is uppercased in CSS and the text a browser hands back is what the
    // page shows: `not.toContain('waiting')` against `WAITING` is a gate that can never fail.
    await page.getByRole('button', { name: 'any', exact: true }).click()
    await expect(rows).toHaveCount(all)
    const settled = (await statuses.allInnerTexts()).map((text) => text.trim().toLowerCase())
    expect(settled, 'a chip dropped rows the queue had not reached').not.toContain('waiting')

    // The same filter from the other side.
    await page.getByRole('button', { name: 'passing', exact: true }).click()
    const green = (await statuses.allInnerTexts()).map((text) => text.trim().toLowerCase())
    expect(green.length).toBeGreaterThan(0)
    for (const status of green) expect(status).toBe('passing')

    // The DISTINGUISHING suite, and it has to be a second page: every case in `state` carries a `run`,
    // so all 21 settle green and a chip that showed everything would pass every assertion above. The
    // `request` cases are `server` faces — settled, and neither passing nor failed — so the two chips
    // are the only thing that can empty this page, and "not failed" is not what `passing` means.
    await page.goto('/tests/request')
    await interactive(page)
    await expect(statuses.first()).toHaveText(/^server$/i, { timeout: 120_000 })
    const answered = (await statuses.allInnerTexts()).map((text) => text.trim().toLowerCase())
    expect(answered.length).toBeGreaterThan(0)
    for (const status of answered) expect(status).toBe('server')

    await page.getByRole('button', { name: 'passing', exact: true }).click()
    await expect(page.getByText('No case here is passing.')).toBeVisible()
    await page.getByRole('button', { name: 'failing', exact: true }).click()
    await expect(page.getByText('Nothing failed.')).toBeVisible()
})

/**
 * The card head pins, and it pins on the SIDEBAR'S line.
 *
 * A layout claim, so a browser is the only thing that can make it: `bun test` renders the markup and
 * has no scroll, no viewport and no sticky. Both halves are owed. The first — that the filter is still
 * on screen — is what fails if the toolbar leaves `.table-top` and only the column names pin, which is
 * how this page behaved before. The second is an EQUALITY against the sidebar rather than a `>` past
 * the chrome, because "somewhere below the header" is true of the old flush offset too.
 */
test('the filter and the column names pin together, level with the sidebar', async ({ page }) => {
    await page.goto('/tests/state')

    const field = page.getByPlaceholder('filter')
    await expect(field).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, 600))
    const pinned = await page.evaluate(() => {
        const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? NaN
        return {
            head: top('.table-top'),
            sidebar: top('.sidebar'),
            field: top('.field'),
            chrome: document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? NaN,
        }
    })

    // Rounded, because a sticky offset built from rems lands on a subpixel and two elements reading the
    // same one still differ in the fourth decimal.
    expect(Math.round(pinned.head), 'the card head is not on the line the sidebar starts at').toBe(
        Math.round(pinned.sidebar),
    )
    expect(pinned.head, 'the card head pinned flush under the chrome, not clear of it').toBeGreaterThan(pinned.chrome)
    expect(pinned.field, 'the filter scrolled away, so only the table pinned').toBeGreaterThan(pinned.chrome)
})

test('a row opens to the code that made its lines', async ({ page }) => {
    await page.goto('/tests/memo')
    await interactive(page)

    const row = page.locator('[data-case]').first()
    await row.locator('summary').first().click()

    // The source pane is asked for on OPEN rather than on mount — a page of twenty rows would otherwise
    // fetch two dozen bodies nobody looked at — so this is also the test that the rpc behind it answers.
    const pane = row.locator('details').filter({ hasText: 'the assertions' }).first()
    await pane.locator('summary').click()
    await expect(pane.locator('pre')).toContainText('is(')
})

/**
 * What opening a row gets you, which is two claims a headless run cannot make: `<details>` has no
 * open/closed under happy-dom that anything renders differently for, and the source arrives over an rpc
 * that only a served page has.
 *
 * Both halves are about what a reader SEES rather than what the page holds. A pane behind a second
 * disclosure is markup that is present and unread, and `bun test` cannot tell those apart at all.
 */
test('opening a row shows the code and hides the empty live area', async ({ page }) => {
    await page.goto('/tests/state')
    await interactive(page)

    // A case that asserts over a graph and mounts nothing — which is most of them.
    const row = page.locator('[data-case="a failed load THROWS from the read"]')
    const pane = row.locator('details.source').first()
    const code = pane.locator('pre.code')

    // Shut, the pane has fetched nothing: the body is what a row costs the slicing rpc, and three
    // hundred rows asking for one on load is the reason it is deferred at all.
    await expect(code).toHaveText('')

    await row.locator('summary').first().click()

    // ONE click, not two. `toBeVisible` is the assertion that means it — a `<pre>` inside a shut
    // `<details>` is in the document and has no box, so a `toHaveCount` here would pass either way.
    await expect(code).toBeVisible()
    await expect(code).toContainText('session', { timeout: 15_000 })

    // And the empty box is gone. It is still in the document — the case is handed that node, and the
    // queue would strand on a row whose live area left — so this is a claim about its BOX.
    const stage = row.locator('.stage')
    await expect(stage).toHaveCount(1)
    await expect(stage).toBeHidden()
    await expect(stage).toBeEmpty()
})

test('a live area that a case DID render into is shown', async ({ page }) => {
    await page.goto('/tests/state')
    await interactive(page)

    // The other side of `:empty`, and it is owed: a rule that hid every stage would leave this test the
    // only thing that fails, and the interact case above would still find its input by locator alone.
    const row = page.locator('[data-case="live — a state driving the DOM by hand"]')
    await row.locator('summary').first().click()
    await expect(row.locator('.stage')).toBeVisible()
})
