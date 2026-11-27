---
"@abide/abide": patch
---

each test under `@abide/abide/test` is one browser session, signed out as it starts — a test or a mounted component's call signs it in with `principal.set` and the next call is that member; a mounted component no longer opens a session of its own — 38.236
