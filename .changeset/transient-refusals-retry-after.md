---
'@abide/abide': minor
---

A refusal at 408, 425 or 429 is transient as one at 500 and above is: a `Keyed` entry or an `Rpc` runs its body again on the next reach rather than holding it for its `ttl`, so a rate limit no longer has to be rewritten as a 503. A `Retry-After` on such an answer, in seconds or as an HTTP date, holds the refusal until the time it names, and crosses the wire again with the refusal wherever it is answered on. The outbox keeps a call answered 408, 425 or 429 and waits at least its `Retry-After` before sending it again, the offline worker keeps its copy under one, and `abide call` exits 8 for one. A handler body refusing synchronously no longer runs twice per call. RULEBOOK 15.19, 15.20, 15.23, 15.24, 45.26, 45.29, 46.4, 46.21.
