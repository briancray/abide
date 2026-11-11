// 32.79-32.85 AND 23.30 IN A REAL BROWSER, against `abide start`. The emulator lays nothing out, so
// whether an observer delivers a size, an intersection or a media change is a question only a
// browser can answer — in both engines, since each ships its own observers.

import { expect, test } from '@playwright/test'
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
import { media, reactive } from '@abide/abide'

let box = reactive<{ width: number; height: number } | undefined>(undefined)
let wide = reactive(false)
let placed = reactive<{ top: number } | undefined>(undefined)
let seen = reactive(false)
let rows = reactive([1, 2, 3, 4, 5])
let sizes = reactive<Record<number, number>>({})
const narrow = media('(max-width: 600px)')
</script>

<main>
    <p id="top">{placed === undefined ? 'unmeasured' : Math.round(placed.top)}</p>
    <p id="size">{box === undefined ? 'unmeasured' : box.width + 'x' + box.height}</p>
    <p id="seen">{seen}</p>
    <p id="narrow">{narrow}</p>
    <p id="rows">{Object.values(sizes).join(',')}</p>
    <button id="widen" onclick={() => { wide = !wide }}>widen</button>
    <button id="drop" onclick={() => { rows = [] }}>drop</button>
    <div class="half"></div>
    <div id="placed" bind:rect={placed}></div>
    <div id="box" class:wide={wide} bind:size={box}></div>
    {#for row of rows by row}<div class="row" bind:size={{ set: (next) => { sizes = { ...sizes, [row]: next.width } } }}></div>{/for}
    <div class="spacer"></div>
    <div id="far" bind:visible={seen}>far</div>
</main>

<style>
#box { width: 200px; height: 100px; padding: 10px; }
#box.wide { width: 300px; }
.row { width: 40px; height: 10px; }
.spacer { height: 3000px; }
.half { height: 50vh; }
#placed { height: 10px; }
</style>`

let server: Subprocess | undefined
let base = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-measured-${testInfo.project.name}`,
        { 'layout.abide': LAYOUT, 'index.abide': PAGE },
    ))
})

test.afterAll(() => {
    server?.kill()
})

// 32.79, 32.83, 32.84 — THE SERVER WRITES NOTHING AND THE BROWSER MEASURES: the content box, padding
// out, and again when the layout moves. THE REVERT: measure `borderBoxSize` in `deliverSizes`; the
// box reads 220x120.
test('bind:size writes the content box, and follows it — 32.79', async ({
    page,
}) => {
    const served = await (await fetch(`${base}/`)).text()
    expect(served).toMatch(/<p id="size"[^>]*>unmeasured<\/p>/)
    expect(served).not.toContain('bind:')
    await page.goto(`${base}/`)
    await expect(page.locator('#size')).toHaveText('200x100')
    await page.click('#widen')
    await expect(page.locator('#size')).toHaveText('300x100')
})

// 32.82, 32.85 — ONE OBSERVER OF EACH KIND FOR EVERY BOUND ELEMENT ON THE PAGE — two
// `ResizeObserver`s, one for the six `bind:size`s and one for the `bind:rect` — and a row that leaves
// is unobserved. Counted by wrapping the browser's own constructor and `unobserve` before the page
// loads. THE REVERT: `observer = new ResizeObserver(…)` in place of `??=` in `bindSize`; 7 are made.
test('every bind:size shares one ResizeObserver, and a row that leaves is unobserved — 32.82, 32.85', async ({
    page,
}) => {
    await page.addInitScript(() => {
        const counts = { made: 0, unobserved: 0 }
        ;(globalThis as { __OBSERVERS__?: typeof counts }).__OBSERVERS__ =
            counts
        const Native = ResizeObserver
        globalThis.ResizeObserver = class extends Native {
            constructor(callback: ResizeObserverCallback) {
                super(callback)
                counts.made += 1
            }
            override unobserve(target: Element): void {
                counts.unobserved += 1
                super.unobserve(target)
            }
        }
    })
    await page.goto(`${base}/`)
    await expect(page.locator('#rows')).toHaveText('40,40,40,40,40')
    const counts = () =>
        page.evaluate(
            () =>
                (
                    globalThis as {
                        __OBSERVERS__?: { made: number; unobserved: number }
                    }
                ).__OBSERVERS__,
        )
    expect(await counts()).toEqual({ made: 2, unobserved: 0 })
    await page.click('#drop')
    await expect(page.locator('.row')).toHaveCount(0)
    expect(await counts()).toEqual({ made: 2, unobserved: 5 })
})

// 32.80 — AN ELEMENT BELOW THE FOLD IS NOT VISIBLE UNTIL IT IS SCROLLED TO. THE REVERT: write `true`
// in `deliverIntersections` whatever `isIntersecting` says; `#seen` reads true before the scroll.
test('bind:visible follows the element into the viewport — 32.80', async ({
    page,
}) => {
    await page.goto(`${base}/`)
    await expect(page.locator('#size')).toHaveText('200x100')
    await expect(page.locator('#seen')).toHaveText('false')
    await page.locator('#far').scrollIntoViewIfNeeded()
    await expect(page.locator('#seen')).toHaveText('true')
})

// 23.30 — THE BROWSER'S ANSWER, AND ITS CHANGE: a viewport narrowed past the query wakes the value.
// THE REVERT: drop the `change` listener in `media`; `#narrow` stays false at 500px.
test('media follows the viewport — 23.30', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${base}/`)
    await expect(page.locator('#narrow')).toHaveText('false')
    await page.setViewportSize({ width: 500, height: 768 })
    await expect(page.locator('#narrow')).toHaveText('true')
})

// 32.86 — A SCROLL MOVES `top` AND SO DOES A WINDOW RESIZE THAT MOVES THE ELEMENT, each answered in
// the frame after it, and the value reads what the browser reports there. THE REVERT: drop the
// scroll listener from `bindRect`; `top` keeps its first reading after the scroll.
test('bind:rect follows a scroll and a window resize — 32.86', async ({
    page,
}) => {
    const served = await (await fetch(`${base}/`)).text()
    expect(served).toMatch(/<p id="top"[^>]*>unmeasured<\/p>/)
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${base}/`)
    // The rows' widths fill a line above `#placed` in their first frame — a move with no scroll or
    // resize, which 32.87 leaves unseen — so the page is read once it has settled.
    await expect(page.locator('#rows')).toHaveText('40,40,40,40,40')
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    const reported = () =>
        page.evaluate(() =>
            String(
                Math.round(
                    (
                        document.getElementById('placed') as Element
                    ).getBoundingClientRect().top,
                ),
            ),
        )
    const first = await reported()
    await expect(page.locator('#top')).toHaveText(first)
    await page.evaluate(() => window.scrollTo(0, 100))
    const scrolled = await reported()
    expect(scrolled).toBe(String(Number(first) - 100))
    await expect(page.locator('#top')).toHaveText(scrolled)
    await page.setViewportSize({ width: 1024, height: 568 })
    const resized = await reported()
    expect(resized).toBe(String(Number(scrolled) - 100))
    await expect(page.locator('#top')).toHaveText(resized)
})
