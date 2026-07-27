// FRONTEND BENCH RUNNER.
//
// Compiles each scenario in the standard corpus once, then measures the three hot paths every abide
// frontend build shares — `render` (SSR string), `mount` (client DOM construction), and `update` (a
// reactive state change flushed to the DOM). Reports mean ns/op per metric.
//
//   bun run bench            # human table
//   bun run bench -- --json  # machine-readable JSON (consumed by bench:delta)
//
// Every metric is measured TWICE: once through abide, once through the hand-written framework-free
// equivalent in `src/vanillaBaselines.ts` — same op, same harness, same process. The second table reports
// the baseline and the `×` multiplier (abide ÷ vanilla), which is the hardware-neutral number: absolute
// ns say what this laptop does, the ratio says what the framework costs. It also separates abide from the
// substrate — a `mount` figure is dominated by the DOM backend (happy-dom here), and only the ratio says
// how much of it is us. Before timing, each baseline's output is asserted equivalent to abide's, so a
// baseline cannot silently drift into measuring less work.
//
// Timing is adaptive: each metric runs a short warmup, then repeats until it has both spent
// ABIDE_BENCH_TIME ms and completed ABIDE_BENCH_MIN_ITERS iterations. mount/update rebuild a fresh
// host (and, for update, a fresh reactive tree) each round so state does not accumulate across ops.

import 'abide/test/happydom'
import { type EmittedModule, loadEmitted } from 'abide/ui/internal/emit'
import {
    DEFAULT_MIN_ITERS,
    DEFAULT_MIN_TIME_MS,
    DEFAULT_WARMUP_ITERS,
    fmtNs,
    type MetricResult,
    measure,
    measureFloor,
    NEAR_FLOOR_FACTOR,
} from './src/measure.ts'
import { SCENARIOS, type Scenario } from './src/scenarios.ts'
import { VANILLA_BASELINES, type VanillaBaseline } from './src/vanillaBaselines.ts'

const UPDATES_PER_ROUND = 20

type MountFn = (host: HTMLElement, scope: Record<string, unknown>) => () => void
type UpdateFn = (host: HTMLElement) => Promise<void>

export interface ScenarioResult {
    name: string
    render: MetricResult | null
    mount: MetricResult | null
    unmount: MetricResult | null
    update: MetricResult | null
    // The same op, hand-written with no framework (`src/vanillaBaselines.ts`).
    vanillaRender: MetricResult | null
    vanillaMount: MetricResult | null
    vanillaUnmount: MetricResult | null
    vanillaUpdate: MetricResult | null
    vanillaNote: string | null
}

export interface BenchReport {
    time: number
    minTimeMs: number
    minIters: number
    // Per-iteration cost of the timing loop itself — see `measureFloor`.
    harnessFloorNs: number
    scenarios: ScenarioResult[]
}

// Let the reactive scheduler's queued microtask land its DOM patches before reading the DOM.
async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

async function benchRender(mod: EmittedModule, scenario: Scenario): Promise<MetricResult | null> {
    if (scenario.server === false) return null
    return measure(async () => {
        await mod.render(scenario.scope())
    })
}

async function benchVanillaRender(
    baseline: VanillaBaseline,
    scenario: Scenario,
): Promise<MetricResult | null> {
    const render = baseline.render
    if (scenario.server === false || render === undefined) return null
    return measure(async () => {
        await render(scenario.scope())
    })
}

// `mount` and `unmount` are measured SEPARATELY, each with the other side of the pair outside the timer.
//
// They used to be one op (`mount(); cleanup()`), which meant teardown cost — disposing every effect and
// removing every node of a list — was folded into the mount figure and could not be read on its own. It
// is a real cost with its own failure modes (a disposer list that grows per item, a range removal that
// walks), and it is exactly what a change to per-item DOM bookkeeping moves. So it gets its own column.
//
// Two consequences, both deliberate:
//   • `mount` numbers are NOT comparable to runs recorded before the split — the op no longer includes
//     teardown. `unmount` has no history at all.
//   • `scenario.scope()` is now built OUTSIDE the timed region (it was inside). For a list scenario that
//     allocation is thousands of elements and has nothing to do with mounting. Both sides do this
//     identically, so the ratio stays honest.
async function benchMount(mount: MountFn, scenario: Scenario): Promise<MetricResult> {
    return measureManually((record) => {
        const host = document.createElement('div')
        const scope = scenario.scope()
        const started = Bun.nanoseconds()
        const cleanup = mount(host, scope)
        record(Bun.nanoseconds() - started)
        cleanup()
    })
}

