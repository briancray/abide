---
"@abide/abide": patch
---

`abide check` names a file that `declare module`s an `@abide/` entry while importing and exporting nothing: such a file replaces the module for the whole program, and every import of it read as missing with nothing pointing at the cause (RULEBOOK 38.212)
