---
"@abide/abide": minor
---

Remove the durable outbox and other unreachable surface — a tighter core

**Breaking:** the durable-delivery outbox is gone. The `@abide/abide/ui/outbox` export (`outbox()`, `outbox.retry()`, `GlobalOutbox`), the `outbox: true` rpc option (POST/PUT/PATCH/DELETE), the reserved `kind: 'queued'` error, and `OutboxEntry` are all removed. A mutating rpc now simply fetches and throws; durable local-first delivery is left to userspace (wrap the call, park failures in your own persisted queue via `fn.raw`). `RemoteFunction` loses its `Durable` type parameter and `.outbox` face; `remoteProxy`'s `DurableOptions` is renamed `RemoteProxyOptions`.

Removing outbox also drops the client persistence stack it was the only caller of (`persist`, `localStoragePersistence`, `PersistenceStore`/`PersistHandle`) and a whole build-time type-query (`outboxForModule`) from the warm server program.

Alongside it, several never-wired internals were deleted: the withdrawn `Scope` capability methods (`record`/`persist`/`broadcast`/`undo`/`redo`/`canUndo`/`canRedo`) and their `history`/`sync` backends, the unused `Scope.child`/`Scope.root` tree helpers, and the per-patch `PatchEvent.inverse` pre-image (computed on every mutation but read by nothing since the journal left). No behavioural change for app code that didn't use these.
