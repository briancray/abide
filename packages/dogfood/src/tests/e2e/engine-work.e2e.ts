// `harness/engine`, against work whose engine cost is KNOWN by construction.
//
// A measurement API is the one kind of code whose output cannot check it: every number it returns is
// plausible, and a counter wired to nothing returns zero forever — which reads as "this work was
// free" rather than as a broken instrument. So each case here drives the engine a known number of
// times and asserts the reading against the arithmetic, not against a previous run.
//
// The cheap tier is always on. The paint tier is exercised in ONE case, because a trace is the
// expensive path and running it per spec would make this file minutes rather than seconds.

import type { Page } from '@playwright/test'
import { engine, shares } from 'harness/engine'
import { expect, test } from 'harness/e2e'
import { settle } from './internal/drive.ts'

/**
 * A page with nothing left to do.
 *
 * `settle` plus a wait, because the network going idle is not the end here: `/docs/state` mounts its
 * ladder after it, and a reading taken across that mount charges 345 nodes and a layout to whatever
 * was being measured. Every case below starts here, and the first draft failed three ways for want
 * of it.
 */
async function quiet(page: Page): Promise<void> {
    await settle(page)
    await page.waitForTimeout(600)
}

test('a forced-layout loop is counted exactly', async ({ page }) => {
    await page.goto('/docs/state')
    await quiet(page)
    const reading = await engine(page)

    // Fifty writes, each followed by a geometry read that forces the layout the write invalidated.
    // Blink cannot batch these, so the answer is arithmetic: fifty layouts, fifty recalculations.
    const work = await reading.around(() =>
        page.evaluate(() => {
            const box = document.createElement('div')
            box.style.cssText = 'width:100px;height:100px;background:red'
            document.body.append(box)
            for (let i = 0; i < 50; i++) {
                box.style.width = `${100 + i}px`
                void box.offsetWidth
            }
            box.remove()
        }),
    )

    // Not `toBe(50)`: the surrounding page is live and lands its own ticks. The claim is that the
    // reading tracks the WORK — a counter reading zero, or reading thousands, is not this loop.
    expect(work.layout, 'layouts were not counted').toBeGreaterThanOrEqual(50)
    expect(work.layout, 'something other than the loop was charged').toBeLessThan(80)
    expect(work.recalcStyle, 'style recalculations were not counted').toBeGreaterThanOrEqual(50)

    // The cheap tier says nothing about paint, and says so as `undefined` rather than as 0.
    expect(work.paint, 'the cheap tier invented a paint count').toBeUndefined()
    expect(work.forcedLayout).toBeUndefined()

    await reading.close()
})

test('work that touches nothing costs nothing', async ({ page }) => {
    await page.goto('/docs/state')
    await quiet(page)
    const reading = await engine(page)

    // The other half of the claim, and the half that catches an instrument stuck ON. Arithmetic in a
    // detached variable invalidates no style and no box, so a non-zero reading here is the page's own
    // idle ticks — which is why this asserts a small bound rather than exactly zero.
    const work = await reading.around(() =>
        page.evaluate(() => {
            let total = 0
            for (let i = 0; i < 100_000; i++) total += i
            return total
        }),
    )

    expect(work.layout, 'a computation with no DOM in it forced a layout').toBeLessThan(4)
    expect(work.nodes, 'a computation with no DOM in it made nodes').toBeLessThan(4)
    await reading.close()
})

