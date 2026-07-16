---
"@abide/abide": minor
---

`errorTtl` — opt a failed RPC load into the negative cache

By default a failed load evicts immediately so the next read retries. Setting `errorTtl` on an endpoint's `cache` policy (or a producer's `cache()` options) retains the failure for that many milliseconds instead: reads within the window re-surface the same rejection with no network round-trip — backing off a failing or rate-limited backend rather than hammering it — then the entry hard-evicts and the next read retries. The function form `errorTtl: (status) => number | undefined` returns a per-status window (`status` is `0` for a network-level fault), or `undefined` to keep the immediate-retry default for that status (e.g. back off a 429/503, retry a 500 at once). A `Retry-After` response header overrides the configured window as the authoritative delay. A negative-cached error is never shipped in the SSR snapshot, so it can't warm-hydrate a poisoned client entry.
