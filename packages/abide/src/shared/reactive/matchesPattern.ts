/**
 * Whether a value holds what a pattern names — an entry's args for a selection (13.12), a caller's
 * principal for `authorize` (54.3).
 *
 * 13.12: an object holds every member the pattern names as the pattern holds it, an array holds
 * every item the pattern lists in any order beside any others, anything else is the same value, and
 * no pattern names every value. One statement, for a `Keyed`'s own entries, the mux's followers of
 * a handler (7.10, 7.18), the outbox's calls and a rung's principal.
 */
export function matchesPattern(held: unknown, pattern: unknown): boolean {
    if (pattern === undefined) return true
    return holds(held, pattern)
}

function holds(held: unknown, wanted: unknown): boolean {
    if (Array.isArray(wanted)) {
        if (!Array.isArray(held)) return false
        for (const item of wanted)
            if (!held.some((candidate) => holds(candidate, item))) return false
        return true
    }
    if (typeof wanted === 'object' && wanted !== null) {
        if (typeof held !== 'object' || held === null) return false
        for (const key in wanted)
            if (
                !holds(
                    (held as Record<string, unknown>)[key],
                    (wanted as Record<string, unknown>)[key],
                )
            )
                return false
        return true
    }
    return held === wanted
}
