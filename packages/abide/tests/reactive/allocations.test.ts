// "0 ALLOCATIONS ON A STABLE DEPENDENCY" is the budget row this design is held to
// rather than to milliseconds, and it needs two instruments because one number
// answers half the question.
//
// `WORK.links` is EXACT and says how many edges were constructed. `allocated()` is a
// batch mean over the whole heap and says whether anything else crept in beside them.
// `retained()` — which the plan named — answers a THIRD question and not this one: it
// reports what stays reachable after a full GC, so a `Link` allocated per read and
// swept at end of run is invisible to it. The reachability instrument is still worth
// running, as the leak check, which is what it is used for below.
//
// Both run in a PROCESS WITH NO DOM. `bunfig.toml` preloads happy-dom into every
// `bun test` process and happy-dom's own objects land in the same untyped `Object`
// bucket the framework's do, so both refuse outright there (44.16) and the gate is
// taken in a child.

import { expect, test } from 'bun:test'
import { inAFreshProcess } from 'harness/gate'

const SOURCE = `
import { allocated, retained } from 'harness/server'
import { state, watch } from './packages/abide/src/shared/index.ts'
// 12.12 — a write SCHEDULES its reader, and this gate's positive half is that the
// reader really re-ran. A synchronous loop of 2000 writes coalesces to one run, so
// the drain stands where the tick would be and the loop is 2000 runs again.
import { flushEffects } from './packages/abide/src/shared/reactive/graph.ts'
import { WORK } from './packages/abide/src/shared/reactive/counters.ts'

const first = state(1)
const second = state(1)
let runs = 0
watch(() => {
    first()
    second()
    runs += 1
})
// Warm: the first runs build the two edges and compile the loop.
for (let at = 0; at < 200; at += 1) { first.set(at); flushEffects() }

const before = WORK.links
for (let at = 0; at < 2000; at += 1) { first.set(1000 + at); flushEffects() }
const links = WORK.links - before
if (links !== 0) {
    console.error('links=' + links)
    process.exit(1)
}
// The positive half: the reader really did re-run, and really did read both sources.
// Zero links also passes against a reader that subscribed to nothing.
if (runs < 2000) {
    console.error('runs=' + runs)
    process.exit(1)
}
const added = state(1)
const beforeAdded = WORK.links
added.set(2)
flushEffects()
watch(() => {
    added()
})
if (WORK.links - beforeAdded !== 1) {
    console.error('newEdge=' + (WORK.links - beforeAdded))
    process.exit(1)
}

const churn = allocated(() => {
    first.set(first.peek() === 1 ? 2 : 1)
    flushEffects()
})
// A \`Link\` per read would be two per rep, both swept and both garbage — which is
// exactly what a batch mean can see and a reachability diff cannot.
const perRep = churn.perRep.Object ?? 0
if (perRep > 1) {
    console.error('perRepObject=' + perRep.toFixed(3))
    process.exit(1)
}
// The leak check, and the one question \`retained()\` is the right instrument for.
const held = retained(() => {
    for (let at = 0; at < 2000; at += 1) first.set(9000 + at)
    return null
})
if ((held.Object ?? 0) > 4) {
    console.error('retainedObject=' + (held.Object ?? 0))
    process.exit(1)
}
console.log('ok links=' + links + ' perRepObject=' + perRep.toFixed(3))
`

test('a read with a stable dependency allocates no edge and retains nothing', () => {
    // REVERT: allocate a `Link` per read rather than claiming the one already in
    // position — drop `subscribe`'s fast path and `attach`'s first two arms, so every
    // read takes the allocating arm. REPORTS: `links=4000` over 2000 writes where
    // this asserts 0, and `perRepObject` rises by two per rep beside it.
    const run = inAFreshProcess(SOURCE)
    expect(run.timedOut).toBe(false)
    expect(run.output).toContain('ok links=0')
    expect(run.ok).toBe(true)
})
