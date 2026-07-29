import { expect, test } from './fixtures.ts'

// Drives the platform bucket in a real browser: request-scope accessors (identity/cookies/context),
// config (env), observability (trace/health), and the machine surfaces (OpenAPI + MCP tools/list)
// fetched from the page. Each demo is exercised through real hydration + interaction.

test('platform hub links the sub-pages and reads config via env()', async ({ page }) => {
    await page.goto('/platform')
    await expect(page.locator('#platform-title')).toContainText('Platform')
    await expect(page.locator('.nav a[href="/platform/machines"]')).toBeVisible()
    await expect(page.locator('.links a[href="/platform/config"]').first()).toBeVisible()
})

test('identity(): login promotes the principal and it persists across reads', async ({ page }) => {
    await page.goto('/platform/identity')
    // Starts anonymous.
    await expect(page.locator('#identity-auth')).toHaveText('anonymous')
    // `identity()` called straight from the component — no rpc — agrees with the server's own read.
    await expect(page.locator('#identity-client-auth')).toHaveText('anonymous')

    await page.locator('#name-input').fill('Grace Hopper')
    await page.locator('#login-btn').click()

    // After identity.set() + a fresh authenticated read (cookie persisted), the page reflects it.
    await expect(page.locator('#identity-auth')).toHaveText('authenticated')
    await expect(page.locator('#identity-name')).toHaveText('Grace Hopper')
    // The isomorphic accessor followed the login: `identity.refresh()` re-asked the server and woke
    // every reader, which is the only way a browser can learn what an HttpOnly cookie made it.
    await expect(page.locator('#identity-client-auth')).toHaveText('authenticated')

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

test('trace(): the traceparent renders from the RPC read', async ({ page }) => {
    await page.goto('/platform/observability')
    const observe = page.locator('#observe-block')
    // A W3C traceparent: version-traceid-spanid-flags.
    await expect(observe).toContainText('traceparent = 00-')
})

test('trace(): the browser ADOPTS the page request traceparent (never mints its own)', async ({
    page,
}) => {
    const response = await page.goto('/platform/observability')
    const block = page.locator('#trace-client-block')
    const rendered = (await block.textContent()) ?? ''
    const traceparent = /rendered during SSR\s+= (\S+)/.exec(rendered)?.[1]
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    // Same id the document response stamped — the seed and the header agree.
    expect(response?.headers().traceresponse).toBe(traceparent)

    // Read it again IN THE BROWSER, after hydration: the adopted value, not "(none)" and not a
    // freshly minted client id.
    await page.getByTestId('trace-client-read').click()
    await expect(block).toContainText(`read in this browser = ${traceparent}`)
})

test('trace(): a soft-nav re-adopts — the browser follows the NEW request, not the first load', async ({
    page,
}) => {
    await page.goto('/platform/observability')
    const block = page.locator('#trace-client-block')
    const first = /rendered during SSR\s+= (\S+)/.exec((await block.textContent()) ?? '')?.[1]

    // Leave and come back through the sidebar (soft-nav, no document load), then re-read in-browser.
    await page.getByRole('link', { name: 'Config', exact: true }).click()
    await expect(page).toHaveURL(/\/platform\/config$/)
    await page.getByRole('link', { name: 'Observability', exact: true }).click()
    await expect(page).toHaveURL(/\/platform\/observability$/)

    await page.getByTestId('trace-client-read').click()
    const after = /read in this browser\s+= (\S+)/.exec((await block.textContent()) ?? '')?.[1]
    expect(after).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    // A second request is a second trace: a stale adopted id would point at the wrong span.
    expect(after).not.toBe(first)
})

test('trace(): a client-side RPC call JOINS the page trace (same trace id, new span)', async ({
    page,
}) => {
    await page.goto('/platform/observability')
    const pageTraceparent = /rendered during SSR\s+= (\S+)/.exec(
        (await page.locator('#trace-client-block').textContent()) ?? '',
    )?.[1]
    const pageTraceId = pageTraceparent?.split('-')[1]

    // "Run again" refreshes the read, so THIS call is issued by the browser (the first one ran in-proc
    // during SSR). The proxy sends a child traceparent, the handler reports what it received.
    const observe = page.locator('#observe-block')
    // The SSR'd card already shows the page request's own traceparent, and the trace ID half is stable
    // by design — so waiting on the traceId would pass before the refresh even lands. Wait for the SPAN
    // half to move instead: that only happens once the browser-issued call has come back.
    await expect(observe).toContainText(`traceparent = ${pageTraceparent}`)
    await page.getByTestId('replay').click()
    await expect(observe).not.toContainText(`traceparent = ${pageTraceparent}`)

    const rpcTraceparent = /traceparent = (\S+)/.exec((await observe.textContent()) ?? '')?.[1]
    expect(rpcTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    // Same trace id — the call JOINED the page's trace rather than starting its own.
    expect(rpcTraceparent?.split('-')[1]).toBe(pageTraceId)
})

test('health(): the /__abide/health probe fetched straight in-browser', async ({ page }) => {
    await page.goto('/platform/observability')
    await page.locator('#health-btn').click()
    await expect(page.locator('#health-block')).toHaveText('reachable = true')
    // The server half of the same call, over `platformHealth` — which composes the document in-proc and
    // reads `doc.bootId` off it as a TYPED field. That read is the regression guard for the generated
    // `src/.abide/health.d.ts`: the browser cell above widens to `any`, so it checks nothing.
    await expect(page.getByTestId('health-composed')).toHaveText(
        /server-composed bootId = [0-9a-f]{8}/,
    )
})

test('lifecycle onStart + onHealth: /__abide/health merges app fields over the framework stub', async ({
    page,
}) => {
    await page.goto('/platform/lifecycle')
    await page.locator('#lifecycle-health-btn').click()
    const out = page.locator('#lifecycle-health-out')
    // Framework stub fields.
    await expect(out).toContainText(/reachable\s+= true/)
    await expect(out).toContainText(/version\s+= \d/)
    // onHealth-merged app fields; a non-empty bootId (UUIDv7 hex) proves onStart ran and seeded it.
    await expect(out).toContainText(/app\s+= docs/)
    await expect(out).toContainText(/bootId\s+= [0-9a-f]{8}/)
})

test('lifecycle onError: an uncaught throw is shaped into a controlled response', async ({
    page,
}) => {
    await page.goto('/platform/lifecycle')
    await page.locator('#lifecycle-error-btn').click()
    const out = page.locator('#lifecycle-error-out')
    await expect(out).toContainText('500 —')
    await expect(out).toContainText('onError caught it')
})

test('online(): reactive connectivity probe called directly in a template', async ({ page }) => {
    await page.goto('/platform/observability')
    // SSR + hydration: online() is true (server + a live browser).
    await expect(page.locator('#online-flag')).toHaveText('true')

    // online() is REACTIVE: dropping connectivity fires the window `offline` event, the signal flips,
    // and the template re-renders — proving it's the real reactive online(), not an SSR constant.
    await page.context().setOffline(true)
    await expect(page.locator('#online-flag')).toHaveText('false')
    await page.context().setOffline(false)
    await expect(page.locator('#online-flag')).toHaveText('true')
})

test('bundled(): desktop-bundle probe is false in a plain browser tab', async ({ page }) => {
    await page.goto('/platform/observability')
    await expect(page.locator('#bundled-flag')).toHaveText('false')
})

test('log(): the RPC logs server-side and reports the channel + levels', async ({ page }) => {
    await page.goto('/platform/observability')
    await expect(page.locator('#log-block')).toHaveText('not called yet')

    await page.locator('#log-btn').click()
    const block = page.locator('#log-block')
    await expect(block).toContainText('logged = true')
    await expect(block).toContainText('channel = docs')
    await expect(block).toContainText('levels = info, trace')
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

    // Blocked: layer 1 calls error(403) without next() — it THROWS, the chain renders the 403, and the
    // browser proxy decodes it back into the same HttpError the caller catches.
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
