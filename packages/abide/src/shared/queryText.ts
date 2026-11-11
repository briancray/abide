/**
 * A record of members as a query string, leaving out each member spelled as its default is.
 *
 * 30.28 — ONE QUERY-STRING RULE for `rpcRequest`'s args (16.18) and `url`'s `Query`: a member left
 * `undefined` is omitted, a list is its member repeated, and anything else is its text — `null`
 * included, which 19.7 reads back as `null` where the schema declares it. AN EMPTY LIST IS ITS NAME
 * WITH NO `=`, last, which no text value spells — `tags=` is the one-member list `['']` — so 19.7
 * reads it back as `[]` rather than losing the member.
 *
 * 30.40 — A DEFAULT IS COMPARED IN THAT SPELLING, so `3` and `'3'` are one value, as they are once
 * the address is read back.
 */
export function queryText(
    members: Record<string, unknown>,
    defaults?: Record<string, unknown>,
): string {
    const query = new URLSearchParams()
    let bare = ''
    for (const [name, value] of Object.entries(members)) {
        if (value === undefined) continue
        if (defaults !== undefined && spelledAlike(value, defaults[name]))
            continue
        if (!Array.isArray(value)) query.append(name, String(value))
        else if (value.length === 0) bare += `&${bareName(name)}`
        else for (const each of value) query.append(name, String(each))
    }
    const text = query.toString()
    return text === '' ? bare.slice(1) : text + bare
}

/** Whether two members write the same text into a query, per 30.28. */
function spelledAlike(value: unknown, fallback: unknown): boolean {
    if (fallback === undefined) return false
    const listed = Array.isArray(value)
    if (listed !== Array.isArray(fallback)) return false
    if (!listed) return String(value) === String(fallback)
    const values = value as unknown[]
    const fallbacks = fallback as unknown[]
    if (values.length !== fallbacks.length) return false
    for (let at = 0; at < values.length; at += 1)
        if (String(values[at]) !== String(fallbacks[at])) return false
    return true
}

/** A query member's name in the encoding `URLSearchParams` gives it, without its `=`. */
export function bareName(name: string): string {
    return new URLSearchParams([[name, '']]).toString().slice(0, -1)
}
