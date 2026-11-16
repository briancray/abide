---
'@abide/abide': minor
---

`database()`'s opener carries `changed`, a `Reactive<number>` that increases when another connection — another process, or another connection in this one — commits to the file. It asks `PRAGMA data_version` once a second, only while something reads it, and never opens the file itself. Follow it with `watch(() => { db.changed(); refresh() })` to reload every value something reads. RULEBOOK 47.22, 47.23, 47.24.
