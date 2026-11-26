---
"@abide/abide": minor
---

`reactive.share(key, create)` is `reactive.shared(create)`, a handle declared once — usually at module level, `export const cart = reactive.shared(() => [] as Line[])` — and called where the value is wanted: `cart()` hands back the value the nearest component above holding one holds, or one created in the calling component (10.1-10.7). `create` answers the opening value, held in a `reactive`, or a `Reactive` handed back as it is. Handles are told apart by identity, so string keys, their literal-key build check and the declaration-merged `Shared` interface are gone; `Shared<Value>` is now the handle's type. `abide upgrade` turns a key one file uses alone into a handle declared at that file's module level, and notes every call of a key several files share, which should all import one exported handle (38.229).
