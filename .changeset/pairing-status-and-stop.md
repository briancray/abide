---
'@abide/abide': minor
---

`pairing()`'s `status` is typed `Reactive<BridgeStatus | undefined, BridgeStatus | undefined, Failed<'HttpError', undefined>>`, so `status.error()` and `status.isError(error, 'HttpError')` are typed (RULEBOOK 44.69, amended). A `pairing()` built outside a component's setup — in a click handler — now has `stop()`, also its `[Symbol.dispose]` for `using`, which stops its read and follow, its timers and `copied`'s write back; one built in a setup is still stopped with it (44.73, amended).
