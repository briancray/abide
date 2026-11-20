// THE SHARE A LONG LIST COSTS, and what windowing buys back — measured before `virtualRows` existed,
// and kept as its bench: where a keyed `{#for}` over N rows crosses a frame when it mounts, and the
// windowed arms, abide's and a hand-written one, priced on the same two ops.
//
// CHROMIUM OVER CDP, the frame priced by `TaskDuration` — every task on the main thread, so the
// style, layout and paint of N rows count beside the script that made them. A mount is a click that
// opens the list; a scroll is 60 frames of one 8px step each.
//
// `bun run bench:virtual` — N = 1000, 5000, 20000, three runs each; `bun run bench:virtual 50000`
// for other sizes.

import { chromium } from '@playwright/test'

import { servedFixture } from '../e2e/servedFixture.ts'
import { median, spread } from './median.ts'

const SIZES =
    process.argv.length > 2
        ? process.argv.slice(2).map(Number)
        : [1000, 5000, 20000]
const RUNS = 3
const FRAMES = 60
const ROW = 24

const LAYOUT = `<html lang="en">
<head>
    <meta charset="utf-8" />
</head>
<body>
    <slot/>
</body>
</html>`

const STYLE = `<style>
.viewport { height: 480px; overflow: auto; }
.row { height: ${ROW}px; display: flex; gap: 8px; }
</style>`

const rowsOf = (count: number): string =>
    `const rows = Array.from({ length: ${count} }, (_, index) => ({ id: index, name: 'Deal ' + index, amount: index * 7 }))`

// Every row of the list, keyed: what an app writes today.
const fullArm = (count: number): string => `<script>
import { reactive } from '@abide/abide'
${rowsOf(count)}
let open = reactive(false)
</script>

<button id="open" onclick={() => (open = true)}>Open</button>
{#if open}
    <div class="viewport" id="viewport">
        {#for row of rows by row.id}
            <div class="row"><span>{row.name}</span><span>{row.amount}</span></div>
        {/for}
    </div>
{/if}
${STYLE}`

// The rows in view, by hand: a scroll listener, a ResizeObserver, two spacers and a keyed patch.
const vanillaArm = (count: number): string => `<script>
${rowsOf(count)}
const ROW = ${ROW}
const OVERSCAN = 5
function mount() {
    const viewport = document.createElement('div')
    viewport.id = 'viewport'
    // Inline, since a page's \`<style>\` reaches only the markup the page writes.
    viewport.style.cssText = 'height: 480px; overflow: auto'
    const before = document.createElement('div')
    const after = document.createElement('div')
    viewport.append(before, after)
    document.body.append(viewport)
    const shown = new Map()
    let height = viewport.clientHeight
    let first = -1
    let last = -1
    const draw = () => {
        const top = Math.floor(viewport.scrollTop / ROW)
        const start = Math.max(0, top - OVERSCAN)
        const end = Math.min(rows.length, top + Math.ceil(height / ROW) + OVERSCAN)
        if (start === first && end === last) return
        first = start
        last = end
        for (const [id, element] of shown)
            if (id < start || id >= end) {
                element.remove()
                shown.delete(id)
            }
        let at = before
        for (let index = start; index < end; index += 1) {
            let element = shown.get(index)
            if (element === undefined) {
                const row = rows[index]
                element = document.createElement('div')
                element.style.cssText = 'height: ${ROW}px; display: flex; gap: 8px'
                const name = document.createElement('span')
                name.textContent = row.name
                const amount = document.createElement('span')
                amount.textContent = String(row.amount)
                element.append(name, amount)
                shown.set(index, element)
                at.after(element)
            } else if (at.nextSibling !== element) at.after(element)
            at = element
        }
        before.style.height = start * ROW + 'px'
        after.style.height = (rows.length - end) * ROW + 'px'
    }
    viewport.addEventListener('scroll', draw, { passive: true })
    new ResizeObserver(() => {
        height = viewport.clientHeight
        draw()
    }).observe(viewport)
    draw()
}
</script>

<button id="open" onclick={mount}>Open</button>
${STYLE}`

