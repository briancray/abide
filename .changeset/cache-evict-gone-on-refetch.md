---
"@belte/belte": patch
---

cache: a policy refetch that hits a 404 now evicts the entry instead of retaining it — the resource is gone, so keeping the stale value made the entry immortal (every later invalidation re-fired the dead fetch). Transient failures (network errors, 5xx) still keep the stale value; a non-2xx Response from a remote refetch is no longer swapped in as fresh data.
