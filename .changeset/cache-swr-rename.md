---
"@abide/abide": minor
---

feat(cache): rename the cache invalidation-policy option from `invalidate` to `swr` (stale-while-revalidate). `swr: true` keeps the entry and refetches in the background on a `cache.invalidate` hit — the stale value stays visible and `refreshing()` reports the in-flight reload — instead of dropping the entry to `pending()`. An optional window coalesces a burst of invalidations: `swr: { throttle: N }` refetches on the leading edge then at most once per N ms, `swr: { debounce: N }` refetches only after N ms of quiet. `cache()` still throws at wrap time on throttle+debounce set together, on `ttl: 0`, and on a non-replayable remote method. Replaces the former `invalidate: { throttle, debounce }` option (same coalescing semantics, clearer name).
