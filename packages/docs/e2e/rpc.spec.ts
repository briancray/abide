import { expect, test } from '@playwright/test'

// Drives the RPC-bucket docs pages in a real browser: SSR reads landing in HTML, mutations called
// over fetch after hydration, streaming (jsonl/sse) reads rendered with {#for await}, typed-error
// narrowing, redirects, and the template async-read forms.

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

    test('{fn.peek() ?? "…"} renders the snapshot, the fallback handling the undefined', async ({
        page,
    }) => {
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
    // The in-template pending()/error() probe demo now lives on /rpc/probes (see rpc-probes.spec.ts).
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

    // The demo builds its RPC URL BY HAND, so it names the reserved transport param itself
    // (`?__abide_args=<json>`). Its `to` arg is deliberately NOT the handler's default (`/rpc`): a stale
    // param name decodes as a flat arg field called "args", `to` falls back to the default, and this
    // assertion fails loudly instead of the guard silently doing nothing.
    test('redirect() is observed by the browser fetch (hand-built ?__abide_args reaches the handler)', async ({
        page,
    }) => {
        await page.goto('/rpc/responses')
        await page.getByTestId('redirect-btn').click()
        await expect(page.getByTestId('redirect-result')).toHaveText(
            'redirected: true → /rpc/reads',
        )
    })

    // `fn.raw` is the view UNDER the decoded cards: each helper's own status line, plus the baseline
    // headers the router stamps at one choke point on every response.
    test('raw() shows each helper status line and the router baseline headers', async ({
        page,
    }) => {
        await page.goto('/rpc/responses')
        const wire = page.getByTestId('wire-result')

        await page.getByTestId('wire-json').click()
        await expect(wire).toContainText('status: 200 OK')
        await expect(wire).toContainText('content-type: application/json')
        // Stamped by the router, not the handler — and only where the response didn't set it.
        await expect(wire).toContainText('x-content-type-options: nosniff')
        await expect(wire).toContainText('referrer-policy: strict-origin-when-cross-origin')
        await expect(wire).toContainText('cache-control: private, no-cache')
        await expect(wire).toContainText('vary: Cookie')
        await expect(wire).toContainText('"greeting":"Hello, raw!"')

        // A raw call does NOT throw on a failure status — that is the whole bypass.
        await page.getByTestId('wire-error').click()
        await expect(wire).toContainText('status: 422')
        await expect(wire).toContainText('note text is required')

        await page.getByTestId('wire-typed').click()
        await expect(wire).toContainText('status: 429')

        // `redirect: "manual"` passed through raw's `init`: the Fetch spec withholds the 302 and the
        // Location header from JS, so the demo reports the opaque response honestly.
        await page.getByTestId('wire-redirect').click()
        await expect(wire).toContainText('0 (opaque)')
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

    // #52: `{#for await}` is now reactive — clicking "Restart" (which calls `rpcTicker.refresh({ count: 4
    // })`) re-runs the source AND re-mounts the block (clear-and-restream). The network refetch alone
    // can't prove the repaint (it fires either way) and the labels are identical across runs, so we pin a
    // DOM-identity marker on the first row: a genuine re-mount rebuilds the rows and drops it.
    test('jsonl {#for await} Restart re-mounts the list on refresh() (#52)', async ({ page }) => {
        const calls: string[] = []
        page.on('request', (request) => {
            if (request.url().includes('rpcTicker')) calls.push(request.url())
        })

        await page.goto('/rpc/streaming')
        await page.getByTestId('jsonl-btn').click() // Start
        const items = page.getByTestId('jsonl-list').locator('li')
        await expect(items).toHaveCount(4)

        // Pin the server-streamed first row; a real re-mount rebuilds the list and this node goes away.
        await page.evaluate(() =>
            document
                .querySelector('[data-testid="jsonl-list"] li')
                ?.setAttribute('data-restart-probe', '1'),
        )

        await page.getByTestId('jsonl-btn').click() // Restart → rpcTicker.refresh({ count: 4 })

        // The source re-ran server-side (sanity — this holds even under the bug).
        await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2)

        // The block re-mounted: the pinned original row is gone and the list rebuilt to 4 fresh rows.
        await expect(page.locator('[data-testid="jsonl-list"] li[data-restart-probe]')).toHaveCount(
            0,
        )
        await expect(items).toHaveCount(4)
    })

    test('sse() stream renders each frame with {#for await}', async ({ page }) => {
        await page.goto('/rpc/streaming')
        await page.getByTestId('sse-btn').click()
        const items = page.getByTestId('sse-list').locator('li')
        await expect(items).toHaveCount(3)
        await expect(items.last()).toHaveText('#3 — final')
    })

    // The native `EventSource` face of the same sse endpoint. Like the redirect demo it builds the URL by
    // hand, so it must name the reserved `__abide_args` param; `count: 5` is NOT the handler's default
    // (3), so a stale param name yields 3 frames and fails here rather than passing by accident.
    test('sse() is consumable via the native EventSource (hand-built ?__abide_args reaches the handler)', async ({
        page,
    }) => {
        await page.goto('/rpc/streaming')
        await page.getByTestId('es-btn').click()
        const items = page.getByTestId('es-list').locator('li')
        await expect(items).toHaveCount(5, { timeout: 5000 })
        await expect(items.last()).toHaveText('#5 — final')
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

    // The chunk probes now live in one card per primitive (peek / chunks / done), each over its own
    // stream key so the cards are independent. Same probe surface, one primitive at a time.
    test('a streaming read exposes chunk probes — peek (latest), chunks (count), done', async ({
        page,
    }) => {
        await page.goto('/rpc/streaming')

        // peek tracks the latest chunk (count: 4 → final label "tick 4 of 4").
        await page.getByTestId('stream-peek-start').click()
        await expect(page.getByTestId('stream-latest')).toHaveText('tick 4 of 4', { timeout: 5000 })

        // chunks accumulate the transcript (count: 6).
        await page.getByTestId('stream-chunks-start').click()
        await expect(page.getByTestId('stream-count')).toHaveText('6', { timeout: 5000 })

        // done flips yes once the stream closes (count: 3).
        await page.getByTestId('stream-done-start').click()
        await expect(page.getByTestId('stream-done')).toHaveText('yes', { timeout: 5000 })
    })
})
