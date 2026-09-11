// WHAT BLINK DID over one traced window, plus the user timing the code under test
// emitted inside it.
//
// Both halves are here for the same reason: a fraction needs a numerator that Blink
// does not name. "Reconcile" is not a Blink layer — style, layout and paint are, and
// a reconcile is application JS — so the numerator comes from `performance.measure`
// pairs the code under test emits, and the layers come from the engine.
export type Trace = {
    // The op this window is of, and the name `shares()` reports.
    op: string
    // `performance.measure` entries, in trace order. `shares()` reads its numerator
    // and its denominator out of these by NAME, and asserts containment rather than
    // assuming it.
    measures: {
        name: string
        startNanoseconds: number
        endNanoseconds: number
    }[]
    // All four, because a count is how two arms REPORT THE WORK. Byte-identical page
    // source ran 4.5x apart and the only difference was that one arm shipped a
    // stylesheet — a class no rule mentions is a write with no style recalculation
    // and no paint after it, so the faster arm was not doing the work at all.
    counters: {
        recalcStyle: number
        layout: number
        paint: number
        // A layout read after a write in the same path forces the layout the write
        // invalidated. One such read per row is the whole frame.
        forcedLayout: number
    }
    // Blink's own per-layer durations over the window, in nanoseconds. Not for
    // pricing — `shares()` prices off the user timing — but for saying which way the
    // headroom runs.
    layers: {
        style: number
        layout: number
        script: number
    }
}
