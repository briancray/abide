---
"@abide/abide": minor
---

`TypeSession` (from `@abide/abide/compiler`) no longer carries `hold`, `projectWith` or `projectionOf`. Every analysis now asks the shadow program through one `ShadowHost`, which owns the snapshot a question runs against, so a caller no longer holds the session and reaches for a raw project by hand.
