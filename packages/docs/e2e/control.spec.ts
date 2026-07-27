import { expect, test } from './fixtures.ts'

// These specs drive the REAL docs app in a real browser: SSR HTML + client hydration + live
// reactivity of every `.abide` control-flow block in the "control" capability bucket. Each block
// has interactive controls, and each test asserts the DOM reacts to a click.

test('{#if}/{:else if}/{:else} swaps branches as state crosses thresholds', async ({ page }) => {
    await page.goto('/templating/conditionals')

    const branch = page.getByTestId('if-branch')
    await expect(branch).toHaveText('zero')

    await page.getByTestId('level-inc').click()
    await expect(branch).toHaveText('low (1)')

    // Push to 5 → the {:else} branch.
    for (let i = 0; i < 4; i++) await page.getByTestId('level-inc').click()
    await expect(branch).toHaveText('high (5)')

    // Drive below zero → the first {#if} branch.
    for (let i = 0; i < 6; i++) await page.getByTestId('level-dec').click()
    await expect(branch).toHaveText('negative')
})

test('{#switch}/{:case}/{:default} matches the active case', async ({ page }) => {
    await page.goto('/templating/conditionals')

    const branch = page.getByTestId('switch-branch')
    await expect(branch).toHaveText('Waiting to start.')

    await page.getByTestId('status-loading').click()
    await expect(branch).toHaveText('Working on it…')

    await page.getByTestId('status-done').click()
    await expect(branch).toHaveText('All finished!')

    // An unmatched value falls through to {:default}.
    await page.getByTestId('status-other').click()
    await expect(branch).toHaveText('Unknown status: mystery')
})

test('{#for … by key} adds, removes, and reorders keyed items', async ({ page }) => {
    await page.goto('/templating/lists')

    const items = page.getByTestId('keyed-item')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('Alpha')
    await expect(items.nth(2)).toContainText('Gamma')

    // Add a keyed item.
    await page.getByTestId('add').click()
    await expect(items).toHaveCount(4)
    await expect(items.nth(3)).toContainText('Item 4')

    // Remove the first item.
    await page.getByTestId('remove-first').click()
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('Beta')

    // Reverse — keyed reconciliation moves nodes; index labels recompute.
    await page.getByTestId('reverse').click()
    await expect(items.nth(0)).toContainText('Item 4')
    await expect(items.nth(2)).toContainText('Beta')
    await expect(items.nth(0)).toContainText('#0')
})

test('keyless positional {#for} maps a plain value list', async ({ page }) => {
    await page.goto('/templating/lists')

    const nums = page.getByTestId('keyless-item')
    await expect(nums).toHaveCount(3)
    await expect(nums.nth(0)).toHaveText('10')

    await page.getByTestId('push-num').click()
    await expect(nums).toHaveCount(4)

    await page.getByTestId('pop-num').click()
    await page.getByTestId('pop-num').click()
    await expect(nums).toHaveCount(2)
})

test('a bare {await} resolves during SSR and re-awaits on refresh', async ({ page }) => {
    await page.goto('/templating/async')

    // The RPC-backed bare {await} interpolation resolves during SSR — its value is in the initial HTML.
    const greeting = page.getByTestId('rpc-await')
    await expect(greeting).toContainText('Hello, control flow')
    const before = await greeting.textContent()

    // "Run again" refreshes the memo and the interpolation re-awaits IN PLACE. This asserts the value
    // moves, which is the only thing that proves the refresh woke the reader: a refresh landing an
    // identity-equal value is now a deliberate no-op, so a fixed-string handler would pass a
    // toContainText check while the button did nothing.
    await page.getByTestId('replay').click()
    await expect(greeting).not.toHaveText(before ?? '')
    await expect(greeting).toContainText('Hello, control flow')
})

