---
"@abide/abide": patch
---

`abide upgrade`'s 38.215 migration adds `memo` to the import of abide's `reactive`, never to a `reactive` the file imports from a module of its own.
