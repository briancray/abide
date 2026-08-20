// Does this app's CSS turn view transitions on, and does a navigation go through one?
//
// A browser gate by necessity twice over. happy-dom's CSS parser DROPS a `::view-transition-old(root)`
// rule — one rule in, zero out — so the selector arm of the detection cannot be expressed headlessly at
// all; and `startViewTransition` does not exist there, so the wrapping cannot be reached without a stub.
// Here both are real: a real CSS engine parses `app.css`, and Chromium has the API.
//
// The detection is the point. There is nothing to call and no flag to set — abide asks the document
// whether any rule names a transition, so `app.css` having those rules IS this app's opt-in.

import type { Page } from '@playwright/test'
import { engine } from 'harness/engine'
import { expect, interactive, test } from 'harness/e2e'
import { goSameRoute, settle } from './internal/drive.ts'

/** What the page counts transitions into. `undefined` says this browser has no API to count. */
interface Counting {
    abideTransitions?: number
}

/** Where the scan lands in the page. Both the behaviour test and the cost gate call this one. */
interface Scanning {
    abideScan?: () => boolean
}

/**
 * Put the scan in the page, before anything on it runs.
 *
 * `addInitScript` over the function's own source rather than a second copy written inline: the cost
 * gate has to call the scan a thousand times inside ONE `page.evaluate` to get a counter delta, and
 * playwright cannot pass a function as an argument — so without this the gate and the behaviour test
 * would be two transcriptions of one algorithm, which is how they drift.
 */
async function installScan(page: Page): Promise<void> {
    await page.addInitScript(`window.abideScan = ${scanStylesheets.toString()}`)
}

/**
 * The detection, transcribed from `wantsTransitions` in `src/ui/internal/navigation.ts`.
 *
 * A copy for a reason that cannot be fixed from here: the function is not exported, and a real
 * navigation's own recalcs cannot be told apart from the scan's. ONE copy, though — if the scan in
 * that file changes, this is the single place that follows it.
 *
 * Self-contained, because it reaches the page as its own source text and closes over nothing.
 */
function scanStylesheets(): boolean {
    const declares = (rules: CSSRuleList): boolean => {
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i] as CSSRule
            if (rule instanceof CSSStyleRule) {
                if (rule.selectorText.includes('view-transition')) return true
                if (rule.style.getPropertyValue('view-transition-name') !== '') return true
                continue
            }
            const grouping = rule as CSSRule & { cssRules?: CSSRuleList }
            if (grouping.cssRules !== undefined && declares(grouping.cssRules)) return true
        }
        return false
    }
    for (let i = 0; i < document.styleSheets.length; i++) {
        try {
            if (declares((document.styleSheets[i] as CSSStyleSheet).cssRules)) return true
        } catch {
            /* cross-origin */
        }
    }
    return false
}

/** Count what the browser was asked to wrap, without stopping it happening. */
async function watchTransitions(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const owner = document as unknown as Record<string, unknown>
        const held = owner.startViewTransition
        if (typeof held !== 'function') return
        const real = held as (update: () => void) => unknown
        const bag = window as unknown as Counting
        bag.abideTransitions = 0
        owner.startViewTransition = (update: () => void): unknown => {
            bag.abideTransitions = (bag.abideTransitions ?? 0) + 1
            return real.call(document, update)
        }
    })
}

/** `-1` when the browser has none, so a case can skip rather than assert about an absence. */
const counted = (page: Page): Promise<number> =>
    page.evaluate(() => (window as unknown as Counting).abideTransitions ?? -1)

test('this app’s stylesheet is what asks for transitions', async ({ page }) => {
    await installScan(page)
    await page.goto('/docs/state')
    await settle(page)

    // The detection, run against the real engine exactly as the client does it.
    const declared = await page.evaluate(() => {
        const scan = (window as unknown as Scanning).abideScan
        if (scan === undefined) throw new Error('the scan was never installed')
        return scan()
    })
    expect(declared, 'app.css no longer declares a transition — the app has silently opted out').toBe(true)

    // And the chrome is named, which is what keeps it OUT of the cross-fade. Reading the computed
    // value rather than the rule: this is the property the browser will act on.
    const named = await page.evaluate(
        () => getComputedStyle(document.querySelector('header') as Element).viewTransitionName,
    )
    expect(named, 'the chrome is not named, so it would cross-fade with the page it did not change').toBe(
        'chrome',
    )
})

