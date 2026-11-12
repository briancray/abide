---
'@abide/abide': minor
---

`pairing()`'s `status` is in flight until `/__abide/pairing` first answers, so `await status` (or `status.then`) waits for the first `BridgeStatus` and rejects with the read's failure where it failed; it is typed `Reactive<BridgeStatus, BridgeStatus, Failed<'HttpError', undefined>>`, so `status.error()` and `status.isError(error, 'HttpError')` are typed and a page no longer guards an `undefined` that only meant "not yet". A server builds it holding nothing and with nothing in flight, so a render neither paints it nor waits on it (RULEBOOK 44.69, amended). A `pairing()` built outside a component's setup — in a click handler — now has `stop()`, also its `[Symbol.dispose]` for `using`, which stops its read and follow, its timers and `copied`'s write back; one built in a setup is still stopped with it (44.73, amended).
