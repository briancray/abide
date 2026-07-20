import { expect, test } from '@playwright/test'

// Regression (soft-nav seed-ordinal desync): when a page has a `{#for await}`/streamed block whose
// hydration create-falls-back, `claimBlock` re-mounts the enclosing region in CREATE mode. That re-run
// must NOT replay/advance the seed ordinal (create mode has no server nodes to match) — otherwise every
// sibling component's seeded `state()` gets a shifted value. Here each Demo's open source tab is a seeded
// state; a desync left panels with no `active` class (code hidden until you clicked the tab).
test('soft-nav to a page with {#for await} keeps every demo tab correctly seeded', async ({ page }) => {
  await page.goto('/reactivity')
  await page.getByRole('link', { name: 'Await', exact: true }).click() // soft-nav → /control/async
  await expect(page).toHaveURL(/\/control\/async$/)
  // Every sample must have exactly one active source panel (matching its default tab), none hidden.
  const samples = page.locator('.sample')
  const n = await samples.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    await expect(samples.nth(i).locator('.tab-panel.active')).toHaveCount(1)
  }
})
