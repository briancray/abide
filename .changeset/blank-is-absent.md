---
"@abide/abide": minor
---

A blank text arg for a member declared neither `string` nor a list is read as absent, or as `null` where `null` is declared (RULEBOOK 19.30): a `form`'s optional number field left empty, and a query's `?miles=`, no longer refuse as "must be number, was string".
