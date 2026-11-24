// 53.61-53.78 IN A REAL BROWSER, against `abide start`. The emulator lays nothing out and snaps
// nothing, so where the scroller rests, and which item a scroll centers, is only a browser's to say —
// in both engines, since chromium reports its snaps (53.66) and webkit is measured once a frame (53.64).

import { expect, type Page, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { servedFixture } from './servedFixture.ts'

// ONE TREE AND ONE SERVER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const LAYOUT = `<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`

const PAGE = `<script>
import { carousel, reactive } from '@abide/abide'

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won']
let selected = reactive<string | undefined>('proposal')
const view = carousel({ items: STAGES, selected })
</script>

<main>
    <p id="current">{view.current}</p>
    <button id="previous" {...view.previous}>previous</button>
    <button id="next" {...view.next}>next</button>
    <button id="reset" onclick={view.reset}>reset</button>
    <button id="pick" onclick={() => { selected = 'lead' }}>pick lead</button>
    <ul id="host" {...view.host}>
        {#for stage of STAGES by stage}
            <li id={stage} {...view.item(stage)}>{stage}</li>
        {/for}
    </ul>
</main>

<style>
#host { display: flex; box-sizing: border-box; width: 300px; margin: 0; padding: 0 50px; overflow-x: auto; scroll-snap-type: x mandatory; list-style: none; }
#host li { flex: 0 0 200px; height: 50px; scroll-snap-align: center; }
</style>`

// The same scroller inside a closed `<dialog>`, where it is bound with no box.
const VIEWER = `<script>
import { lightbox } from '@abide/abide'

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won']
const viewer = lightbox({ items: STAGES })
</script>

<main>
    {#for stage of STAGES by stage}
        <button id={'open-' + stage} onclick={() => viewer.show(stage)}>{stage}</button>
    {/for}
    <dialog {...viewer.dialog}>
        <p id="current">{viewer.current}</p>
        <button id="previous" {...viewer.previous}>previous</button>
        <button id="next" {...viewer.next}>next</button>
        <ul id="host" {...viewer.host}>
            {#for stage of STAGES by stage}
                <li id={stage} {...viewer.item(stage)}>{stage}</li>
            {/for}
        </ul>
    </dialog>
</main>

<style>
#host { display: flex; box-sizing: border-box; width: 300px; margin: 0; padding: 0 50px; overflow-x: auto; scroll-snap-type: x mandatory; list-style: none; }
#host li { flex: 0 0 200px; height: 50px; scroll-snap-align: center; }
</style>`

// The same scroller stepping by itself, round and round, with a button to pause it.
const TOUR = `<script>
import { carousel } from '@abide/abide'

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won']
const tour = carousel({ items: STAGES, loop: true, autoplay: 300 })
</script>

<main>
    <p id="current">{tour.current}</p>
    <button id="play" {...tour.play}>play</button>
    <ul id="host" {...tour.host}>
        {#for stage of STAGES by stage}
            <li id={stage} {...tour.item(stage)}>{stage}</li>
        {/for}
    </ul>
    <p id="away">away</p>
</main>

<style>
#host { display: flex; box-sizing: border-box; width: 300px; margin: 0; padding: 0 50px; overflow-x: auto; scroll-snap-type: x mandatory; list-style: none; }
#host li { flex: 0 0 200px; height: 50px; scroll-snap-align: center; }
</style>`

// Three months and a tenth of the fourth showing, each lined up by its start, stepped one at a time.
const MONTHS = `<script>
import { carousel } from '@abide/abide'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug']
const months = carousel({ items: MONTHS, align: 'start' })
</script>

<main>
    <p id="current">{months.current}</p>
    <button id="previous" {...months.previous}>previous</button>
    <button id="next" {...months.next}>next</button>
    <ul id="host" {...months.host}>
        {#for month of MONTHS by month}
            <li id={month} {...months.item(month)}>{month}</li>
        {/for}
    </ul>
</main>

<style>
#host { display: flex; width: 310px; margin: 0; padding: 0; overflow-x: auto; scroll-snap-type: x mandatory; list-style: none; }
#host li { flex: 0 0 100px; height: 50px; scroll-snap-align: start; }
</style>`

let server: Subprocess | undefined
let base = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-carousel-${testInfo.project.name}`,
        {
            'layout.abide': LAYOUT,
            'index.abide': PAGE,
            'viewer.abide': VIEWER,
            'tour.abide': TOUR,
            'months.abide': MONTHS,
        },
    ))
})

test.afterAll(() => {
    server?.kill()
})

// How far an item's center sits from the scroller's, in whole pixels.
function offCenter(page: Page, id: string): Promise<number> {
    return page.evaluate((id) => {
        const host = (
            document.getElementById('host') as Element
        ).getBoundingClientRect()
        const item = (
            document.getElementById(id) as Element
        ).getBoundingClientRect()
        return Math.round(
            item.left + item.width / 2 - (host.left + host.width / 2),
        )
    }, id)
}

// 53.61, 53.62 — THE SERVER WRITES THE RESTING ITEM CENTERED, AND THE BROWSER SCROLLS TO IT. THE
// REVERT: drop the rest's `watch` from the host's binding; the scroller stays at `lead`.
test('the page arrives resting on the selection, centered — 53.61, 53.62', async ({
    page,
}) => {
    const served = await (await fetch(`${base}/`)).text()
    expect(served).toMatch(/<li id="proposal"[^>]*data-current/)
    await page.goto(`${base}/`)
    await expect.poll(() => offCenter(page, 'proposal')).toBe(0)
    await expect(page.locator('#current')).toHaveText('proposal')
})

// 53.64, 53.66 — A SCROLL THE READER MAKES MOVES `current` TO WHERE IT SNAPS. THE REVERT: listen for
// neither `scroll` nor the snap events; `current` stays at `proposal`.
test('a scroll moves current to the item it snaps to — 53.64, 53.66', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    await expect.poll(() => offCenter(page, 'proposal')).toBe(0)
    // Chromium reports its snaps and webkit does not: each engine's path is the one it takes.
    const reports = await page.evaluate(() => {
        const host = document.getElementById('host') as Element
        const counted = globalThis as { __SNAPS__?: number }
        counted.__SNAPS__ = 0
        host.addEventListener('scrollsnapchange', () => {
            counted.__SNAPS__ = (counted.__SNAPS__ ?? 0) + 1
        })
        return 'onscrollsnapchange' in host
    })
    await page.locator('#host').hover()
    await page.mouse.wheel(400, 0)
    await expect(page.locator('#current')).toHaveText('won')
    await expect.poll(() => offCenter(page, 'won')).toBe(0)
    await expect(page.locator('#won')).toHaveAttribute('data-current', '')
    const snaps = await page.evaluate(
        () => (globalThis as { __SNAPS__?: number }).__SNAPS__ ?? 0,
    )
    expect(snaps > 0).toBe(reports)
})

// 53.67, 53.68 — THE BUTTONS STEP, AND RESET COMES BACK. THE REVERT: make `reset` scroll to
// `current`; the scroller stays on `won`.
test('next steps to the item after, and reset scrolls back to the selection — 53.67, 53.68', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    await expect.poll(() => offCenter(page, 'proposal')).toBe(0)
    await page.click('#next')
    await page.click('#next')
    await expect(page.locator('#current')).toHaveText('won')
    await expect(page.locator('#next')).toBeDisabled()
    await expect.poll(() => offCenter(page, 'won')).toBe(0)
    await page.click('#reset')
    await expect.poll(() => offCenter(page, 'proposal')).toBe(0)
    await expect(page.locator('#current')).toHaveText('proposal')
})

// 53.62 — A NEW SELECTION IS SCROLLED TO. THE REVERT: read `resting.peek()` in the rest's `watch`; the
// scroller stays on `proposal`.
test('a new selection scrolls the carousel to it — 53.62', async ({ page }) => {
    await page.goto(`${base}/`)
    await expect.poll(() => offCenter(page, 'proposal')).toBe(0)
    await page.click('#pick')
    await expect.poll(() => offCenter(page, 'lead')).toBe(0)
    await expect(page.locator('#current')).toHaveText('lead')
    await expect(page.locator('#previous')).toBeDisabled()
})

// 53.62, 53.63 — A SCROLLER BOUND INSIDE A CLOSED DIALOG RESTS WHEN IT OPENS, EACH TIME IT OPENS. THE
// REVERT: drop the host's resize listener; the dialog opens on `lead` with `next` disabled. The two
// `previous` clicks land while the first scroll is on its way: scroll `by` the measured offset rather
// than `to` it, and webkit stops ~27px short of `proposal`.
test('a carousel in a dialog opens resting on the item picked, each time — 53.62, 53.63', async ({
    page,
}) => {
    await page.goto(`${base}/viewer`)
    await page.click('#open-won')
    await expect.poll(() => offCenter(page, 'won')).toBe(0)
    await expect(page.locator('#current')).toHaveText('won')
    await page.click('#previous')
    await page.click('#previous')
    await expect(page.locator('#current')).toHaveText('proposal')
    await expect.poll(() => offCenter(page, 'proposal')).toBe(0)
    await expect(page.locator('#next')).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.click('#open-won')
    await expect.poll(() => offCenter(page, 'won')).toBe(0)
    await expect(page.locator('#current')).toHaveText('won')
})

// 53.71, 53.74, 53.78 — IT STEPS BY ITSELF, AND HOLDS STILL UNDER THE POINTER. THE REVERT: drop
// `!held()` from `rotating`; the hovered scroller moves on to the next stage.
test('an autoplaying carousel steps by itself, and holds still under the pointer — 53.71, 53.74, 53.78', async ({
    page,
}) => {
    await page.goto(`${base}/tour`)
    await expect(page.locator('#host')).toHaveAttribute('aria-live', 'off')
    await expect(page.locator('#current')).not.toHaveText('lead')
    await page.locator('#host').hover()
    await expect(page.locator('#host')).not.toHaveAttribute('aria-live', /.*/)
    const held = await page.locator('#current').textContent()
    // Three of its steps' worth, under the pointer.
    await page.waitForTimeout(900)
    await expect(page.locator('#current')).toHaveText(held ?? '')
    await page.locator('#away').hover()
    await expect(page.locator('#current')).not.toHaveText(held ?? '')
})

// 53.76, 53.77 — A READER WHO PREFERS REDUCED MOTION ARRIVES PAUSED, AND PLAY STARTS IT. THE REVERT:
// drop the reduced-motion `watch`; the page hydrates playing and moves off `lead`.
test('reduced motion arrives paused, and play starts it — 53.76, 53.77', async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${base}/tour`)
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false')
    await page.waitForTimeout(900)
    await expect(page.locator('#current')).toHaveText('lead')
    await page.click('#play')
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#away').hover()
    await expect(page.locator('#current')).not.toHaveText('lead')
})

