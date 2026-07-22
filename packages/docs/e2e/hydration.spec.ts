import { expect, test } from '@playwright/test'

// Regression (soft-nav seed-ordinal desync): when a page has a `{#for await}`/streamed block whose
// hydration create-falls-back, `claimBlock` re-mounts the enclosing region in CREATE mode. That re-run
// must NOT replay/advance the seed ordinal (create mode has no server nodes to match) — otherwise every
// sibling component's seeded `state()` gets a shifted value. Here each Demo's open source tab is a seeded
// state; a desync left panels with no `active` class (code hidden until you clicked the tab).
test('soft-nav to a page with {#for await} keeps every demo tab correctly seeded', async ({ page }) => {
  await page.goto('/templating/reactivity')
  await page.getByRole('link', { name: 'Async blocks', exact: true }).click() // soft-nav → /templating/async
  await expect(page).toHaveURL(/\/templating\/async$/)
  // `toHaveURL` resolves on the history push — BEFORE the soft-nav content swap. Wait for the destination
  // page's own content to be in the DOM before counting `.sample`, else under load we count the OUTGOING
  // page's samples (a different number) and assert on stale indices. Then: every sample has exactly one
  // active source panel (matching its default tab), none hidden.
  await expect(page.locator('h1')).toHaveText('Async control flow')
  const samples = page.locator('.sample')
  const n = await samples.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    await expect(samples.nth(i).locator('.tab-panel.active')).toHaveCount(1)
  }
})

// /pages/hydration embeds a HydrationProbe in every hydration scenario (static, {#if}, {#for},
// nested component, streamed {#await}:then, streamed {#for await} item). Each probe is a seeded
// `state` that reads "server" only when its block was server-rendered AND cleanly CLAIMED; a
// create-fallback (mismatch / a streamed branch the client couldn't claim) flips it to "client". A
// probe carries what it SHOULD read (`data-ok` = origin matches its contract) — "server" for a
// claiming block, "client" for the {#for await} list that re-renders by design. So "zero mismatches"
// (data-ok="false") is a cross-scenario proof of correct hydration — the eyeball test, asserted.
const PROBE = '[data-testid="probe"]'

test('every hydration scenario hydrates to its contract on a hard load (no mismatched probe)', async ({
  page,
}) => {
  const warnings: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text())
  })

  await page.goto('/pages/hydration')
  // The streamed scenarios settle after their reads; wait for the last chunk, then assert the matrix.
  await expect(page.locator(`${PROBE}[data-label="chunk-3"]`)).toBeVisible()
  await expect(page.locator(`${PROBE}`)).toHaveCount(10)
  await expect(page.locator(`${PROBE}[data-ok="false"]`)).toHaveCount(0)
  // The claiming blocks (all but the 3 {#for await} chunks) genuinely CLAIMED — server-origin.
  await expect(page.locator(`${PROBE}[data-origin="server"]`)).toHaveCount(7)
  expect(warnings.filter((t) => /hydrat/i.test(t))).toEqual([])
})

test('every hydration scenario still hydrates to its contract when reached by a soft-nav', async ({
  page,
}) => {
  // Soft-nav exercises the streamed-patch-adoption path (the fill/append/complete frames): a streamed
  // {#await}:then branch that failed to adopt would create-fallback and its "await-then" probe would
  // flip to "client" (a mismatch). So this is the observable, non-seed-masked guard for that path.
  await page.goto('/pages/structure')
  await page.locator('aside.sidebar').getByRole('link', { name: 'Hydration health' }).click()
  await expect(page).toHaveURL(/\/pages\/hydration$/)
  await expect(page.locator(`${PROBE}[data-label="chunk-3"]`)).toBeVisible()
  await expect(page.locator(`${PROBE}`)).toHaveCount(10)
  await expect(page.locator(`${PROBE}[data-ok="false"]`)).toHaveCount(0)
  // The streamed single-{#await} claimed cleanly across the soft-nav (the fix's real coverage).
  await expect(page.locator(`${PROBE}[data-label="await-then"]`)).toHaveAttribute(
    'data-origin',
    'server',
  )
})