test('{#await}/{:then}/{:catch}/{:finally} tracks a promise through settle', async ({ page }) => {
    await page.goto('/templating/async')

    // Success path: pending → then, with finally.
    await page.getByTestId('run-success').click()
    await expect(page.getByTestId('job-pending')).toBeVisible()
    await expect(page.getByTestId('job-done')).toBeVisible()
    await expect(page.getByTestId('job-done')).toContainText('resolved after a delay')
    await expect(page.getByTestId('job-finally')).toBeVisible()
    // Source order: the resolved branch renders BEFORE {:finally} (not the other way around).
    await expect(page.getByTestId('job')).toHaveText(/done: resolved after a delay\s*·\s*settled/)

    // Failure path: pending → catch.
    await page.getByTestId('run-fail').click()
    await expect(page.getByTestId('job-error')).toBeVisible()
    await expect(page.getByTestId('job-error')).toContainText('the job failed')
    await expect(page.getByTestId('job-finally')).toBeVisible()
    await expect(page.getByTestId('job')).toHaveText(/error: the job failed\s*·\s*settled/)
})

test('{#for await} streams chunks and falls to {:catch} on stream error', async ({ page }) => {
    await page.goto('/templating/async')

    // Initial stream (seeded on mount) yields three chunks.
    await expect(page.getByTestId('feed-item')).toHaveCount(3)

    // A failing stream emits its chunks, then appends the {:catch} branch.
    await page.getByTestId('run-stream-fail').click()
    await expect(page.getByTestId('feed-error')).toBeVisible()
    await expect(page.getByTestId('feed-error')).toContainText('stream error: the stream broke')

    // Re-running a good stream clears the error and yields three chunks again.
    await page.getByTestId('run-stream').click()
    await expect(page.getByTestId('feed-error')).toHaveCount(0)
    await expect(page.getByTestId('feed-item')).toHaveCount(3)
})

test('done(stream): the completion probe flips true once the stream drains', async ({ page }) => {
    await page.goto('/templating/async')

    // Nothing until the stream is started.
    await expect(page.getByTestId('done-status')).toHaveCount(0)

    await page.getByTestId('done-start').click()
    // Immediately after starting, the stream is still draining.
    await expect(page.getByTestId('done-status')).toHaveText('streaming…')
    // Three chunks arrive, then the probe flips to complete.
    await expect(page.getByTestId('done-item')).toHaveCount(3)
    await expect(page.getByTestId('done-status')).toHaveText('complete')

    // Re-running creates a FRESH stream object: the probe resets to streaming, then completes again.
    await page.getByTestId('done-start').click()
    await expect(page.getByTestId('done-status')).toHaveText('streaming…')
    await expect(page.getByTestId('done-status')).toHaveText('complete')
    await expect(page.getByTestId('done-item')).toHaveCount(3)
})

test('{#try}/{:catch}/{:finally} catches a throw and recovers', async ({ page }) => {
    await page.goto('/templating/errors')

    await expect(page.getByTestId('try-body')).toContainText('computed successfully')
    await expect(page.getByTestId('try-finally')).toBeVisible()

    // Throw inside the body → the {:catch} branch replaces it; {:finally} still runs.
    await page.getByTestId('run-fail').click()
    await expect(page.getByTestId('try-caught')).toContainText('something went wrong')
    await expect(page.getByTestId('try-body')).toHaveCount(0)
    await expect(page.getByTestId('try-finally')).toBeVisible()

    // Recover → the body renders again.
    await page.getByTestId('run-ok').click()
    await expect(page.getByTestId('try-body')).toContainText('computed successfully')
    await expect(page.getByTestId('try-caught')).toHaveCount(0)
})

