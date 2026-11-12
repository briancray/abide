---
'@abide/abide': patch
---

`pairing()`'s `status` fails with the failure where `/__abide/pairing` does not answer, so `status.error()` carries it and a page can say the assistant is unavailable rather than wait on a status that never lands (RULEBOOK 44.69).
