import { expect, test } from "@playwright/test"

// Streaming SSR (streaming-ssr-plan PR2/PR3). A slow (40ms) server `{#await}` read misses the 4ms
// render deadline, so SSR flushes the shell with an `<abide-slot>` placeholder and streams the resolved
// branch as an out-of-order `<template>` patch + move-script. On the client the patch fills the slot
// pre-hydration; then the deferred module bundle hydrates and UNWRAPS the slot, CLAIMING the streamed
// branch in place (decision (a)) — so it stays reactive with no re-create.

test("a slow {#await} read streams, then hydration claims it in place + it stays reactive", async ({
  page,
}) => {
  const warnings: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "warning" || msg.type() === "error") warnings.push(msg.text())
  })

  // The RAW first-load HTML actually STREAMED — a placeholder slot AND an out-of-order patch, not an
  // inline render. This proves the deadline classified the 40ms read as streaming.
  const raw = await (await page.request.get("/streaming")).text()
  expect(raw).toContain("<abide-slot")
  expect(raw).toContain("data-ab-patch")

  await page.goto("/streaming")

  // The streamed resolved branch is present after load.
  const value = page.getByTestId("value")
  await expect(value).toBeVisible()
  await expect(value).toContainText("runs:")
  const before = (await value.textContent())?.trim() ?? ""

  // Hydration UNWRAPPED the placeholder — no `<abide-slot>` survives in the live DOM.
  await expect(page.locator("abide-slot")).toHaveCount(0)

  // The CLAIMED await block is still reactive: refresh re-fetches and re-renders the streamed subtree
  // in place (the run counter advances).
  await page.getByTestId("refresh").click()
  await expect(value).toContainText("runs:")
  await expect(value).not.toHaveText(before)

  // Clean claim — a mis-claim would have create-fallen-back and warned.
  expect(warnings.filter((text) => /hydrat/i.test(text))).toEqual([])
})

// Streaming ERROR (PR5): a slow read that REJECTS with a `{:catch}` streams the catch branch as its
// patch (no 500 — the shell already flushed). Server-side the catch sees the raw error (proven in the
// abide integration tests); the BROWSER shows the client's view — the handler throw became an HTTP 500
// on the wire (raw messages are not leaked), and since an errored read carries no seed the client
// re-fetches and its `{:catch}` renders the resulting `HttpError` ("Internal Server Error").
test("a slow {#await} that rejects renders its {:catch} branch (client HTTP-error view)", async ({
  page,
}) => {
  await page.goto("/streaming")

  const errorValue = page.getByTestId("error-value")
  await expect(errorValue).toBeVisible()
  await expect(errorValue).toContainText("Internal Server Error")

  // Both streamed slots (the resolved one and the errored one) were unwrapped by hydration.
  await expect(page.locator("abide-slot")).toHaveCount(0)
})

// Streaming SOFT-NAV (PR4): an in-app navigation streams too. The soft-nav body is a JSONL frame
// stream (shell → patches → seed); the client swaps the shell, fills each `<abide-slot>` as its patch
// frame arrives, then hydrates — so a slow read shows the shell then streams in, WITHOUT a full reload.
test("an in-app soft-nav to /streaming streams progressively (shell then patch), no full reload", async ({
  page,
}) => {
  await page.goto("/rpc")

  // A full reload would wipe this marker; a soft-nav keeps it.
  await page.evaluate(() => {
    ;(window as unknown as { __abideNoReload?: boolean }).__abideNoReload = true
  })

  await page.locator("aside.sidebar").getByRole("link", { name: "Streaming SSR" }).click()
  await expect(page).toHaveURL(/\/streaming$/)

  // Progressive: the shell's pending fallback shows first, then the streamed patch replaces it.
  await expect(page.getByTestId("pending")).toBeVisible()
  await expect(page.getByTestId("value")).toContainText("runs:")

  // It was a soft-nav (no full document reload) and the streamed subtree hydrated (slot unwrapped).
  const survived = await page.evaluate(
    () => (window as unknown as { __abideNoReload?: boolean }).__abideNoReload === true,
  )
  expect(survived).toBe(true)
  await expect(page.locator("abide-slot")).toHaveCount(0)

  // Reactive after the streamed soft-nav.
  const before = (await page.getByTestId("value").textContent())?.trim() ?? ""
  await page.getByTestId("refresh").click()
  await expect(page.getByTestId("value")).not.toHaveText(before)
})
