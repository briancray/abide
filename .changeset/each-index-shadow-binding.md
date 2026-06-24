---
'@abide/abide': patch
---

`abide check`: declare the `each` `index` binding in the type-check shadow

`index="i"` (0.41.0) was bound in the build and SSR passes but not in the shadow the
type-checker reads, so `{i}` in a row body false-positived "Cannot find name 'i'". The
shadow now declares the index as a `number` inside the loop body, matching the runtime.
