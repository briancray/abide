/**
 * A record of members as a query string.
 *
 * 30.28 — ONE QUERY-STRING RULE for `rpcRequest`'s args (16.18) and `url`'s `Query`: a member left
 * `undefined` is omitted, a list is its member repeated, and anything else is its text — `null`
 * included, which 19.7 reads back as `null` where the schema declares it. AN EMPTY LIST IS ITS NAME
 * WITH NO `=`, last, which no text value spells — `tags=` is the one-member list `['']` — so 19.7
 * reads it back as `[]` rather than losing the member.
 */
export function queryText(members: Record<string, unknown>): string {
    const query = new URLSearchParams()
    let bare = ''
    for (const [name, value] of Object.entries(members)) {
        if (value === undefined) continue
        if (!Array.isArray(value)) query.append(name, String(value))
        else if (value.length === 0) bare += `&${bareName(name)}`
        else for (const each of value) query.append(name, String(each))
    }
    const text = query.toString()
    return text === '' ? bare.slice(1) : text + bare
}

/** A query member's name in the encoding `URLSearchParams` gives it, without its `=`. */
export function bareName(name: string): string {
    return new URLSearchParams([[name, '']]).toString().slice(0, -1)
}
