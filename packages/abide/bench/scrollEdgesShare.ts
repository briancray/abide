// WHAT `scrollEdges` COSTS ON A LIST OF N ROWS, against the hand-written arm: a passive scroll
// listener, a `MutationObserver` over the subtree, a `ResizeObserver` on the scroller alone and one
// read of `scrollTop` / `scrollHeight` / `clientHeight` a frame.
//
// A resize observation PER ROW (an earlier 32.104) was priced here and dropped: on 1000 rows, quiet
// machine, it was 3.2x the vanilla arm per idle frame (0.282 against 0.089 ms), 1.85x per scrolled
// frame and +1.2 ms a remount — the browser walks every observed target every frame whether or not
// anything changed. What it bought, a row growing with no mutation (a transition, a font), is not
// worth a cost paid by every idle frame. The mutation-watching arm that replaced it reads level with
// vanilla (0.98-1.03 on every op).
//
// CHROMIUM OVER CDP, priced by `TaskDuration` — every task on the main thread, so the rendering
// step's resize-observation walk counts beside the script. Four ops on one list of N rows: a remount
// (unmount then mount, ten times), idle frames, scrolled frames, and a row appended per frame. Each
// is summed over many frames and divided, so no sample is near the clock's resolution. Counted
// beside: how many elements each arm hands a `ResizeObserver`.
//
// `bun run bench:edges` — N = 100 and 1000, three runs each; `bun run bench:edges 5000` for others.

import type { Page } from '@playwright/test'

import { BARE_LAYOUT } from './BARE_LAYOUT.ts'
import { eachRun, inChromium, settle } from './mainThread.ts'
import { median, spread } from './median.ts'

const SIZES =
    process.argv.length > 2 ? process.argv.slice(2).map(Number) : [100, 1000]
const RUNS = 3
const FRAMES = 60
const REMOUNTS = 10

const VANILLA = `function vanilla(element: HTMLElement) {
    let frame = 0
    let last = ''
    const read = () => {
        frame = 0
        const top = element.scrollTop
        const below = element.scrollHeight - element.clientHeight - top
        const tokens = top >= 1 ? (below >= 1 ? 'top bottom' : 'top') : below >= 1 ? 'bottom' : ''
        if (tokens === last) return
        last = tokens
        if (tokens === '') element.removeAttribute('data-scrollable')
        else element.setAttribute('data-scrollable', tokens)
    }
    const owe = () => {
        if (frame === 0) frame = requestAnimationFrame(read)
    }
    element.addEventListener('scroll', owe, { passive: true })
    const mutations = new MutationObserver(owe)
    mutations.observe(element, { childList: true, subtree: true, characterData: true })
    const resizes = new ResizeObserver(owe)
    resizes.observe(element)
    owe()
    return () => {
        element.removeEventListener('scroll', owe)
        mutations.disconnect()
        resizes.disconnect()
        cancelAnimationFrame(frame)
    }
}`

const page = (count: number, arm: 'abide' | 'vanilla'): string => `<script>
import { reactive, scrollEdges } from '@abide/abide'

let shown = reactive(true)
let rows = reactive(Array.from({ length: ${count} }, (_, index) => index))
${VANILLA}
globalThis.__TOGGLE__ = () => { shown = !shown }
globalThis.__ADD__ = () => { rows = [...rows, rows.length] }
</script>

{#if shown}<ol id="list" ${arm === 'abide' ? '{...scrollEdges()}' : 'bind:element={vanilla}'}>{#for row of rows key row}<li>{row}</li>{/for}</ol>{/if}

<style>
#list { height: 300px; overflow-y: auto; margin: 0; }
#list li { height: 20px; }
</style>`

// Installed before the page loads: how many elements are handed a `ResizeObserver`.
const WRAP = (): void => {
    const counts = { observed: 0 }
    ;(globalThis as { __RESIZES__?: typeof counts }).__RESIZES__ = counts
    const observe = ResizeObserver.prototype.observe
    ResizeObserver.prototype.observe = function (target, options) {
        counts.observed += 1
        observe.call(this, target, options)
    }
}

type Op = 'remount' | 'idle' | 'scroll' | 'append'
const OPS: Op[] = ['remount', 'idle', 'scroll', 'append']

/** Runs `op` in the page; resolves two quiet frames after its last step. */
function run(tab: Page, op: Op): Promise<void> {
    return tab.evaluate(
        ({ op, frames, remounts }) =>
            new Promise<void>((resolve) => {
                const state = globalThis as {
                    __TOGGLE__?: () => void
                    __ADD__?: () => void
                }
                const list = (): HTMLElement =>
                    document.getElementById('list') as HTMLElement
                let left = op === 'remount' ? remounts * 2 : frames
                const step = (): void => {
                    if (left === 0) {
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolve()),
                        )
                        return
                    }
                    left -= 1
                    if (op === 'remount') state.__TOGGLE__?.()
                    else if (op === 'scroll') list().scrollTop += 4
                    else if (op === 'append') state.__ADD__?.()
                    requestAnimationFrame(() => requestAnimationFrame(step))
                }
                requestAnimationFrame(step)
            }),
        { op, frames: FRAMES, remounts: REMOUNTS },
    )
}

await inChromium(async (browser, serve) => {
    for (const count of SIZES) {
        const results = new Map<string, number[]>()
        const observed = new Map<string, number>()
        for (const arm of ['abide', 'vanilla'] as const) {
            const base = await serve(`bench-edges-${arm}-${count}`, {
                'layout.abide': BARE_LAYOUT,
                'index.abide': page(count, arm),
            })
            await eachRun(
                browser,
                base,
                {
                    runs: RUNS,
                    viewport: { width: 800, height: 600 },
                    init: WRAP,
                    ready: (tab) =>
                        tab.waitForSelector('#list[data-scrollable]'),
                },
                async (tab, taskDuration) => {
                    observed.set(
                        arm,
                        await tab.evaluate(
                            () =>
                                (
                                    globalThis as {
                                        __RESIZES__?: { observed: number }
                                    }
                                ).__RESIZES__?.observed ?? 0,
                        ),
                    )
                    for (const op of OPS) {
                        const before = await taskDuration()
                        await run(tab, op)
                        const after = await taskDuration()
                        // Per frame stepped, or per remount (an unmount and a mount).
                        const per = op === 'remount' ? REMOUNTS : FRAMES
                        const key = `${arm} ${op}`
                        const values = results.get(key) ?? []
                        values.push(((after - before) * 1000) / per)
                        results.set(key, values)
                        await settle(tab)
                    }
                },
            )
        }
        const ms = (value: number): string => value.toFixed(3)
        console.log(`\n  N = ${count}`)
        console.log(
            `    elements handed a ResizeObserver at mount   abide ${observed.get('abide')}   vanilla ${observed.get('vanilla')}`,
        )
        for (const op of OPS) {
            const abide = results.get(`abide ${op}`) ?? []
            const vanilla = results.get(`vanilla ${op}`) ?? []
            console.log(
                `    ${op.padEnd(8)} abide ${ms(median(abide))} ms (${spread(abide, ms)})   vanilla ${ms(median(vanilla))} ms (${spread(vanilla, ms)})   ratio ${(median(abide) / median(vanilla)).toFixed(2)}`,
            )
        }
    }
})
