// 41.11 — A HYDRATION MISMATCH REBUILDS THE ENCLOSING BLOCK AND WARNS, and what it must not do is
// take the page down. An ordinary throw out of `mount` does exactly that: every binding and every
// listener after the one that refused is never installed, so a page whose one slot disagrees is
// served looking right and completely dead. Every refusal in this seam cited the clause while
// doing the opposite of it.
//
// THROWN RATHER THAN RETURNED, because the refusal comes from inside a walk several nodes deep and
// the block that rebuilds is several frames above it. The BRAND is what a block's catch reads: a
// throw from an author's own expression is not a mismatch and is rethrown untouched, which is why
// this is a class rather than a string test on a message.
export class Mismatch extends Error {}

// Whether a throw was a mismatch, WARNING when it was. One call rather than a predicate with a
// warn beside it: the warning is the other half of 41.11, and a caller that only asked would have
// to remember it at every catch.
//
// `console.warn` under the clause's own namespace is the stand-in for `log.named`, the same way
// `refuse.ts` carries `abide:refuse` until the logger exists.
export function warnMismatch(thrown: unknown): boolean {
    if (!(thrown instanceof Mismatch)) return false
    console.warn('abide:hydrate', thrown.message)
    return true
}
