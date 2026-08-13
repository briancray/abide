// The example app served under `/v2`, in a real browser.
//
// `test/mount.test.ts` is the server half and it can go no further than the bytes: it reads the
// document and asks for the endpoints by hand. What it CANNOT reach is whether the client half of a
// mount works at all — the bundle has to load from a mounted address, read the base back out of the
// `<meta>` the shell wrote, and then address its own rpcs and its own routes with it. Every one of
// those failing leaves the SERVER-rendered page looking perfect, which is the shape of failure this
// file exists for and the reason the assertions here are about the console and about interaction.
//
// `baseURL` already carries `/v2`, so a path below is relative to the mount — which is also a small
// proof in itself: these are the same paths the unmounted project uses.

import { expect, test } from '@playwright/test'

/** Anything the page said that means the client is not working, however the screen looks. */
function complaints(page: import('@playwright/test').Page): string[] {
    const seen: string[] = []
    page.on('console', (message) => {
        const text = message.text()
        if (message.type() === 'error') seen.push(text)
        if (message.type() === 'warning' && text.includes('hydration mismatch')) seen.push(text)
    })
    page.on('pageerror', (failure) => seen.push(String(failure)))
    return seen
}

test('a mounted page hydrates — the bundle loaded from under the mount and adopted', async ({ page }) => {
    const said = complaints(page)
    await page.goto('users/42')
    await page.waitForLoadState('networkidle')

    // The server's markup is there. On its own this proves nothing about the mount's client half —
    // it is the same markup a page with a 404'd bundle serves, which is exactly why it is not the
    // assertion but the precondition for one.
    await expect(page.locator('section.users')).toContainText('42')

    // A 404 on the bundle is a console error, a mismatch is a warning, and a client that threw while
    // reading the mount back is a pageerror. All three land in the same list.
    expect(said).toEqual([])
})

test('the client addresses its own endpoints under the mount', async ({ page }) => {
    const asked: string[] = []
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path.includes('/__abide/')) asked.push(path)
    })

    const said = complaints(page)
    // The tests page RUNS the suites in the browser: rpcs go out, sockets open, the router moves. It
    // is the densest client-side exercise this app has, which is what makes it the page to mount.
    await page.goto('tests/transport')
    await page.waitForLoadState('networkidle')

    // Every reserved address the client asked for is under the mount. A single one at the origin root
    // is a request the proxy in front of a real deployment would never have forwarded — and it would
    // have WORKED here, because this process is reachable at both.
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.filter((path) => !path.startsWith('/v2/'))).toEqual([])
    expect(said).toEqual([])
})

test('a suite of cases runs green inside a mounted app', async ({ page }) => {
    await page.goto('tests/state')
    await page.waitForLoadState('networkidle')

    // `state` rather than `routing`, and the reason is worth writing down: the routing suite's cases
    // assert in APP space against an app they assume is at the ROOT — `route().url.pathname` is
    // `/users/42` there and `/v2/users/42` here — so running them under a mount fails them CORRECTLY.
    // Rewriting them to be mount-agnostic would delete the thing they are about. What belongs here is
    // a suite whose claims are orthogonal to where the app is served, exercising the client's rpc,
    // its reactivity and its case runner under a mount.
    const rows = page.locator('[data-case]')
    const count = await rows.count()
    expect(count, 'the suite has no rows').toBeGreaterThan(5)

    // The queue runs them one at a time, so waiting for the last is waiting for all — the same shape
    // `tests-page.e2e.ts` uses, and for the same reason.
    const statuses = page.locator('[data-case] summary span:last-child')
    await expect(statuses.nth(count - 1)).not.toHaveText('waiting', { timeout: 60_000 })

    for (let at = 0; at < count; at++) {
        const status = (await statuses.nth(at).innerText()).trim()
        const title = await rows.nth(at).getAttribute('data-case')
        expect(status, `${title} is ${status}`).not.toBe('failed')
    }
})
