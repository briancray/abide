import { expect, test } from '@playwright/test'

// Drives the RPC-bucket docs pages in a real browser: SSR reads landing in HTML, mutations called
// over fetch after hydration, streaming (jsonl/sse) reads rendered with {#for await}, typed-error
// narrowing, redirects, and the three template async-read forms.

test.describe('Reads', () => {
    test('GET read is server-rendered into the HTML', async ({ page }) => {
        await page.goto('/rpc/reads')
        await expect(page.locator('h1')).toHaveText('Reads')
        await expect(page.getByTestId('get-read')).toHaveText('Hello, verbs page!')
    })

    test('HEAD read returns a 200 status via a raw fetch', async ({ page }) => {
        await page.goto('/rpc/reads')
        await expect(page.getByTestId('head-status')).toHaveText('0')
        await page.getByTestId('head-btn').click()
        await expect(page.getByTestId('head-status')).toHaveText('200')
    })

    test('{await fn()} blocks SSR and lands the value in the HTML', async ({ page }) => {
        await page.goto('/rpc/reads')
        await expect(page.getByTestId('await-read')).toHaveText('Hello from abide, async reads!')
    })

    test('sample headers render literal braces, not the escape sequence', async ({ page }) => {
        await page.goto('/rpc/reads')
        // The card title shows `{await fn()}` — the literal braces, not a raw `{'{'}` escape.
        const header = page.locator('#await-read h2')
        await expect(header).toHaveText('{await fn()} — blocking read')
        await expect(header).not.toContainText("{'{'}")
    })

    test('{fn()} peek renders the read value', async ({ page }) => {
        await page.goto('/rpc/reads')
        await expect(page.getByTestId('peek-read')).toHaveText('Hello from abide, peek!')
    })

    test('{#await}/{:then} renders the resolved read', async ({ page }) => {
        await page.goto('/rpc/reads')
        await expect(page.getByTestId('await-then')).toContainText('greeting: Hello, await block!')
    })

    test('{#await fn() then v} inline shorthand renders the resolved value', async ({ page }) => {
        await page.goto('/rpc/reads')
        await expect(page.getByTestId('inline-then')).toHaveText('Hello, inline then! (11)')
    })

    test('fn.raw returns the untouched Response — status, header, and JSON body', async ({
        page,
    }) => {
        await page.goto('/rpc/reads')
        await page.getByTestId('raw-btn').click()
        const result = page.getByTestId('raw-result')
        await expect(result).toContainText('status: 200')
        await expect(result).toContainText('content-type: application/json')
        await expect(result).toContainText('Hello, raw!')
    })

    test('in-template fn.pending()/fn.error() probes reflect the resolving slot', async ({
        page,
    }) => {
        await page.goto('/rpc/reads')
        // The read resolves: the value branch renders, pending clears to false, error stays none.
        await expect(page.getByTestId('probe-value')).toHaveText('Hello, probe!')
        await expect(page.getByTestId('probe-pending-flag')).toHaveText('false')
        await expect(page.getByTestId('probe-error-flag')).toHaveText('none')
    })
})

test.describe('Mutations', () => {
    test('POST / DELETE mutations run from the browser', async ({ page }) => {
        await page.goto('/rpc/mutations')

        await page.getByTestId('post-btn').click()
        await expect(page.getByTestId('post-result')).toContainText('verb: POST')
        await expect(page.getByTestId('post-result')).toContainText('text: first draft')

        await page.getByTestId('delete-btn').click()
        await expect(page.getByTestId('delete-result')).toContainText('verb: DELETE')
    })

    test('bind:value feeds the typed note text into the mutation body', async ({ page }) => {
        await page.goto('/rpc/mutations')
        const input = page.getByTestId('post-input')
        await input.fill('edited note')
        await page.getByTestId('post-btn').click()
        await expect(page.getByTestId('post-result')).toContainText('text: edited note')
    })

    test('cached mutation (cache: { ttl }) retains: a repeat call hits the cache, refresh re-runs', async ({
        page,
    }) => {
        await page.goto('/rpc/mutations')
        const out = page.getByTestId('cached-out')

        // First call runs the handler → runs: 1, and its reactive probe shows the retained value.
        await page.getByTestId('cached-call-btn').click()
        await expect(out).toContainText('runs: 1')

        // A repeat call within the ttl HITS the cache — the handler does not re-run, so runs stays 1.
        await page.getByTestId('cached-call-btn').click()
        await expect(out).toContainText('runs: 1')

        // refresh() re-runs the handler → runs bumps to 2 (mutation cache verbs work like a read's).
        await page.getByTestId('cached-refresh-btn').click()
        await expect(out).toContainText('runs: 2')
    })
})

test.describe('Response helpers', () => {
    test('json() bare-return value is server-rendered', async ({ page }) => {
        await page.goto('/rpc/responses')
        await expect(page.getByTestId('json-result')).toContainText('greeting: Hello, json!')
    })

    test('error(status, message) surfaces as a caught HttpError', async ({ page }) => {
        await page.goto('/rpc/responses')
        await page.getByTestId('error-btn').click()
        await expect(page.getByTestId('error-result')).toHaveText('422 — note text is required')
    })

    test('error.typed narrows to the named error via fn.isError', async ({ page }) => {
        await page.goto('/rpc/responses')
        await page.getByTestId('typed-btn').click()
        const result = page.getByTestId('typed-result')
        await expect(result).toContainText('caught: RateLimited')
        await expect(result).toContainText('status 429')
        await expect(result).toContainText('retryAfter 30')
    })

    test('redirect() is observed by the browser fetch', async ({ page }) => {
        await page.goto('/rpc/responses')
        await page.getByTestId('redirect-btn').click()
        await expect(page.getByTestId('redirect-result')).toHaveText('redirected: true → /rpc')
    })
})

test.describe('Streaming', () => {
    test('jsonl() stream renders each line with {#for await}', async ({ page }) => {
        await page.goto('/rpc/streaming')
        await page.getByTestId('jsonl-btn').click()
        const items = page.getByTestId('jsonl-list').locator('li')
        await expect(items).toHaveCount(4)
        await expect(items.last()).toHaveText('tick 4 of 4')
    })

    test('sse() stream renders each frame with {#for await}', async ({ page }) => {
        await page.goto('/rpc/streaming')
        await page.getByTestId('sse-btn').click()
        const items = page.getByTestId('sse-list').locator('li')
        await expect(items).toHaveCount(3)
        await expect(items.last()).toHaveText('#3 — final')
    })

    test('streaming mutation: a POST yielding jsonl renders each step via {#for await}', async ({
        page,
    }) => {
        await page.goto('/rpc/streaming')
        await page.getByTestId('stream-mutation-btn').click()
        const items = page.getByTestId('stream-mutation-list').locator('li')
        await expect(items).toHaveCount(3)
        await expect(items.last()).toHaveText('step 3 of 3 done')
    })

    test('a streaming read exposes chunk probes — peek (latest), chunks (count), done', async ({
        page,
    }) => {
        await page.goto('/rpc/streaming')
        await page.getByTestId('stream-start').click()
        // Chunks accumulate; peek tracks the latest; done flips true once the stream closes.
        await expect(page.getByTestId('stream-latest')).toHaveText('tick 4 of 4', { timeout: 5000 })
        await expect(page.getByTestId('stream-count')).toHaveText('4')
        await expect(page.getByTestId('stream-done')).toHaveText('yes')
    })
})
