---
"@abide/abide": minor
---

Breaking: `fetchAndHandle` makes one request per call and takes no `timeout`, `retries` or `backoff` (54.7) — asking again is a `pipe`'s (57.9), and a deadline is `signal: AbortSignal.timeout(ms)`. `FetchFailed`'s `timeout` reason is gone, and a `FetchFailed` is transient by the status its service answered, so a `pipe` or a `memo` no longer asks again after a service's 404 (15.19). `abide upgrade` spells a `timeout` as the signal, drops `retries: 0`, and names each retry left for a pipe (38.234)
