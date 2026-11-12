---
'@abide/abide': patch
---

An entry of a mutation's `refreshes` whose refresh fails no longer keeps the entries after it from refreshing; the first failure is still warned once on `abide:reactive` (16.102, 16.103).
