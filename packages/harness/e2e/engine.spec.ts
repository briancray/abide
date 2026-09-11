// THE ENGINE LANE'S LIVE HALF. Chromium only, over CDP, driven from the playwright
// side — which is where it has to be, and is why `gate()` structurally cannot wrap
// any of this.
//
// It serves nothing: the page is a `setContent`, and that is deliberate rather than
// convenient. The recorded case that costs two sessions is two arms running
// byte-identical page source 4.5x apart because only one of them shipped a
// stylesheet — a class no rule mentions is a write with no style recalculation and
// no paint after it — so the page here carries a rule that the class it toggles
// actually matches, and the counters are asserted to MOVE.

import { expect, test } from '@playwright/test'
import { shares } from '../src/engine/shares.ts'
import { traceOp } from '../src/engine/traceOp.ts'
import { THRESHOLDS } from '../src/report/THRESHOLDS.ts'

const PAGE = `<!doctype html><html><head><style>
    li { padding: 2px 6px; }
    li.hot { padding-left: 24px; font-weight: 700; }
</style></head><body><ul id="rows"></ul>
<script>
    const rows = document.querySelector('#rows')
    for (let index = 0; index < 200; index += 1) {
        const row = document.createElement('li')
        row.textContent = 'row ' + index
        rows.appendChild(row)
    }
</script></body></html>`

// CHROMIUM ONLY, and that is the lane rather than a gap: `harness/engine` reads what
// BLINK did, over CDP, and there is no CDP in webkit. The measure lane runs in every
// engine a reader might bring; this one answers a question only one engine can be
// asked.
test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'the engine lane is CDP, and CDP is chromium',
)

test.beforeEach(async ({ page }) => {
    await page.goto('about:blank')
    await page.setContent(PAGE)
})

// Not for pricing — `shares()` prices off the user timing — but so that two arms
// REPORT THE WORK. An existence proof is believed after the counters agree, not
// before, and this asserts the counters can disagree at all.
test('the four counters move, and forced layout distinguishes', async ({
    page,
}) => {
    const clean = await traceOp(page, 'toggle-a-class', async () => {
        await page.evaluate(async () => {
            performance.mark('op:start')
            for (const row of document.querySelectorAll('#rows li'))
                row.classList.toggle('hot')
            await new Promise((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve(null)),
                ),
            )
            performance.mark('op:end')
            performance.measure('toggle-a-class', 'op:start', 'op:end')
        })
    })
    expect(clean.counters.recalcStyle).toBeGreaterThan(0)
    expect(clean.counters.layout).toBeGreaterThan(0)
    expect(clean.counters.paint).toBeGreaterThan(0)
    // A layout read after a write in the same path forces the layout the write
    // invalidated; nothing here reads one.
    expect(clean.counters.forcedLayout).toBe(0)

    const forced = await traceOp(page, 'read-after-write', async () => {
        await page.evaluate(() => {
            performance.mark('op:start')
            for (const row of document.querySelectorAll('#rows li')) {
                ;(row as HTMLElement).style.paddingLeft = `${Math.random()}px`
                void (row as HTMLElement).offsetWidth
            }
            performance.mark('op:end')
            performance.measure('read-after-write', 'op:start', 'op:end')
        })
    })
    // Reverted — read `beginData.stackTrace` without the
    // `disabled-by-default-devtools.timeline.stack` category — this reports 0 with
    // four forced layouts in the trace, and the counter is green forever. Measured
    // that way first: 0 against 4.
    expect(forced.counters.forcedLayout).toBeGreaterThan(0)
})

// NAME THE SHARE BEFORE CHANGING THE LAYER, end to end: the marks come out of the
// page, `shares()` reads them out of the trace, and the observed ceiling is zero
// because the whole op fits in a frame.
test('a layer is priced against the op, and the observed ceiling is zero under a frame', async ({
    page,
}) => {
    const trace = await traceOp(page, 'click-to-paint', async () => {
        await page.evaluate(async () => {
            performance.mark('op:start')
            performance.mark('layer:start')
            for (const row of document.querySelectorAll('#rows li'))
                row.classList.toggle('hot')
            performance.mark('layer:end')
            performance.measure('reconcile', 'layer:start', 'layer:end')
            await new Promise((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve(null)),
                ),
            )
            performance.mark('op:end')
            performance.measure('click-to-paint', 'op:start', 'op:end')
        })
    })
    const answer = shares(trace, {
        layer: 'reconcile',
        of: 'click-to-paint',
        threshold: 'frame',
    })
    expect(answer.ceilingCpu).toBeGreaterThan(0)
    expect(answer.ceilingCpu).toBeLessThan(1)
    // Whether THIS run landed under a frame is the machine's business — an op
    // measured to paint carries at least one frame boundary, and a loaded machine
    // carries two. The contract is the correspondence: a CPU share is not a latency,
    // so the observed ceiling is zero exactly when the op is frame quantised.
    expect(answer.underOneFrame).toBe(answer.opNanoseconds < THRESHOLDS.frame)
    expect(answer.ceilingObserved).toBe(
        answer.underOneFrame ? 0 : answer.ceilingCpu,
    )
})
