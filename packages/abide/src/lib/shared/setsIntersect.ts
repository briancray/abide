/*
True when two sets share at least one member — a plain for-of over the first set
rather than `.values().some()` (Iterator Helpers are too new for this module's
browser baseline; see producerKey). Pass the smaller set first. Shared by
selectorMatcher (local selectors) and matcherFromEnvelope (wire-decoded frames) so
the two tag predicates can't drift.
*/
export function setsIntersect<T>(a: Set<T>, b: Set<T>): boolean {
    for (const value of a) {
        if (b.has(value)) {
            return true
        }
    }
    return false
}
