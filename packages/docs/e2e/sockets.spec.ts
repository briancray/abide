import { expect, test } from '@playwright/test'

// These specs drive the REAL sockets demo in a real browser: the page subscribes to a live socket
// (over the HTTP-face SSE stream and, separately, the multiplexed WS mux), publishes to it from the
// server (a POST RPC) and from the client (clientPublish), and asserts the new message shows up live
// in the DOM without a reload. A tail-replay test proves recent history survives a page reload.
//
// The HTTP-face SSE tests were quarantined while a byte-idle SSE stream was killed by Bun's default
// 10s idle timeout (EventSource opened, then errored -> status "reconnecting"). Fixed by raising
// `Bun.serve`'s `idleTimeout` + a heartbeat/`cancel()` in `server/sse.ts` (docs/TODO.md #22).

function unique(label: string): string {
    return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

test('SSR renders the sockets page with an empty log and publish controls', async ({ page }) => {
    await page.goto('/sockets')
    await expect(page.locator('h1')).toHaveText('Sockets')
    await expect(page.getByTestId('server-publish')).toBeVisible()
    await expect(page.getByTestId('client-publish')).toBeVisible()
})

test('server publish (socket.publish via POST RPC) appears live in the DOM', async ({ page }) => {
    await page.goto('/sockets')
    // The EventSource subscription opens after hydration.
    await expect(page.getByTestId('socket-status')).toHaveText('live', { timeout: 15_000 })

    const text = unique('server-msg')
    await page.getByTestId('server-input').fill(text)
    await page.getByTestId('server-publish').click()

    const item = page.getByTestId('message-log').locator('li', { hasText: text })
    await expect(item).toBeVisible({ timeout: 15_000 })
    await expect(item).toContainText('server')
})

test('client publish (clientPublish + handler) appears live tagged via:client', async ({
    page,
}) => {
    await page.goto('/sockets')
    await expect(page.getByTestId('socket-status')).toHaveText('live', { timeout: 15_000 })

    const text = unique('client-msg')
    await page.getByTestId('client-input').fill(text)
    await page.getByTestId('client-publish').click()

    const item = page.getByTestId('message-log').locator('li', { hasText: text })
    await expect(item).toBeVisible({ timeout: 15_000 })
    // The socket handler stamps every client publish with via:"client".
    await expect(item).toHaveAttribute('data-via', 'client')
})

test('tail replay — a published message re-appears after a full page reload', async ({ page }) => {
    await page.goto('/sockets')
    await expect(page.getByTestId('socket-status')).toHaveText('live', { timeout: 15_000 })

    const text = unique('tail-msg')
    await page.getByTestId('server-input').fill(text)
    await page.getByTestId('server-publish').click()
    await expect(page.getByTestId('message-log').locator('li', { hasText: text })).toBeVisible({
        timeout: 15_000,
    })

    // Full reload — a brand-new subscription. The socket's tail replays recent history on connect.
    await page.reload()
    await expect(page.getByTestId('socket-status')).toHaveText('live', { timeout: 15_000 })
    await expect(page.getByTestId('message-log').locator('li', { hasText: text })).toBeVisible({
        timeout: 15_000,
    })
})

test('multiplexed WS mux — server publish reaches a mux subscriber live', async ({ page }) => {
    await page.goto('/sockets/mux')
    await expect(page.getByTestId('mux-status')).toHaveText('live', { timeout: 15_000 })

    const text = unique('mux-server')
    await page.getByTestId('mux-server-input').fill(text)
    await page.getByTestId('mux-server-publish').click()

    await expect(page.getByTestId('mux-log').locator('li', { hasText: text })).toBeVisible({
        timeout: 15_000,
    })
})

test('multiplexed WS mux — client pub frame reaches the mux subscriber live', async ({ page }) => {
    await page.goto('/sockets/mux')
    await expect(page.getByTestId('mux-status')).toHaveText('live', { timeout: 15_000 })

    const text = unique('mux-client')
    await page.getByTestId('mux-input').fill(text)
    await page.getByTestId('mux-publish').click()

    const item = page.getByTestId('mux-log').locator('li', { hasText: text })
    await expect(item).toBeVisible({ timeout: 15_000 })
    await expect(item).toHaveAttribute('data-via', 'client')
})
