---
"@abide/abide": minor
---

A `pipe`'s `backoff` function is handed what the attempt before the retry failed with — the refusal it answered or what it threw — beside the retry's number, so a 429 can wait longer than a 503 (RULEBOOK 57.10). A third party's `Retry-After` already reaches a pipe through `fetchAndHandle`'s `FetchFailed`, and is now proved to.