test('inline components: <slot/>, tag invocation, render-props, spread, named slots, reactive', async ({
    page,
}) => {
    await page.goto('/templating/components')

    // Inline component with a single <slot/> and a reactive title prop.
    await expect(page.getByTestId('card-title')).toHaveText('Original title')
    await expect(page.getByTestId('card-count')).toHaveText('0')

    await page.getByTestId('rename').click()
    await expect(page.getByTestId('card-title')).toHaveText('Renamed title')

    // The slot content stays live after hydration.
    await page.getByTestId('inc').click()
    await expect(page.getByTestId('card-count')).toHaveText('1')

    // A component invoked as a tag <Chip text="…"/>, repeated.
    await expect(page.getByTestId('chip')).toHaveCount(3)
    await expect(page.getByTestId('chip').nth(0)).toHaveText('alpha')

    // A component passed as a prop and invoked by the receiver as a render-prop.
    await expect(page.getByTestId('loud')).toHaveText('RENDERED VIA PROP')

    // {...obj} spread into a child component: every key arrives as a prop.
    const child = page.getByTestId('spread-child')
    await expect(child).toHaveAttribute('data-kind', 'metric')
    await expect(child).toHaveText('Requests: 42')

    // A nested {#component} inside <Panel> arrives as Panel's Header prop; <slot/> fills automatically.
    await expect(page.getByTestId('ns-title')).toHaveText('Nested header')
    await expect(page.getByTestId('ns-body')).toHaveText('This is the default slot content.')

    // Reactive component: a cell-named tag <Current/> re-mounts when the computed selects a new one.
    await expect(page.getByTestId('reactive-status')).toHaveText('Pending…')
    await page.getByTestId('reactive-toggle').click()
    await expect(page.getByTestId('reactive-status')).toHaveText('Done ✓')
})

test('an inline component invoked — and defined — inside {#for}/{#if}', async ({ page }) => {
    // Every other components test invokes at the top level. This one puts the invocation INSIDE a block
    // body (the `{#for}` path that gives each item its own component scope) and puts a `{#component}`
    // DEFINITION inside a branch body, then drives both through SSR, hydration, and reconciliation.

    // SSR half: the rows are component-rendered in the initial HTML, not painted by the client.
    const raw = await (await page.request.get('/templating/components')).text()
    expect(raw).toContain('data-testid="block-row"')
    expect(raw.match(/data-testid="block-label"/g)?.length).toBe(3)

    await page.goto('/templating/components')
    const rows = page.getByTestId('block-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Alpha')
    await expect(rows.nth(0)).toContainText('#0')

    // Tag the first row's DOM node. A keyed reconcile MOVES a component row's whole range; a rebuild
    // produces identical text, so only node identity distinguishes the two.
    await rows.nth(0).evaluate((node) => node.setAttribute('data-marked', 'yes'))

    await page.getByTestId('block-add').click()
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(3)).toContainText('Item 4')

    await page.getByTestId('block-reverse').click()
    await expect(rows.nth(0)).toContainText('Item 4')
    // Alpha moved to the end carrying its node — the component instance was relocated, not rebuilt —
    // and the `index` prop recomputed for it on the way.
    await expect(rows.nth(3)).toContainText('Alpha')
    await expect(rows.nth(3)).toContainText('#3')
    await expect(rows.nth(3)).toHaveAttribute('data-marked', 'yes')

    // Same keys, fresh objects: the prop updates THROUGH the component boundary, in place.
    await page.getByTestId('block-shout').click()
    await expect(rows.nth(3)).toContainText('ALPHA')
    await expect(rows.nth(3)).toHaveAttribute('data-marked', 'yes')

    // The {:else} branch declares `Collapsed` in its own body and invokes it there.
    await page.getByTestId('block-toggle').click()
    await expect(page.getByTestId('block-list')).toHaveCount(0)
    await expect(page.getByTestId('block-collapsed')).toHaveText('4 rows hidden')

    // Its `count` prop stays live while the branch is mounted — a declared param is an accessor over
    // the caller's props, not a value copied in at mount.
    await page.getByTestId('block-add').click()
    await expect(page.getByTestId('block-collapsed')).toHaveText('5 rows hidden')

    // Back to the {#if} branch: the whole list stands up again from the same keyed data.
    await page.getByTestId('block-toggle').click()
    await expect(page.getByTestId('block-collapsed')).toHaveCount(0)
    await expect(rows).toHaveCount(5)
    await expect(rows.nth(0)).toContainText('ITEM 4')
})
