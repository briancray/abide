import { derived } from '../src/lib/ui/derived.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { emitMetric } from './emitMetric.ts'

/*
Reactive-graph throughput benchmark — the track / runNode / invalidate path, the
one the dependency-edge representation governs. The existing reactivity.bench
measures the doc write path (one cell, one reader); this one stresses the graph
shape itself: wide effect fan-out, deep computed chains, and dynamic re-tracking
(a reader whose dependency set changes every run). Run:

  bun packages/abide/bench/reactivityGraph.bench.ts

These are abide absolutes — they exist to be a regression gate: a graph change
(edge representation, propagation order) shows up here before it ships.
*/

function ms(start: number): number {
    return performance.now() - start
}

function report(metricName: string, label: string, elapsed: number, ops: number): void {
    console.log(
        `${label.padEnd(28)} ${elapsed.toFixed(1).padStart(8)}ms` +
            `   ${((elapsed / ops) * 1000).toFixed(4).padStart(10)}µs/op`,
    )
    emitMetric(metricName, elapsed, 'ms')
}

/*
Wide fan-out: one shared signal feeds N effects, each also reading its own signal,
so every shared-signal write invalidates N effects and each re-run drops and
re-installs two dependency edges. Stresses invalidate's observer walk plus
runNode's unlink + re-track on the hottest possible cone.
*/
function wideFanout(observers: number, writes: number): number {
    const shared = state(0)
    const locals = Array.from({ length: observers }, () => state(0))
    let sink = 0
    const disposers = locals.map((local) =>
        effect(() => {
            sink += shared.value + local.value
        }),
    )
    const start = performance.now()
    for (let write = 0; write < writes; write += 1) {
        shared.value = write
    }
    const elapsed = ms(start)
    for (const dispose of disposers) {
        dispose()
    }
    return sink === -1 ? 0 : elapsed
}

/*
Deep chain: signal → computed → computed → … (depth N), read the tail then write
the head, repeated. Stresses lazy pull propagation — each write marks the chain
dirty, each tail read recomputes the whole chain and re-tracks every edge.
*/
function deepChain(depth: number, reads: number): number {
    const head = state(0)
    let tail = derived(() => head.value + 1)
    for (let level = 1; level < depth; level += 1) {
        const previous = tail
        tail = derived(() => previous.value + 1)
    }
    let sink = 0
    const start = performance.now()
    for (let read = 0; read < reads; read += 1) {
        head.value = read
        sink += tail.value
    }
    const elapsed = ms(start)
    return sink === -1 ? 0 : elapsed
}

/*
Dynamic dependencies: an effect reads a different half of a signal pool each run,
so every run unlinks the previous run's edges and links a fresh set. The pure
churn case — re-tracking is the entire cost, with no stable steady state to reuse.
*/
function dynamicDeps(poolSize: number, runs: number): number {
    const pool = Array.from({ length: poolSize }, (_, index) => state(index))
    const selector = state(0)
    let sink = 0
    const dispose = effect(() => {
        const offset = selector.value % 2 === 0 ? 0 : poolSize / 2
        for (let index = offset; index < offset + poolSize / 2; index += 1) {
            sink += (pool[index] as (typeof pool)[number]).value
        }
    })
    const start = performance.now()
    for (let run = 0; run < runs; run += 1) {
        selector.value = run
    }
    const elapsed = ms(start)
    dispose()
    return sink === -1 ? 0 : elapsed
}

/* Warm the JIT before measuring. */
wideFanout(100, 2_000)
deepChain(50, 2_000)
dynamicDeps(100, 2_000)

console.log('\nreactive graph throughput\n')

const FANOUT_OBSERVERS = 1_000
const FANOUT_WRITES = 5_000
report(
    'reactivity.fanout',
    `fanout ${FANOUT_OBSERVERS}×${FANOUT_WRITES}`,
    wideFanout(FANOUT_OBSERVERS, FANOUT_WRITES),
    FANOUT_OBSERVERS * FANOUT_WRITES,
)

const CHAIN_DEPTH = 500
const CHAIN_READS = 20_000
report(
    'reactivity.chain',
    `chain depth=${CHAIN_DEPTH} ×${CHAIN_READS}`,
    deepChain(CHAIN_DEPTH, CHAIN_READS),
    CHAIN_DEPTH * CHAIN_READS,
)

const POOL = 200
const DYNAMIC_RUNS = 50_000
report(
    'reactivity.dynamicDeps',
    `dynamic deps pool=${POOL} ×${DYNAMIC_RUNS}`,
    dynamicDeps(POOL, DYNAMIC_RUNS),
    (POOL / 2) * DYNAMIC_RUNS,
)
console.log()
