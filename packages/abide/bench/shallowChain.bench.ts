import { computed } from '../src/lib/ui/computed.ts'
import { state } from '../src/lib/ui/state.ts'
import { emitMetric } from './emitMetric.ts'

/*
Shallow computed-chain benchmark — the common app shape (computed-of-computed,
depth 2-4), distinct from reactivityGraph's pathological depth-500 chain. It
guards the propagation path against an optimisation that wins on a deep chain by
trading allocation for stack depth: that trade loses here, where the chain is too
short to amortise a per-read scratch allocation over the recursion frames it
removes. Keeping both depths in the gate stops a deep-chain win from masking a
shallow-chain regression. Run:

  bun packages/abide/bench/shallowChain.bench.ts
*/

/* signal → computed → … (depth N); each iteration writes the head and reads the
   tail, so the whole chain marks dirty and re-settles — the propagation path. */
function shallowChain(depth: number, reads: number): number {
    const head = state(0)
    let tail = computed(() => head.value + 1)
    for (let level = 1; level < depth; level += 1) {
        const previous = tail
        tail = computed(() => previous.value + 1)
    }
    let sink = 0
    const start = performance.now()
    for (let read = 0; read < reads; read += 1) {
        head.value = read
        sink += tail.value
    }
    const elapsed = performance.now() - start
    return sink === -1 ? 0 : elapsed
}

const DEPTHS = [2, 3, 4]
const READS = 2_000_000

/* Warm the JIT before measuring. */
for (const depth of DEPTHS) {
    shallowChain(depth, 50_000)
}

console.log('\nshallow computed chains (depth 2-4)\n')
for (const depth of DEPTHS) {
    const elapsed = shallowChain(depth, READS)
    console.log(`depth=${depth} ×${READS}   ${elapsed.toFixed(1).padStart(8)}ms`)
    emitMetric(`shallowChain.depth${depth}`, elapsed, 'ms')
}
console.log()
