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
// end: `/complex` is a `<table>`, whose layout is a multi-pass algorithm, and `/media` is a grid of
// components. If the two disagreed, the table would be the reason. They do not.
//
// The bounds are loose on purpose. Absolute microseconds are this machine's and move by 4x under
// load; what holds anywhere is that script is a MINORITY of the three measured layers, which is the
// whole claim and the only thing worth gating.
import { engine, shares } from 'harness/engine'
import { expect, interactive, test } from 'harness/e2e'

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
const perFrame = async (page: import('@playwright/test').Page, n: number, body: () => void) => {
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

test('a 1000-row keyed swap spends a MINORITY of the engine work in script', async ({ page }) => {
    await page.goto('/complex')
    await interactive(page)
    const reading = await engine(page, { paint: true })

    const swap = () => (document.getElementById('swap') as HTMLButtonElement).click()
    await perFrame(page, 4, swap)
    const work = await reading.around(() => perFrame(page, OPS, swap))
    report('swap two rows of 1000, in a <table>', work, OPS)

    // One layout per op and no FORCED one: a forced layout here would mean the reconcile read
    // geometry it had just invalidated, and the split above would be measuring that instead.
    expect(work.forcedLayout).toBe(0)
    expect(work.layout).toBeGreaterThan(0)
    expect(scriptShare(work)).toBeLessThan(0.5)
    await reading.close()
})

test('so does a full re-sort of 500 keyed rows, table or not', async ({ page }) => {
    await page.goto('/media')
    await interactive(page)
    const reading = await engine(page, { paint: true })

    // A sort is a SCATTERED permutation — the shape no placement fast path touches, so this is the
    // general walk at its most expensive, which is the honest place to ask what the walk is worth.
    const resort = () => {
        const select = document.getElementById('sort') as HTMLSelectElement
        select.value = select.value === 'added' ? 'title' : 'added'
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await perFrame(page, 4, resort)
    const work = await reading.around(() => perFrame(page, OPS, resort))
    report('re-sort 500 keyed rows, in a grid', work, OPS)

    expect(work.forcedLayout).toBe(0)
    expect(work.layout).toBeGreaterThan(0)
    expect(scriptShare(work)).toBeLessThan(0.5)
    await reading.close()
})

// The other two thirds, and what can actually be done about them.
//
// `contain: layout` is the intuitive reach and it does nothing: containing a ROW does not stop its
// container relaying out its children when one is inserted among them. `content-visibility: auto` is
// the one that works, and only on the right shape — a `<table>` barely moves, because table layout is
// its own multi-pass algorithm and a `<tr>` is not a box it will skip.
//
// This is CSS, so it is guidance for an app rather than anything abide does — `packages/perf` ships no
// stylesheet and must not gain one, so the rule is injected for the measurement and not served. It is
// here because the number is what makes the guidance worth following, and because the trade is real:
// the win comes from NOT laying out what is off screen, so it scales with the off-screen fraction, and
// `contain-intrinsic-size` is a guess until a row has been seen. That guess is why the page below is
// 20456px instead of 24182px — a 40px estimate against a 54px row — which is a scrollbar that lies
// until the reader has been there. `auto` remembers the real size after first render.
test('content-visibility is the layout lever, and a <table> is not the shape for it', async ({ page }) => {
    const CV = 'content-visibility: auto; contain-intrinsic-size: auto 40px;'
    const readings: Record<string, number> = {}

    for (const [label, css] of [
        ['as shipped', ''],
        ['contain', '#media > * { contain: layout; }'],
        ['content-visibility', `#media > * { ${CV} }`],
    ] as const) {
        await page.goto('/media')
        await interactive(page)
        if (css !== '') await page.addStyleTag({ content: css })
        const reading = await engine(page, { paint: true })
        const resort = () => {
            const select = document.getElementById('sort') as HTMLSelectElement
            select.value = select.value === 'added' ? 'title' : 'added'
            select.dispatchEvent(new Event('input', { bubbles: true }))
            select.dispatchEvent(new Event('change', { bubbles: true }))
        }
        await perFrame(page, 4, resort)
        const work = await reading.around(() => perFrame(page, OPS, resort))
        readings[label] = work.layoutMs
        report(`re-sort 500 rows — ${label}`, work, OPS)
        await reading.close()
    }

    // Containing a row is not containing the container. Asserted as "no better", not as a number:
    // the point is that the obvious lever is the wrong one, and a future engine may change that.
    expect(readings.contain).toBeGreaterThan((readings['as shipped'] as number) * 0.8)
    // The one that works. Loose, because how much it wins is how much is off screen.
    expect(readings['content-visibility']).toBeLessThan((readings['as shipped'] as number) * 0.8)

    // …and it still renders. A lever that wins by not drawing the page is not a lever.
    await page.goto('/media')
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
