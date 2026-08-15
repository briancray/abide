// `navigate`'s two options, driven by the buttons an author would write.
//
// Both are facts a DOM emulator does not have: one is the shape of the history STACK, the other is
// where the viewport is. So `bun test` cannot reach either, and until now neither had a test of any
// kind — not headless, not here. The framework's only caller of both is the popstate listener, which
// passes them together, so nothing in the repo could tell a working option from a missing one.
//
// b98e49c wrote this spec, ran it and DELETED it rather than weaken it: every navigation re-rendered
// the suite and collapsed the `<details>` the controls live in, so the second click had nothing to
// hit. A same-route move is painted by the client now and the controls stay put, which is what makes
// this writable.
//
// Two things about the DRIVER are load-bearing, and both were wrong when it was written:
//
//   · the targets move the PATHNAME. `place` scrolls to the top only when the pathname moved, so
//     query-only targets leave `keepScroll` and the plain button doing the identical nothing — a
//     scroll gate against those two passes with `keepScroll` deleted.
//   · the buttons are found by ID. A playwright text match is a case-insensitive substring, so
//     `hasText: 'keepScroll'` also matches `plain (scrolls to top)`, and this repo has shipped a
//     green test against the wrong element before.

import type { Page } from '@playwright/test'
import { expect, test } from 'harness/e2e'
import { clickControl, openControls, ROUTING_SUITE as SUITE, settle } from './internal/drive.ts'

// The depth and the BACK landing in one test rather than two, because the second is the first plus
// one `goBack` — and the setup is not free here: a suite page runs all fifteen of its cases, benches
// included, every time one of these opens it.
test('replace does not grow the history stack, and leaves BACK where it was', async ({ page }) => {
    await openControls(page)

    // The DEPTH the browser reports. Read before anything is clicked, because a page arrives with a
    // stack of its own and the claim is about the delta.
    const start = await page.evaluate(() => history.length)

    await clickControl(page, 'nav-push', '/tests/routing/nav/push')
    const afterPush = await page.evaluate(() => history.length)

    await clickControl(page, 'nav-replace', '/tests/routing/nav/replace')
    const afterReplace = await page.evaluate(() => history.length)

    // The CONTROL first: without a push that grows the stack, "replace did not grow it" is a claim
    // about a browser that never records anything, and it would pass against a router that pushed
    // nothing at all.
    expect(afterPush, 'a plain navigate did not grow the history stack — the control is dead').toBe(start + 1)
    expect(afterReplace, 'replace grew the history stack').toBe(afterPush)

    // The depth is a proxy; this is the behaviour it is a proxy for. A replace that decremented some
    // counter but still pushed an entry would satisfy the two lines above and fail a reader.
    await page.goBack()
    await settle(page)

    // Back from the REPLACED entry lands where the pushed one came from — `/tests/routing` — and not
    // on `/nav/push`, which is the entry `replace` overwrote.
    expect(new URL(page.url()).pathname, 'back landed on the entry replace should have overwritten').toBe(
        SUITE,
    )
})

/**
 * Where the reader is standing when the button is clickable.
 *
 * The baseline has to be taken AFTER the control is in view, and this is not a detail: `locator.click`
 * scrolls its target into view as part of its actionability checks, so a `scrollTo` written before the
 * click is undone by the click. Measured that way the first draft of this read 600 before and 7,592
 * after and looked like a router that hurls the reader down the page — the number was playwright's.
 */
async function standingAt(page: Page, id: string): Promise<number> {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    return page.evaluate(() => window.scrollY)
}

test('keepScroll leaves the reader where they were, and a plain navigate goes to the top', async ({
    page,
}) => {
    await openControls(page)

    const before = await standingAt(page, 'nav-keepscroll')
    // A control already at the top of the document makes both arms read 0 and the pair says nothing.
    expect(
        before,
        'the control is at the top — there is nothing for either option to preserve',
    ).toBeGreaterThan(0)

    await clickControl(page, 'nav-keepscroll', '/tests/routing/nav/keep')
    const kept = await page.evaluate(() => window.scrollY)

    // The other arm, from a DIFFERENT pathname so the move is a real one: `place` scrolls to the top
    // only when the pathname changed, and `/nav/keep` to `/nav/top` is that.
    const beforePlain = await standingAt(page, 'nav-totop')
    expect(beforePlain, 'the page was already at the top before the plain arm').toBeGreaterThan(0)
    await clickControl(page, 'nav-totop', '/tests/routing/nav/top')
    const plain = await page.evaluate(() => window.scrollY)

    expect(kept, 'keepScroll moved the reader').toBe(before)
    // The PAIR is the assertion. "keepScroll did not go to zero" passes against a router that never
    // scrolls at all, which is exactly the weaker form b98e49c refused to ship.
    expect(plain, 'a plain navigate across pathnames did NOT scroll to the top').toBe(0)
})
