---
"@abide/abide": minor
---

Breaking: a change to a table refreshes the values whose last run called that table — no longer every value whose `tags` name the table. A handler serving a table's rows to browsers live is `global`, as a table's own `rpc` is; a read through `sql`, or a view narrowed to its caller, follows nothing on its own: tag it, and refresh the tag from what writes (47.29)
