---
"@briancray/belte": minor
---

`cache()` gains an `invalidate` option — `{ throttle: ms }` or `{ debounce: ms }` — that controls how a `cache.invalidate` hit on the key is applied, coalescing invalidation-driven refetches so a burst of invalidations (e.g. a socket spraying updates) no longer fires a burst of underlying calls. `throttle` refetches on the leading edge then at most once per N ms while invalidations keep arriving; `debounce` refetches only after N ms of quiet. Both keep serving the existing (stale) value until the refetch resolves — stale-while-revalidate — and affect only the refetch-after-invalidate, leaving the first fetch and arg-change fetches immediate. Set at most one. Input-debounce (search-as-you-type, where the args change every keystroke) is deliberately not this — debounce the reactive value feeding the args instead.
