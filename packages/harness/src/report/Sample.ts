// ONE ARM'S TIMING, and everything `ratio()` needs to refuse a comparison it should
// not make. Every field is required: a record with an optional substrate is a record
// whose substrate somebody omits, and the JSC/V8 inversion — the same graph at 1.67x
// a hand-written signal in one engine and 0.21x in the other — is not a difference an
// average can survive.
export type Sample = {
    // The name this arm is reported under. `ratio()` refuses two samples sharing it,
    // which is an arm measured against itself.
    arm: string
    // The case both arms ran. Refused when they disagree.
    case: string
    // Operations batched into ONE timing. Equal across arms or the comparison is
    // refused: a per-op figure at n=10,000 has different GC and cache behaviour than
    // at n=10.
    n: number
    // Timed batches taken, warm-up excluded.
    reps: number
    // Batches run and discarded before timing started. JSC tiers LLInt -> Baseline ->
    // DFG -> FTL, so this is not a formality.
    warmup: number
    // The ENGINE, not the runtime. `bun test` is JSC, a chromium arm is V8, and a
    // reader's own browser is whichever of three they brought.
    substrate: 'jsc' | 'v8' | 'spidermonkey' | 'unknown'
    // Whether the op touched an EMULATED DOM. Set by the lane rather than sniffed,
    // and a duration carrying `'dom'` is refused at construction — happy-dom can
    // produce a count, never a millisecond anybody should quote.
    emulated: 'dom' | null
    // Per operation, min-of-reps. Timing noise is one-sided-positive, so the minimum
    // is the robust point estimate and it is free.
    nanoseconds: number
    // Per operation, 95th percentile of the reps. A mean of 14 ms with a p99 of 40 ms
    // is jank published as smooth.
    p95: number
    // True when the op was measured UNBATCHED and came in under a frame. Click -> paint
    // is frame quantised: nine ops reading 16.6-17.0 across six frameworks is the
    // answer, not an instrument to sharpen. `ratio()` will not divide two of these.
    underOneFrame: boolean
    // What the arm DID, when the lane counted it. Two arms whose work disagrees are not
    // two implementations of one op — byte-identical page source ran 4.5x apart because
    // only one arm shipped a stylesheet, so the faster arm was not doing the work.
    work: Readonly<Record<string, number>> | null
}
