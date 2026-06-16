import { doc } from '../src/lib/ui/doc.ts'
import type { BenchResult } from './types/BenchResult.ts'

/*
Reactivity write-path benchmark. Run with the Svelte client loader preloaded:

  bun --preload ./packages/abide/tests/support/sveltePreload.ts \
      packages/abide/bench/reactivity.bench.ts

Workload (same for all): a list of N items, M times "update one item's field and
read it back". Three contenders:

  - abide cell   — `doc.cell(path)`, the stable accessor the compiler emits:
                   path resolved once, the hot loop is string-free. Apples to
                   apples with Svelte's compiled "hold the signal reference".
  - abide path   — `doc.replace(path)` / `doc.read(path)` building the path
                   string every iteration: the *unspecialised* runtime floor.
  - svelte       — deep `$state` proxy + `$derived` read.

Now that patches mutate in place (O(depth), not O(width)), the structural-sharing
tax is gone — section 2 confirms per-update cost is flat across list widths.

Fan-out dispatch granularity is proven separately by tests/uiReactivity.test.ts.
*/

/* Compiled-style: resolve the cell once, then string-free get/set. */
function abideCellBench(itemCount: number, updates: number): BenchResult {
    const document = doc({ items: Array.from({ length: itemCount }, (_, index) => ({ n: index })) })
    const cells = Array.from({ length: itemCount }, (_, index) =>
        document.cell<number>(`items/${index}/n`),
    )
    let sink = 0
    const updateStart = performance.now()
    for (let update = 0; update < updates; update += 1) {
        const cell = cells[update % itemCount]
        cell.set(update)
        sink += cell.get()
    }
    const updateMs = performance.now() - updateStart
    return { createMs: 0, updateMs, runs: sink === -1 ? 0 : updates }
}

/* Unspecialised floor: build + parse the path string every iteration. */
function abidePathBench(itemCount: number, updates: number): BenchResult {
    const document = doc({ items: Array.from({ length: itemCount }, (_, index) => ({ n: index })) })
    let sink = 0
    const updateStart = performance.now()
    for (let update = 0; update < updates; update += 1) {
        const index = update % itemCount
        document.replace(`items/${index}/n`, update)
        sink += document.read<number>(`items/${index}/n`)
    }
    const updateMs = performance.now() - updateStart
    return { createMs: 0, updateMs, runs: sink === -1 ? 0 : updates }
}

function perUpdateUs(result: BenchResult, updates: number): string {
    return `${((result.updateMs / updates) * 1000).toFixed(3)}µs/update`
}

function report(label: string, result: BenchResult, updates: number): void {
    console.log(
        `${label.padEnd(18)} ${result.updateMs.toFixed(1).padStart(8)}ms` +
            `   ${perUpdateUs(result, updates).padStart(16)}   runs=${result.runs}`,
    )
}
/* window so the preload's reactivity-client swap activates; imported after. */
;(globalThis as { window?: unknown }).window = globalThis
const { svelteCellBench } = await import('./svelteBench.svelte.ts')

const HEAD_TO_HEAD_ITEMS = 1_000
const UPDATES = 50_000

/* Warm the JITs at small size before measuring. */
abideCellBench(200, 5_000)
abidePathBench(200, 5_000)
svelteCellBench(200, 5_000)

console.log(`\n1) head-to-head: ${HEAD_TO_HEAD_ITEMS}-item list, ${UPDATES} update+read\n`)
report('abide cell', abideCellBench(HEAD_TO_HEAD_ITEMS, UPDATES), UPDATES)
report('svelte $state', svelteCellBench(HEAD_TO_HEAD_ITEMS, UPDATES), UPDATES)
report('abide path', abidePathBench(HEAD_TO_HEAD_ITEMS, UPDATES), UPDATES)

console.log(`\n2) abide cell scaling across list width (${UPDATES} update+read)\n`)
for (const width of [100, 1_000, 5_000, 20_000]) {
    report(`abide width=${width}`, abideCellBench(width, UPDATES), UPDATES)
}
console.log('\n→ flat per-update cost across widths = the O(width) copy-on-write tax is gone\n')