// The rows in view, through \`virtualRows\`.
const virtualArm = (count: number): string => `<script>
import { reactive, virtualRows } from '@abide/abide'
${rowsOf(count)}
let open = reactive(false)
const view = virtualRows({ count: () => rows.length, rowHeight: ${ROW} })
</script>

<button id="open" onclick={() => (open = true)}>Open</button>
{#if open}
    <div class="viewport" id="viewport" bind:element={view.viewport}>
        <div style:height="{view.before()}px"></div>
        {#for row of rows.slice(view.start(), view.end()) by row.id}
            <div class="row"><span>{row.name}</span><span>{row.amount}</span></div>
        {/for}
        <div style:height="{view.after()}px"></div>
    </div>
{/if}
${STYLE}`

const ARMS: Record<string, (count: number) => string> = {
    full: fullArm,
    vanilla: vanillaArm,
    virtual: virtualArm,
}
const chosen = (process.env.ARMS ?? 'full,vanilla,virtual').split(',')

type Row = { mountMs: number; scrollMs: number; nodes: number }

const browser = await chromium.launch()
const servers: { kill: () => void }[] = []
try {
    for (const count of SIZES) {
        console.log(`\n  N = ${count}`)
        const results = new Map<string, Row[]>()
        for (const arm of chosen) {
            const { base, server } = await servedFixture(
                `bench-virtual-${arm}-${count}`,
                {
                    'layout.abide': LAYOUT,
                    'index.abide': (ARMS[arm] as (count: number) => string)(
                        count,
                    ),
                },
            )
            servers.push(server)
            const rows: Row[] = []
            for (let run = 0; run < RUNS; run += 1) {
                const context = await browser.newContext({
                    viewport: { width: 800, height: 700 },
                })
                const tab = await context.newPage()
                await tab.goto(`${base}/`, { waitUntil: 'load' })
                await tab.evaluate(
                    () =>
                        new Promise((resolve) =>
                            setTimeout(
                                () => requestAnimationFrame(resolve),
                                200,
                            ),
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
                const mountBefore = await taskDuration()
                // A click, then two frames for its render, style, layout and paint.
                await tab.evaluate(
                    () =>
                        new Promise<void>((resolve) => {
                            ;(
                                document.getElementById('open') as HTMLElement
                            ).click()
                            requestAnimationFrame(() =>
                                requestAnimationFrame(() => resolve()),
                            )
                        }),
                )
                const mountAfter = await taskDuration()
                const nodes = await tab.evaluate(
                    () =>
                        document
                            .getElementById('viewport')
                            ?.getElementsByTagName('*').length ?? 0,
                )
                const scrollBefore = await taskDuration()
                await tab.evaluate(
                    (frames) =>
                        new Promise<void>((resolve) => {
                            const viewport = document.getElementById(
                                'viewport',
                            ) as HTMLElement
                            let left = frames
                            const step = (): void => {
                                if (left === 0) {
                                    requestAnimationFrame(() =>
                                        requestAnimationFrame(() => resolve()),
                                    )
                                    return
                                }
                                left -= 1
                                viewport.scrollTop += 8
                                requestAnimationFrame(step)
                            }
                            requestAnimationFrame(step)
                        }),
                    FRAMES,
                )
                const scrollAfter = await taskDuration()
                rows.push({
                    mountMs: (mountAfter - mountBefore) * 1000,
                    scrollMs: ((scrollAfter - scrollBefore) * 1000) / FRAMES,
                    nodes,
                })
                await session.detach()
                await context.close()
            }
            results.set(arm, rows)
            const ms = (value: number): string => value.toFixed(2)
            const mount = rows.map((row) => row.mountMs)
            const scroll = rows.map((row) => row.scrollMs)
            console.log(
                `    ${arm.padEnd(8)} mount ${ms(median(mount))} ms (${spread(mount, ms)})   scroll/frame ${ms(median(scroll))} ms (${spread(scroll, ms)})   nodes ${rows[0]?.nodes}`,
            )
        }
        const vanilla = results.get('vanilla')
        const virtual = results.get('virtual')
        if (vanilla && virtual) {
            const ratio = (pick: (row: Row) => number): string =>
                (median(virtual.map(pick)) / median(vanilla.map(pick))).toFixed(
                    2,
                )
            console.log(
                `    virtual / vanilla   mount ${ratio((row) => row.mountMs)}x   scroll ${ratio((row) => row.scrollMs)}x`,
            )
        }
    }
} finally {
    await browser.close()
    for (const server of servers) server.kill()
}
