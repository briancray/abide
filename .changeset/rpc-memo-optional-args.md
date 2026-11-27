---
"@abide/abide": patch
---

`rpc` over a `memo` whose args are optional is called without them again, as the memo is: `rpc(memo((args?: { type?: string }) => …))()` no longer asks for its args (16.6).
