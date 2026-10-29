---
"@abide/abide": patch
---

markdown imported `with { type: 'text' }` into an app's `.ts` now checks as a `string` under `abide check`, as it already did in a `.abide` — no more hand-written `declare module '*.md'`
