import {
    durationOf,
    measuresNamed,
    shares,
    traceOp,
} from '@abide/harness/engine'
import type { Page } from '@playwright/test'

/** What one traced click reports: the op and layer durations, the layer's share, the counters. */
export type ArmSample = {
    opNanoseconds: number
    layerNanoseconds: number
    layerRuns: number
    share: number | null
    refusal: string
    recalcStyle: number
    layoutCount: number
}

/** Traces one click on the element with id `button`, to the frame after `layer` reported done. */
export async function traceArm(
    page: Page,
    button: string,
    layer: string,
): Promise<ArmSample> {
    const trace = await traceOp(page, 'click-to-paint', async () => {
        await page.evaluate(
            async ([id, layerName]) => {
                const lane = globalThis as unknown as { __FLUSH__?: () => void }
                performance.mark('op:start')
                ;(document.querySelector(`#${id}`) as HTMLElement).click()
                // THE TURN ENDS INSIDE THE OP. A reactive drain is batched to the end of one, so a
                // body that clicks and returns is measured before the reconcile has run at all —
                // and reports a page doing no work as a page doing less of it. The hand-written
                // arm has nothing to flush, which is itself part of what is being compared.
                lane.__FLUSH__?.()
                // THE LAYER'S OWN MEASURE IS THE COMPLETION SIGNAL, rather than a row's text.
                // Watching text cannot serve an arm whose rows are STATIC, and it silently waits
                // forever instead of failing. Every arm emits a measure when its work is done.
                await new Promise<void>((resolve) => {
                    const tick = (): void => {
                        if (performance.getEntriesByName(layerName).length > 0)
                            requestAnimationFrame(() => resolve())
                        else requestAnimationFrame(tick)
                    }
                    requestAnimationFrame(tick)
                })
                performance.mark('op:end')
                performance.measure('click-to-paint', 'op:start', 'op:end')
            },
            [button, layer] as [string, string],
        )
    })
    let share: number | null = null
    let refusal = ''
    try {
        share = shares(trace, {
            layer,
            of: 'click-to-paint',
            threshold: 'frame',
        }).ceilingCpu
    } catch (thrown) {
        refusal = String(thrown).split('\n')[0] ?? ''
    }
    return {
        opNanoseconds: durationOf(trace, 'click-to-paint'),
        layerNanoseconds: durationOf(trace, layer),
        layerRuns: measuresNamed(trace, layer).length,
        share,
        refusal,
        recalcStyle: trace.counters.recalcStyle,
        layoutCount: trace.counters.layout,
    }
}
