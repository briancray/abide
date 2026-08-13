// A KNOWN DEFECT, written down as a gate rather than as a comment.
//
// Some pages log `hydration mismatch — a nested template left <script> over — building this slot instead
// of adopting it` on load. The client then rebuilds that slot rather than adopting what the server wrote:
// correct output, twice the work, and invisible to every assertion that is not a browser. `renderToString`
// cannot see it, a headless `mount` cannot see it, and a reader does not open the console.
//
// Which pages, measured rather than guessed:
//
//     /              clean          /users/42     clean
//     /bench         clean          /streaming    MISMATCH
//     /tests         MISMATCH       /tests/state  MISMATCH
//     /docs/<any>    MISMATCH
//
// `/streaming` is the tell. It predates all of the `/docs` and `/tests` work, so this is not something the
// reference ladders or the case tables introduced — what the four failing pages share is that their
// top-level content sits behind a DEFERRED region (`{#if x.pending()}` over the whole page), and the
// client's adoption of that region claims a range with the document's own module `<script>` in it.
//
// Recorded as `test.fail` because that is the one form of "we know" that cannot rot: while the defect is
// there this file is green, and the day somebody fixes it playwright reports "expected to fail but
// passed" — which fails the run and forces this file to be deleted rather than left lying.
//
// It is deliberately NOT asserted in `docs.e2e.ts`. A mismatch on a reference page is not a fact about
// references, and putting it there would make every capability's test red for a reason that has nothing to
// do with capabilities.

import { expect, test } from '@playwright/test'

/** The pages that adopt cleanly today. This half is a real gate, not a known defect. */
const CLEAN = ['/', '/bench', '/users/42']

/** The pages that do not. Every one of them defers its whole content behind a pending read. */
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
    // rather than for a span of time — except that there is nothing to wait FOR when it goes well, which
    // is why a short settle is the honest instrument here.
    await page.waitForLoadState('networkidle')
    return seen
}

for (const path of CLEAN) {
    test(`${path} adopts the server's markup`, async ({ page }) => {
        expect(await mismatches(page, path)).toEqual([])
    })
}

for (const path of DEFERRED) {
    test.fail(`${path} does not adopt its deferred region — known`, async ({ page }) => {
        expect(await mismatches(page, path)).toEqual([])
    })
}
