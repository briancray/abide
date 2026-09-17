// An `Args` object becomes an entry key by its canonical wire form. RULEBOOK 11.26:
// members sorted by name, `undefined` members dropped, `Date` written ISO.
//
// 11.28: the key is taken BEFORE any gate runs, because a browser holds no copy
// of the gate — a key taken after normalising is computed one way on a server and
// another in a browser, and every handler with a normalising schema would miss its
// seed buffer and re-issue the call on hydration.
export function canonicalKey(args: unknown): string {
    if (args === undefined) return ''
    return JSON.stringify(canonical(args))
}

function canonical(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) {
        const out: unknown[] = []
        for (let index = 0; index < value.length; index += 1)
            out.push(canonical(value[index]))
        return out
    }
    const source = value as Record<string, unknown>
    const keys = Object.keys(source).sort()
    const out: Record<string, unknown> = {}
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string
        const member = source[key]
        if (member === undefined) continue
        out[key] = canonical(member)
    }
    return out
}
