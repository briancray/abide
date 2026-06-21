---
"@abide/abide": patch
---

fix(dom): skip control-flow rebuild when the end marker is detached. An effect for a `when`/`switch` block could fire one final time after an enclosing await/each block tore its branch down in the same microtask flush (before the owner scope disposed it), making `fillBefore` insert a fragment before a parentless comment — `HierarchyRequestError: The operation would yield an incorrect node tree`. `fillBefore` now bails when `end.parentNode` is null.
