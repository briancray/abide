import { expect, test } from "@playwright/test"

// Drives the reactivity demo page in a real browser: SSR values, client hydration, and every
// reactive primitive in bucket 5 (state / computed / linked / watch×2 / props / html).

const PAGE = "/reactivity/demo"

test("props() reader renders the fallback heading", async ({ page }) => {
  await page.goto(PAGE)
  // A page's props are empty, so the destructuring fallback from props() is what renders.
  await expect(page.locator("h1")).toHaveText("Reactivity playground")
})

test("state(v) counter increments, decrements, and clamps via its transform", async ({ page }) => {
  await page.goto(PAGE)
  const count = page.getByTestId("count")
  await expect(count).toHaveText("0") // SSR value

  const inc = page.getByTestId("inc")
  await inc.click()
  await expect(count).toHaveText("1")
  await inc.click()
  await inc.click()
  await expect(count).toHaveText("3")

  await page.getByTestId("dec").click()
  await expect(count).toHaveText("2")

  // The state transform clamps every write into 0..10 — hammering increment never exceeds 10.
  for (let i = 0; i < 15; i++) await inc.click()
  await expect(count).toHaveText("10")

  await page.getByTestId("reset").click()
  await expect(count).toHaveText("0")
})

test("state.computed derives reactively from the counter", async ({ page }) => {
  await page.goto(PAGE)
  const doubled = page.getByTestId("doubled")
  await expect(doubled).toHaveText("0")

  await page.getByTestId("inc").click()
  await expect(doubled).toHaveText("2")
  await page.getByTestId("inc").click()
  await expect(doubled).toHaveText("4")
})

test("state.linked is independently writable and reseeds when its source changes", async ({
  page,
}) => {
  await page.goto(PAGE)
  const draft = page.getByTestId("draft")
  await expect(draft).toHaveText("0") // seeded to count(0) * 100

  // Local writes hold until the next reseed.
  await page.getByTestId("bump-draft").click()
  await page.getByTestId("bump-draft").click()
  await expect(draft).toHaveText("2")

  // Changing the source (count) reseeds the linked cell, discarding the local edits.
  await page.getByTestId("inc").click() // count -> 1
  await expect(draft).toHaveText("100")

  await page.getByTestId("inc").click() // count -> 2
  await expect(draft).toHaveText("200")
})

test("watch(source, handler) pushes a side effect into the DOM on change only", async ({
  page,
}) => {
  await page.goto(PAGE)
  const changes = page.getByTestId("changes")
  // Handler does NOT run on the initial read.
  await expect(changes).toHaveText("0")

  await page.getByTestId("inc").click()
  await expect(changes).toHaveText("1")
  await page.getByTestId("inc").click()
  await page.getByTestId("dec").click()
  await expect(changes).toHaveText("3")
})

test("watch(thunk) auto-tracks and mirrors a derived value", async ({ page }) => {
  await page.goto(PAGE)
  const mirror = page.getByTestId("mirror")
  // mirror = doubled + 1; at count 0 that is 1 (seeded synchronously on mount).
  await expect(mirror).toHaveText("1")

  await page.getByTestId("inc").click() // count 1 -> doubled 2 -> mirror 3
  await expect(mirror).toHaveText("3")
  await page.getByTestId("inc").click() // count 2 -> doubled 4 -> mirror 5
  await expect(mirror).toHaveText("5")
})

test("snippet child component re-renders when its reactive props change", async ({ page }) => {
  await page.goto(PAGE)
  const badges = page.getByTestId("badges")
  await expect(badges).toContainText("Live count: 0")
  await expect(badges).toContainText("Doubled: 0")

  await page.getByTestId("inc").click()
  await expect(badges).toContainText("Live count: 1")
  await expect(badges).toContainText("Doubled: 2")
})

test("html() renders raw markup and swaps it live", async ({ page }) => {
  await page.goto(PAGE)
  const raw = page.getByTestId("raw")

  // Raw markup is really injected as an element (not escaped text).
  await expect(raw.locator("em")).toHaveText("italic emphasis")
  await expect(raw.locator("strong")).toHaveCount(0)

  await page.getByTestId("toggle-raw").click()
  await expect(raw.locator("strong")).toHaveText("bold shout")
  await expect(raw.locator("em")).toHaveCount(0)

  await page.getByTestId("toggle-raw").click()
  await expect(raw.locator("em")).toHaveText("italic emphasis")
})

test("state.shared: two component instances share one cell by key", async ({ page }) => {
  await page.goto(PAGE)
  const aVal = page.getByTestId("tally-a-val")
  const bVal = page.getByTestId("tally-b-val")

  // Both instances start from the shared initial (also the SSR value).
  await expect(aVal).toHaveText("0")
  await expect(bVal).toHaveText("0")

  // Bumping instance A updates BOTH — they share the same backing signal by key.
  await page.getByTestId("tally-a-bump").click()
  await expect(aVal).toHaveText("1")
  await expect(bVal).toHaveText("1")

  // Bumping instance B advances the same shared value.
  await page.getByTestId("tally-b-bump").click()
  await expect(aVal).toHaveText("2")
  await expect(bVal).toHaveText("2")
})

test("state.shared: a write syncs across browser tabs via BroadcastChannel", async ({
  context,
}) => {
  const tabOne = await context.newPage()
  await tabOne.goto(PAGE)
  const tabTwo = await context.newPage()
  await tabTwo.goto(PAGE)

  // Bump in tab one; tab two's shared cell reflects it without any reload.
  await tabOne.getByTestId("tally-a-bump").click()
  await expect(tabTwo.getByTestId("tally-a-val")).toHaveText("1")

  await tabOne.close()
  await tabTwo.close()
})
