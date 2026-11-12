// 32.79-32.85, 32.91, 32.92 AND 23.30 IN A REAL BROWSER, against `abide start`. The emulator lays nothing out, so
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
let tall = reactive(false)
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
    {#if narrow}<p id="narrow-arm">narrow</p>{:else}<p id="wide-arm">wide</p>{/if}
    <p id="rows">{Object.values(sizes).join(',')}</p>
    <button id="widen" onclick={() => { wide = !wide }}>widen</button>
    <button id="drop" onclick={() => { rows = [] }}>drop</button>
    <button id="grow" onclick={() => { tall = true }}>grow</button>
    <div class:tall={tall}></div>
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
.tall { height: 50px; }
#placed { height: 10px; }
</style>`

// 32.91, 32.92 — A SCROLLER STANDING INSIDE THE VIEWPORT, ANOTHER BELOW THE FOLD, AND TWO BORDER
// BOXES, one of them written vertically.
const MEASURED_AGAINST = `<script>
import { reactive } from '@abide/abide'

let scroller = reactive<HTMLElement>()
let low = reactive<HTMLElement>()
let head = reactive<boolean>()
let tail = reactive<boolean>()
let inside = reactive<boolean>()
let insideViewport = reactive<boolean>()
let bordered = reactive<{ width: number; height: number }>()
let upright = reactive<{ width: number; height: number }>()
</script>

<main>
    <p id="head-seen">{String(head)}</p>
    <p id="tail-seen">{String(tail)}</p>
    <p id="inside-seen">{String(inside)} {String(insideViewport)}</p>
    <p id="bordered">{bordered === undefined ? 'unmeasured' : bordered.width + 'x' + bordered.height}</p>
    <p id="upright">{upright === undefined ? 'unmeasured' : upright.width + 'x' + upright.height}</p>
    <div id="sized" bind:size={bordered} sizeBox="border"></div>
    <div id="sized-upright" bind:size={upright} sizeBox="border"></div>
    <div id="scroller" bind:element={scroller}>
        <p id="head" bind:visible={head} visibleIn={scroller}>head</p>
        <div class="gap"></div>
        <p id="tail" bind:visible={tail} visibleIn={scroller}>tail</p>
    </div>
    <div class="fold"></div>
    <div id="low" bind:element={low}>
        <p bind:visible={inside} visibleIn={low}>inside</p>
        <p bind:visible={insideViewport}>inside</p>
    </div>
</main>

<style>
#sized, #sized-upright { width: 200px; height: 100px; padding: 10px; border: 2px solid; }
#sized-upright { writing-mode: vertical-rl; }
#scroller { height: 100px; margin-top: 100px; overflow-y: auto; }
#scroller p { margin: 0; height: 20px; }
.gap { height: 100px; }
.fold { height: 3000px; }
</style>`

let server: Subprocess | undefined
let base = ''

// Playwright's "no fixtures" spelling — see `routing.spec.ts`.
test.beforeAll(async ({}, testInfo) => {
    ;({ base, server } = await servedFixture(
        `e2e-measured-${testInfo.project.name}`,
        {
            'layout.abide': LAYOUT,
            'index.abide': PAGE,
            'against.abide': MEASURED_AGAINST,
        },
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
    // The rows' widths fill a line above `#placed` after the first frame — a move 32.87 sees — so
    // the page is read once it has settled.
    await expect(page.locator('#rows')).toHaveText('40,40,40,40,40')
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

// 32.87 — A SIBLING ABOVE GROWS, AND `#placed` MOVES WITH NO SCROLL, NO WINDOW RESIZE AND NO RESIZE
// OF ITS OWN: its position observer sees the move. THE REVERT: skip `arm` in `measure`; `top` keeps
// the reading from before the growth, 50px short.
test('bind:rect follows a move nothing else reports — 32.87', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${base}/`)
    await expect(page.locator('#rows')).toHaveText('40,40,40,40,40')
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
    const before = await reported()
    await expect(page.locator('#top')).toHaveText(before)
    await page.click('#grow')
    const after = await reported()
    expect(after).toBe(String(Number(before) + 50))
    await expect(page.locator('#top')).toHaveText(after)
})

// 32.87, 32.90 — THE SAME MOVE RIGHT AFTER A SCROLL. A scrolled frame makes no position observer, so
// what sees the growth is the one made in the frame after the scroll. THE REVERT: drop
// `if (scrolling) schedule()` in `measure`; in chromium `top` keeps the reading from the scroll, 50px
// short (575 -> 525).
test('bind:rect follows a move nothing else reports right after a scroll — 32.87, 32.90', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${base}/`)
    await expect(page.locator('#rows')).toHaveText('40,40,40,40,40')
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
    await page.evaluate(() => window.scrollTo(0, 100))
    const scrolled = await reported()
    await expect(page.locator('#top')).toHaveText(scrolled)
    // Clicked in the page: playwright's own click scrolls the button into view first.
    await page.evaluate(() => document.getElementById('grow')?.click())
    const after = await reported()
    expect(after).toBe(String(Number(scrolled) + 50))
    await expect(page.locator('#top')).toHaveText(after)
})

