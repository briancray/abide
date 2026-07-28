// The `debug`-npm channel-pattern grammar, in one place: an exact name, the `*` wildcard, or a
// trailing-`*` prefix (`abide:*` lights `abide:memo`). A comma separates alternatives.
//
// Extracted from `log.ts`'s own gate because a REMOTE log subscriber filters with the same spelling a
// server gates with (`DEBUG=abide:rpc` and `logs --debug abide:rpc` select the same lines). Two
// implementations of one grammar is exactly the kind of thing that drifts by a trimmed space.
export function debugPatternMatches(spec: string, channel: string): boolean {
    if (spec.length === 0) return false
    const patterns = spec.split(',')
    for (const raw of patterns) {
        const pattern = raw.trim()
        if (pattern.length === 0) continue
        if (pattern === '*') return true
        if (pattern === channel) return true
        if (pattern.endsWith('*') && channel.startsWith(pattern.slice(0, -1))) return true
    }
    return false
}
