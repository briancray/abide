// The measurement half of the kit, and the half with NO ABIDE IN ITS GRAPH.
//
// That is the invariant this entry point exists to carry, and it is load-bearing rather than tidy.
// Every performance claim in this repo is a RATIO against hand-written code in the same substrate, so
// the hand-written arm has to be timed by the same clock, with the same batch sizing and the same
// quiesce, as the abide arm beside it. An import of `abide` from here would put the framework in the
// graph of the arm that exists to have none — and the vanilla arm would be measured on a substrate
// that had already paid to load the thing it is the control for.
//
// It is also what makes the layer reusable outside this repo. The cross-repo comparison harness in
// ~/code times other frameworks' arms, and `packages/perf` times a hand-written signal ladder; both
// hand-rolled their own median and batch calibration before this was importable on its own, which is
// two more places for "a timing sample must be at least 100x the clock's resolution" to be got wrong.
//
// Two things follow from the invariant, and neither is negotiable:
//
//   · nothing here may import `abide`, and nothing here may import `bun:` anything. This runs in a
//     browser page, under `bun test`, and inside a playwright `evaluate`.
//   · the two probes it needs are the kit's own copies — see `internal/probes.ts` for why six
//     duplicated lines are the correct price for the boundary.
//
// Assertions are NOT here. They are on `abide-kit`, beside the `Case` that carries them: an assertion
// is how a case states a claim, not how a number is taken.

// How long, how many times, and what a ratio is allowed to say about the difference.
export {
    type Arm,
    clockResolution,
    duration,
    FLOOR,
    floorTicks,
    frame,
    keep,
    keptValue,
    microtasks,
    NOISE,
    NOISY_SPREAD,
    nsPerOp,
    quiesce,
    ratioText,
    settled,
    type Timing,
    timeArms,
    verdict,
} from './internal/bench.ts'
// What the document was actually asked to do. Counted, never timed — the wrong implementation
// produces the right output at full cost, and only a counter can tell the two apart.
export {
    type Counts,
    countCalls,
    install,
    measure,
    measureFlush,
    nodesMade,
    nonZero,
    tick,
    total,
} from './internal/dom.ts'
