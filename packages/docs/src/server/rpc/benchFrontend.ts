import { SCENARIOS } from '@abide/bench/scenarios'
import { GET } from 'abide/server/GET'
import { jsonl } from 'abide/server/jsonl'
import { getContext } from 'abide/shared/internal/context'
import { loadEmittedServer } from 'abide/ui/internal/emit'

// LIVE FRONTEND RENDER BENCH (server side).
//
// Times the SSR `render` path for each scenario in the STANDARD corpus — the same `@abide/bench/scenarios`
// list the CLI runner (`packages/bench/run.ts`) drives, so the docs numbers and the CLI numbers never
// drift. Render is the pure string-build hot path: no DOM, genuinely abide-bound (unlike client `mount`,
// whose large-list cost in a JS-DOM is dominated by the DOM backend's O(n) insertBefore). Only the
// server-renderable scenarios are timed (`server !== false` skips the interaction-only ones). Results
// stream one scenario at a time via `jsonl`, so the page fills its table live with `{#for await}`; a
// short sleep between scenarios keeps the streaming visible. Refresh re-runs the whole corpus.

const RENDERABLE = SCENARIOS.filter((scenario) => scenario.server !== false)

const MIN_TIME_MS = 120
const MIN_ITERS = 20
const WARMUP = 5

// This bench runs INSIDE a page render: the docs `/platform/bench` page consumes it with a top-level
// `{#for await}`, so `benchFrontend()` executes in that request's ambient context. A scenario template's
// own `{#await}` / `{#for await}` blocks (e.g. the `await-block` scenario) call `awaitStream`, which
// reads `getContext().stream` — and by the time the bench reaches them the page's 4ms streaming deadline
// has long passed, so each measured render would DEFER its subtree into the PAGE's stream (flooding it
// with hundreds of stray patches and pegging the render). Isolate each timed render by clearing the
// ambient stream scope for its duration: the emitted render then takes its no-scope path and builds the
// pure buffered string — byte-identical, and exactly the hot path this bench means to measure. The scope
// is per-request, so this only affects the render we own; it is restored before control returns to the
// page's `{#for await}` drain.
async function renderIsolated(render: () => Promise<unknown>): Promise<void> {
    const context = getContext()
    const savedStream = context.stream
    context.stream = undefined
    try {
        await render()
    } finally {
        context.stream = savedStream
    }
}

export interface BenchRow {
    name: string
    nsPerOp: number
    iters: number
    rows: number | null
    nsPerRow: number | null
}

export default GET(() => {
    async function* run(): AsyncIterable<BenchRow> {
        for (const scenario of RENDERABLE) {
            const mod = await loadEmittedServer(scenario.src)
            const render = () => mod.render(scenario.scope())

            for (let i = 0; i < WARMUP; i++) await renderIsolated(render)

            let iters = 0
            const start = Bun.nanoseconds()
            let elapsed = 0
            const budgetNs = MIN_TIME_MS * 1e6
            do {
                await renderIsolated(render)
                iters++
                elapsed = Bun.nanoseconds() - start
            } while (elapsed < budgetNs || iters < MIN_ITERS)

            const nsPerOp = elapsed / iters
            const rows = scenario.rows ?? null
            yield {
                name: scenario.name,
                nsPerOp,
                iters,
                rows,
                nsPerRow: rows ? nsPerOp / rows : null,
            }
            await new Promise((resolve) => setTimeout(resolve, 40))
        }
    }
    return jsonl(run())
})
