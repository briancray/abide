---
"@abide/abide": minor
---

A `table` is written with SQL's words. `set` is renamed `upsert` and `patch` is renamed `update`, so a table's writes read `insert`, `upsert`, `update` and `delete`, the way a ledger says `append`. An `rpc` over a table sends `upsert` as `PUT` and `update` as `PATCH`, and a browser's copy has the same two names (RULEBOOK 16.117, 47.30).