async function benchUnmount(mount: MountFn, scenario: Scenario): Promise<MetricResult> {
    return measureManually((record) => {
        const host = document.createElement('div')
        const cleanup = mount(host, scenario.scope())
        const started = Bun.nanoseconds()
        cleanup()
        record(Bun.nanoseconds() - started)
    })
}

// The adaptive loop of `measure`, but timing only the region the op hands to `record` — so setup and
// teardown around it are excluded rather than amortised into the mean.
async function measureManually(op: (record: (ns: number) => void) => void): Promise<MetricResult> {
    let iters = 0
    let totalNs = 0
    const budgetNs = DEFAULT_MIN_TIME_MS * 1e6
    const record = (ns: number): void => {
        totalNs += ns
        iters++
    }
    for (let i = 0; i < DEFAULT_WARMUP_ITERS; i++) op(() => {})
    do {
        op(record)
    } while (totalNs < budgetNs || iters < DEFAULT_MIN_ITERS)
    return { nsPerOp: totalNs / iters, iters }
}

// Update measures reactive-patch cost only: a fresh mount is built per round (outside the timer) and
// a bounded number of updates are timed against it, so accumulated state cannot skew the mean.
async function benchUpdate(
    mount: MountFn,
    scenario: Scenario,
    update: UpdateFn,
): Promise<MetricResult> {
    let iters = 0
    let totalNs = 0
    const budgetNs = DEFAULT_MIN_TIME_MS * 1e6
    // Warmup round.
    {
        const host = document.createElement('div')
        const cleanup = mount(host, scenario.scope())
        await Promise.resolve()
        for (let i = 0; i < DEFAULT_WARMUP_ITERS; i++) await update(host)
        cleanup()
    }
    do {
        const host = document.createElement('div')
        const cleanup = mount(host, scenario.scope())
        await Promise.resolve()
        for (let i = 0; i < UPDATES_PER_ROUND; i++) {
            const t0 = Bun.nanoseconds()
            await update(host)
            totalNs += Bun.nanoseconds() - t0
            iters++
        }
        cleanup()
    } while (totalNs < budgetNs || iters < DEFAULT_MIN_ITERS)
    return { nsPerOp: totalNs / iters, iters }
}

// Abide's markup carries hydration anchors (`<!--[-->`, `<!--if-->`, the per-interpolation `<!---->`)
// that a hand-written page has no equivalent for. Strip them so the comparison is about the DOM the user
// actually sees — everything else must match byte for byte.
function normalize(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '').trim()
}

function assertSame(scenario: Scenario, metric: string, abide: string, vanilla: string): void {
    if (normalize(abide) === normalize(vanilla)) return
    throw new Error(
        `vanilla baseline for "${scenario.name}" (${metric}) does not match abide's output — the ratio would be meaningless.\n` +
            `  abide:   ${normalize(abide)}\n  vanilla: ${normalize(vanilla)}`,
    )
}

async function mountedHtml(
    mount: MountFn,
    scenario: Scenario,
    update: UpdateFn | undefined,
): Promise<string> {
    const host = document.createElement('div')
    const cleanup = mount(host, scenario.scope())
    await flush()
    if (update) await update(host)
    const html = host.innerHTML
    cleanup()
    return html
}

// A baseline is only worth timing if it does the same work. Compare the rendered string, the mounted DOM,
// and the DOM after one update; throw on any drift rather than publish a flattering ratio.
async function assertEquivalent(
    mod: EmittedModule,
    baseline: VanillaBaseline,
    scenario: Scenario,
): Promise<void> {
    if (scenario.server !== false && baseline.render) {
        assertSame(
            scenario,
            'render',
            await mod.render(scenario.scope()),
            await baseline.render(scenario.scope()),
        )
    }
    assertSame(
        scenario,
        'mount',
        await mountedHtml(mod.mount, scenario, undefined),
        await mountedHtml(baseline.mount, scenario, undefined),
    )
    if (scenario.update && baseline.update) {
        assertSame(
            scenario,
            'update',
            await mountedHtml(mod.mount, scenario, scenario.update),
            await mountedHtml(baseline.mount, scenario, baseline.update),
        )
    }
}

