import { expect, test } from '@playwright/test'

// Drives the platform bucket in a real browser: request-scope accessors (identity/cookies/context),
// config (env), observability (trace/health), and the machine surfaces (OpenAPI + MCP tools/list)
// fetched from the page. Each demo is exercised through real hydration + interaction.

test('platform hub links the sub-pages and reads config via env()', async ({ page }) => {
    await page.goto('/platform')
    await expect(page.locator('#platform-title')).toContainText('Platform')
    // The hub's config peek is an SSR'd env()-backed read.
    await expect(page.locator('#config-peek')).toContainText('abide docs')
    await expect(page.locator('.nav a[href="/platform/machines"]')).toBeVisible()
})

test('identity(): login promotes the principal and it persists across reads', async ({ page }) => {
    await page.goto('/platform/identity')
    // Starts anonymous.
    await expect(page.locator('#identity-auth')).toHaveText('anonymous')

    await page.locator('#name-input').fill('Grace Hopper')
    await page.locator('#login-btn').click()

    // After identity.set() + a fresh authenticated read (cookie persisted), the page reflects it.
    await expect(page.locator('#identity-auth')).toHaveText('authenticated')
    await expect(page.locator('#identity-name')).toHaveText('Grace Hopper')

    // Logout reverts to anonymous.
    await page.locator('#logout-btn').click()
    await expect(page.locator('#identity-auth')).toHaveText('anonymous')
})

test('cookies(): an RPC reads a browser-set cookie back through the request scope', async ({
    page,
}) => {
    await page.goto('/platform/scope')
    // The SSR/in-proc seed has no cookie yet.
    await expect(page.locator('#cookie-block')).toContainText('(unset)')

    await page.locator('#cookie-input').fill('midnight')
    await page.locator('#set-cookie-btn').click()

    // A real browser fetch now runs through the router; the handler reads it via cookies().
    await expect(page.locator('#cookie-block')).toContainText('cookie platform_pref = midnight')
})

test('context(): a per-RPC middleware stamps the carrier bag the handler reads back', async ({
    page,
}) => {
    await page.goto('/platform/scope')
    // A real browser fetch runs through the router + per-RPC middleware (SSR in-proc reads bypass it),
    // which stamps the carrier bag the handler returns.
    await page.locator('#read-context-btn').click()
    await expect(page.locator('#context-block')).toContainText(
        'context.stampedBy = platformContext.middleware',
    )
    await expect(page.locator('#context-block')).toContainText('context.stampedAt = 2026')
})

test('env(): a typed config value is coerced and rendered', async ({ page }) => {
    await page.goto('/platform/config')
    const block = page.locator('#config-block')
    await expect(block).toContainText('appName        = abide docs')
    await expect(block).toContainText('maxItems       = 25')
    // String "25" was coerced to a number by the schema.
    await expect(block).toContainText('coerced to number')
    await expect(block).toContainText('featureMachines = on')
})

test('trace() + health(): observability values render, health also fetched in-browser', async ({
    page,
}) => {
    await page.goto('/platform/observability')
    const observe = page.locator('#observe-block')
    // A W3C traceparent: version-traceid-spanid-flags.
    await expect(observe).toContainText('traceparent = 00-')
    await expect(observe).toContainText('health.reachable = true')

    await page.locator('#health-btn').click()
    await expect(page.locator('#health-block')).toHaveText('reachable = true')
})

test('online() + bundled(): framework probes called directly in a template (M3b)', async ({
    page,
}) => {
    await page.goto('/platform/observability')
    // SSR + hydration: online() is true (server + a live browser), bundled() is false (plain tab).
    await expect(page.locator('#online-flag')).toHaveText('true')
    await expect(page.locator('#bundled-flag')).toHaveText('false')

    // online() is REACTIVE: dropping connectivity fires the window `offline` event, the signal flips,
    // and the template re-renders — proving it's the real reactive online(), not an SSR constant.
    await page.context().setOffline(true)
    await expect(page.locator('#online-flag')).toHaveText('false')
    await page.context().setOffline(false)
    await expect(page.locator('#online-flag')).toHaveText('true')
})

test('log(): the RPC logs server-side and reports the channel + levels', async ({ page }) => {
    await page.goto('/platform/observability')
    await expect(page.locator('#log-block')).toHaveText('not called yet')

    await page.locator('#log-btn').click()
    const block = page.locator('#log-block')
    await expect(block).toContainText('logged = true')
    await expect(block).toContainText('channel = docs')
    await expect(block).toContainText('levels = info, warn')
})

test('RPC middleware onion: authorized call stamps context, blocked call short-circuits 403', async ({
    page,
}) => {
    await page.goto('/platform/scope')

    // Authorized: layer 1 calls next(), layer 2 stamps context(), handler runs.
    await page.locator('#guard-allow-btn').click()
    await expect(page.locator('#guard-allow-out')).toContainText('allow=yes')
    await expect(page.locator('#guard-allow-out')).toContainText(
        'passedGuard=platformGuard.authorize',
    )

    // Blocked: layer 1 returns error(403) without next() — a short-circuit caught off .load().
    await page.locator('#guard-block-btn').click()
    await expect(page.locator('#guard-block-out')).toContainText('HTTP 403')
})

test('machine surfaces: OpenAPI + MCP tools/list fetched from the browser', async ({ page }) => {
    await page.goto('/platform/machines')

    await page.locator('#openapi-btn').click()
    await expect(page.locator('#openapi-info')).toContainText('OpenAPI 3.1.0')
    const paths = page.locator('#openapi-paths li')
    await expect(paths.first()).toBeVisible()
    // Every RPC is an OpenAPI operation; the platform config RPC is one of them.
    await expect(page.locator('#openapi-paths')).toContainText('/rpc/platformConfig')

    await page.locator('#mcp-btn').click()
    const tools = page.locator('#mcp-tools li')
    await expect(tools.first()).toBeVisible()
    // The capabilities RPC is projected as an MCP tool.
    await expect(page.locator('#mcp-tools')).toContainText('capabilities')
})
