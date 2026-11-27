---
"@abide/abide": patch
---

each test under `@abide/abide/test` is one browser session, signed out as it starts — a test or a mounted component's call signs it in with `principal.set`, and `principal`, `cookies`, `request` and a handler's rungs read it outside every request; `settled` no longer waits on a value nothing reads whose load waits on nothing — 38.236, 38.204
