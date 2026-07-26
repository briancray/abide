import { measure, measureFloor, NEAR_FLOOR_FACTOR } from '@abide/bench/measure'
import { SCENARIOS } from '@abide/bench/scenarios'
import { VANILLA_BASELINES } from '@abide/bench/vanillaBaselines'
import { GET } from 'abide/server/GET'
import { jsonl } from 'abide/server/jsonl'
import { loadEmittedServer } from 'abide/ui/internal/emit'
import { withoutRenderStream } from 'abide/ui/internal/renderState'

// LIVE FRONTEND RENDER BENCH (server side).
//
// Times the SSR `render` path for each scenario in the STANDARD corpus — the same `@abide/bench/scenarios`
// list the CLI runner (`packages/bench/run.ts`) drives, so the docs numbers and the CLI numbers never
// drift. Render is the pure string-build hot path: no DOM, genuinely abide-bound (unlike client `mount`,
// whose large-list cost in a JS-DOM is dominated by the DOM backend's O(n) insertBefore). Only the
// server-renderable scenarios are timed (`server !== false` skips the interaction-only ones). Results
// stream one scenario at a time via `jsonl`, so the page fills its table live with `{#for await}`; a
// short sleep between scenarios keeps the streaming visible. Refresh re-runs the whole corpus.
//
// Each scenario is timed TWICE — abide's `render`, then the hand-written framework-free equivalent from
// `@abide/bench/vanillaBaselines` that builds the same markup with string concatenation — so every row
// carries the baseline and the `×` multiplier. The ns figures describe whatever machine serves this page;
// the ratio is the part that doesn't.

const RENDERABLE = SCENARIOS.filter((scenario) => scenario.server !== false)

// Shorter than the CLI budget so a page load stays snappy; same adaptive loop (`@abide/bench/measure`).
const BUDGET = { minTimeMs: 120, minIters: 20, warmupIters: 5 }

// This bench runs INSIDE a page render: the docs `/platform/bench` page consumes it with a top-level
// `{#for await}`, so `benchFrontend()` executes in that request's ambient context. A scenario template's
// own `{#await}` / `{#for await}` blocks (e.g. the `await-block` scenario) call `awaitStream`, which
// reads `getContext().stream` — and by the time the bench reaches them the page's 4ms streaming deadline
// has long passed, so each measured render would DEFER its subtree into the PAGE's stream (flooding it
// with hundreds of stray patches and pegging the render). Isolate each timed render by clearing the
// ambient stream scope for its duration: the emitted render then takes its no-scope path and builds the
// pure buffered string — byte-identical, and exactly the hot path this bench means to measure. The scope
// is per-request, so this only affects the render we own; it is restored before control returns to the
// page's `{#for await}` drain. `withoutRenderStream` is the framework's name for that operation
// (ADR 0026) — this used to save/restore the internal `context.stream` field by hand.
async function renderIsolated(render: () => Promise<unknown>): Promise<void> {
    await withoutRenderStream(render)
}

export interface BenchRow {
    name: string
    nsPerOp: number
    iters: number
    rows: number | null
    nsPerRow: number | null
    // The same markup built by hand with no framework (`@abide/bench/vanillaBaselines`), timed by the
    // same loop in the same request — so `ratio` (abide ÷ vanilla) is a hardware-neutral figure.
    vanillaNsPerOp: number | null
    vanillaNote: string | null
    ratio: number | null
    // Either side is within `NEAR_FLOOR_FACTOR` of the timing loop's own per-iteration cost, which is
    // added to both — so the ratio is squashed toward 1.00× and understates the real one.
    nearFloor: boolean
}

export default GET(() => {
    async function* run(): AsyncIterable<BenchRow> {
        const floor = await measureFloor(BUDGET)
        for (const scenario of RENDERABLE) {
            const mod = await loadEmittedServer(scenario.src)
            const abide = await measure(
                () => renderIsolated(() => mod.render(scenario.scope())),
                BUDGET,
            )

            // The baseline is a plain string build — no ambient stream to isolate it from.
            const baseline = VANILLA_BASELINES[scenario.name]
            const vanillaRender = baseline?.render
            const vanilla = vanillaRender
                ? await measure(async () => {
                      await vanillaRender(scenario.scope())
                  }, BUDGET)
                : null

            const nsPerOp = abide.nsPerOp
            const rows = scenario.rows ?? null
            const limit = floor.nsPerOp * NEAR_FLOOR_FACTOR
            yield {
                name: scenario.name,
                nsPerOp,
                iters: abide.iters,
                rows,
                nsPerRow: rows ? nsPerOp / rows : null,
                vanillaNsPerOp: vanilla?.nsPerOp ?? null,
                vanillaNote: baseline?.note ?? null,
                ratio: vanilla ? nsPerOp / vanilla.nsPerOp : null,
                nearFloor: vanilla !== null && (nsPerOp < limit || vanilla.nsPerOp < limit),
            }
            await new Promise((resolve) => setTimeout(resolve, 40))
        }
    }
    return jsonl(run())
})
