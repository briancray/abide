---
"@abide/abide": minor
---

`memo` takes `staleIfError`: an entry whose `ttl` runs out with nothing subscribed is kept that much longer, and the call that reaches it revalidates it in place, answering what it held where the revalidation fails — 6.6, 6.7, 6.8, 6.9. A memo's call takes `{ signal }` as an `Rpc`'s does, so a run every caller left is ended, its `abortSignal` with it — 11.83, 11.84, 7.23. And a call of either whose signal aborts is refused `Aborted` at once, while the load goes on for the calls that remain — 16.120
