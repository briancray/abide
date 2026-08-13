// The two "what kind of thing is this?" probes the measurement half asks, and the kit's own copies of
// them on purpose.
//
// `$shared/internal/probes.ts` has both, and until the kit was a package of its own it imported them
// from there. It may not now, and not out of tidiness: `abide-kit/measure` carries the invariant that
// NOTHING IN ITS GRAPH IS ABIDE — that is what lets a browser page, and the cross-repo comparison
// harness in ~/code, time a hand-written arm with the same clock and the same batch sizing as an abide
// one. An import of a framework internal to answer "is this a promise?" would put the framework in
// every arm's graph and the comparison would be against a substrate that had already loaded it.
//
// So the duplication is the seam, not an oversight. These are six lines and they answer a question
// about JavaScript rather than about abide; if a third copy ever seems necessary, that is the signal
// that the layering was wrong rather than that a fourth is due.

/** What a thrown value SAID, with Bun's aggregate unwrapped — the first inner message is the diagnostic. */
export function messageOf(failure: unknown): string {
    // Guarded, because `throw null` is legal and a property read off it is a second failure thrown
    // from the code reporting the first.
    if (failure !== null && typeof failure === 'object') {
        const first = (failure as { errors?: { message?: unknown }[] }).errors?.[0]?.message
        if (typeof first === 'string') return first
    }
    return failure instanceof Error ? failure.message : String(failure)
}

/**
 * The typeof guard is the whole cost: `value?.then` on a PRIMITIVE boxes it and walks a wrapper
 * prototype, which a timed arm pays once per operation.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (value === null) return false
    const type = typeof value
    if (type !== 'object' && type !== 'function') return false
    return typeof (value as { then?: unknown }).then === 'function'
}
