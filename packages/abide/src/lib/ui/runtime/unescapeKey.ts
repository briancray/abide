/*
Reverses `escapeKey` for one path segment (JSON Pointer RFC 6901): `~1`→`/`,
`~0`→`~`, in that order so a literal `~1` in the original key (escaped to `~01`)
round-trips. A segment with no `~` can't carry an escape, so it returns untouched
— the fast path for every plain-identifier segment on the hot read/split path.
*/
export function unescapeKey(segment: string): string {
    if (!segment.includes('~')) {
        return segment
    }
    return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}
