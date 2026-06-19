import { derived } from '../src/lib/ui/derived.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import type { BenchResult } from './types/BenchResult.ts'

/*
The data-collapse spike: is `derived` as a computed DOC SLOT competitive with the
standalone signal-cell `derived`? Three contenders, two workloads.

Contenders:
  - standalone   — `derived(() => s.value * 2)`, read `.value` (today's form).
  - doc bound    — `doc.derive(path, …)` → the string-free reader (what the
                   compiler would hoist a computed read to).
  - doc path     — `doc.read(path)` resolving the computed by string every read
                   (the unspecialised floor).

Workload A (pure read): the computed stays clean; isolates read + lookup cost.
Workload B (update+read): change the source each iter; the realistic recompute.

If `doc bound` ≈ `standalone`, the collapse pays for itself with hoisting, and the
only gap is `doc path`'s per-read map lookup — the same gap `cell`/hoist closes
for stored reads.
*/

const ITERS = 500_000

function pureRead(label: string, read: () => number): BenchResult {
    let sink = 0
    const start = performance.now()
    for (let i = 0; i < ITERS; i += 1) {
        sink += read()
    }
    return { createMs: 0, updateMs: performance.now() - start, runs: sink === -1 ? 0 : ITERS }
}

/* ---- standalone derived ---- */
function standaloneRead(): BenchResult {
    const s = state(1)
    const d = derived(() => s.value * 2)
    return pureRead('standalone', () => d.value)
}
function standaloneUpdate(): BenchResult {
    const s = state(1)
    const d = derived(() => s.value * 2)
    let sink = 0
    const start = performance.now()
    for (let i = 0; i < ITERS; i += 1) {
        s.value = i
        sink += d.value
    }
    return { createMs: 0, updateMs: performance.now() - start, runs: sink === -1 ? 0 : ITERS }
}

/* ---- doc computed slot ---- */
function docBoundRead(): BenchResult {
    const document = doc({ n: 1 })
    const d = document.derive('doubled', () => document.read<number>('n') * 2)
    return pureRead('doc bound', d)
}
function docPathRead(): BenchResult {
    const document = doc({ n: 1 })
    document.derive('doubled', () => document.read<number>('n') * 2)
    return pureRead('doc path', () => document.read<number>('doubled'))
}
/* Unspecialised: string write + the compute reads its dep by string. */
function docBoundUpdate(): BenchResult {
    const document = doc({ n: 1 })
    const d = document.derive('doubled', () => document.read<number>('n') * 2)
    let sink = 0
    const start = performance.now()
    for (let i = 0; i < ITERS; i += 1) {
        document.replace('n', i)
        sink += d()
    }
    return { createMs: 0, updateMs: performance.now() - start, runs: sink === -1 ? 0 : ITERS }
}

/* Compiled form: source written through a hoisted `cell`, and the compute reads
   its dep through that same cell — both string-free, what the compiler emits. */
function docHoistedUpdate(): BenchResult {
    const document = doc({ n: 1 })
    const nCell = document.cell<number>('n')
    const d = document.derive('doubled', () => nCell.get() * 2)
    let sink = 0
    const start = performance.now()
    for (let i = 0; i < ITERS; i += 1) {
        nCell.set(i)
        sink += d()
    }
    return { createMs: 0, updateMs: performance.now() - start, runs: sink === -1 ? 0 : ITERS }
}

function perReadNs(result: BenchResult): string {
    return `${((result.updateMs / ITERS) * 1_000_000).toFixed(1)}ns/read`
}
function report(label: string, result: BenchResult): void {
    console.log(
        `${label.padEnd(20)} ${result.updateMs.toFixed(1).padStart(7)}ms   ${perReadNs(result).padStart(12)}`,
    )
}

/* warm the JIT */
standaloneRead()
docBoundRead()
docPathRead()

console.log(`\nA) pure read (computed clean), ${ITERS.toLocaleString()} reads\n`)
report('standalone', standaloneRead())
report('doc bound', docBoundRead())
report('doc path', docPathRead())

console.log(`\nB) update + read (recompute each iter), ${ITERS.toLocaleString()} cycles\n`)
report('standalone', standaloneUpdate())
report('doc path-write', docBoundUpdate())
report('doc hoisted', docHoistedUpdate())
console.log()
