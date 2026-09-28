// ONE QUERY-STRING RULE for `rpcRequest`'s args (16.19) and `url`'s `Query` (30.6): a member left
// `undefined` is omitted, a list is its member repeated, and anything else is its text — `null`
// included, which 19.8 reads back as `null` where the schema declares it. An empty list writes
// nothing here; `rpcRequest` spells it as a bare name.

export function queryText(members: Record<string, unknown>): string {
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(members)) {
        if (value === undefined) continue
        if (Array.isArray(value))
            for (const each of value) query.append(name, String(each))
        else query.append(name, String(value))
    }
    return query.toString()
}
