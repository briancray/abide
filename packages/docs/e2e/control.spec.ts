import { expect, test } from '@playwright/test'

// These specs drive the REAL docs app in a real browser: SSR HTML + client hydration + live
// reactivity of every `.abide` control-flow block in the "control" capability bucket. Each block
// has interactive controls, and each test asserts the DOM reacts to a click.

test('control hub links to every control-flow demo', async ({ page }) => {
    await page.goto('/control')
    await expect(page.locator('h1')).toHaveText('Control flow')
    await expect(page.getByRole('link', { name: 'Conditionals' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Lists' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Components & snippets' })).toBeVisible()
})

test('{#if}/{:else if}/{:else} swaps branches as state crosses thresholds', async ({ page }) => {
    await page.goto('/control/conditionals')

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
    await page.goto('/control/conditionals')

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
    await page.goto('/control/lists')

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
    await page.goto('/control/lists')

    const nums = page.getByTestId('keyless-item')
    await expect(nums).toHaveCount(3)
    await expect(nums.nth(0)).toHaveText('10')

    await page.getByTestId('push-num').click()
    await expect(nums).toHaveCount(4)

    await page.getByTestId('pop-num').click()
    await page.getByTestId('pop-num').click()
    await expect(nums).toHaveCount(2)
})

test('{#await}/{:then}/{:catch}/{:finally} tracks a promise through settle', async ({ page }) => {
    await page.goto('/control/async')

    // The RPC-backed {#await} resolves during SSR — its value is in the initial HTML.
    await expect(page.getByTestId('rpc-await')).toContainText('Hello, control flow')

    // Success path: pending → then, with finally.
    await page.getByTestId('run-success').click()
    await expect(page.getByTestId('job-pending')).toBeVisible()
    await expect(page.getByTestId('job-done')).toBeVisible()
    await expect(page.getByTestId('job-done')).toContainText('resolved after a delay')
    await expect(page.getByTestId('job-finally')).toBeVisible()

    // Failure path: pending → catch.
    await page.getByTestId('run-fail').click()
    await expect(page.getByTestId('job-error')).toBeVisible()
    await expect(page.getByTestId('job-error')).toContainText('the job failed')
    await expect(page.getByTestId('job-finally')).toBeVisible()
})

test('{#for await} streams chunks and falls to {:catch} on stream error', async ({ page }) => {
    await page.goto('/control/async')

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
    await page.goto('/control/async')

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
    await page.goto('/control/errors')

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

test('component renders {children()} + reactive props; snippets and render-props work', async ({
    page,
}) => {
    await page.goto('/control/components')

    // Component with a single {children()} slot and a reactive title prop.
    await expect(page.getByTestId('card-title')).toHaveText('Original title')
    await expect(page.getByTestId('card-count')).toHaveText('0')

    await page.getByTestId('rename').click()
    await expect(page.getByTestId('card-title')).toHaveText('Renamed title')

    // The slot content stays live after hydration.
    await page.getByTestId('inc').click()
    await expect(page.getByTestId('card-count')).toHaveText('1')

    // A snippet called inline as {name(args)}, repeated.
    await expect(page.getByTestId('chip')).toHaveCount(3)
    await expect(page.getByTestId('chip').nth(0)).toHaveText('alpha')

    // A snippet passed as a render-prop and called by the component.
    await expect(page.getByTestId('loud')).toHaveText('RENDERED VIA PROP')

    // {...obj} spread into a child component: every key arrives as a prop.
    const child = page.getByTestId('spread-child')
    await expect(child).toHaveAttribute('data-kind', 'metric')
    await expect(child).toHaveText('Requests: 42')
})
