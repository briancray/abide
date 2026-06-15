import type { BenchResult } from './types/BenchResult.ts'

/*
Svelte 5 baseline for the write-path bench: deep `$state` (a Proxy) plus a
`$derived` read. Each iteration mutates one item in place and reads the derived
back, which recomputes synchronously on read — the reliable, pull-based half of
Svelte's reactivity. (Svelte's push-based `$effect` does not re-run headless under
Bun, so effect fan-out is benched in a DOM harness, not here.) Compiled through
the `.svelte.ts` client loader in tests/support/sveltePreload.ts.
*/
export function svelteCellBench(itemCount: number, updates: number): BenchResult {
    let items = $state(Array.from({ length: itemCount }, (_, index) => ({ n: index })))
    let key = $state(0)
    const current = $derived(items[key].n)

    let sink = 0
    const updateStart = performance.now()
    for (let update = 0; update < updates; update += 1) {
        const index = update % itemCount
        items[index].n = update // in-place proxy write, O(1)
        key = index
        sink += current // forces the derived to recompute and read back
    }
    const updateMs = performance.now() - updateStart
    return { createMs: 0, updateMs, runs: sink === -1 ? 0 : updates }
}
