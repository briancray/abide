/*
The on-wire envelope for a cross-client staleness signal (ADR-0041). A single
monomorphic shape — every field always present so the JIT keeps it a stable
hidden class — carried as the `message` of a standard socket frame on the
reserved `__abide/cache` topic.

  op    — which local verb each subscriber runs: drop (`invalidate`) or refetch
          (`refresh`).
  mode  — how `match`/`tags` select entries, mapping 1:1 onto selectorMatcher's
          three real branches: an exact call key, a fn key prefix, or a tag set.
  match — the exact cache key (`mode: 'key'`), the key prefix (`mode: 'prefix'`),
          or `''` (`mode: 'tags'`, unused).
  tags  — the requested tag list (`mode: 'tags'`), or `[]` otherwise.

Producer/closure selectors and the bare match-all form are NOT expressible here
— they are rejected at encode time (serializeSelector), so this envelope only
ever carries a cross-client-stable selector.
*/
export interface CacheStalenessFrame {
    op: 'invalidate' | 'refresh'
    mode: 'key' | 'prefix' | 'tags'
    match: string
    tags: string[]
}
