// THE SCROLL SHARE OF `bind:rect` — what a scroll of 60 frames costs the main thread with N bound
// elements, and how much of it is the position observers 32.87 keeps (made again per 32.90).
//
// CHROMIUM OVER CDP, because the cost is Blink's as much as the script's: a new
// `IntersectionObserver` is constructed and observed in script, but its first intersection is
// computed and delivered in the rendering step. So the frame is priced by `TaskDuration` — every
// task on the main thread — and the script side of the observers by wrapping the constructor,
// `observe` and `disconnect` in the page, beside a COUNT of observers made per frame, which is the
// work the two arms differ in.
//
// `bun run bench:rect` — N = 10, 100, 500, three runs each; `bun run bench:rect 2000 5000` for
// other sizes. Measured before 32.90 left scrolled frames unarmed, the observers were 31% of the
// frame at N = 10 and 65% at N = 500, and the whole frame crossed 16.7 ms near N = 4500.

import { chromium } from '@playwright/test'

import { servedFixture } from '../e2e/servedFixture.ts'
import { median, percent, spread } from './median.ts'

const SIZES =
    process.argv.length > 2 ? process.argv.slice(2).map(Number) : [10, 100, 500]
const RUNS = 3
const FRAMES = 60

const LAYOUT = `<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`

const page = (count: number): string => `<script>
const rows = Array.from({ length: ${count} }, (_, index) => index)
const sink = { set: (next) => { globalThis.__RECT_WRITES__ = (globalThis.__RECT_WRITES__ ?? 0) + 1 } }
</script>

<main>
    {#for row of rows by row}<div class="row" bind:rect={sink}>{row}</div>{/for}
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

const browser = await chromium.launch()
const servers: { kill: () => void }[] = []
try {
    for (const count of SIZES) {
        const { base, server } = await servedFixture(`bench-rect-${count}`, {
            'layout.abide': LAYOUT,
            'index.abide': page(count),
        })
        servers.push(server)
        const rows: Row[] = []
        for (let run = 0; run < RUNS; run += 1) {
            const context = await browser.newContext({
                viewport: { width: 800, height: 600 },
            })
            await context.addInitScript(WRAP)
            const tab = await context.newPage()
            await tab.goto(`${base}/`, { waitUntil: 'load' })
            // Settled: every element read and armed, its first delivery made.
            await tab.waitForFunction(
                (expected) =>
                    ((globalThis as { __RECT_WRITES__?: number })
                        .__RECT_WRITES__ ?? 0) >= expected,
                count,
            )
            await tab.evaluate(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => requestAnimationFrame(resolve), 200),
                    ),
            )
            const session = await context.newCDPSession(tab)
            await session.send('Performance.enable')
            const taskDuration = async (): Promise<number> => {
                const answer = (await session.send(
                    'Performance.getMetrics',
                )) as { metrics: { name: string; value: number }[] }
                return (
                    answer.metrics.find(
                        (metric) => metric.name === 'TaskDuration',
                    )?.value ?? 0
                )
            }
            const before = await tab.evaluate(() => {
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
            const taskBefore = await taskDuration()
            // 60 FRAMES OF SCROLL, one step per frame, then two quiet frames for the settle.
            await tab.evaluate(
                (frames) =>
                    new Promise<void>((resolve) => {
                        let left = frames
                        const step = (): void => {
                            if (left === 0) {
                                requestAnimationFrame(() =>
                                    requestAnimationFrame(() => resolve()),
                                )
                                return
                            }
                            left -= 1
                            scrollBy(0, 4)
                            requestAnimationFrame(step)
                        }
                        requestAnimationFrame(step)
                    }),
                FRAMES,
            )
            const taskAfter = await taskDuration()
            const after = await tab.evaluate(() => {
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
            rows.push({
                frameMs: ((taskAfter - taskBefore) * 1000) / FRAMES,
                armMs: (after.armMs - before.armMs) / FRAMES,
                made: after.made - before.made,
                writes: after.writes - before.writes,
            })
            await session.detach()
            await context.close()
        }
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
} finally {
    await browser.close()
    for (const server of servers) server.kill()
}
