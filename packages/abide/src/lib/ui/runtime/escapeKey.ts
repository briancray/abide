/*
Escapes one object key into a JSON Pointer reference token (RFC 6901): `~`→`~0`,
`/`→`~1`, so a key that itself contains `/` (a URL id, a date, a composite key)
survives a `/`-joined path instead of being mis-split into segments. `~` is
escaped first so a `/`→`~1` substitution isn't re-escaped. The common key (a
plain identifier) contains neither char, so the scan returns it untouched.
*/
export function escapeKey(key: string): string {
    if (!key.includes('~') && !key.includes('/')) {
        return key
    }
    return key.replace(/~/g, '~0').replace(/\//g, '~1')
}
