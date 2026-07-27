// SERVER BENCH RUNNER.
//
// The frontend bench (`run.ts`) covers the UI triad (render/mount/update). This harness covers the
// OTHER half of every request: the server-dispatch + memo/RPC hot paths.
//
//   bun run bench:server                  # human table, every bench
//   bun run bench:server -- --json        # machine-readable JSON
//   bun run bench:server -- --list        # print the `group/name` labels, run nothing
//   bun run bench:server -- memo          # run only the benches matching these patterns…
//   bun run bench:server -- stream/* route  # …substring, or glob when a `*` is present
//
// A filter selects by the printed `group/name` label, so a bare group name (`memo`, `probe`) takes the
// whole tier. Selecting away every `dispatch/*` bench also skips BOOTING the two loopback test apps —
// the slow part of this harness — so an iteration loop on a primitive costs a fraction of a full run.
//
// Two tiers:
//   • PRIMITIVES — the shared recipes from `src/serverBenches.ts` (also streamed live by the docs
//     `/platform/bench/server` page): `matchRoute`, `canonicalKey`, and the `memo` read/verb surface,
//     called directly so the number is the primitive's own cost.
//   • END-TO-END — a real `createTestApp` driven over its loopback socket. CLI-only (booting a server is
//     wrong for a live page). Includes the TCP floor, so read `dispatch/*` RELATIVE to `dispatch/health`.
//
// Every primitive recipe that has a meaningful framework-free equivalent is timed TWICE — once through
// abide, once through the hand-written baseline on the recipe (`ServerBench.baseline`) — so the table
// carries a `vanilla` column and the `×` multiplier (abide ÷ vanilla). Absolute ns describe this machine;
// the ratio describes the framework. The loopback `dispatch/*` benches have no baseline (their floor is
// the TCP round trip, which `dispatch/health` already measures).
//
// Timing methodology is shared with `run.ts` via `src/measure.ts` so numbers stay comparable.

import { GET } from 'abide/server/GET'
import { createTestApp, type TestApp } from 'abide/test/createTestApp'
import { type BenchSelection, benchSelection } from './src/benchSelection.ts'
import {
    DEFAULT_MIN_ITERS,
    DEFAULT_MIN_TIME_MS,
    fmtNs,
    type MetricResult,
    measure,
    measureFloor,
    NEAR_FLOOR_FACTOR,
} from './src/measure.ts'
import { createReactiveBenches } from './src/reactiveBenches.ts'
import { selectBenches } from './src/selectBenches.ts'
import { createServerBenches } from './src/serverBenches.ts'

export interface ServerBenchResult {
    group: string
    name: string
    note: string
    metric: MetricResult
    // The same work hand-written with no framework, timed by the same loop (see `ServerBench.baseline`).
    // `null` where no framework-free equivalent is meaningful, or where the recipe is already vanilla.
    vanilla: MetricResult | null
    vanillaNote: string | null
}

export interface ServerBenchReport {
    time: number
    minTimeMs: number
    minIters: number
    // Per-iteration cost of the timing loop itself — see `measureFloor`.
    harnessFloorNs: number
    // Benches in the whole corpus, so a filtered report says so rather than reading as a shrunken one.
    corpusSize: number
    results: ServerBenchResult[]
}

type BenchCall = (args: { n: number }) => Promise<unknown>

// Everything a loopback bench needs, resolved once at boot — nothing here is looked up inside the timed
// op, which measures the round trip and nothing else.
interface DispatchContext {
    app: TestApp
    call: BenchCall
    call10: BenchCall
}

// The loopback tier, declared before anything boots so its labels can be listed and filtered alongside
// the primitives — only a selection that keeps one of these pays to start the two servers.
interface DispatchBench {
    name: string
    note: string
    run: (ctx: DispatchContext) => Promise<void>
}

const DISPATCH_BENCHES: DispatchBench[] = [
    {
        name: 'health',
        note: 'GET /__abide/health (loopback floor)',
        run: async (ctx) => {
            await ctx.app.fetch('/__abide/health')
        },
    },
    {
        name: 'rpc-read',
        note: 'warm RPC read, 0 middleware',
        run: async (ctx) => {
            await ctx.call({ n: 1 })
        },
    },
    {
        name: 'rpc-read-mw10',
        note: 'warm RPC read, 10 middleware',
        run: async (ctx) => {
            await ctx.call10({ n: 1 })
        },
    },
]

function benchCall(app: TestApp): BenchCall {
    const call = app.rpc.bench as BenchCall | undefined
    if (call === undefined) throw new Error('bench route not registered on the test app')
    return call
}

