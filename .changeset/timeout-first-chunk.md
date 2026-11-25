---
"@abide/abide": minor
---

A handler's `timeout` (and `ABIDE_RPC_TIMEOUT`) now bounds its answer, or a stream's FIRST chunk — a stream that has begun keeps its own pace, so a live feed waiting on its next event (a chat, a ticker, a ledger's tail) is no longer ended with a 504 for going quiet — 16.59
