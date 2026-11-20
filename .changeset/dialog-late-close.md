---
"@abide/abide": patch
---

A `Dialog` shut in code and opened again before the browser reported the close stays open: the late `close` no longer writes `false` to `open` (RULEBOOK 50.2).
