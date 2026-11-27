---
"@abide/abide": patch
---

a rung reads `ctx.request` when it reads it, so a handler whose rungs never do runs in an `App.run` made without a request — 16.121