// 53.67, 53.99 — LINED UP BY ITS START, A STEP MOVES ONE ITEM, AND THE END IS WHERE THE SCROLLER ENDS.
// THE REVERT: step to the next key whether or not a scroll to it moves the scroller, and next is still
// enabled at jun, with jul and aug left where the scroller already is.
test('a carousel aligned by its start shows three and a tenth, and steps one at a time to its end — 53.67, 53.99', async ({
    page,
}) => {
    await page.goto(`${base}/months`)
    const scrolled = () =>
        page.evaluate(() =>
            Math.round((document.getElementById('host') as Element).scrollLeft),
        )
    await expect(page.locator('#current')).toHaveText('jan')
    await page.click('#next')
    await expect(page.locator('#current')).toHaveText('feb')
    await expect.poll(scrolled).toBe(100)
    for (const month of ['mar', 'apr', 'may', 'jun']) {
        await page.click('#next')
        await expect(page.locator('#current')).toHaveText(month)
    }
    // jun's start is past where the scroller ends, 800 less 310 along.
    await expect.poll(scrolled).toBe(490)
    await expect(page.locator('#next')).toBeDisabled()
    await page.click('#previous')
    await expect(page.locator('#current')).toHaveText('may')
    await expect.poll(scrolled).toBe(400)
})
