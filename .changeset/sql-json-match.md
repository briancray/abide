---
"@abide/abide": minor
---

A `table` call matches by JSON: a value, `null`, an array of values it is one of, or `{ gt, gte, lt, lte, ne }` comparisons met together (47.36). `sql` binds an array interpolated as `IN ${ids}`, an empty one matching nothing (47.37). A read-only database is still read by a `table` call and by `sql`, its stopped watch said once (47.38).
