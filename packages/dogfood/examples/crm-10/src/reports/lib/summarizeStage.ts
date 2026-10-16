// One pass over the deals per summary, counted where a test can read it.
const counted = { summaries: 0 }
const globals = globalThis as { __HARNESS_WORK__?: Record<string, object> }
globals.__HARNESS_WORK__ ??= {}
globals.__HARNESS_WORK__.reports = counted

const DEALS = [
    { stage: 'qualified', amount: 4400 },
    { stage: 'qualified', amount: 2600 },
    { stage: 'proposal', amount: 8000 },
    { stage: 'proposal', amount: 5200 },
    { stage: 'proposal', amount: 1900 },
]

/** How many deals sit in `stage`, their value, and the largest. */
export function summarizeStage(stage: string) {
    counted.summaries += 1
    let deals = 0
    let value = 0
    let largest = 0
    for (const deal of DEALS) {
        if (deal.stage !== stage) continue
        deals += 1
        value += deal.amount
        if (deal.amount > largest) largest = deal.amount
    }
    return { deals, value, largest }
}
