/*
Translates a single path segment into a Bun.serve route pattern:
- `[name]` → `:name` (named path param)
- `[...rest]` → `*` (catch-all wildcard)
- everything else passes through unchanged.
*/
export function toRoutePattern(segment: string): string {
    if (segment.startsWith('[...') && segment.endsWith(']')) {
        return '*'
    }
    if (segment.startsWith('[') && segment.endsWith(']')) {
        return `:${segment.slice(1, -1)}`
    }
    return segment
}