export async function runServerBench(
    selection: BenchSelection = benchSelection([]),
): Promise<ServerBenchReport> {
    const primitives = [...(await createServerBenches()), ...(await createReactiveBenches())]
    const labels = [
        ...primitives.map((bench) => `${bench.group}/${bench.name}`),
        ...DISPATCH_BENCHES.map((bench) => `dispatch/${bench.name}`),
    ]
    const selected = selectBenches(labels, selection, 'benches')

    const results: ServerBenchResult[] = []
    const floor = await measureFloor()

    // Each recipe is timed twice — once through abide, once through its hand-written baseline (where one
    // exists), back to back in the same process so the ratio is hardware-neutral.
    for (const bench of primitives) {
        if (!selected.has(`${bench.group}/${bench.name}`)) continue
        results.push({
            group: bench.group,
            name: bench.name,
            note: bench.note,
            metric: await measure(bench.run),
            vanilla: bench.baseline ? await measure(bench.baseline.run) : null,
            vanillaNote: bench.baseline?.note ?? null,
        })
    }

    // ── END-TO-END (loopback, CLI-only) ─────────────────────────────────────────────────────────────
    // Booting two servers is the slow part of this harness, so a selection that keeps no `dispatch/*`
    // bench skips it entirely rather than starting and stopping them for nothing.
    const dispatch = DISPATCH_BENCHES.filter((bench) => selected.has(`dispatch/${bench.name}`))
    if (dispatch.length > 0) {
        const app = await createTestApp({
            routes: { bench: GET(({ n = 0 }: { n?: number }) => ({ n, ok: true })) },
        })
        const app10 = await createTestApp({
            routes: { bench: GET(({ n = 0 }: { n?: number }) => ({ n, ok: true })) },
            middleware: Array.from(
                { length: 10 },
                () => (next: () => Response | Promise<Response>) => next(),
            ),
        })
        try {
            const ctx: DispatchContext = { app, call: benchCall(app), call10: benchCall(app10) }
            for (const bench of dispatch) {
                results.push({
                    group: 'dispatch',
                    name: bench.name,
                    note: bench.note,
                    metric: await measure(() => bench.run(ctx)),
                    vanilla: null,
                    vanillaNote: null,
                })
            }
        } finally {
            await app.stop()
            await app10.stop()
        }
    }

    return {
        time: Date.now(),
        minTimeMs: DEFAULT_MIN_TIME_MS,
        minIters: DEFAULT_MIN_ITERS,
        harnessFloorNs: floor.nsPerOp,
        corpusSize: labels.length,
        results,
    }
}

// A bench within `NEAR_FLOOR_FACTOR` of the harness's own per-iteration cost is floor-bound: the constant
// is added to both sides, so the printed ratio is squashed toward 1.00× and understates the real one.
export function nearFloor(result: ServerBenchResult, floorNs: number): boolean {
    if (result.vanilla === null) return false
    const limit = floorNs * NEAR_FLOOR_FACTOR
    return result.metric.nsPerOp < limit || result.vanilla.nsPerOp < limit
}

// abide ÷ vanilla — how many times the same work costs through the framework.
function ratio(result: ServerBenchResult, floorNs: number): string {
    if (result.vanilla === null || result.vanilla.nsPerOp === 0) return '      —'
    const mark = nearFloor(result, floorNs) ? '†' : ' '
    return `${(result.metric.nsPerOp / result.vanilla.nsPerOp).toFixed(2)}×${mark}`.padStart(7)
}

function printTable(report: ServerBenchReport): void {
    const results = report.results
    const nameWidth = Math.max(8, ...results.map((r) => `${r.group}/${r.name}`.length))
    const head =
        `${'bench'.padEnd(nameWidth)}  ${'ns/op'.padStart(9)}  ${'vanilla'.padStart(9)}  ` +
        `${'×'.padStart(7)}  ${'iters'.padStart(7)}  note`
    console.log(head)
    console.log('-'.repeat(head.length))
    let group = ''
    for (const r of results) {
        if (r.group !== group) {
            group = r.group
            console.log('')
        }
        const label = `${r.group}/${r.name}`.padEnd(nameWidth)
        console.log(
            `${label}  ${fmtNs(r.metric)}  ${fmtNs(r.vanilla)}  ${ratio(r, report.harnessFloorNs)}  ` +
                `${String(r.metric.iters).padStart(7)}  ${r.note}`,
        )
    }
    console.log(
        `\nmean ns/op · dispatch/* is over a loopback socket — read it relative to the dispatch/health floor`,
    )
    console.log(
        'vanilla = the same work hand-written with no framework; × = abide ÷ vanilla (the hardware-neutral figure)',
    )
    console.log(
        `† within ${NEAR_FLOOR_FACTOR}× of the ${report.harnessFloorNs.toFixed(0)} ns harness floor (an empty op through the same loop) — ` +
            'that constant is added to both sides, so the ratio is squashed toward 1.00× and understates the real one',
    )
    if (results.length !== report.corpusSize) {
        console.log(
            `filtered: ${results.length} of ${report.corpusSize} benches — re-run without a filter before trusting a verdict`,
        )
    }
    const noted = results.filter((r) => r.vanillaNote !== null)
    if (noted.length > 0) {
        console.log('\nhand-written as:')
        for (const r of noted) {
            console.log(`  ${`${r.group}/${r.name}`.padEnd(nameWidth)}  ${r.vanillaNote}`)
        }
    }
}

if (import.meta.main) {
    const json = process.argv.includes('--json')
    const report = await runServerBench(benchSelection(process.argv.slice(2), { positional: true }))
    if (json) {
        console.log(JSON.stringify(report))
    } else {
        printTable(report)
    }
}
