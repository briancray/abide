/*
Deterministic key string for a value. Object keys (and Map keys, Set members)
are sorted so values differing only in insertion order produce identical
strings, and every recognised type carries a tag so distinct types never
collide — a Date never equals the string of its ISO form, a Map never equals a
plain object. Used to derive cache keys from producer args and from auto-keyed
POST/PUT/PATCH bodies; the output is a key, not a request body, so it is free to
encode types JSON.stringify would silently flatten (Map/Set → {}), coerce
(Date → its ISO string, via toJSON before any replacer sees it) or drop
(undefined). Covers the value types commonly passed as rpc args: primitives,
arrays, plain objects, Date, Map, Set, and bigint. Functions and symbols can't
key anything meaningful but are tagged rather than dropped so a stray one can't
silently collapse two distinct argument sets onto the same key.
*/
export function canonicalJson(value: unknown): string {
    if (value === null) {
        return 'null'
    }
    if (value === undefined) {
        return 'undefined'
    }
    const type = typeof value
    if (type === 'string') {
        return JSON.stringify(value)
    }
    if (type === 'bigint') {
        return `${value}n`
    }
    if (type === 'number') {
        // -0 and 0 stringify alike but are distinct keys; NaN/Infinity stay stable (JSON drops them to null).
        return Object.is(value, -0) ? '-0' : String(value)
    }
    if (type === 'boolean') {
        return String(value)
    }
    if (type !== 'object') {
        // function | symbol — not serialisable; tag by type so the key can't crash or alias a real value.
        return `${type}()`
    }
    if (value instanceof Date) {
        return `Date(${value.getTime()})`
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`
    }
    if (value instanceof Map) {
        // Sort by encoded entry so key order doesn't change the result.
        const entries = Array.from(
            value,
            ([key, val]) => `${canonicalJson(key)}=>${canonicalJson(val)}`,
        ).sort()
        return `Map{${entries.join(',')}}`
    }
    if (value instanceof Set) {
        const members = Array.from(value, canonicalJson).sort()
        return `Set{${members.join(',')}}`
    }
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
}
