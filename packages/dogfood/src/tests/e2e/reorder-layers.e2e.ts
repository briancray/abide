// What a keyed reorder actually spends its time ON, by engine layer.
//
// This exists to STOP work, not to start it. The reconcile is the layer everybody reaches for when a
// list feels slow, and the question CLAUDE.md asks first — name the share before changing the layer —
// has no answer inside a case body: `harness/measure` counts DOM calls, and what a reorder costs is
// mostly not DOM calls. It is style and layout, which only Blink can report and only over CDP.
//
// The answer, on both shapes and consistently: the framework's SCRIPT is about a third of the engine
// work — 35% swapping two rows of a thousand, 31% re-sorting five hundred — and the other two thirds
// are style and layout that a hand-written `insertBefore` invalidates just the same. So the ceiling on
// making the reconcile faster is that third, and the two rewrites of the reactive core that landed as
// no-ops are what a missing measurement of this kind costs.
//
// Both shapes are here because layout cost is a property of the SHAPE and a table is the expensive
// end: `complex` is a `<table>`, whose layout is a multi-pass algorithm, and `media` is a grid of
// components. If the two disagreed, the table would be the reason. They do not.
//
// THESE PAGES NOW SHIP A STYLESHEET, which they did not while they were their own application, and it
// moves the numbers in the direction that makes the claim SAFER rather than shakier: rules behind the
// classes these demos write mean style and layout do more work, so script's share of the three can
// only fall. The reading that needed an unstyled shell was a cross-FRAMEWORK ratio — see
// `USECASES.ts` — and no ratio is taken here.
//
// The bounds are loose on purpose. Absolute microseconds are this machine's and move by 4x under
// load; what holds anywhere is that script is a MINORITY of the three measured layers, which is the
// whole claim and the only thing worth gating.
import { engine, shares } from 'harness/engine'
import { expect, interactive, type Page, test } from 'harness/e2e'

/** How much of the three MEASURED layers is script. `taskMs` is not the denominator — see below. */
function scriptShare(work: { scriptMs: number; recalcStyleMs: number; layoutMs: number }): number {
    const measured = work.scriptMs + work.recalcStyleMs + work.layoutMs
    return measured <= 0 ? 0 : work.scriptMs / measured
}

/**
 * `shares()` divides by `taskMs`, which is the whole task — the driver's round trips and the frame
 * this waits for are in it, and they are 70-80% of the window however little the page does. That is
 * what the IDLE control measures, and it is why the assertion above uses the three layers as the
 * denominator instead. Both are reported: the `other` column is the honest reminder that a share of
 * `taskMs` is a floor.
 */
function report(label: string, work: Parameters<typeof shares>[0], ops: number): void {
    const share = shares(work)
    const per = (ms: number) => `${((ms / ops) * 1000).toFixed(0)}µs`
    console.log(
        `\n  ${label}\n` +
            `    per op — script ${per(work.scriptMs)}  style ${per(work.recalcStyleMs)}  ` +
            `layout ${per(work.layoutMs)}  (task ${per(work.taskMs)})\n` +
            `    script is ${(scriptShare(work) * 100).toFixed(0)}% of the three measured layers` +
            `, ${(share.script * 100).toFixed(0)}% of the task (other ${(share.other * 100).toFixed(0)}%)\n` +
            `    counts — recalcStyle ${work.recalcStyle}  layout ${work.layout}  ` +
            `paint ${work.paint}  forced ${work.forcedLayout}`,
    )
}

/** One op per FRAME. Batched into one task they would share a single layout, which is not the case. */
const perFrame = async (page: Page, n: number, body: () => void) => {
    await page.evaluate(
        async ({ n, source }) => {
            const act = new Function(source) as () => void
            for (let i = 0; i < n; i++) {
                act()
                await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
            }
        },
        { n, source: `(${body.toString()})()` },
    )
}

const OPS = 20

/**
 * Toggle the `media` demo's sort, which REORDERS the same 500 keyed rows.
 *
 * A sort is a SCATTERED permutation — the shape no placement fast path touches, so this is the general
 * walk at its most expensive, which is the honest place to ask what the walk is worth.
 *
 * Module scope because two tests drive it and the second compares against the first: two copies that
 * have to stay identical for a comparison to mean anything is one copy written twice. It captures
 * nothing — `perFrame` stringifies the body into the page, so this is source, not a closure.
 */
