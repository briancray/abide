// 32.101-32.103 IN A REAL BROWSER, against `abide start`. The emulator lays nothing out, so where
// a scroll position lands against an element's overflow, which way a right-to-left scroller's runs,
// and what a closed `<details>` leaves to measure are questions only a browser answers — in both
// engines.

import { expect, test } from '@playwright/test'
import type { Subprocess } from 'bun'

import { BARE_LAYOUT } from '../bench/BARE_LAYOUT.ts'
import { servedFixture } from './servedFixture.ts'

// ONE TREE AND ONE SERVER PER PROJECT, for `routing.spec.ts`'s reason.
test.describe.configure({ mode: 'default' })

const PAGE = `<script>
import { reactive, scrollEdges } from '@abide/abide'

let rows = reactive([1, 2])
let tall = reactive(false)
</script>

<main>
    <button id="add" onclick={() => { rows = [...rows, rows.length + 1] }}>add</button>
    <button id="grow" onclick={() => { tall = true }}>grow</button>
    <ol id="list" {...scrollEdges()}>
        {#for row of rows key row}<li>{row}</li>{/for}
    </ol>
    <div id="grown" {...scrollEdges()}><p class:tall={tall}>content</p></div>
    <div id="ltr" class="wide" {...scrollEdges()}><p></p></div>
    <div id="rtl" class="wide" dir="rtl" {...scrollEdges()}><p></p></div>
    <details id="folded">
        <summary>more</summary>
        <div id="inside" {...scrollEdges()}><p class:tall={tall}>content</p></div>
    </details>
</main>

<style>
#list, #grown, #inside { height: 100px; overflow-y: auto; margin: 0; padding: 0; }
#list li { height: 40px; }
#grown p, #inside p { margin: 0; height: 20px; }
#grown p.tall, #inside p.tall { height: 300px; }
.wide { width: 100px; height: 20px; overflow-x: auto; }
.wide p { width: 300px; height: 10px; margin: 0; }
</style>`

let server: Subprocess | undefined
let base = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-scroll-edges-${testInfo.project.name}`,
        { 'layout.abide': BARE_LAYOUT, 'index.abide': PAGE },
    ))
})

test.afterAll(() => {
    server?.kill()
})

// 32.101, 32.103 — A LIST THAT FITS IS UNMARKED; ROWS ADDED PAST ITS HEIGHT MARK `bottom`, AND
// SCROLLING THROUGH IT MARKS EACH EDGE IN TURN. The list's own box never moves as rows arrive.
// THE REVERT: drop the `MutationObserver` from `Edged`; the third row is added with no read, and
// the list stays unmarked.
test("rows added past a list's height mark it, and scrolling moves the mark — 32.101, 32.103", async ({
    page,
}) => {
    await page.goto(`${base}/`)
    const list = page.locator('#list')
    await expect(list).not.toHaveAttribute('data-scrollable')
    await page.click('#add')
    await expect(list).toHaveAttribute('data-scrollable', 'bottom')
    await list.evaluate((element) => {
        element.scrollTop = 10
    })
    await expect(list).toHaveAttribute('data-scrollable', 'top bottom')
    await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight
    })
    await expect(list).toHaveAttribute('data-scrollable', 'top')
})

// 32.103 — CONTENT GROWING INSIDE IS SEEN THOUGH THE SCROLLER KEEPS ITS SIZE: the class that grows the
// paragraph is an attribute written inside. THE REVERT: drop `attributes` from `CONTENT`; the
// paragraph grows to 300px with no read, and the scroller stays unmarked.
test('a child growing inside a scroller of fixed size marks it — 32.103', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    const grown = page.locator('#grown')
    await expect(page.locator('#list')).not.toHaveAttribute('data-scrollable')
    await expect(grown).not.toHaveAttribute('data-scrollable')
    await page.click('#grow')
    await expect(grown).toHaveAttribute('data-scrollable', 'bottom')
})

// 32.102 — START IS THE SCROLL ORIGIN: the left of a left-to-right scroller and the right of a
// right-to-left one, whose position runs negative. THE REVERT: read `scrollLeft` signed in
// `measure`; the right-to-left scroller scrolled toward its end reads `end` alone, its `start` lost.
test('start and end follow the direction a scroller runs in — 32.102', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    const ltr = page.locator('#ltr')
    const rtl = page.locator('#rtl')
    await expect(ltr).toHaveAttribute('data-scrollable', 'end')
    await expect(rtl).toHaveAttribute('data-scrollable', 'end')
    await ltr.evaluate((element) => {
        element.scrollLeft = 50
    })
    await rtl.evaluate((element) => {
        element.scrollLeft = -50
    })
    await expect(ltr).toHaveAttribute('data-scrollable', 'start end')
    await expect(rtl).toHaveAttribute('data-scrollable', 'start end')
    await rtl.evaluate((element) => {
        element.scrollLeft = -element.scrollWidth
    })
    await expect(rtl).toHaveAttribute('data-scrollable', 'start')
})

// 32.103 — CONTENT THAT GROWS INSIDE A CLOSED `<details>` IS READ AT THE CHANGE: the read forces the
// closed content's layout, so the scroller is marked before the `<details>` opens and stays marked
// after. THE REVERT: drop `attributes` from `CONTENT`; the scroller is unmarked, open or closed.
test('a scroller whose content grew inside a closed details is marked, and stays marked open — 32.103', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    const inside = page.locator('#inside')
    await expect(page.locator('#ltr')).toHaveAttribute('data-scrollable', 'end')
    await expect(inside).not.toHaveAttribute('data-scrollable')
    await page.click('#grow')
    await expect(inside).toHaveAttribute('data-scrollable', 'bottom')
    await page.click('#folded summary')
    await expect(inside).toHaveAttribute('data-scrollable', 'bottom')
})
