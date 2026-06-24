import { effect } from '../src/lib/ui/effect.ts'
import { batch } from '../src/lib/ui/runtime/batch.ts'
import { state } from '../src/lib/ui/state.ts'
import { emitMetric } from './emitMetric.ts'

/*
Write-coalescing benchmark. Run directly:

  bun packages/abide/bench/coalesce.bench.ts

Models the case the `on`-handler batch targets: a "form" of F reactive fields with
one aggregate reader (a `valid`/summary effect reading every field), and a handler
that writes all F fields at once, invoked H times. The aggregate reader is the cost
that scales — it re-runs once per flush.

  - eager   — write each field at batchDepth 0 (the pre-change default): one flush
              per write, so the aggregate reader runs F times per handler.
  - batched — wrap the handler's writes in `batch()` (what `on` now does): one flush
              per handler, so the aggregate reader runs once.

The recompute COUNT is deterministic and machine-independent (eager = H·F, batched
= H), so it is the honest headline; wall time confirms the work actually drops.
*/

type Workload = { aggregateRuns: number; ms: number }

/* F fields, one effect reading all of them, the handler runs H times. `wrap` decides
   whether the handler's F writes coalesce. Returns how many times the aggregate
   reader re-ran plus the wall time. */
function run(fields: number, handlers: number, wrap: (write: () => void) => void): Workload {
    const cells = Array.from({ length: fields }, () => state(0))
    let aggregateRuns = 0
    /* The aggregate reader: subscribes to every field, re-runs on each flush. */
    effect(() => {
        for (const cell of cells) {
            cell.value
        }
        aggregateRuns += 1
    })
    const start = performance.now()
    for (let handler = 0; handler < handlers; handler += 1) {
        wrap(() => {
            for (const cell of cells) {
                cell.value = handler
            }
        })
    }
    return { aggregateRuns, ms: performance.now() - start }
}

const eager = (write: () => void): void => write()
const batched = (write: () => void): void => batch(write)

function report(label: string, fields: number, handlers: number, result: Workload): void {
    const perHandlerUs = ((result.ms / handlers) * 1000).toFixed(2)
    console.log(
        `${label.padEnd(10)} fields=${fields} handlers=${handlers}` +
            `   aggregate-runs=${String(result.aggregateRuns).padStart(7)}` +
            `   ${result.ms.toFixed(1).padStart(7)}ms   ${perHandlerUs.padStart(7)}µs/handler`,
    )
}

const FIELDS = 8
const HANDLERS = 50_000

/* Warm the JITs before measuring. */
run(FIELDS, 5_000, eager)
run(FIELDS, 5_000, batched)

console.log(`\nForm handler writing ${FIELDS} fields, ${HANDLERS} invocations:\n`)
const eagerResult = run(FIELDS, HANDLERS, eager)
const batchedResult = run(FIELDS, HANDLERS, batched)
report('eager', FIELDS, HANDLERS, eagerResult)
report('batched', FIELDS, HANDLERS, batchedResult)

const runReduction = eagerResult.aggregateRuns / batchedResult.aggregateRuns
const speedup = eagerResult.ms / batchedResult.ms
console.log(
    `\n→ aggregate re-runs cut ${runReduction.toFixed(0)}× (= field count), ` +
        `wall time ${speedup.toFixed(2)}× faster\n`,
)

/* Gate metric: the batched per-handler cost — the path `on` now takes. */
emitMetric('coalesce.batchedHandler', (batchedResult.ms / HANDLERS) * 1000, 'us/handler')
