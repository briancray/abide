import { expect, test } from '@playwright/test'

// Count surviving `<!--ab-p:N-->` opening sentinels — hydration must leave none. Runs in the page:
// comments are invisible to CSS selectors, so this is the only way to assert on them.
function countSlotComments(): number {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT)
    let count = 0
    while (walker.nextNode() !== null) {
        if ((walker.currentNode as Comment).data.startsWith('ab-p:')) count++
    }
    return count
}

// Streaming SSR (streaming-ssr-plan PR2/PR3). A slow (40ms) server `{#await}` read misses the 4ms
// render deadline, so SSR flushes the shell with a sentinel-bracketed placeholder
// (`<!--ab-p:N-->` … `<template id="ab-p:N">`) and streams the resolved branch as an out-of-order
// `<template>` patch + move-script. On the client the patch replaces the fallback between the sentinels
// pre-hydration; then the deferred module bundle hydrates and DROPS both sentinels, CLAIMING the streamed
// branch in place (decision (a)) — so it stays reactive with no re-create.

test('a slow {#await} read streams, then hydration claims it in place + it stays reactive', async ({
    page,
}) => {
    const warnings: string[] = []
    page.on('console', (msg) => {
        if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text())
    })

    // The RAW first-load HTML actually STREAMED — a placeholder slot AND an out-of-order patch, not an
    // inline render. This proves the deadline classified the 40ms read as streaming.
    const raw = await (await page.request.get('/pages/ssr')).text()
    expect(raw).toContain('<!--ab-p:')
    expect(raw).toContain('<template id="ab-p:')
    expect(raw).toContain('data-ab-patch')

    await page.goto('/pages/ssr')

    // The streamed resolved branch is present after load.
    const value = page.getByTestId('value')
    await expect(value).toBeVisible()
    await expect(value).toContainText('runs:')
    const before = (await value.textContent())?.trim() ?? ''

    // Hydration dropped the sentinels — neither survives in the live DOM.
    await expect(page.locator('template[id^="ab-p:"]')).toHaveCount(0)
    expect(await page.evaluate(countSlotComments)).toBe(0)

    // The CLAIMED await block is still reactive: refresh re-fetches and re-renders the streamed subtree
    // in place (the run counter advances).
    await page.getByTestId('refresh').click()
    await expect(value).toContainText('runs:')
    await expect(value).not.toHaveText(before)

    // Clean claim — a mis-claim would have create-fallen-back and warned.
    expect(warnings.filter((text) => /hydrat/i.test(text))).toEqual([])
})

// Streaming ERROR (PR5): a slow read that REJECTS with a `{:catch}` streams the catch branch as its
// patch (no 500 — the shell already flushed). Server-side the catch sees the raw error (proven in the
// abide integration tests); the BROWSER shows the client's view — the handler throw became an HTTP 500
// on the wire (raw messages are not leaked), and since an errored read carries no seed the client
// re-fetches and its `{:catch}` renders the resulting `HttpError` ("Internal Server Error").
test('a slow {#await} that rejects renders its {:catch} branch (client HTTP-error view)', async ({
    page,
}) => {
    await page.goto('/pages/ssr')

    const errorValue = page.getByTestId('error-value')
    await expect(errorValue).toBeVisible()
    // The app's onError hook (src/app.ts) shapes every uncaught throw into a 500 with this message,
    // so the client's {:catch} renders the shaped HttpError rather than a bare "Internal Server Error".
    await expect(errorValue).toContainText('onError caught it and shaped this reply')

    // Both streamed slots (the resolved one and the errored one) were unwrapped by hydration.
    await expect(page.locator('template[id^="ab-p:"]')).toHaveCount(0)
    expect(await page.evaluate(countSlotComments)).toBe(0)
})

// Streaming SOFT-NAV (PR4): an in-app navigation streams too. The soft-nav body is a JSONL frame
// stream (shell → patches → seed); the client swaps the shell, replaces each slot's fallback as its patch
// frame arrives, then hydrates — so a slow read shows the shell then streams in, WITHOUT a full reload.
test('an in-app soft-nav to /pages/ssr streams progressively (shell then patch), no full reload', async ({
    page,
}) => {
    // Soft-nav to a streaming page must CLAIM cleanly. (This is a smoke guard, not the regression lock
    // for the frame-kind fix — the seed re-renders the value on hydrate, so the final DOM is correct
    // either way; the `applyPatchFrame` unit tests in abide's nav.test.ts lock the fill/append/complete
    // application directly. Here we assert no hydration-mismatch warning fires during the streamed nav.)
    const warnings: string[] = []
    page.on('console', (msg) => {
        if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text())
    })

    await page.goto('/rpc')

    // A full reload would wipe this marker; a soft-nav keeps it.
    await page.evaluate(() => {
        ;(window as unknown as { __abideNoReload?: boolean }).__abideNoReload = true
    })

    await page.locator('aside.sidebar').getByRole('link', { name: 'Streaming SSR' }).click()
    await expect(page).toHaveURL(/\/pages\/ssr$/)

    // Progressive: the shell's pending fallback shows first, then the streamed patch replaces it.
    await expect(page.getByTestId('pending')).toBeVisible()
    await expect(page.getByTestId('value')).toContainText('runs:')

    // It was a soft-nav (no full document reload) and the streamed subtree hydrated (slot unwrapped).
    const survived = await page.evaluate(
        () => (window as unknown as { __abideNoReload?: boolean }).__abideNoReload === true,
    )
    expect(survived).toBe(true)
    await expect(page.locator('template[id^="ab-p:"]')).toHaveCount(0)
    expect(await page.evaluate(countSlotComments)).toBe(0)

    // The applied `fill` patch let hydration CLAIM the streamed subtree in place — no mismatch warning.
    expect(warnings.filter((text) => /hydrat/i.test(text))).toEqual([])

    // Reactive after the streamed soft-nav.
    const before = (await page.getByTestId('value').textContent())?.trim() ?? ''
    await page.getByTestId('refresh').click()
    await expect(page.getByTestId('value')).not.toHaveText(before)
})
