---
"@abide/abide": minor
---

`observe.size()`, `observe.rect()` and `observe.visible()` take no target: each hands back `host` to spread and its fields read by name — `size.width`, `rect.top`, `seen.visible` — each a value of its own, `undefined` until the first reading. The target forms are unchanged. RULEBOOK 32.110.
