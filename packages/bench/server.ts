// SERVER BENCH RUNNER.
//
// The frontend bench (`run.ts`) covers the UI triad (render/mount/update). This harness covers the
// OTHER half of every request: the server-dispatch + memo/RPC hot paths.
//
//   bun run bench:server            # human table
//   bun run bench:server -- --json  # machine-readable JSON
//
// Two tiers:
//   • PRIMITIVES — the shared recipes from `src/serverBenches.ts` (also streamed live by the docs
//     `/platform/bench/server` page): `matchRoute`, `canonicalKey`, and the `memo` read/verb surface,
//     called directly so the number is the primitive's own cost.
//   • END-TO-END — a real `createTestApp` driven over its loopback socket. CLI-only (booting a server is
//     wrong for a live page). Includes the TCP floor, so read `dispatch/*` RELATIVE to `dispatch/health`.
//
// Timing methodology is shared with `run.ts` via `src/measure.ts` so numbers stay comparable.

import { GET } from 'abide/server/GET'
import { createTestApp } from 'abide/test/createTestApp'
import {
    DEFAULT_MIN_ITERS,
    DEFAULT_MIN_TIME_MS,
    fmtNs,
    type MetricResult,
    measure,
} from './src/measure.ts'
import { createReactiveBenches } from './src/reactiveBenches.ts'
import { createServerBenches } from './src/serverBenches.ts'

export interface ServerBenchResult {
    group: string
    name: string
    note: string
    metric: MetricResult
}

export interface ServerBenchReport {
    time: number
    minTimeMs: number
    minIters: number
    results: ServerBenchResult[]
}

export async function runServerBench(): Promise<ServerBenchResult[]> {
    const results: ServerBenchResult[] = []
    const record = async (
        group: string,
        name: string,
        note: string,
        op: () => Promise<void> | void,
    ): Promise<void> => {
        results.push({ group, name, note, metric: await measure(op) })
    }

    // ── PRIMITIVES (shared with the docs live bench) ────────────────────────────────────────────────
    for (const bench of await createServerBenches()) {
        await record(bench.group, bench.name, bench.note, bench.run)
    }

    // ── REACTIVE / STREAM / CHANNEL PRIMITIVES (ADR 0023 baseline) ──────────────────────────────────
    for (const bench of await createReactiveBenches()) {
        await record(bench.group, bench.name, bench.note, bench.run)
    }

    // ── END-TO-END (loopback, CLI-only) ─────────────────────────────────────────────────────────────
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
    const callBench = app.rpc.bench
    const callBench10 = app10.rpc.bench
    if (callBench === undefined || callBench10 === undefined)
        throw new Error('bench route not registered on the test app')
    try {
        await record('dispatch', 'health', 'GET /__abide/health (loopback floor)', async () => {
            await app.fetch('/__abide/health')
        })
        await record('dispatch', 'rpc-read', 'warm RPC read, 0 middleware', async () => {
            await callBench({ n: 1 })
        })
        await record('dispatch', 'rpc-read-mw10', 'warm RPC read, 10 middleware', async () => {
            await callBench10({ n: 1 })
        })
    } finally {
        await app.stop()
        await app10.stop()
    }

    return results
}

function printTable(results: ServerBenchResult[]): void {
    const nameWidth = Math.max(8, ...results.map((r) => `${r.group}/${r.name}`.length))
    const head = `${'bench'.padEnd(nameWidth)}  ${'ns/op'.padStart(9)}  ${'iters'.padStart(7)}  note`
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
            `${label}  ${fmtNs(r.metric)}  ${String(r.metric.iters).padStart(7)}  ${r.note}`,
        )
    }
    console.log(
        `\nmean ns/op · dispatch/* is over a loopback socket — read it relative to the dispatch/health floor`,
    )
}

if (import.meta.main) {
    const json = process.argv.includes('--json')
    const results = await runServerBench()
    if (json) {
        const report: ServerBenchReport = {
            time: Date.now(),
            minTimeMs: DEFAULT_MIN_TIME_MS,
            minIters: DEFAULT_MIN_ITERS,
            results,
        }
        console.log(JSON.stringify(report))
    } else {
        printTable(results)
    }
}