test('nodes and listeners are deltas, and go both ways', async ({ page }) => {
    await page.goto('/docs/state')
    await quiet(page)
    const reading = await engine(page)

    const added = await reading.around(() =>
        page.evaluate(() => {
            const host = document.createElement('div')
            host.id = 'engine-probe'
            for (let i = 0; i < 200; i++) host.append(document.createElement('span'))
            document.body.append(host)
        }),
    )
    expect(added.nodes, '200 elements did not register').toBeGreaterThanOrEqual(200)
    // Every span has a box, which is what a reflow walks — the count no DOM-call counter can give.
    expect(added.layoutObjects, 'the new nodes had no layout objects').toBeGreaterThan(0)

    // A removal does NOT read negative here, and that is the fact the API documents rather than a
    // shortcoming: `Nodes` counts LIVE nodes, so a detached subtree still counts until it is swept.
    const detached = await reading.around(() =>
        page.evaluate(() => document.getElementById('engine-probe')?.remove()),
    )
    // Not `toBe(0)`: the page is live and lands its own nodes. The claim is that the 200-node removal
    // did NOT register — an implementation reporting attached nodes would read about −201 here.
    expect(detached.nodes, 'an uncollected removal moved the live count').toBeGreaterThan(-100)
    await reading.close()

    // With `{ collect: true }` the same removal is RETAINED nodes and reads negative. This is the
    // difference between a leak and a pending sweep, and it is the whole reason the option exists.
    const retained = await engine(page, { collect: true })
    await page.evaluate(() => {
        const host = document.createElement('div')
        host.id = 'engine-probe-2'
        for (let i = 0; i < 300; i++) host.append(document.createElement('span'))
        document.body.append(host)
    })
    const swept = await retained.around(() =>
        page.evaluate(() => document.getElementById('engine-probe-2')?.remove()),
    )
    expect(swept.nodes, 'a collected removal did not read negative').toBeLessThan(-200)
    await retained.close()
})

test('a layout the work did not wait for is charged to the work, not to the next reading', async ({
    page,
}) => {
    await page.goto('/docs/state')
    await quiet(page)
    const reading = await engine(page)

    // DEFERRED work, which every other case here avoids: this one mutates and returns, so the style
    // recalculation and layout it caused happen at the next frame, after `run` has resolved.
    //
    // The property is that they are billed to the op that CAUSED them rather than to the next reading,
    // which would make the guilty op look free and an innocent one expensive. It does NOT gate the
    // two-frame settle in `around` — removing that leaves this green, because the CDP round trip is
    // itself slower than a frame. See the note there; the settle is insurance, and this is the claim.
    const mutating = await reading.around(() =>
        page.evaluate(() => {
            const box = document.createElement('div')
            box.id = 'late-layout'
            box.style.cssText = 'width:300px;height:300px;background:teal'
            document.body.append(box)
            // Deliberately NO geometry read: nothing here forces the pipeline to run early.
        }),
    )

    // The following reading does nothing at all, so anything it reports was the previous op's.
    const after = await reading.around(() => page.evaluate(() => undefined))

    expect(mutating.layout, 'the deferred layout was not charged to the work that caused it').toBeGreaterThan(
        0,
    )
    expect(after.layout, "the previous op's layout was billed to an op that did nothing").toBeLessThan(1)

    await page.evaluate(() => document.getElementById('late-layout')?.remove())
    await reading.close()
})

test('the paint tier counts paints and forced layouts', async ({ page }) => {
    await page.goto('/docs/state')
    await quiet(page)
    // The expensive tier, exercised once. `{ paint: true }` is what turns the trace on.
    const reading = await engine(page, { paint: true })

    const work = await reading.around(() =>
        page.evaluate(
            () =>
                new Promise<void>((done) => {
                    const box = document.createElement('div')
                    box.style.cssText = 'width:200px;height:200px;background:red'
                    document.body.append(box)
                    let frames = 0
                    const step = (): void => {
                        // A background change is a REPAINT with no layout — the two are separable, and
                        // separating them is the reason the paint tier exists.
                        box.style.background = frames % 2 === 0 ? 'blue' : 'red'
                        if (++frames < 20) requestAnimationFrame(step)
                        else {
                            box.remove()
                            done()
                        }
                    }
                    requestAnimationFrame(step)
                }),
        ),
    )

    expect(work.paint, 'the paint tier reported nothing').toBeGreaterThan(0)
    // `forcedLayout` is a real zero here rather than an absent one: nothing in that loop reads
    // geometry, so there is no synchronous flush to count. Defined, and zero-or-more.
    expect(work.forcedLayout, 'the forced-layout counter was not wired').toBeDefined()

    await reading.close()
})

