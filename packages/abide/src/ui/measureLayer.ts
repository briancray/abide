// WHAT GIVES `shares()` A NUMERATOR. The engine lane reads its numerator out of the
// `performance.measure` pairs THE CODE UNDER TEST EMITS, and abide emitted none — so no layer of
// this framework could be priced against an op anybody waits on, and
// `explorations/NAME-THE-SHARE.md` had to stand in Blink's whole `ScriptDuration` and call the
// result a ceiling on a ceiling.
//
// That stand-in is why four separate go/no-go measurements across six rewrite proposals are still
// untaken: each pre-registered a threshold on a layer, and there was no instrument that could be
// pointed at one. These marks are that instrument.
//
// DISARMED BY DEFAULT, AND READ ONCE. `performance.mark` is not free, and a framework that pays
// for its own telemetry on every navigation is a framework nobody measures twice. The flag is read
// at module load into a `const` so the branch is one monomorphic test the engine can fold, which
// means THE HARNESS MUST ARM IT BEFORE ABIDE'S MODULE GRAPH LOADS — `page.addInitScript` followed
// by a navigation, the pattern `compiled.spec.ts` already uses. Arming after boot does nothing,
// and that is the trade for not branching on a global per op.
//
// PAIRED, NOT WRAPPED. A `withLayer(name, body)` would allocate a closure at every call site; the
// open/close pair allocates nothing and costs one branch when disarmed.
const ARMED =
    (
        globalThis as unknown as {
            __ABIDE_LAYERS__?: boolean
        }
    ).__ABIDE_LAYERS__ === true

// The mark an `endLayer` measures back to. One string per layer rather than a concatenation per
// call: a template literal here would allocate on a path that exists to be cheap.
const OPENED = ':opened'

export function beginLayer(name: string): void {
    if (ARMED) performance.mark(name + OPENED)
}

// `shares()` REFUSES A LAYER THAT RUNS OUTSIDE ITS OP, so an unbalanced pair is a throw in the
// spec rather than a wrong fraction. Every `beginLayer` owes one of these on every path out,
// including the ones that return early.
export function endLayer(name: string): void {
    if (ARMED) performance.measure(name, name + OPENED)
}