export async function runBench(): Promise<BenchReport> {
    const scenarios: ScenarioResult[] = []
    const floor = await measureFloor()
    for (const scenario of SCENARIOS) {
        const mod = await loadEmitted(scenario.src)
        const baseline = VANILLA_BASELINES[scenario.name]
        if (baseline === undefined)
            throw new Error(
                `scenario "${scenario.name}" has no vanilla baseline — add one to src/vanillaBaselines.ts`,
            )
        await assertEquivalent(mod, baseline, scenario)

        const render = await benchRender(mod, scenario)
        const mount = await benchMount(mod.mount, scenario)
        const unmount = await benchUnmount(mod.mount, scenario)
        const update = scenario.update
            ? await benchUpdate(mod.mount, scenario, scenario.update)
            : null
        const vanillaRender = await benchVanillaRender(baseline, scenario)
        const vanillaMount = await benchMount(baseline.mount, scenario)
        const vanillaUnmount = await benchUnmount(baseline.mount, scenario)
        const vanillaUpdate =
            scenario.update && baseline.update
                ? await benchUpdate(baseline.mount, scenario, baseline.update)
                : null
        scenarios.push({
            name: scenario.name,
            render,
            mount,
            unmount,
            update,
            vanillaRender,
            vanillaMount,
            vanillaUnmount,
            vanillaUpdate,
            vanillaNote: baseline.note,
        })
    }
    return {
        time: Date.now(),
        minTimeMs: DEFAULT_MIN_TIME_MS,
        minIters: DEFAULT_MIN_ITERS,
        harnessFloorNs: floor.nsPerOp,
        scenarios,
    }
}

// abide ÷ vanilla — how many times the same visible work costs through the framework. A metric within
// `NEAR_FLOOR_FACTOR` of the harness's own per-iteration cost is marked `†`: that constant is added to
// both sides, so the ratio is squashed toward 1.00× and understates the real one.
function ratio(abide: MetricResult | null, vanilla: MetricResult | null, floorNs: number): string {
    if (abide === null || vanilla === null || vanilla.nsPerOp === 0) return '      —'
    const limit = floorNs * NEAR_FLOOR_FACTOR
    const mark = abide.nsPerOp < limit || vanilla.nsPerOp < limit ? '†' : ' '
    return `${(abide.nsPerOp / vanilla.nsPerOp).toFixed(2)}×${mark}`.padStart(7)
}

function printTable(report: BenchReport): void {
    const nameWidth = Math.max(8, ...report.scenarios.map((s) => s.name.length))
    const head = `${'scenario'.padEnd(nameWidth)}  ${'render'.padStart(9)}  ${'mount'.padStart(9)}  ${'unmount'.padStart(9)}  ${'update'.padStart(9)}`
    console.log(head)
    console.log('-'.repeat(head.length))
    for (const s of report.scenarios) {
        console.log(
            `${s.name.padEnd(nameWidth)}  ${fmtNs(s.render)}  ${fmtNs(s.mount)}  ${fmtNs(s.unmount)}  ${fmtNs(s.update)}`,
        )
    }
    console.log(
        `\nmean ns/op · warmup ${DEFAULT_WARMUP_ITERS} · ≥${report.minTimeMs}ms/≥${report.minIters} iters per metric`,
    )
}

function printBaseline(report: BenchReport): void {
    const floorNs = report.harnessFloorNs
    const nameWidth = Math.max(8, ...report.scenarios.map((s) => s.name.length))
    const head =
        `${'scenario'.padEnd(nameWidth)}  ${'render'.padStart(9)}  ${'×'.padStart(7)}  ` +
        `${'mount'.padStart(9)}  ${'×'.padStart(7)}  ${'unmount'.padStart(9)}  ${'×'.padStart(7)}  ` +
        `${'update'.padStart(9)}  ${'×'.padStart(7)}  hand-written as`
    console.log('\n\nvanilla JS baseline — the same op with no framework (× = abide ÷ vanilla)\n')
    console.log(head)
    console.log('-'.repeat(head.length))
    for (const s of report.scenarios) {
        console.log(
            `${s.name.padEnd(nameWidth)}  ${fmtNs(s.vanillaRender)}  ${ratio(s.render, s.vanillaRender, floorNs)}  ` +
                `${fmtNs(s.vanillaMount)}  ${ratio(s.mount, s.vanillaMount, floorNs)}  ` +
                `${fmtNs(s.vanillaUnmount)}  ${ratio(s.unmount, s.vanillaUnmount, floorNs)}  ` +
                `${fmtNs(s.vanillaUpdate)}  ${ratio(s.update, s.vanillaUpdate, floorNs)}  ${s.vanillaNote ?? ''}`,
        )
    }
    console.log(
        '\nthe × column is the hardware-neutral figure: absolute ns describe this machine, the ratio describes the framework',
    )
    console.log(
        `† within ${NEAR_FLOOR_FACTOR}× of the ${floorNs.toFixed(0)} ns harness floor (an empty op through the same loop) — ` +
            'that constant is added to both sides, so the ratio understates the real one',
    )
}

if (import.meta.main) {
    const json = process.argv.includes('--json')
    const report = await runBench()
    if (json) {
        console.log(JSON.stringify(report))
    } else {
        printTable(report)
        printBaseline(report)
    }
}