// 41.32 — THE SERVER PAINTS THE WIDE ARM, A NARROW BROWSER HYDRATES IT AND THEN SWAPS IT, and says
// nothing on `abide:hydrate`: the arm changed because the viewport is the browser's to know, not
// because the two sides disagreed by mistake. THE REVERT: make `beginHydration` write nothing and
// `isHydrating` answer false; the console carries the 41.24 warning.
test('media hydrates the arm the server painted and swaps it without a warning — 41.32', async ({
    page,
}) => {
    const warned: string[] = []
    page.on('console', (message) => {
        if (message.text().includes('41.24')) warned.push(message.text())
    })
    await page.setViewportSize({ width: 500, height: 768 })
    await page.goto(`${base}/`)
    await expect(page.locator('#narrow-arm')).toHaveText('narrow')
    await expect(page.locator('#wide-arm')).toHaveCount(0)
    await expect(page.locator('#size')).toHaveText('200x100')
    expect(warned).toEqual([])
})

// 32.92 — THE BORDER BOX, PADDING AND BORDER IN: 200x100 with 10px of padding and a 2px border is
// 224x124, and the same box written vertically is 224x124 too — its inline size is its height. THE
// REVERT: write `contentRect` for a `sizeBox="border"` element in `deliverSizes`; both read 200x100.
// Turning the axes is the unit test's (`bindMeasured.test.ts`, 124x224 without it).
test('sizeBox="border" writes the border box, in physical axes — 32.92', async ({
    page,
}) => {
    const served = await (await fetch(`${base}/against`)).text()
    expect(served.toLowerCase()).not.toContain('sizebox')
    await page.goto(`${base}/against`)
    await expect(page.locator('#bordered')).toHaveText('224x124')
    await expect(page.locator('#upright')).toHaveText('224x124')
})

// 32.91 — A ROOT IS WHAT VISIBILITY IS MEASURED AGAINST. In a scroller standing in the viewport, the
// head is visible and the tail is not; scrolled, the head is out of the scroller while it still
// stands in the viewport. Two elements in one root are one observer. THE REVERT: drop `{ root }` in
// `Rooted`; the scroller clips its elements against the viewport too, so they read as before, and
// what fails is the count — no observer rooted at the scroller. The next test is what tells them apart.
test('bind:visible with visibleIn follows a scroller, sharing one observer — 32.91, 32.82', async ({
    page,
}) => {
    await page.addInitScript(() => {
        const roots: unknown[] = []
        ;(globalThis as { __ROOTS__?: unknown[] }).__ROOTS__ = roots
        const Native = IntersectionObserver
        globalThis.IntersectionObserver = class extends Native {
            constructor(
                callback: IntersectionObserverCallback,
                options?: IntersectionObserverInit,
            ) {
                super(callback, options)
                roots.push(
                    options?.root instanceof Element ? options.root.id : null,
                )
            }
        }
    })
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${base}/against`)
    await expect(page.locator('#head-seen')).toHaveText('true')
    await expect(page.locator('#tail-seen')).toHaveText('false')
    await page.evaluate(() => {
        ;(document.getElementById('scroller') as Element).scrollTop = 50
    })
    await expect(page.locator('#head-seen')).toHaveText('false')
    await expect(page.locator('#tail-seen')).toHaveText('true')
    const headBottom = await page.evaluate(
        () =>
            (document.getElementById('head') as Element).getBoundingClientRect()
                .bottom,
    )
    expect(headBottom).toBeGreaterThan(0)
    const roots = await page.evaluate(
        () => (globalThis as { __ROOTS__?: unknown[] }).__ROOTS__,
    )
    expect(roots?.filter((root) => root === 'scroller')).toHaveLength(1)
})

// 32.91 — THE DISTINGUISHING CASE: a scroller below the fold holds an element in its own view, which
// is visible in the scroller and not in the viewport. THE REVERT: drop `{ root }` in `Rooted`; it
// reads `false false`.
test('bind:visible with visibleIn measures against the root, not the viewport — 32.91', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`${base}/against`)
    await expect(page.locator('#inside-seen')).toHaveText('true false')
})