const resort = () => {
    const select = document.getElementById('sort') as HTMLSelectElement
    select.value = select.value === 'added' ? 'title' : 'added'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Swap two of the `complex` demo's 1,000 keyed rows. Module scope for the same reason `resort` is. */
const swap = () => (document.getElementById('swap') as HTMLButtonElement).click()

// ONE body over both shapes, because the claim is that they AGREE — the file's whole argument is that
// a table and a grid put the same third of a reorder in script, and two hand-copied bodies are two
// assertions that can drift apart while still reading as a comparison. A `test()` per row, so the two
// still report and fail separately.
const REORDERS = [
    { title: 'a 1000-row keyed swap spends a MINORITY of the engine work in script', path: '/demos/complex', op: swap, label: 'swap two rows of 1000, in a <table>' },
    { title: 'so does a full re-sort of 500 keyed rows, table or not', path: '/demos/media', op: resort, label: 're-sort 500 keyed rows, in a grid' },
] as const

for (const reorder of REORDERS) {
    test(reorder.title, async ({ page }) => {
        await page.goto(reorder.path)
        await interactive(page)
        const reading = await engine(page, { paint: true })

        await perFrame(page, 4, reorder.op)
        const work = await reading.around(() => perFrame(page, OPS, reorder.op))
        report(reorder.label, work, OPS)

        // One layout per op and no FORCED one: a forced layout here would mean the reconcile read
        // geometry it had just invalidated, and the split above would be measuring that instead.
        expect(work.forcedLayout).toBe(0)
        expect(work.layout).toBeGreaterThan(0)
        expect(scriptShare(work)).toBeLessThan(0.5)
        await reading.close()
    })
}

// The other two thirds, and what can actually be done about them — which is LESS than this file used
// to claim, and the correction is the finding.
//
// `contain: layout` is the intuitive reach and it does nothing, on either page: containing a ROW does
// not stop its container relaying out its children when one is inserted among them. Same counts, same
// milliseconds. That half has never moved.
//
// `content-visibility: auto` was the one that worked — 20% off layout on the unstyled perf page — and
// on THIS page it is a net loss. The counts say why, and they are what is asserted below because they
// are the stable half: 19 layouts per run become 431, and 20 paints become 234. The property does not
// remove layout work, it CHANGES ITS SHAPE — one layout of everything becomes a relevance check and a
// small layout per element — and which of the two is cheaper is decided by how much is off screen,
// which is a fact about the page rather than about the property.
//
// So what changed is the page, and that is exactly why the ms bound is gone rather than retuned. These
// rows now have rules behind their classes and real heights, `contain-intrinsic-size: auto 40px` is a
// worse guess against them than it was, and a wrong estimate is a scrollbar that lies AND a relevance
// that churns. Retuning the estimate until the old number came back would have been fitting the
// instrument to the answer; a bound that reverses when a page gains a stylesheet was never a claim
// about the property in the first place.
//
// This is CSS, so it is guidance for an app rather than anything abide does, and the rule is injected
// for the measurement rather than served: `content-visibility` on a demo would be a lever the reader
// is being shown the effect of, applied silently to the thing they are looking at.
//
// `bypassCSP` for THIS test and nothing else. The lever is a rule in a STYLESHEET, which is the only
// form of it worth measuring — Blink builds its style invalidation sets from the sheets, so a rule and
// five hundred equivalent inline styles are not the same input to the layer being measured. This app
// serves a nonce-based `style-src`, so `addStyleTag` is refused; the perf app served no policy at all
// and this was free there. Scoped to one describe rather than set on the project, because the console
// gate and the policy are what every OTHER spec on this app is partly testing.
test.describe('the layout lever', () => {
    test.use({ bypassCSP: true })

    test('contain does nothing, and content-visibility trades one layout for hundreds', async ({ page }) => {
        const CV = 'content-visibility: auto; contain-intrinsic-size: auto 40px;'
        const readings: Record<string, number> = {}
        const layouts: Record<string, number> = {}

        for (const [label, css] of [
            ['as shipped', ''],
            ['contain', '#media > * { contain: layout; }'],
            ['content-visibility', `#media > * { ${CV} }`],
        ] as const) {
            await page.goto('/demos/media')
            await interactive(page)
            if (css !== '') await page.addStyleTag({ content: css })
            const reading = await engine(page, { paint: true })
            await perFrame(page, 4, resort)
            const work = await reading.around(() => perFrame(page, OPS, resort))
            readings[label] = work.layoutMs
            layouts[label] = work.layout
            report(`re-sort 500 rows — ${label}`, work, OPS)
            await reading.close()
        }

        // Containing a row is not containing the container. Asserted as "no better", not as a number:
        // the point is that the obvious lever is the wrong one, and a future engine may change that.
        expect(readings.contain).toBeGreaterThan((readings['as shipped'] as number) * 0.8)
        expect(layouts.contain, 'contain changed the layout count').toBe(layouts['as shipped'] as number)

        // The COUNT, not the clock. This is the one number here that does not move: it reads 19 and 431
        // to the unit across runs, where `layoutMs` swings with the machine and reversed outright when
        // these pages gained a stylesheet. A layout is a COST rather than a count — CLAUDE.md's own rule
        // — so the ms is reported above and the count is what is gated, because the count is the
        // mechanism and the mechanism is the finding.
        expect(layouts['content-visibility'], 'content-visibility no longer splits the layout').toBeGreaterThan(
            (layouts['as shipped'] as number) * 10,
        )

        // …and it still renders. A lever that wins by not drawing the page is not a lever.
        await page.goto('/demos/media')
        await interactive(page)
        await page.addStyleTag({ content: `#media > * { ${CV} }` })
        const shown = await page.evaluate(async () => {
            const grid = document.getElementById('media') as HTMLElement
            window.scrollTo(0, document.documentElement.scrollHeight)
            await new Promise((r) => requestAnimationFrame(() => r(null)))
            await new Promise((r) => requestAnimationFrame(() => r(null)))
            const last = grid.lastElementChild as HTMLElement
            return { rows: grid.children.length, text: (last.textContent ?? '').replace(/\s+/g, ' ').trim() }
        })
        expect(shown.rows).toBe(500)
        expect(shown.text.length).toBeGreaterThan(0)
    })
})
