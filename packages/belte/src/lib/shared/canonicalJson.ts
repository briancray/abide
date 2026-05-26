/*
Stable JSON stringify: object keys are sorted recursively so equivalent values
produce identical strings regardless of insertion order. Non-JSON values
(functions, symbols) are dropped the same way native JSON.stringify drops them.
Used to derive deterministic cache keys from explicit-key overrides and from
auto-keyed POST/PUT/PATCH bodies. Walks the value once using JSON.stringify's
replacer so no intermediate copies are allocated per level.
*/
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, sortedKeysReplacer)
}

function sortedKeysReplacer(_key: string, value: unknown): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value
    }
    const record = value as Record<string, unknown>
    const sortedKeys = Object.keys(record).sort()
    const sorted: Record<string, unknown> = {}
    for (const key of sortedKeys) {
        sorted[key] = record[key]
    }
    return sorted
}
