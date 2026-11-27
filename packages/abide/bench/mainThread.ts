// WHAT THE MAIN THREAD SPENT, read off chromium over CDP for the benches that price a frame by its
// `TaskDuration` — every task on the main thread, so style, layout and paint count beside the script.
// Not `harness/engine`'s `traceOp`: its tracing would load the very `TaskDuration` read here.

import {
    type Browser,
    type BrowserContext,
    type CDPSession,
    chromium,
    type Page,
} from '@playwright/test'

import { servedFixture } from '../e2e/servedFixture.ts'

/** Lets the page settle: past a 200 ms timer, then to the next frame. */
export function settle(tab: Page): Promise<unknown> {
    return tab.evaluate(
        () =>
            new Promise((resolve) =>
                setTimeout(() => requestAnimationFrame(resolve), 200),
            ),
    )
}

/** A reader of the main thread's `TaskDuration` so far, in seconds, over `session`. */
export async function taskDurationOf(
    session: CDPSession,
): Promise<() => Promise<number>> {
    await session.send('Performance.enable')
    return async () => {
        const answer = (await session.send('Performance.getMetrics')) as {
            metrics: { name: string; value: number }[]
        }
        return (
            answer.metrics.find((metric) => metric.name === 'TaskDuration')
                ?.value ?? 0
        )
    }
}

/**
 * Scrolls `pixels` a frame for `frames` frames, then waits two quiet frames for the settle: the
 * element of id `element` where one is named, the window where none is.
 */
export function scrollFrames(
    tab: Page,
    frames: number,
    pixels: number,
    element?: string,
): Promise<void> {
    return tab.evaluate(
        ({ frames, pixels, element }) =>
            new Promise<void>((resolve) => {
                const scroller =
                    element === undefined
                        ? undefined
                        : (document.getElementById(element) as HTMLElement)
                let left = frames
                const step = (): void => {
                    if (left === 0) {
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolve()),
                        )
                        return
                    }
                    left -= 1
                    if (scroller === undefined) scrollBy(0, pixels)
                    else scroller.scrollTop += pixels
                    requestAnimationFrame(step)
                }
                requestAnimationFrame(step)
            }),
        { frames, pixels, element },
    )
}

/**
 * Runs `body` with a chromium and a `serve` that serves a fixture's files and answers its origin —
 * the browser closed and every server killed once `body` settles, however it does.
 */
export async function inChromium(
    body: (
        browser: Browser,
        serve: (name: string, files: Record<string, string>) => Promise<string>,
    ) => Promise<void>,
): Promise<void> {
    const browser = await chromium.launch()
    const servers: { kill: () => void }[] = []
    try {
        await body(browser, async (name, files) => {
            const { base, server } = await servedFixture(name, files)
            servers.push(server)
            return base
        })
    } finally {
        await browser.close()
        for (const server of servers) server.kill()
    }
}

/**
 * `runs` fresh tabs on `base`, each loaded, made `ready`, settled and read over CDP, and what `op`
 * measured in each: a context per run, so no run inherits another's JavaScript or layout.
 */
export async function eachRun<Row>(
    browser: Browser,
    base: string,
    options: {
        runs: number
        viewport: { width: number; height: number }
        /** A script every document of the run is opened with, ahead of the page's own. */
        init?: Parameters<BrowserContext['addInitScript']>[0] | undefined
        /** What the page is waited on for before it settles. */
        ready?: ((tab: Page) => Promise<unknown>) | undefined
    },
    op: (tab: Page, taskDuration: () => Promise<number>) => Promise<Row>,
): Promise<Row[]> {
    const rows: Row[] = []
    for (let run = 0; run < options.runs; run += 1) {
        const context = await browser.newContext({ viewport: options.viewport })
        if (options.init !== undefined)
            await context.addInitScript(options.init)
        const tab = await context.newPage()
        await tab.goto(`${base}/`, { waitUntil: 'load' })
        await options.ready?.(tab)
        await settle(tab)
        const session = await context.newCDPSession(tab)
        rows.push(await op(tab, await taskDurationOf(session)))
        await session.detach()
        await context.close()
    }
    return rows
}
