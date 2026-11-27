---
"@abide/abide": minor
---

`fetchAndHandle` takes `as: 'response'`, answering the `Response` itself once it is 2xx with its body unread, for a header the answer carries; a status outside 2xx still rejects with its `FetchFailed` (RULEBOOK 54.10).
