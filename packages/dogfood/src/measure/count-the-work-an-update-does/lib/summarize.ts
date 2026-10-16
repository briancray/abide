// One pass over the days per summary, counted.
const counted = { summaries: 0 }
const globals = globalThis as { __HARNESS_WORK__?: Record<string, object> }
globals.__HARNESS_WORK__ ??= {}
globals.__HARNESS_WORK__.dashboard = counted

/** Total, daily average and best day over `revenue`. */
export function summarize(revenue: number[]) {
    counted.summaries += 1
    let total = 0
    let best = 0
    for (const day of revenue) {
        total += day
        if (day > best) best = day
    }
    return { total, average: Math.round(total / revenue.length), best }
}
