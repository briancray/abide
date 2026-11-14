---
"@abide/abide": patch
---

`abide check` refuses a property an imported or local reactive's `set` does not take in an object literal written to it by name (`question = { text, stale: 1 }`), as TypeScript does for an assignment — RULEBOOK 31.18. A whole value of the wrong type written by name is now reported as TS1360 at the value rather than TS2345.
