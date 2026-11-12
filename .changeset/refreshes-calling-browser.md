---
'@abide/abide': minor
---

`refreshes` takes a triple, `[rpc, pattern, { caller: true }]`, which refreshes `rpc` for the browser that made the write and no other — every tab of it — as `rpc.refresh(pattern, { caller: true })` does. `caller: true` is new on `rpc.refresh` and `rpc.invalidate` too: on the server it stands for the `principal.caller` of the request it runs in, and a request carrying none (a machine's call) reaches no browser. A value that depends on who is signed in rather than on its arguments — `whoAmI` — has no pattern to name the writer's copy by, and a tag would refetch it in every browser. RULEBOOK 16.104, 18.39.
