---
"@abide/abide": patch
---

`disclosure`, `resizable`, `stepper` and `chart` check their parts while developing, as the other headless components do: an `aria-controls` or `aria-describedby` naming an element that is not there warns once on `abide:parts` (49.7). `accordion` and `clamp`, built on `disclosure`, check with it.
