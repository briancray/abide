/*
The value-directed wire ENCODE step for a rpc response body (ADR-0029 output path). A
`JSON.stringify` replacer that rewrites the structured runtime values plain JSON can't carry into
their honest-JSON wire form, so `json()` never drops a `Set`/`Map` to `{}` or throws on a `bigint`:

  - `bigint`  → its digit string (plain JSON.stringify throws on a bigint)
  - `Set<T>`  → a JSON array of its values (plain JSON.stringify emits `{}`)
  - `Map<K,V>`→ a JSON array of `[K,V]` entries (uniform, carries non-string keys)

A `Date` needs no branch — its native `toJSON` already rewrote it to an ISO string before the
replacer runs. Value-directed (not type-directed), so it runs for EVERY client — a non-abide caller
(curl / an OpenAPI SDK) receives the same honest JSON the projected schema (`jsonSchemaForType`)
describes. It is naturally recursive: a returned array/object member surfaces through the same
replacer, so a `Set` nested inside an object still encodes. Never throws — an ordinary value falls
through untouched.
*/
export function wireJsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
        return value.toString()
    }
    if (value instanceof Set) {
        return [...value]
    }
    if (value instanceof Map) {
        /* A Map iterates as `[key, value]` pairs, so the spread yields the entries array the
           client output plan (and the projected schema) expects. */
        return [...value]
    }
    return value
}
