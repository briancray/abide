// Does a served page ADOPT what the server wrote, or quietly rebuild it?
//
// The claim is about WORK, and a rebuild produces the same screen at full cost — so nothing an
// assertion about markup can reach will ever see it. `renderToString` cannot, a headless `mount`
// cannot, and a reader does not open the console. What says so is the warning abide writes when a
// part cannot claim its range, which is why this file listens to the console rather than the DOM.
//
// Both halves of the list are real gates. They are kept apart because they fail for different
// reasons: the first is the ordinary in-order render, and the second is the page whose content sits
// behind a DEFERRED region — a `{#if x.pending()}` over the whole page, patched in by the two-line
// `$p` script after the walk is done.
//
// The deferred half was a known defect until the patches moved: `renderDocument` wrote them BEFORE
// the close of the hydration root, so every one of these pages handed its top-level part a range
// with a `<template>` and two `<script>`s on the end of it, mismatched, and rebuilt the whole page it
// had been given correct markup for. `demos/hydrate.ts` holds the headless gate; this is the same
// claim where it is actually served.
//
// It is deliberately NOT asserted in `docs.e2e.ts`. A mismatch on a reference page is not a fact
// about references, and putting it there would make every capability's test red for a reason that
// has nothing to do with capabilities.

import { expect, test } from '@playwright/test'

/** Pages that render in one pass. */
const IN_ORDER = ['/', '/bench', '/users/42']

/** Pages whose content arrives as a patch — the half the placement of the drain used to break. */
const DEFERRED = ['/streaming', '/tests', '/tests/state', '/docs/state', '/docs/logging']

async function mismatches(page: import('@playwright/test').Page, path: string): Promise<string[]> {
    const seen: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('hydration mismatch')) {
            seen.push(message.text())
        }
    })
    await page.goto(path)
    // The adoption happens on the client's first update, so this waits for the page to be interactive
    // rather than for a span of time — except that there is nothing to wait FOR when it goes well,
    // which is why a short settle is the honest instrument here.
    await page.waitForLoadState('networkidle')
    return seen
}

for (const path of IN_ORDER) {
    test(`${path} adopts the server's markup`, async ({ page }) => {
        expect(await mismatches(page, path)).toEqual([])
    })
}

for (const path of DEFERRED) {
    test(`${path} adopts its deferred region too`, async ({ page }) => {
        expect(await mismatches(page, path)).toEqual([])
    })
}
