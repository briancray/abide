---
"@abide/abide": minor
---

`computed` is the derived value: `computed(() => seats() * price())` runs again when what it read changes, loads where its body is async, and streams where it hands back an async iterable. `memo` is now always keyed — one value per set of args, keyed on `undefined` where its body declares no parameter — and neither reads a body's parameters to decide what it builds. `abide upgrade` renames every `memo` handed a body that declares no parameter to `computed` (38.223).
