// WHAT THE MAIN THREAD SPENT, read off chromium over CDP for the benches that price a frame by its
// `TaskDuration` — every task on the main thread, so style, layout and paint count beside the script.
// Not `harness/engine`'s `traceOp`: its tracing would load the very `TaskDuration` read here.

import type { CDPSession, Page } from '@playwright/test'

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
