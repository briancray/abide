// Every reference page, in a real browser.
//
// `test/docs.test.ts` already asserts that every public name has a rung and that every rung carries the
// text of a real file, and `bun test` mounts the mountable rungs. None of that can see the thing this
// file is for: a rung that renders on the server and then throws in the browser, or a page whose preview
// is markup with nothing behind it.
//
// Derived from `CALLABLES.ts` rather than from a list written here, so a name added to abide is covered
// without anybody remembering to add it. That file is plain TypeScript whose ladders are `import()`
// thunks, which is why a playwright process can read it without pulling one rung.

import { expect, interactive, type Page, test } from 'harness/e2e'
import { CALLABLE_ORDER, CALLABLES, SPECIFIERS } from '../demos/CALLABLES.ts'
import { SPELLING_ORDER, SPELLINGS } from '../demos/SPELLINGS.ts'

/**
 * Every rung's SOURCE is on the page, painted, not blank, and not running off the card.
 *
 * Blank is one failure worth catching: the text arrives through `?source`, so a loader change turns
 * every example into an empty frame while every other assertion in the repo still passes.
 *
 * ONE PANE per rung, always — a rung that crosses the seam is two files behind a TAB STRIP, so the
 * second is a click rather than a second `<pre>`. The tabs are pressed here rather than assumed: a
 * strip that renders and does not switch is markup with nothing behind it, which is the whole reason
 * this file drives a real browser. Both halves are asserted non-empty and DIFFERENT, because a strip
 * showing one file under two labels would satisfy every other check in the repo.
 *
 * The selector is scoped to `.files`. It was `[data-rung] pre`, which also matched the `<pre>` a
 * PREVIEW renders its answer into — so the loose selector and a one-per-rung count failed together,
 * and fixing either alone would have left a check that reads as though it still guarded something.
 */
async function sourcesAreOnThePage(page: Page, name: string, rungs: number): Promise<void> {
    // The SYMPTOM, once per page and above the per-rung checks: a reference page never scrolls
    // sideways. Whatever grows past the window — a pane, a table, a preview somebody writes next year —
    // is caught here whether or not the check below happens to be looking at it.
    const spill = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(spill, `${name} scrolls sideways by ${spill}px`).toBeLessThan(2)

    for (let at = 0; at < rungs; at++) {
        const where = `${name} rung ${at + 1}`
        const rung = page.locator(`[data-rung="${at + 1}"]`)
        const pane = rung.locator('.files pre')
        expect(await pane.count(), `${where} does not show exactly one source pane`).toBe(1)
        const server = (await pane.innerText()).trim()
        expect(server.length, `${where} shows an empty pane`).toBeGreaterThan(20)

        // Contained rather than overflowing: the pane scrolls its own long lines instead of growing to
        // them. Asserted between the PANE and the box that holds it, which is where the failure was —
        // an 812px pane inside a 672px column, running off the card and taking the document to 1523 in
        // a 1440 window. Checked against the rung instead, `.files` itself fitted and the check passed
        // with the bug in: the first version of this assertion was green against a page it should have
        // failed, which is the whole reason the fix is reverted and re-run rather than eyeballed.
        const fits = await rung.evaluate((el) => {
            const box = el.querySelector('.files')
            const pane = box?.querySelector('.code-block')
            if (box === null || box === undefined || pane === null || pane === undefined) return true
            return pane.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1
        })
        expect(fits, `${where}: the source pane runs past the column that holds it`).toBe(true)

        // A tab strip is two tabs or no strip at all. One tab is chrome that says nothing, and three
        // means a rung grew a file the page has no vocabulary for.
        const tabs = rung.locator('.tab')
        const count = await tabs.count()
        expect([0, 2], `${where} has ${count} tabs`).toContain(count)
        if (count === 0) continue

        await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
        await tabs.nth(1).click()
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
        expect(await pane.count(), `${where} shows both files at once after a tab press`).toBe(1)
        const client = (await pane.innerText()).trim()
        expect(client.length, `${where} shows an empty client half`).toBeGreaterThan(20)
        expect(client === server, `${where} shows one file under both tabs`).toBe(false)
        await tabs.nth(0).click()
    }
}

test('/docs indexes the whole surface', async ({ page, complaints }) => {
    await page.goto('/docs')

    // One card per public name, and the count is the claim: a grid that silently rendered half the list
    // still looks like an index.
    const cards = page.locator('[data-callable]')
    expect(await cards.count(), '/docs does not list every name').toBe(CALLABLE_ORDER.length)

    // Grouped by the specifier you import from, which is half of what a reader came for.
    const groups = page.locator('[data-specifier]')
    expect(await groups.count(), '/docs lost an entry point').toBe(SPECIFIERS.length)

    expect(complaints.errors, '/docs logged errors').toEqual([])
})

