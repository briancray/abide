---
'@abide/abide': patch
---

`pairing()`'s `status` holds `undefined` until `/__abide/pairing` first answers, busy while that read is in flight, so a page's `{:else}Connecting…` arm paints and `await status` waits for the first status. A read that failed is taken as a refused write: it is on `status.error()`, and reading `status` goes on answering what it held rather than throwing, so `status?.paired` in an attribute, a listener or an `{#if}` needs no `ready()` guard and nothing reaches `onError` (RULEBOOK 44.69). A server render holds `undefined` with nothing in flight.