test('a cross-route navigation goes through a view transition', async ({ page }) => {
    await watchTransitions(page)
    await page.goto('/docs/state')
    // The link below is intercepted by the client, so a click before it adopts is a full page load.
    await interactive(page)
    await settle(page)
    test.skip((await counted(page)) === -1, 'this browser has no startViewTransition')
    expect(await counted(page), 'something transitioned before the test navigated').toBe(0)

    await page.locator('header a[href="/bench"]').first().click()
    await page.waitForURL('**/bench')
    await settle(page)

    // The page landed, and it went through exactly one transition — the piece that STANDS, not one
    // per deferred patch.
    expect(new URL(page.url()).pathname).toBe('/bench')
    expect(await counted(page), 'the navigation was not wrapped, or was wrapped per piece').toBe(1)
    // And the preserved chrome is still the node it was, transition or not.
    const chrome = await page.evaluate(() => document.querySelector('header') !== null)
    expect(chrome).toBe(true)
})

test('a same-route move is painted locally and is NOT a transition', async ({ page }) => {
    // Nothing is fetched and nothing is torn down, so there is no swap to animate. A transition here
    // would be a cross-fade over a page that patched in place.
    await watchTransitions(page)
    await page.goto('/tests/state')
    await settle(page)
    test.skip((await counted(page)) === -1, 'this browser has no startViewTransition')

    await goSameRoute(page, '/tests/state?nav=probe')

    expect(await counted(page), 'a locally painted move was wrapped in a transition').toBe(0)
})

// --- what the detection costs ------------------------------------------------
//
// The scan runs on every served navigation, right before the DOM is mutated — the exact position
// CLAUDE.md warns about, where a layout read after a write forces the layout the write invalidated. So
// the claim is that it reads the CSSOM and never the render tree: `selectorText` is a string and
// `rule.style.getPropertyValue` reads the DECLARED block, neither of which needs style resolution or a
// box. `getComputedStyle` would, which is why the detection does not use it — and is the control below.
//
// ONE honest limit, stated because it cannot be fixed from here: this measures `scanStylesheets`
// above, which is a COPY — `wantsTransitions` is not exported, and a real navigation's own recalcs
// cannot be told apart from the scan's. So it gates the APPROACH rather than the file. The regression
// it is really aimed at is someone rewriting the detection to ask `getComputedStyle(el)
// .viewTransitionName` — the obvious way, and one that would add a forced recalc per navigation with
// every other test still green.

test('does the stylesheet scan force style or layout', async ({ page }) => {
    // `harness/engine` rather than a hand-rolled CDP session: the same eight lines were in two files
    // and pulled two of the thirty-six metrics available.
    const reading = await engine(page)

    await installScan(page)
    await page.goto('/docs/state')
    await settle(page)
    // Quiesce, so what is attributed to the scan is only the scan.
    //
    // A fixed span and NOT a poll on the counters themselves, which is the obvious improvement and was
    // tried: two equal reads 50 ms apart is not a quiet page, and this docs page lands one more style
    // recalculation after a pair of them agree — so the poll broke early and charged that recalc to
    // the scan, reporting +1 against an expected 0. The span is what has to be generous here.
    await page.waitForTimeout(400)

    const scanned = await reading.around(() =>
        page.evaluate(() => {
            const scan = (window as unknown as Scanning).abideScan
            if (scan === undefined) throw new Error('the scan was never installed')
            for (let i = 0; i < 1000; i++) scan()
        }),
    )

    // CONTROL: getComputedStyle is the classic forced recalc. If this reads 0 too, the counter is
    // blind here and the number above says nothing.
    const styleControl = await reading.around(() =>
        page.evaluate(() => {
            const el = document.querySelector('header') as HTMLElement
            for (let i = 0; i < 1000; i++) {
                el.style.setProperty('--probe', String(i))
                void getComputedStyle(el).color
            }
        }),
    )

    // A LAYOUT control too: the pass above forces style and not layout (`color` needs no box), so on
    // its own it leaves "layout +0" for the scan uncontrolled. A width write plus `offsetWidth` is the
    // classic forced reflow.
    const layoutControl = await reading.around(() =>
        page.evaluate(() => {
            const el = document.querySelector('header') as HTMLElement
            for (let i = 0; i < 200; i++) {
                el.style.paddingLeft = `${i % 7}px`
                void el.offsetWidth
            }
            el.style.paddingLeft = ''
        }),
    )

    console.log(`\n[scan x1000]     recalc +${scanned.recalcStyle}   layout +${scanned.layout}`)
    console.log(`[style control]  recalc +${styleControl.recalcStyle}   layout +${styleControl.layout}`)
    console.log(`[layout control] recalc +${layoutControl.recalcStyle}   layout +${layoutControl.layout}`)
    expect(
        styleControl.recalcStyle,
        'the style control forced nothing — that counter is blind',
    ).toBeGreaterThan(0)
    expect(layoutControl.layout, 'the layout control forced nothing — that counter is blind').toBeGreaterThan(
        0,
    )
    expect(scanned.recalcStyle, 'the scan forced a style recalculation').toBe(0)
    expect(scanned.layout, 'the scan forced a layout').toBe(0)

    await reading.close()
})
