// THE SCROLL SHARE OF `elementRect` — what a scroll of 60 frames costs the main thread with N bound
// elements, and how much of it is the position observers 32.85 keeps (made again per 32.88).
//
// CHROMIUM OVER CDP, because the cost is Blink's as much as the script's: a new
// `IntersectionObserver` is constructed and observed in script, but its first intersection is
// computed and delivered in the rendering step. So the frame is priced by `TaskDuration` — every
// task on the main thread — and the script side of the observers by wrapping the constructor,
// `observe` and `disconnect` in the page, beside a COUNT of observers made per frame, which is the
// work the two arms differ in.
//
// `bun run bench:rect` — N = 10, 100, 500, three runs each; `bun run bench:rect 2000 5000` for
// other sizes. Measured before 32.88 left scrolled frames unarmed, the observers were 31% of the
// frame at N = 10 and 65% at N = 500, and the whole frame crossed 16.7 ms near N = 4500.

import { BARE_LAYOUT } from './BARE_LAYOUT.ts'
import { eachRun, inChromium, scrollFrames } from './mainThread.ts'
import { median, percent, spread } from './median.ts'

const SIZES =
    process.argv.length > 2 ? process.argv.slice(2).map(Number) : [10, 100, 500]
const RUNS = 3
const FRAMES = 60

const page = (count: number): string => `<script>
import { elementRect } from '@abide/abide'

const rows = Array.from({ length: ${count} }, (_, index) => index)
const sink = () => { globalThis.__RECT_WRITES__ = (globalThis.__RECT_WRITES__ ?? 0) + 1 }
</script>

<main>
    {#for row of rows key row}<div class="row" {...elementRect(sink)}>{row}</div>{/for}
    <div class="spacer"></div>
</main>

<style>
.row { height: 6px; }
.spacer { height: 6000px; }
</style>`

// Installed before the page loads: counts observers made and times what making, observing and
// dropping one costs the script. `performance.now()` is coarse, but these are summed over 60
// frames of N elements, and the frame cost is read off CDP rather than from here.
const WRAP = (): void => {
    const counts = { made: 0, armMs: 0 }
    ;(globalThis as { __ARMS__?: typeof counts }).__ARMS__ = counts
    const Native = IntersectionObserver
    globalThis.IntersectionObserver = class extends Native {
        constructor(
            callback: IntersectionObserverCallback,
            options?: IntersectionObserverInit,
        ) {
            const start = performance.now()
            super(callback, options)
            counts.made += 1
            counts.armMs += performance.now() - start
        }
        override observe(target: Element): void {
            const start = performance.now()
            super.observe(target)
            counts.armMs += performance.now() - start
        }
        override disconnect(): void {
            const start = performance.now()
            super.disconnect()
            counts.armMs += performance.now() - start
        }
    }
}

type Row = { frameMs: number; armMs: number; made: number; writes: number }

await inChromium(async (browser, serve) => {
    for (const count of SIZES) {
        const base = await serve(`bench-rect-${count}`, {
            'layout.abide': BARE_LAYOUT,
            'index.abide': page(count),
        })
        const rows: Row[] = await eachRun(
            browser,
            base,
            {
                runs: RUNS,
                viewport: { width: 800, height: 600 },
                init: WRAP,
                // Settled: every element read and armed, its first delivery made.
                ready: (tab) =>
                    tab.waitForFunction(
                        (expected) =>
                            ((globalThis as { __RECT_WRITES__?: number })
                                .__RECT_WRITES__ ?? 0) >= expected,
                        count,
                    ),
            },
            async (tab, taskDuration) => {
                // What the page counted so far: arms made, their milliseconds, and rect writes.
                const counters = () =>
                    tab.evaluate(() => {
                        const state = globalThis as {
                            __ARMS__?: { made: number; armMs: number }
                            __RECT_WRITES__?: number
                        }
                        return {
                            made: state.__ARMS__?.made ?? 0,
                            armMs: state.__ARMS__?.armMs ?? 0,
                            writes: state.__RECT_WRITES__ ?? 0,
                        }
                    })
                const before = await counters()
                const taskBefore = await taskDuration()
                // 60 FRAMES OF SCROLL, one step per frame, then two quiet frames for the settle.
                await scrollFrames(tab, FRAMES, 4)
                const taskAfter = await taskDuration()
                const after = await counters()
                return {
                    frameMs: ((taskAfter - taskBefore) * 1000) / FRAMES,
                    armMs: (after.armMs - before.armMs) / FRAMES,
                    made: after.made - before.made,
                    writes: after.writes - before.writes,
                }
            },
        )
        const frame = rows.map((row) => row.frameMs)
        const arm = rows.map((row) => row.armMs)
        const share = rows.map((row) => row.armMs / row.frameMs)
        const ms = (value: number): string => value.toFixed(3)
        console.log(`\n  N = ${count}`)
        console.log(
            `    main thread / frame  median ${ms(median(frame))} ms   spread ${spread(frame, ms)}`,
        )
        console.log(
            `    arm script / frame   median ${ms(median(arm))} ms   spread ${spread(arm, ms)}   share ${percent(median(share))}`,
        )
        console.log(
            `    observers made       ${rows.map((row) => row.made).join('/')}   rect writes ${rows.map((row) => row.writes).join('/')}`,
        )
    }
})
