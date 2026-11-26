---
"@abide/abide": patch
---

A `memo`'s call carries the refusals its function's answer carries, so `reactive.derived(() => m(args)).error()` over a memo of a handler is typed with the handler's refusals rather than as nothing (11.12).