test('shares() names what fraction of the op each layer took', async ({ page }) => {
    await page.goto('/docs/state')
    await quiet(page)
    const reading = await engine(page)

    // The work is installed as PAGE script and triggered by a real CLICK, which is not incidental:
    // `page.evaluate` runs through the debugger and Blink does not attribute it to `ScriptDuration` at
    // all — the same 20M-iteration loop reads 0.005 ms of script under `evaluate` and 16.9 ms under a
    // click. So this measures the way a user's app is measured, and the alternative measures nothing.
    await page.evaluate(() => {
        const burn = document.createElement('button')
        burn.id = 'burn'
        // Text, because an empty button has no box and Playwright will not click what it cannot see.
        burn.textContent = 'burn'
        burn.addEventListener('click', () => {
            let total = 0
            for (let i = 0; i < 20_000_000; i++) total += i % 7
            ;(window as unknown as Record<string, unknown>).burned = total
        })
        document.body.append(burn)
    })

    const work = await reading.around(() => page.click('#burn'))
    const share = shares(work)

    expect(work.scriptMs, 'a hot script loop was not attributed to script').toBeGreaterThan(5)
    // Script is the LARGEST named layer, which is the claim `shares` exists to support. Not "most of
    // the task": `taskMs` is the whole window including the driver's own round trips, so a named
    // share is a floor on what that layer cost and never a ceiling.
    expect(share.script, 'script was not the dominant named layer').toBeGreaterThan(share.recalcStyle)
    expect(share.script).toBeGreaterThan(share.layout)
    expect(share.layout, 'a loop with no DOM in it was charged for layout').toBeLessThan(0.1)
    // The four sum to the task, which is what makes `other` readable as a residue rather than a gap.
    const summed = share.script + share.recalcStyle + share.layout + share.other
    expect(Math.abs(summed - 1), 'the shares do not sum to the task').toBeLessThan(0.001)

    await reading.close()
})

test('a same-origin frame is counted on the PAGE’s own session', async ({ page }) => {
    // The fact that decides how a framed demo is profiled, and it is not obvious enough to assume: a
    // same-origin frame shares the renderer PROCESS with the page above it, and `Performance.getMetrics`
    // reports that process. So `engine(page)` already sees a demo running inside a frame, and nothing
    // needs a CDP session of the frame's own.
    //
    // Worth a case rather than a comment because the alternative was a real piece of work — opening a
    // second session against a `Frame` target and reconciling two readings — and because the failure
    // mode if this ever stops holding is a demo that reports its engine cost as ZERO. A counter wired
    // to nothing reads as "this work was free", which is the whole reason this file exists.
    await page.goto('/docs/state')
    await quiet(page)

    // A frame of its own, with something layout-shaped in it.
    await page.evaluate(async () => {
        const frame = document.createElement('iframe')
        frame.setAttribute('width', '200')
        frame.setAttribute('height', '200')
        document.body.append(frame)
        for (let waited = 0; frame.contentDocument?.body == null && waited < 50; waited++) {
            await new Promise((settled) => setTimeout(settled, 10))
        }
        ;(frame.contentDocument as Document).body.innerHTML = '<div id="box">x</div>'
    })
    await page.waitForTimeout(200)

    const reading = await engine(page)
    const work = await reading.around(() =>
        page.evaluate(() => {
            const inner = (document.querySelector('iframe') as HTMLIFrameElement).contentDocument as Document
            const box = inner.getElementById('box') as HTMLElement
            // Fifty write/read pairs, INSIDE the frame. Blink cannot batch them there either.
            for (let i = 0; i < 50; i++) {
                box.style.width = `${100 + i}px`
                void box.offsetWidth
            }
        }),
    )

    expect(work.layout, 'the frame’s layouts were invisible to the page’s session').toBeGreaterThanOrEqual(50)
    expect(work.layout, 'something other than the frame’s loop was charged').toBeLessThan(90)
    expect(work.recalcStyle, 'the frame’s style recalculations were not counted').toBeGreaterThanOrEqual(50)

    await reading.close()
    await page.evaluate(() => document.querySelector('iframe')?.remove())
})
