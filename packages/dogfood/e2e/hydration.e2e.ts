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

import { expect, interactive, test } from 'harness/e2e'
import { CALLABLE_ORDER } from '../demos/CALLABLES.ts'
import { SPELLING_ORDER } from '../demos/SPELLINGS.ts'
import { CAPABILITIES } from '../demos/SUITES.ts'

/** Pages that render in one pass. */
const IN_ORDER = ['/', '/bench', '/users/42']

/** Pages whose content arrives as a patch — the half the placement of the drain used to break. */
const DEFERRED = ['/streaming', '/tests', '/tests/state', '/docs/state', '/docs/log']

/**
 * EVERY route this app serves, by section — because eight hand-listed paths is a sample, and the
 * defect this file exists for is invisible on the eighty-six it did not name.
 *
 * The eight above stay: they are the two SHAPES a page can hydrate in, they are documented as such,
 * and a named example of each is what a reader needs before the sweep below means anything. The sweep
 * is coverage, not explanation.
 *
 * Derived rather than written out, for the reason `docs.e2e.ts` derives its own: a capability or a
 * callable added to the app is covered without anybody remembering to come here.
 */
const SWEEPS: { section: string; paths: string[] }[] = [
    {
        section: 'the app’s own pages',
        paths: ['/', '/docs', '/docs/syntax', '/tests', '/bench', '/streaming', '/users/42'],
    },
    { section: 'every callable', paths: CALLABLE_ORDER.map((name) => `/docs/${name}`) },
    { section: 'every spelling', paths: SPELLING_ORDER.map((slug) => `/docs/syntax/${slug}`) },
    {
        section: 'every capability, running',
        // `hydrate` is the one suite excluded, and it is excluded for what it IS rather than because
        // it was inconvenient: its cases mismatch ON PURPOSE — markup rendered without
        // `{ hydratable: true }`, a nested template left over — and assert about what the client does
        // next. Nine warnings on that page are nine cases working. What is lost with it is that page's
        // OWN hydration, which nothing else here covers; separating the two would mean recording
        // warnings in-page against a hydration marker rather than reading the console from outside.
        paths: CAPABILITIES.filter((entry) => entry.name !== 'hydrate').map((entry) => `/tests/${entry.name}`),
    },
    { section: 'every capability, priced', paths: CAPABILITIES.map((entry) => `/bench/${entry.name}`) },
]

async function mismatches(page: import('@playwright/test').Page, path: string): Promise<string[]> {
    const seen: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('hydration mismatch')) {
            seen.push(message.text())
        }
    })
    const answered = await page.goto(path)
    // The status, because the assertion below is that NOTHING was warned — and a 404 warns nothing at
    // all. `/docs/logging` sat in this list for a while after `/docs` was re-keyed by callable: the path
    // stopped existing, the page became an apology, and the test went on passing. A gate whose happy
    // answer and whose missing-page answer are the same string is not a gate.
    expect(answered?.status(), `${path} is not a page`).toBe(200)
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

for (const sweep of SWEEPS) {
    test(`${sweep.section} — nothing rebuilds what the server sent`, async ({ page }) => {
        // ONE listener for the whole sweep, stamped with the route it fired on. Attached once rather
        // than per page: `mismatches` above adds one per call, which is right for a single route and
        // would stack forty-five deep here.
        let at = ''
        const seen: string[] = []
        page.on('console', (message) => {
            if (message.type() === 'warning' && message.text().includes('hydration mismatch')) {
                seen.push(`${at} — ${message.text()}`)
            }
        })

        // SEQUENTIAL, and the section split is what keeps that affordable: a `/tests/<suite>` page
        // starts running its cases, and twenty of those against one `abide dev` in parallel is what
        // starved this project's other specs into timeouts once already. See `tests-page.e2e.ts`.
        const missing: string[] = []
        for (const path of sweep.paths) {
            at = path
            const answered = await page.goto(path)
            // A 404 warns nothing at all, so a route that stopped existing would sail through the
            // assertion below. Collected rather than thrown for the same reason the mismatches are.
            if (answered?.status() !== 200) missing.push(`${path} answered ${answered?.status()}`)
            // The hydration flag rather than `networkidle`: adoption is decided when the client takes
            // the page over, and a suite page is still running cases long after that. What this cannot
            // see is a mismatch from a load that settles much later — the named paths above are where
            // that shape is covered deliberately.
            await interactive(page)
        }

        expect(missing, 'a route in the table that the app does not serve').toEqual([])
        expect(seen, 'a page that rebuilt the markup it was handed').toEqual([])
    })
}

/**
 * A rung holding a live STREAM, sampled while it is still arriving.
 *
 * The two slots read the same cell and take different paths: `{ticks ?? 0}` is a plain read and
 * paints, `{#for tick of ticks.chunks()}` is a probe and does not. The server DRAINED this stream
 * before it wrote the markup, so what is on screen at hydration is its last chunk — five rows beside
 * a `latest 5` — while this side restarts from one.
 *
 * Whatever the two do, they have to do TOGETHER. Keeping the rows froze the list at the server's five
 * while the count beside it climbed from one, which is correct at both ends and wrong for the whole
 * middle — no console warning, no mismatch, and the final state agrees, so every other gate in this
 * file is green while the page reads as nonsense.
 */
test('a streamed rung and the count beside it never disagree', async ({ page }) => {
    await page.goto('/docs/state')
    await interactive(page)

    const rung = page.locator('.rung-preview').filter({ hasText: 'latest' }).first()
    const latest = rung.locator('p')
    const rows = rung.locator('li')

    // SAMPLED, not read once: the disagreement is a window, and its two ends agree. The stream is
    // five chunks 300ms apart, so this walks the middle of it.
    for (let i = 0; i < 8; i++) {
        const [text, count] = await Promise.all([latest.innerText(), rows.count()])
        const shown = Number(/(\d+)/.exec(text)?.[1] ?? '-1')
        expect(count, `latest ${shown} beside ${count} rows`).toBe(shown)
        await page.waitForTimeout(150)
    }
})
