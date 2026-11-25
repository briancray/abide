---
"@abide/abide": minor
---

A handler's body is kept per set of args whatever it declares: one declaring no parameter is kept on `undefined`, and its parameters are never read to decide. A body no longer runs again when a value it read changes; a handler serving a live derived value is `GET(computed(() => …))` (16.6).