for (const name of CALLABLE_ORDER) {
    test(`/docs/${name} renders its ladder`, async ({ page, complaints }) => {
        await page.goto(`/docs/${name}`)

        // The import line is the first thing on the page and the thing most likely to be copied, so it
        // is asserted as an EXACT string. `hasText` matches case-insensitively and as a substring, which
        // would pass against `GET` on the `get` page.
        await expect(page.locator('pre').first()).toHaveText(`import { ${name} } from '${CALLABLES[name].from}'`)

        // Every rung is a numbered section with the one thing it adds as its heading, located by the
        // `data-rung` the page numbers it with. At least one — `docs.test.ts` proves the count is not
        // zero for any name, and this proves the page actually drew it.
        const rungs = page.locator('[data-rung]')
        await expect(rungs.first()).toBeVisible()
        const count = await rungs.count()

        await sourcesAreOnThePage(page, name, count)

        // What is KNOWN about each rung, which the page proves live — see `demos/proofs.ts`. This is
        // where the per-rung sweep lives rather than under `bun test`: a page loads only the ladders
        // its own callable is in, so each rung is mounted once and nothing else in the process holds
        // an opinion about the module-level cells inside it.
        //
        // Waited for rather than read: the proofs are queued when their pane lands and run one at a
        // time, so the last badge settling is all of them settling.
        const badges = page.locator('[data-rung] .proofs .badge')
        const proven = await badges.count()
        if (proven > 0) {
            await expect(badges.nth(proven - 1)).not.toHaveText('waiting', { timeout: 30_000 })
            // `allInnerTexts` in one crossing rather than one per rung, and every red collected so
            // that one broken rung cannot hide the next on the same page.
            const written = await badges.allInnerTexts()
            const red: string[] = []
            for (let at = 0; at < written.length; at++) {
                if (written[at]?.trim().toLowerCase() === 'failed') red.push(`${name} rung ${at + 1}`)
            }
            expect(red, 'a documented example the two substrates disagree about').toEqual([])
        }

        // Stated here as well as in the fixture's teardown, and not only to satisfy a linter: a fixture
        // has to be REQUESTED to be active, so a page whose console nobody destructured is a page nobody
        // is listening to. Written at the call site, the claim is visible in the test rather than in the
        // harness. Hydration warnings are deliberately somebody else's file — see `hydration.e2e.ts`.
        expect(complaints.errors, `${name} logged errors`).toEqual([])
    })
}

test('/docs/syntax indexes the whole language', async ({ page, complaints }) => {
    await page.goto('/docs/syntax')

    const cards = page.locator('[data-spelling]')
    expect(await cards.count(), '/docs/syntax does not list every spelling').toBe(SPELLING_ORDER.length)
    expect(complaints.errors, '/docs/syntax logged errors').toEqual([])
})

for (const slug of SPELLING_ORDER) {
    test(`/docs/syntax/${slug} renders its ladder`, async ({ page, complaints }) => {
        await page.goto(`/docs/syntax/${slug}`)

        // The heading is the SPELLING as it is typed — `{#for}`, not `for` — because that is what a
        // reader arrived holding. Exact, since `toHaveText` on a substring would pass `for` against it.
        await expect(page.locator('.page-title')).toHaveText(SPELLINGS[slug].name)

        // And there is NO import line, which is the one way this page differs from a callable's: a
        // block imports nothing, and a `<pre>` telling somebody to import `{#for}` would be a lie the
        // shared component is one prop away from telling.
        expect(await page.locator('.import-line').count(), 'a spelling is not imported from anywhere').toBe(0)

        const rungs = page.locator('[data-rung]')
        await expect(rungs.first()).toBeVisible()
        const count = await rungs.count()

        await sourcesAreOnThePage(page, slug, count)

        // The same per-rung sweep the callable pages get — see `demos/proofs.ts`. It matters more here:
        // this axis is where the template rungs live, so every mountable example in the language is
        // built, server-rendered and hydrated over on one of these fifteen pages.
        const badges = page.locator('[data-rung] .proofs .badge')
        const proven = await badges.count()
        if (proven > 0) {
            await expect(badges.nth(proven - 1)).not.toHaveText('waiting', { timeout: 30_000 })
            const written = await badges.allInnerTexts()
            const red: string[] = []
            for (let at = 0; at < written.length; at++) {
                if (written[at]?.trim().toLowerCase() === 'failed') red.push(`${slug} rung ${at + 1}`)
            }
            expect(red, 'a documented example the two substrates disagree about').toEqual([])
        }

        expect(complaints.errors, `${slug} logged errors`).toEqual([])
    })
}

test('a spelling a `.abide` file does not have is a 404, not an apology', async ({ page }) => {
    const answered = await page.goto('/docs/syntax/nonsense')
    expect(answered?.status()).toBe(404)
})

test('a mounted rung is live, not a picture of itself', async ({ page }) => {
    // `state`'s first rung is a counter, which is the smallest thing that can prove the preview is
    // hydrated rather than server markup sitting there: the button has to change the number.
    await page.goto('/docs/state')
    // The rung's button is the client's. See `interactive` — `goto` resolves before hydration.
    await interactive(page)
    const first = page.locator('[data-rung="1"]')
    // Inside the PREVIEW, not the first `<p>` in the rung: the rung's own heading block carries one
    // saying which callables it is `of`, and `p` alone silently started matching that instead.
    const line = first.locator('.rung-preview p').first()
    await expect(line).toHaveText(/count 0/)

    await first.getByRole('button', { name: 'add one' }).click()
    await expect(line).toHaveText(/count 1/)
})

test('a name abide does not export is a 404, not an apology', async ({ page }) => {
    const answered = await page.goto('/docs/nowhere')
    expect(answered?.status()).toBe(404)
})
