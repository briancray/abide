// FRONTEND BENCH RUNNER.
//
// Compiles each scenario in the standard corpus once, then measures the three hot paths every abide
// frontend build shares — `render` (SSR string), `mount` (client DOM construction), and `update` (a
// reactive state change flushed to the DOM). Reports mean ns/op per metric.
//
//   bun run bench            # human table
//   bun run bench -- --json  # machine-readable JSON (consumed by bench:delta)
//
// Timing is adaptive: each metric runs a short warmup, then repeats until it has both spent
// ABIDE_BENCH_TIME ms and completed ABIDE_BENCH_MIN_ITERS iterations. mount/update rebuild a fresh
// host (and, for update, a fresh reactive tree) each round so state does not accumulate across ops.

import '../src/lib/test/happydom.ts'
import { type EmittedModule, loadEmitted } from '../src/lib/ui/internal/emit.ts'
import { SCENARIOS, type Scenario } from './SCENARIOS.ts'

const MIN_TIME_MS = Number(process.env.ABIDE_BENCH_TIME ?? 400)
const MIN_ITERS = Number(process.env.ABIDE_BENCH_MIN_ITERS ?? 25)
const WARMUP_ITERS = 5
const UPDATES_PER_ROUND = 20

export interface MetricResult {
    nsPerOp: number
    iters: number
}

export interface ScenarioResult {
    name: string
    render: MetricResult | null
    mount: MetricResult | null
    update: MetricResult | null
}

export interface BenchReport {
    time: number
    minTimeMs: number
    minIters: number
    scenarios: ScenarioResult[]
}

// Repeatedly invoke `op` until the time and iteration floors are both met; return mean ns/op.
async function measure(op: () => Promise<void> | void): Promise<MetricResult> {
    for (let i = 0; i < WARMUP_ITERS; i++) await op()
    let iters = 0
    const start = Bun.nanoseconds()
    let elapsed = 0
    const budgetNs = MIN_TIME_MS * 1e6
    do {
        await op()
        iters++
        elapsed = Bun.nanoseconds() - start
    } while (elapsed < budgetNs || iters < MIN_ITERS)
    return { nsPerOp: elapsed / iters, iters }
}

async function benchRender(mod: EmittedModule, scenario: Scenario): Promise<MetricResult | null> {
    if (scenario.server === false) return null
    return measure(async () => {
        await mod.render(scenario.scope())
    })
}

async function benchMount(mod: EmittedModule, scenario: Scenario): Promise<MetricResult> {
    return measure(() => {
        const host = document.createElement('div')
        const cleanup = mod.mount(host, scenario.scope())
        cleanup()
    })
}

// Update measures reactive-patch cost only: a fresh mount is built per round (outside the timer) and
// a bounded number of updates are timed against it, so accumulated state cannot skew the mean.
async function benchUpdate(mod: EmittedModule, scenario: Scenario): Promise<MetricResult> {
    const update = scenario.update
    if (update === undefined)
        throw new Error(`benchUpdate called for scenario without an update fn: ${scenario.name}`)
    let iters = 0
    let totalNs = 0
    const budgetNs = MIN_TIME_MS * 1e6
    // Warmup round.
    {
        const host = document.createElement('div')
        const cleanup = mod.mount(host, scenario.scope())
        await Promise.resolve()
        for (let i = 0; i < WARMUP_ITERS; i++) await update(host)
        cleanup()
    }
    do {
        const host = document.createElement('div')
        const cleanup = mod.mount(host, scenario.scope())
        await Promise.resolve()
        for (let i = 0; i < UPDATES_PER_ROUND; i++) {
            const t0 = Bun.nanoseconds()
            await update(host)
            totalNs += Bun.nanoseconds() - t0
            iters++
        }
        cleanup()
    } while (totalNs < budgetNs || iters < MIN_ITERS)
    return { nsPerOp: totalNs / iters, iters }
}

export async function runBench(): Promise<BenchReport> {
    const scenarios: ScenarioResult[] = []
    for (const scenario of SCENARIOS) {
        const mod = await loadEmitted(scenario.src)
        const render = await benchRender(mod, scenario)
        const mount = await benchMount(mod, scenario)
        const update = scenario.update ? await benchUpdate(mod, scenario) : null
        scenarios.push({ name: scenario.name, render, mount, update })
    }
    return { time: Date.now(), minTimeMs: MIN_TIME_MS, minIters: MIN_ITERS, scenarios }
}

function fmtNs(metric: MetricResult | null): string {
    if (metric === null) return '        —'
    const ns = metric.nsPerOp
    if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`.padStart(9)
    if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`.padStart(9)
    return `${ns.toFixed(0)} ns`.padStart(9)
}

function printTable(report: BenchReport): void {
    const nameWidth = Math.max(8, ...report.scenarios.map((s) => s.name.length))
    const head = `${'scenario'.padEnd(nameWidth)}  ${'render'.padStart(9)}  ${'mount'.padStart(9)}  ${'update'.padStart(9)}`
    console.log(head)
    console.log('-'.repeat(head.length))
    for (const s of report.scenarios) {
        console.log(
            `${s.name.padEnd(nameWidth)}  ${fmtNs(s.render)}  ${fmtNs(s.mount)}  ${fmtNs(s.update)}`,
        )
    }
    console.log(
        `\nmean ns/op · warmup ${WARMUP_ITERS} · ≥${report.minTimeMs}ms/≥${report.minIters} iters per metric`,
    )
}

if (import.meta.main) {
    const json = process.argv.includes('--json')
    const report = await runBench()
    if (json) {
        console.log(JSON.stringify(report))
    } else {
        printTable(report)
    }
}
