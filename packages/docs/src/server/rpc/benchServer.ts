import { measure, measureFloor, NEAR_FLOOR_FACTOR } from '@abide/bench/measure'
import { createServerBenches } from '@abide/bench/serverBenches'
import { GET } from 'abide/server/GET'
import { jsonl } from 'abide/server/jsonl'

// LIVE SERVER-DISPATCH BENCH (server side).
//
// The other half of every request the frontend bench (`/platform/bench`) doesn't touch: the in-process
// per-request/per-read primitives on the hot path — route classification (`matchRoute`), cache-key
// building (`canonicalKey`), and the `memo` read/verb surface. Drives the SAME `@abide/bench/serverBenches`
// recipes the CLI runner (`packages/bench/server.ts`) does, timed with the SAME `@abide/bench/measure`
// loop, so the docs numbers and CLI numbers never drift. Streams one row at a time via `jsonl`, so the
// page fills its table live with `{#for await}`. Unlike the CLI runner this omits the end-to-end
// `createTestApp` dispatch benches — booting a real server per page-load is wrong for a live page; these
// primitives are the tight numbers the framework's per-request hot path is actually made of.
//
// A shorter-than-CLI budget keeps a page load snappy while still averaging over enough iterations.

export interface ServerBenchRow {
    group: string
    name: string
    note: string
    nsPerOp: number
    iters: number
    // The same work hand-written with no framework (`ServerBench.baseline`), timed by the same loop in
    // the same request — so `ratio` (abide ÷ vanilla) is a hardware-neutral figure.
    vanillaNsPerOp: number | null
    vanillaNote: string | null
    ratio: number | null
    // Either side is within `NEAR_FLOOR_FACTOR` of the timing loop's own per-iteration cost, which is
    // added to both — so the ratio is squashed toward 1.00× and understates the real one.
    nearFloor: boolean
}

const BUDGET = { minTimeMs: 100, minIters: 15, warmupIters: 5 }

export default GET(() => {
    async function* run(): AsyncIterable<ServerBenchRow> {
        const floor = await measureFloor(BUDGET)
        const limit = floor.nsPerOp * NEAR_FLOOR_FACTOR
        const benches = await createServerBenches()
        for (const bench of benches) {
            const metric = await measure(bench.run, BUDGET)
            const vanilla = bench.baseline ? await measure(bench.baseline.run, BUDGET) : null
            yield {
                group: bench.group,
                name: bench.name,
                note: bench.note,
                nsPerOp: metric.nsPerOp,
                iters: metric.iters,
                vanillaNsPerOp: vanilla?.nsPerOp ?? null,
                vanillaNote: bench.baseline?.note ?? null,
                ratio: vanilla ? metric.nsPerOp / vanilla.nsPerOp : null,
                nearFloor: vanilla !== null && (metric.nsPerOp < limit || vanilla.nsPerOp < limit),
            }
            await new Promise((resolve) => setTimeout(resolve, 40))
        }
    }
    return jsonl(run())
})
