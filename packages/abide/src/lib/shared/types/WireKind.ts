/*
The wire codec kind for a single top-level Args field (ADR-0029). Generalizes ADR-0028's scalar
`number`/`boolean` query coercion to the structured value kinds the warm server program can name
through the type graph — a `Date` / `Set` / `Map` by symbol identity, a `bigint` by type flag.
parseArgs revives a field's plain-JSON wire form into the runtime value the handler's declared
type expects: an ISO string → `Date`, a numeric string → `bigint`, a JSON array → `Set`, a JSON
entries array (or object) → `Map`. Top-level fields only in this increment — a structured value
NESTED inside another value is not descended into. Reviving is fail-open: an unrevivable value is
left as its JSON form, never thrown, so the plain-JSON / OpenAPI contract still works.
*/
export type WireKind = 'number' | 'boolean' | 'date' | 'bigint' | 'set' | 'map'
