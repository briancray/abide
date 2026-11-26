---
"@abide/abide": minor
---

`reactive.derived` is the derived value: `reactive.derived(() => seats() * price())` runs again when what it read changes, loads where its body is async, and streams where it hands back an async iterable. `memo` is now always keyed — one value per set of args, keyed on `undefined` where its body declares no parameter — and neither reads a body's parameters to decide what it builds. `abide upgrade` renames every `memo` handed a body that declares no parameter to `reactive.derived` (38.223).
