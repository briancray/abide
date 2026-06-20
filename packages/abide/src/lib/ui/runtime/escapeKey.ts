/*
Escapes one object key into a JSON Pointer reference token (RFC 6901): `~`→`~0`,
`/`→`~1`, so a key that itself contains `/` (a URL id, a date, a composite key)
survives a `/`-joined path instead of being mis-split into segments. `~` is
escaped first so a `/`→`~1` substitution isn't re-escaped. The common key (a
plain identifier) contains neither char, so the scan returns it untouched.

Coerces first: lowerDocAccess wraps every dynamic path segment in this call, and a
segment is often a number (an array index `lines[i]`) — String() mirrors the `+`
join that built the path before, leaving numerics as their decimal text.
*/
// @documentation plumbing
export function escapeKey(key: string | number): string {
    const segment = String(key)
    if (!segment.includes('~') && !segment.includes('/')) {
        return segment
    }
    return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}
