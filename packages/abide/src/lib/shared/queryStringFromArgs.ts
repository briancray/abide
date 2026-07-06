/*
Canonical query-string encoding for a query-carrying rpc's args bag. The
single definition both the synthesized Request (buildRpcRequest) and its
cache key (keyForRemoteCall) build their query from, so the request URL and
the key encode every value identically and can't drift. `undefined` values
are dropped; each surviving value is coerced with String() and percent-
encoded with encodeURIComponent on both name and value. Keys come in
insertion order for the request and sorted for the key (`sort`), so the key
is stable under arg reordering. Returns the query body without a leading
`?` (empty string when nothing survives the filter). Concatenated in one
walk — no entries / filtered / URLSearchParams intermediates — to keep the
hot GET-cache path allocation-light. Callers validate that `args` is a
plain object first; this assumes that.

A non-primitive VALUE throws: String() would flatten every object to
'[object Object]', so distinct calls would collide onto one request URL and
one cache key — the first call's data silently served for the second.
*/
export function queryStringFromArgs(args: Record<string, unknown>, sort: boolean): string {
    const keys = sort ? Object.keys(args).sort() : Object.keys(args)
    let query = ''
    for (const key of keys) {
        const value = args[key]
        if (value === undefined) {
            continue
        }
        const kind = typeof value
        if (value !== null && (kind === 'object' || kind === 'function' || kind === 'symbol')) {
            const got = Array.isArray(value) ? 'array' : kind
            throw new TypeError(
                `[abide] query arg "${key}" must be a primitive — got ${got} (query-carrying methods can't encode structured values; move the arg to a POST body)`,
            )
        }
        query += query ? '&' : ''
        query += `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    }
    return query
}
