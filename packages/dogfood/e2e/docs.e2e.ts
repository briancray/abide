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

import { expect, interactive, test } from 'harness/e2e'
import { CALLABLE_ORDER, CALLABLES, SPECIFIERS } from '../demos/CALLABLES.ts'

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

        // Each rung's SOURCE is on the page, painted. An empty `<pre>` is the failure this catches: the
        // text arrives through `?source`, so a loader change turns every example into a blank frame while
        // every other assertion in the repo still passes.
        const panes = page.locator('[data-rung] pre')
        expect(await panes.count(), `${name} shows no source`).toBe(count)
        for (let at = 0; at < count; at++) {
            const text = (await panes.nth(at).innerText()).trim()
            expect(text.length, `${name} rung ${at + 1} shows an empty pane`).toBeGreaterThan(20)
        }

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
