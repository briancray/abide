// The dogfood app served under `/v2`, in a real browser.
//
// `#tests/unit/mount.test.ts` is the server half and it can go no further than the bytes: it reads the
// document and asks for the endpoints by hand. What it CANNOT reach is whether the client half of a
// mount works at all — the bundle has to load from a mounted address, read the base back out of the
// `<meta>` the shell wrote, and then address its own rpcs and its own routes with it. Every one of
// those failing leaves the SERVER-rendered page looking perfect, which is the shape of failure this
// file exists for and the reason the assertions here are about the console and about interaction.
//
// `baseURL` already carries `/v2`, so a path below is relative to the mount — which is also a small
// proof in itself: these are the same paths the unmounted project uses.

import { type Complaints, expect, test } from 'harness/e2e'
import { sweepStatuses } from '../internal/drive.ts'

/**
 * The shared fixture, plus the one thing it deliberately does not fold in.
 *
 * `complaints` keeps warnings apart from errors, because a warning is not a failure on most pages. Here
 * it is: a mismatch is what a client that read the mount back wrong produces, and it arrives as a
 * warning. So this file asks for it BY NAME rather than carrying a second collector that redefines
 * "error" — which is what it used to do, and which cost it the fixture's teardown assertion as well.
 */
function noMismatch(complaints: Complaints): void {
    expect(complaints.warnings.filter((line) => line.includes('hydration mismatch'))).toEqual([])
}

test('a mounted page hydrates — the bundle loaded from under the mount and adopted', async ({
    page,
    complaints,
}) => {
    await page.goto('users/42')
    await page.waitForLoadState('networkidle')

    // The server's markup is there. On its own this proves nothing about the mount's client half —
    // it is the same markup a page with a 404'd bundle serves, which is exactly why it is not the
    // assertion but the precondition for one.
    await expect(page.locator('section.users')).toContainText('42')

    // A 404 on the bundle is a console error and a client that threw while reading the mount back is a
    // pageerror — both are `unexpected()`, which the fixture also asserts on the way out. A mismatch is
    // a warning, hence the second line.
    expect(complaints.unexpected()).toEqual([])
    noMismatch(complaints)
})

test('the client addresses its own endpoints under the mount', async ({ page, complaints }) => {
    const asked: string[] = []
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path.includes('/__abide/')) asked.push(path)
    })

    // The loads this page FAILS ON PURPOSE. The suites it runs include a refused endpoint and an answer
    // that does not match its declared shape, and a read of either reports on `abide:load` with its
    // reason — a demonstrated failure, not the client failing.
    //
    // DECLARED rather than filtered, which is the difference that matters: `expected` requires the line,
    // so this is the page asserting that its transport suite still demonstrates a failed load. Filtering
    // the channel — the older shape — permitted it instead, and would have gone on passing if reporting
    // stopped working altogether.
    complaints.expected('a load failed')
    // The tests page RUNS the suites in the browser: rpcs go out, sockets open, the router moves. It
    // is the densest client-side exercise this app has, which is what makes it the page to mount.
    await page.goto('tests/transport')
    await page.waitForLoadState('networkidle')

    // Every reserved address the client asked for is under the mount. A single one at the origin root
    // is a request the proxy in front of a real deployment would never have forwarded — and it would
    // have WORKED here, because this process is reachable at both.
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.filter((path) => !path.startsWith('/v2/'))).toEqual([])
    expect(complaints.unexpected()).toEqual([])
    noMismatch(complaints)
})

test('a suite of cases runs green inside a mounted app', async ({ page, complaints }) => {
    // The `state` suite demonstrates failed loads too — a refused port, an offline probe, a rejection
    // with no reason — so the same declaration the transport page makes. Adding the fixture here is what
    // FOUND these: this test had no console assertion, and fourteen error lines a page renders while
    // every row reads `passing` is exactly what one is for.
    complaints.expected('a load failed')
    await page.goto('tests/state')
    await page.waitForLoadState('networkidle')

    // `state` rather than `routing`, and the reason is worth writing down: the routing suite's cases
    // assert in APP space against an app they assume is at the ROOT — `route().url.pathname` is
    // `/users/42` there and `/v2/users/42` here — so running them under a mount fails them CORRECTLY.
    // Rewriting them to be mount-agnostic would delete the thing they are about. What belongs here is
    // a suite whose claims are orthogonal to where the app is served, exercising the client's rpc,
    // its reactivity and its case runner under a mount.
    //
    // The same sweep the unmounted suite pages get — see `sweepStatuses` for the two traps it carries,
    // and for why one crossing beats the row-at-a-time loop this used to be.
    const swept = await sweepStatuses(page, '[data-case]', 'summary span:last-child', 60_000)
    expect(swept.length, 'the suite has no rows').toBeGreaterThan(5)
    // A TERMINAL status rather than merely "not failed": a selector that stopped matching reads `null`
    // for every row, and a sweep of nulls satisfies a not-failed check while having seen nothing at all.
    for (const { label, status } of swept) {
        expect(status, `${label} is ${status}`).toMatch(/^(passing|interactive|benched|server)$/)
    }

    // This test had no console assertion at all, which the fixture now supplies on the way out: a suite
    // whose rows all read `passing` while the page threw beside them is the shape it could not see.
    noMismatch(complaints)
})
