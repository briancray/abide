// 13.12 — WHETHER AN ENTRY'S ARGS ARE ONES A PATTERN NAMES: every key the pattern gives is the same in
// the args, and no pattern names every entry. One statement, for a `Keyed`'s own entries and for the
// mux's followers of a handler (7.10, 7.18), which match the same pattern over the same args.
export function matchesPattern(args: unknown, pattern: unknown): boolean {
    if (pattern === undefined) return true
    if (args === null || typeof args !== 'object') return args === pattern
    const wanted = pattern as Record<string, unknown>
    const held = args as Record<string, unknown>
    for (const key of Object.keys(wanted))
        if (held[key] !== wanted[key]) return false
    return true
}
