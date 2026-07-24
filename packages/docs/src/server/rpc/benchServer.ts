import { measure } from '@abide/bench/measure'
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
}

export default GET(() => {
    async function* run(): AsyncIterable<ServerBenchRow> {
        const benches = await createServerBenches()
        for (const bench of benches) {
            const metric = await measure(bench.run, {
                minTimeMs: 100,
                minIters: 15,
                warmupIters: 5,
            })
            yield {
                group: bench.group,
                name: bench.name,
                note: bench.note,
                nsPerOp: metric.nsPerOp,
                iters: metric.iters,
            }
            await new Promise((resolve) => setTimeout(resolve, 40))
        }
    }
    return jsonl(run())
})
