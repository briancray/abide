import { installMiniDom } from '../tests/support/installMiniDom.ts'
import { emitMetric } from './emitMetric.ts'

installMiniDom()

const { state } = await import('../src/lib/ui/state.ts')
const { effect } = await import('../src/lib/ui/effect.ts')
const { scope } = await import('../src/lib/ui/runtime/scope.ts')
const { when } = await import('../src/lib/ui/dom/when.ts')
const { appendText } = await import('../src/lib/ui/dom/appendText.ts')

/*
Control-flow build / swap / teardown benchmark (mini-DOM). The render benches measure
a steady mounted tree; this one measures the lifecycle paths a control-flow block
governs — building a branch, swapping it on a condition flip, and disposing it with
its owner. The owner-teardown path (a navigation tearing a page's live branches down)
is the one that bit-rotted into a leak until `scopeGroup` unified it, so it earns a
guarded number. Run:

  bun packages/abide/bench/controlFlow.bench.ts
*/

function ms(start: number): number {
    return performance.now() - start
}

function report(metricName: string, label: string, elapsed: number, ops: number): void {
    const perOp = (elapsed / ops) * 1000
    console.log(
        `${label.padEnd(26)} ${elapsed.toFixed(1).padStart(8)}ms   ${perOp.toFixed(3).padStart(9)}µs/op`,
    )
    emitMetric(metricName, perOp, 'us/op')
}

/* A separate signal feeds the branch interior, so the toggle drives only the swap —
   never a self-referential read of its own gate (which would accumulate work per
   flip and measure feedback, not the build/teardown path). */
const label = state('content')

/* Mount a `when` whose branch holds a reactive interior (a bound text node + an
   effect), so a flip exercises the full build → scope → group.track and the
   clearBetween → group-wrapper dispose, not an empty range. */
function mountToggle(condition: { value: boolean }): Element {
    const host = document.createElement('div')
    when(
        host,
        () => condition.value,
        (parent) => {
            appendText(parent, () => label.value)
            effect(() => void label.value)
        },
    )
    return host
}

/*
Swap churn: flip the condition `ops` times, each flip building one branch and
disposing the prior — the fillBefore/scope/group.track build path plus the
clearBetween/group-wrapper teardown path, back to back.
*/
function swapChurn(ops: number): number {
    const condition = state(true)
    mountToggle(condition)
    const start = performance.now()
    for (let op = 0; op < ops; op += 1) {
        condition.value = !condition.value
    }
    return ms(start)
}

/*
Owner teardown: build `count` independent owner scopes, each holding a mounted
`when` with a live branch, then dispose every owner — the path a navigation walks
(scopeGroup disposing each block's live branch). Build is excluded from the clock;
only the teardown is timed.
*/
function ownerTeardown(count: number): number {
    const condition = state(true)
    const disposers = Array.from({ length: count }, () =>
        scope(() => {
            mountToggle(condition)
        }),
    )
    const start = performance.now()
    for (const dispose of disposers) {
        dispose()
    }
    return ms(start)
}

/* Warm the JIT. */
swapChurn(2_000)
ownerTeardown(2_000)

console.log('\ncontrol-flow lifecycle\n')

const SWAPS = 100_000
report('controlFlow.swap', `when swap ×${SWAPS}`, swapChurn(SWAPS), SWAPS)

const OWNERS = 100_000
report('controlFlow.teardown', `owner teardown ×${OWNERS}`, ownerTeardown(OWNERS), OWNERS)

console.log()
