import { expect, test } from './fixtures.ts'

// Branch-local `<script>` (C9.4) and nested `<style>` (C9.2) — both used to be dropped in silence: the
// script emitted nothing at all (its bindings read `undefined`), and a nested style was scoped with the
// FILE's attribute, or with none when the file had no root `<style>`.
//
// These run in a real browser over the SSR'd + hydrated page because that is where the interesting half
// lives: unit tests mount a fresh tree, and the failure mode worth guarding is a per-iteration cell
// whose hydration-seed bucket is shared with its neighbour's — which only shows up after a real SSR
// paint has been claimed.

test('a per-iteration <script> gives every row its own state, after SSR + hydration', async ({
    page,
}) => {
    await page.goto('/templating/scripts')

    const counters = page.getByTestId('row-count')
    await expect(counters).toHaveCount(3)
    // Every row starts at its own literal initial — not at a neighbour's replayed seed value.
    for (let index = 0; index < 3; index++)
        await expect(counters.nth(index)).toHaveText('clicked 0×')

    await counters.nth(1).click()
    await counters.nth(1).click()
    await expect(counters.nth(1)).toHaveText('clicked 2×')
    // The other rows are untouched: the cell belongs to the ITERATION, not to the list.
    await expect(counters.nth(0)).toHaveText('clicked 0×')
    await expect(counters.nth(2)).toHaveText('clicked 0×')

    // A row added after hydration gets a fresh cell of its own, and the existing ones keep their values.
    await page.getByTestId('add-row').click()
    await expect(counters).toHaveCount(4)
    await expect(counters.nth(3)).toHaveText('clicked 0×')
    await expect(counters.nth(1)).toHaveText('clicked 2×')
})

test('a branch-local <script> in an {#if} is set up when the branch mounts', async ({ page }) => {
    await page.goto('/templating/scripts')

    // The branch is out at 3 rows, so its script has never run.
    await expect(page.getByTestId('branch-note')).toHaveCount(0)
    await page.getByTestId('add-row').click()
    await expect(page.getByTestId('branch-note')).toHaveText('this branch owns its own state')
})

test('an inline {#component} owns its <script> and <style> per invocation', async ({ page }) => {
    await page.goto('/templating/components')

    const tallies = page.getByTestId('tally')
    const bump = page.getByTestId('tally-bump')
    await expect(tallies).toHaveCount(2)
    await expect(tallies.nth(0)).toHaveText('reads · 0')

    // Each invocation's `<script>` ran for ITSELF: bumping one leaves the other alone.
    await bump.nth(0).click()
    await bump.nth(0).click()
    await expect(tallies.nth(0)).toHaveText('reads · 2')
    await expect(tallies.nth(1)).toHaveText('writes · 0')

    // A newly invoked one starts from its own literal initial; the existing ones keep their values.
    await page.getByTestId('add-tally').click()
    await expect(tallies).toHaveCount(3)
    await expect(tallies.nth(2)).toHaveText('extra 2 · 0')
    await expect(tallies.nth(0)).toHaveText('reads · 2')

    // The component's `<style>` reaches its own subtree, and the `.tally` outside it keeps the class
    // without the styling.
    await expect(tallies.nth(0)).toHaveCSS('color', 'rgb(4, 120, 87)')
    await expect(page.getByTestId('tally-outside')).not.toHaveCSS('color', 'rgb(4, 120, 87)')
})

test('a nested <style> scopes its own subtree and nothing else', async ({ page }) => {
    await page.goto('/templating/styling')

    const inside = page.getByTestId('nested-inside')
    const outside = page.getByTestId('nested-outside')
    await expect(inside).toBeVisible()

    // The branch rule reaches the branch…
    await expect(inside).toHaveCSS('color', 'rgb(217, 70, 239)')
    // …and NOT its sibling, which carries the same class but sits outside the branch. Before this was
    // scoped per subtree, both elements carried the one file-wide attribute and the rule hit both.
    await expect(outside).not.toHaveCSS('color', 'rgb(217, 70, 239)')

    // The component's own rule still reaches INTO the branch: an inner scope narrows, it doesn't cut off.
    await expect(inside).toHaveCSS('font-style', 'italic')
    await expect(outside).toHaveCSS('font-style', 'italic')

    // Two scope attributes on the inner element, one on the outer.
    const attrCount = (testId: string): Promise<number> =>
        page
            .getByTestId(testId)
            .evaluate((el) => el.getAttributeNames().filter((n) => n.startsWith('data-ab-')).length)
    expect(await attrCount('nested-inside')).toBe(2)
    expect(await attrCount('nested-outside')).toBe(1)
})

// A cell assignment compiles to `cell.set(…)`, so the binding-analysis lane has to find where the
// right-hand side ENDS. It had its own private copy of the continuation-operator set that had drifted
// from the check lane's: it knew `+` and `.` but not `? :`, `as`, `instanceof`, `in`, or template
// middles. Each of those truncated at the line break and emitted `size.set( count > 2)` followed by an
// orphaned `? "many" : "few"` — not a syntax error, so nothing downstream complained. The cell was
// silently set to the CONDITION.
//
// That is why this is a rendered assertion and not a compile check: every value on the page is still a
// value, just the wrong one. The unit test in `analyzeBindings.test.ts` compares emitted strings; this
// one is the dogfooding half, which had no case that could tell the two implementations apart.
//
// Verified by reverting the continuation set to the drifted build-lane copy: the ternary, binary and
// member cases go silently wrong, and the template-literal case severs into unbalanced source, so the
// page fails to BUILD and every assertion below fails at once. The loud case masking the quiet ones is
// fine here — the guard only has to fail when the rule regresses, and a build error is the better of
// the two outcomes to get.
//
// `as` is in the continuation set but deliberately NOT demoed: the operator carries a
// no-line-terminator restriction, so `x` ⏎ `as number` is a syntax error in TypeScript itself. Not
// severing it is still right (the lane should not invent a statement boundary), but there is no
// working program to render, so the unit test is the only place that case can live.
test('a multi-line right-hand side is not severed at the line break', async ({ page }) => {
    await page.goto('/templating/scripts')

    // count starts at 2, so the ternary takes its ELSE branch. Severed, this reads "true".
    await expect(page.getByTestId('rhs-ternary')).toHaveText('few')
    await expect(page.getByTestId('rhs-binary')).toHaveText('4')
    await expect(page.getByTestId('rhs-member')).toHaveText('a then b')
    await expect(page.getByTestId('rhs-instanceof')).toHaveText('a date')
    await expect(page.getByTestId('rhs-in')).toHaveText('present')
    await expect(page.getByTestId('rhs-template')).toHaveText('2 items')

    // Re-run the whole set in the BROWSER: SSR evaluates the script once server-side, so without a
    // client write every assertion above would also pass against a client bundle that never ran.
    await page.getByTestId('bump').click()

    // count is 3 now — the ternary flips, which is the value that proves the branches were reached
    // rather than the condition being stored.
    await expect(page.getByTestId('rhs-ternary')).toHaveText('many')
    await expect(page.getByTestId('rhs-binary')).toHaveText('6')
    await expect(page.getByTestId('rhs-member')).toHaveText('a then b then c')
    await expect(page.getByTestId('rhs-template')).toHaveText('3 items')
})
