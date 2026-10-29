---
"@abide/abide": patch
---

A handler's derived args schema reads a member left `undefined` as absent, so an in-process call like `getResearch({ home, topic: undefined })` is answered as the wire answers it rather than refused 422 (RULEBOOK 19.25, 15.8).
