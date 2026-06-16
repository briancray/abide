/*
The selector-prefix grammar shared by selectorMatcher and the cache store's
scoped lifecycle marks: a prefix owns its exact key plus arg-bearing
extensions — `?` (GET/DELETE query args) or ` ` (canonical-json body /
producer args) — so `GET /a` never matches `GET /ab`.
*/
export function keyMatchesPrefix(key: string, prefix: string): boolean {
    return key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix} `)
}
