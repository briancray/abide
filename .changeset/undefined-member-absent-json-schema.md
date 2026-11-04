---
"@abide/abide": patch
---

`validateJson` reads a member left `undefined` as absent, so an `args: jsonSchema(...)` gate accepts `note: undefined` where `note` is optional rather than refusing it 422, as the derived args schema already did (RULEBOOK 19.25).
