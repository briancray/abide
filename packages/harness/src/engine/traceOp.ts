// THE CDP SIDE. Chromium only, driven from the playwright side, and an engine number
// is not available inside a case body — that is a property of the lane rather than a
// gap, and any API pretending otherwise is inviting a claim about the emulator.
//
// Playwright is imported for TYPES only, so `harness/engine` still resolves in a bun
// test process that has no browser: `shares()` is a pure function of a `Trace` and is
// gated there, where the driver below can only run under `bun run bench`.

import type { CDPSession, Page } from '@playwright/test'
import type { Trace } from './Trace.ts'

// `devtools.timeline` carries Paint and the Layout events; the `disabled-by-default`
// twin is what marks a Layout as FORCED, by hanging the JS stack that forced it off
// the event.
const TRACE_CATEGORIES = [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.stack',
]

type TraceEvent = {
    name: string
    args?: { beginData?: { stackTrace?: unknown }; data?: unknown }
}

type Metrics = Record<string, number>

async function metrics(session: CDPSession): Promise<Metrics> {
    const answer = (await session.send('Performance.getMetrics')) as {
        metrics: { name: string; value: number }[]
    }
    const out: Metrics = {}
    for (const metric of answer.metrics) out[metric.name] = metric.value
    return out
}

export async function traceOp(
    page: Page,
    op: string,
    body: () => Promise<void>,
): Promise<Trace> {
    const session = await page.context().newCDPSession(page)
    try {
        return await traced(page, session, op, body)
    } finally {
        // The session is owed back whatever happened. Left attached, every later
        // `traceOp` on this context adds another live tracing client and the failure
        // surfaces in a case that has nothing wrong with it.
        await session.detach()
    }
}

async function traced(
    page: Page,
    session: CDPSession,
    op: string,
    body: () => Promise<void>,
): Promise<Trace> {
    const events: TraceEvent[] = []
    session.on('Tracing.dataCollected', (payload: unknown) => {
        for (const event of (payload as { value: TraceEvent[] }).value)
            events.push(event)
    })
    const complete = new Promise<void>((resolve) => {
        session.once('Tracing.tracingComplete', () => resolve())
    })

    await session.send('Performance.enable')
    await page.evaluate(() => {
        performance.clearMarks()
        performance.clearMeasures()
    })
    await session.send('Tracing.start', {
        transferMode: 'ReportEvents',
        traceConfig: { includedCategories: TRACE_CATEGORIES },
    })
    // `Tracing.end` is owed even when the op throws. Left started, the NEXT `traceOp`
    // on this page fails with "Tracing is already started" and the failure names the
    // wrong op — a bad assertion in one case body would read as a broken lane in the
    // next one.
    let before: Metrics
    let after: Metrics
    try {
        before = await metrics(session)
        await body()
        after = await metrics(session)
    } finally {
        await session.send('Tracing.end')
        await complete
    }

    let paint = 0
    let forcedLayout = 0
    for (const event of events) {
        if (event.name === 'Paint') paint += 1
        // A Layout with a JS stack hanging off it is a layout somebody's read forced.
        if (event.name === 'Layout' && event.args?.beginData?.stackTrace)
            forcedLayout += 1
    }

    // The user timing comes from the page rather than from the trace: the marks are
    // exact there, and parsing them back out of `blink.user_timing` is a second
    // spelling of the same numbers that goes wrong quietly. The COUNTERS are what the
    // trace is for.
    const measures = await page.evaluate(() =>
        performance.getEntriesByType('measure').map((entry) => ({
            name: entry.name,
            startNanoseconds: Math.round(entry.startTime * 1e6),
            endNanoseconds: Math.round(
                (entry.startTime + entry.duration) * 1e6,
            ),
        })),
    )

    const since = (name: string): number =>
        ((after[name] ?? 0) - (before[name] ?? 0)) * 1e9
    return {
        op,
        measures,
        counters: {
            recalcStyle:
                (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
            layout: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
            paint,
            forcedLayout,
        },
        layers: {
            style: since('RecalcStyleDuration'),
            layout: since('LayoutDuration'),
            script: since('ScriptDuration'),
        },
    }
}
