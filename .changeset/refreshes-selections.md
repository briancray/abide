---
"@abide/abide": minor
---

A mutation's `refreshes` names selections as well as tags — `[boards, { personId }]` refreshes that one entry as `refresh(boards, { personId })` does — and its function may be `async`, run in the call's scope, so it can `await principal.resolved` to name whose entry the write changed. RULEBOOK 16.89, 16.101.
