---
'@abide/abide': patch
---

Fix: `abide format <file>` formats the `.abide` it names instead of crashing with `ENOTDIR` — a path named is a file to format or a directory to format every `.abide` under, and the two mix in one run (RULEBOOK 38.125).
