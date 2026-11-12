---
'@abide/abide': patch
---

A `reactive` body that fails while it still serves only its opening `undefined` now fails outright: a read throws the failure and every value built on it hears it (RULEBOOK 2.2). The opening was held as if it were a value, so a value derived before the failure — `reactive(() => pairing().status())`, say — never reran and stood not ready with no `error()` for good, where the same value derived after the failure threw it.
