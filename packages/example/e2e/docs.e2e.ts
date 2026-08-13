// Every reference page, in a real browser.
//
// `test/docs.test.ts` already asserts that every capability has a ladder and that every rung carries the
// text of a real file, and `bun test` mounts the mountable rungs. None of that can see the thing this
// file is for: a rung that renders on the server and then throws in the browser, or a page whose preview
// is markup with nothing behind it.
//
// Derived from `SUITES.ts` rather than from a list written here, so a capability added to the app is
// covered without anybody remembering to add it. That file is plain TypeScript with no `.abide` imports,
// which is why a playwright process can read it at all.

import { expect, test } from 'abide-kit/e2e'
import { ORDER } from '../demos/SUITES.ts'

// The hub's own suite is the index of the others, so it has no ladder to show.
const CAPABILITIES = ORDER.filter((name) => name !== 'overview')

for (const name of CAPABILITIES) {
    test(`/docs/${name} renders its ladder`, async ({ page, complaints }) => {
        await page.goto(`/docs/${name}`)

        // Every rung is a numbered section with the one thing it adds as its heading. Located by
        // `data-rung`, because the claims under the ladder are a `<section>` with an `<h2>` as well.
        const rungs = page.locator('[data-rung]')
        await expect(rungs.first()).toBeVisible()
        const count = await rungs.count()
        expect(count, `${name} shows no rungs`).toBeGreaterThan(1)

        // Each rung's SOURCE is on the page, painted. An empty `<pre>` is the failure this catches: the
        // text arrives through `?source`, so a loader change turns every example into a blank frame while
        // every other assertion in the repo still passes.
        const panes = page.locator('[data-rung] pre')
        expect(await panes.count(), `${name} shows no source`).toBe(count)
        for (let at = 0; at < count; at++) {
            const text = (await panes.nth(at).innerText()).trim()
            expect(text.length, `${name} rung ${at + 1} shows an empty pane`).toBeGreaterThan(20)
        }

        // And the claims under the ladder, which are the suite's own cases as prose.
        await expect(page.getByText('what is asserted about it', { exact: false })).toBeVisible()

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
    const first = page.locator('[data-rung="1"]')
    const line = first.locator('p').first()
    await expect(line).toHaveText(/count 0/)

    await first.getByRole('button', { name: 'add one' }).click()
    await expect(line).toHaveText(/count 1/)
})

test('a capability that does not exist is a 404, not an apology', async ({ page }) => {
    const answered = await page.goto('/docs/nowhere')
    expect(answered?.status()).toBe(404)
})
