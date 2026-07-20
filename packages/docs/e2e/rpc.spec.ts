import { expect, test } from "@playwright/test"

// Drives the RPC-bucket docs pages in a real browser: SSR reads landing in HTML, mutations called
// over fetch after hydration, streaming (jsonl/sse) reads rendered with {#for await}, typed-error
// narrowing, redirects, and the three template async-read forms.

test.describe("RPC verbs", () => {
  test("GET read is server-rendered into the HTML", async ({ page }) => {
    await page.goto("/rpc-guide/verbs")
    await expect(page.locator("h1")).toHaveText("RPC verbs")
    await expect(page.getByTestId("get-read")).toHaveText("Hello, verbs page!")
  })

  test("HEAD read returns a 200 status via a raw fetch", async ({ page }) => {
    await page.goto("/rpc-guide/verbs")
    await expect(page.getByTestId("head-status")).toHaveText("0")
    await page.getByTestId("head-btn").click()
    await expect(page.getByTestId("head-status")).toHaveText("200")
  })

  test("POST / PUT / PATCH / DELETE mutations run from the browser", async ({ page }) => {
    await page.goto("/rpc-guide/verbs")

    // Each verb is now its own self-contained card with its own result readout.
    await page.getByTestId("post-btn").click()
    await expect(page.getByTestId("post-result")).toContainText("verb: POST")
    await expect(page.getByTestId("post-result")).toContainText("text: first draft")

    await page.getByTestId("put-btn").click()
    await expect(page.getByTestId("put-result")).toContainText("verb: PUT")

    await page.getByTestId("patch-btn").click()
    await expect(page.getByTestId("patch-result")).toContainText("verb: PATCH")

    await page.getByTestId("delete-btn").click()
    await expect(page.getByTestId("delete-result")).toContainText("verb: DELETE")
  })

  test("bind:value feeds the typed note text into the mutation body", async ({ page }) => {
    await page.goto("/rpc-guide/verbs")
    const input = page.getByTestId("verb-input")
    await input.fill("edited note")
    await page.getByTestId("post-btn").click()
    await expect(page.getByTestId("post-result")).toContainText("text: edited note")
  })
})

test.describe("Response helpers", () => {
  test("json() bare-return value is server-rendered", async ({ page }) => {
    await page.goto("/rpc-guide/responses")
    await expect(page.getByTestId("json-result")).toContainText("greeting: Hello, json!")
  })

  test("jsonl() stream renders each line with {#for await}", async ({ page }) => {
    await page.goto("/rpc-guide/responses")
    await page.getByTestId("jsonl-btn").click()
    const items = page.getByTestId("jsonl-list").locator("li")
    await expect(items).toHaveCount(4)
    await expect(items.last()).toHaveText("tick 4 of 4")
  })

  test("sse() stream renders each frame with {#for await}", async ({ page }) => {
    await page.goto("/rpc-guide/responses")
    await page.getByTestId("sse-btn").click()
    const items = page.getByTestId("sse-list").locator("li")
    await expect(items).toHaveCount(3)
    await expect(items.last()).toHaveText("#3 — final")
  })

  test("error(status, message) surfaces as a caught HttpError", async ({ page }) => {
    await page.goto("/rpc-guide/responses")
    await page.getByTestId("error-btn").click()
    await expect(page.getByTestId("error-result")).toHaveText("422 — note text is required")
  })

  test("error.typed narrows to the named error via fn.isError", async ({ page }) => {
    await page.goto("/rpc-guide/responses")
    await page.getByTestId("typed-btn").click()
    const result = page.getByTestId("typed-result")
    await expect(result).toContainText("caught: RateLimited")
    await expect(result).toContainText("status 429")
    await expect(result).toContainText("retryAfter 30")
  })

  test("redirect() is observed by the browser fetch", async ({ page }) => {
    await page.goto("/rpc-guide/responses")
    await page.getByTestId("redirect-btn").click()
    await expect(page.getByTestId("redirect-result")).toHaveText("redirected: true → /rpc")
  })
})

test.describe("Async reads in templates", () => {
  test("{await fn()} blocks SSR and lands the value in the HTML", async ({ page }) => {
    await page.goto("/rpc-guide/async-reads")
    await expect(page.getByTestId("await-read")).toHaveText("Hello from abide, async reads!")
  })

  test("sample headers render literal braces, not the escape sequence", async ({ page }) => {
    await page.goto("/rpc-guide/async-reads")
    // The card title shows `{await fn()}` — the literal braces, not a raw `{'{'}` escape.
    const header = page.locator("#await-read h2")
    await expect(header).toHaveText("{await fn()} — blocking read")
    await expect(header).not.toContainText("{'{'}")
  })

  test("{fn()} peek renders the read value", async ({ page }) => {
    await page.goto("/rpc-guide/async-reads")
    await expect(page.getByTestId("peek-read")).toHaveText("Hello from abide, peek!")
  })

  test("{#await}/{:then} renders the resolved read", async ({ page }) => {
    await page.goto("/rpc-guide/async-reads")
    await expect(page.getByTestId("await-then")).toContainText("greeting: Hello, await block!")
  })

  test("{#await fn() then v} inline shorthand renders the resolved value", async ({ page }) => {
    await page.goto("/rpc-guide/async-reads")
    await expect(page.getByTestId("inline-then")).toHaveText("Hello, inline then! (11)")
  })

  test("fn.peek probe returns the cached value after the read resolves", async ({ page }) => {
    await page.goto("/rpc-guide/async-reads")
    // Wait for the {#await} block to have resolved (its slot is now cached).
    await expect(page.getByTestId("await-then")).toContainText("greeting: Hello, await block!")
    await page.getByTestId("peek-btn").click()
    await expect(page.getByTestId("peek-value")).toHaveText("Hello, await block!")
  })

  test("fn.raw returns the untouched Response — status, header, and JSON body", async ({
    page,
  }) => {
    await page.goto("/rpc-guide/async-reads")
    await page.getByTestId("raw-btn").click()
    const result = page.getByTestId("raw-result")
    await expect(result).toContainText("status: 200")
    await expect(result).toContainText("content-type: application/json")
    await expect(result).toContainText("Hello, raw!")
  })

  test("in-template fn.pending()/fn.error() probes reflect the resolving slot", async ({
    page,
  }) => {
    await page.goto("/rpc-guide/async-reads")
    // The read resolves: the value branch renders, pending clears to false, error stays none.
    await expect(page.getByTestId("probe-value")).toHaveText("Hello, probe!")
    await expect(page.getByTestId("probe-pending-flag")).toHaveText("false")
    await expect(page.getByTestId("probe-error-flag")).toHaveText("none")
  })
})
