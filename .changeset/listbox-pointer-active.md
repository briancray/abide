---
"@abide/abide": patch
---

A pointer moving over a `listbox` option makes it active without moving to it: it stays active until the listbox next moves to a key or `selected` is written, and a single-select `aria-selected` names the key moved to rather than the option under the pointer (RULEBOOK 51.1, 51.94).
