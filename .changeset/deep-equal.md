---
"@abide/abide": minor
---

Breaking: `structural` is renamed `deepEqual`. `{ identity: structural }` becomes `{ identity: deepEqual }`; what it compares is unchanged — arrays and plain objects by contents, and "not equal" for anything else, a `Map`, a `Date` or a class instance (RULEBOOK 5.5).
