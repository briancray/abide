---
"@abide/abide": patch
---

A page's module, and every module it imports, is now evaluated outside the request that first renders it. In an executable `abide compile` writes, a module's `reactive` was built as the first request's own rather than per request, so whatever that request left — a signed-out caller's refusal — stood for every caller after it (RULEBOOK 11.67).
