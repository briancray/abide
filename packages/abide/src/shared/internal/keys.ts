// How a keyed `memo` addresses a slot, and how a bulk verb decides a slot matches a pattern.
//
// One function builds the key and the SAME function compares a pattern field, which is the whole
// point of the file: comparing pattern fields with `===` would silently never match an object-valued
// field, since the pattern's copy is a different object however equal it looks.

import { hasFile, isFile } from './probes.ts'

/**
 * A stable key for an args object; sorted so {a,b} and {b,a} address one slot.
 *
 * The key is only ever compared against another key and never parsed back, so its whole contract is
 * that args which should share a slot produce the same string and args which should not produce
 * different ones. That is what lets the ordinary shape — a handful of names over primitive values —
 * skip `Object.entries` + `sort` + `JSON.stringify`, which measured 317 ns and WAS the cost of a
 * keyed-memo cache hit, against 4 ns for the `Map.get` it wraps.
 *
 * Every field is written length-prefixed and tagged with its `typeof`, which is what keeps the
 * concatenation unambiguous: without the length `{ ab: 'c' }` and `{ a: 'bc' }` glue into one
 * string, and without the tag `{ id: 1 }` and `{ id: '1' }` address one slot.
 */
export function keyOf(args: unknown): string {
    if (args === undefined || args === null) return ''
    if (typeof args !== 'object') return String(args)
    const record = args as Record<string, unknown>
    const keys = Object.keys(record)
    // Sorted HERE, because the other caller of `sortedKey` reaches it past the insertion sort below
    // and would otherwise pay `Array.sort` over an array already in order.
    if (keys.length > 8) {
        keys.sort()
        return sortedKey(record, keys)
    }
    // Insertion order is not the key's order. An insertion sort over a handful of names beats
    // `Array.sort` and, unlike `Object.entries().sort()`, allocates nothing beyond this array.
    for (let i = 1; i < keys.length; i++) {
        const name = keys[i] as string
        let at = i - 1
        while (at >= 0 && (keys[at] as string) > name) {
            keys[at + 1] = keys[at] as string
            at--
        }
        keys[at + 1] = name
    }
    // A leading marker, so `{}` and `undefined` stay two different keys.
    let out = '{'
    for (let i = 0; i < keys.length; i++) {
        const name = keys[i] as string
        const value = record[name]
        const type = typeof value
        // `null` reports `object`, so it takes the long way with everything else that is not a
        // primitive. That branch is what JSON is genuinely needed for.
        if (type === 'object' || type === 'function' || type === 'symbol') return sortedKey(record, keys)
        const text = String(value)
        out += `${name.length}:${name}${type}${text.length}:${text}`
    }
    return out
}

/**
 * A file has no JSON form — `JSON.stringify` writes `{}` for one — so two calls carrying different
 * files would address ONE slot, and the second upload would be answered with the first's result.
 *
 * Identity is the only honest key for a stream of bytes: two files with the same name and length are
 * not the same file, and reading them to find out is not something building a cache key may do. So
 * each one is tagged once and remembered, weakly, for as long as the caller holds it.
 */
const FILE_KEYS = new WeakMap<object, string>()
let files = 0

function tagged(_key: string, value: unknown): unknown {
    if (!isFile(value)) return value
    let held = FILE_KEYS.get(value)
    if (held === undefined) {
        held = `file#${files++}`
        FILE_KEYS.set(value, held)
    }
    return held
}

/** `keys` arrives ALREADY ordered — both callers sort before reaching here, by two different routes. */
function sortedKey(args: Record<string, unknown>, keys: string[]): string {
    const entries: [string, unknown][] = []
    // The walk the entries need anyway also answers whether the replacer is wanted. A keyed memo
    // asks for this key on every HIT, and a replacer costs a callback per key in the whole graph to
    // find the file that a call which declared none does not have.
    let carries = false
    for (const name of keys) {
        const value = args[name]
        entries.push([name, value])
        if (!carries && hasFile(value)) carries = true
    }
    return carries ? JSON.stringify(entries, tagged) : JSON.stringify(entries)
}

/**
 * Compile a pattern ONCE, then ask it about each slot.
 *
 * A bulk verb walks every slot a caller holds, and the pattern is the same for all of them — so
 * `Object.entries` over it, and `keyOf` of each value it wants, belong outside that loop. Asked per
 * slot instead, five hundred slots meant five hundred entries arrays and a thousand keys built to
 * answer a question about one small object: 235 ns a slot, against 20 ns for a hand-written cache
 * that decided up front what a group was.
 *
 * No pattern means every slot, and that case does not even look at the args.
 */
export function matcher(pattern: unknown): (args: unknown) => boolean {
    if (pattern === undefined) return () => true
    if (typeof pattern !== 'object' || pattern === null) {
        const wanted = keyOf(pattern)
        return (args) => keyOf(args) === wanted
    }
    const names = Object.keys(pattern as Record<string, unknown>)
    const wanted: string[] = []
    for (const name of names) wanted.push(keyOf((pattern as Record<string, unknown>)[name]))
    return (args) => {
        if (typeof args !== 'object' || args === null) return false
        const record = args as Record<string, unknown>
        for (let i = 0; i < names.length; i++) {
            if (keyOf(record[names[i] as string]) !== wanted[i]) return false
        }
        return true
    }
}
