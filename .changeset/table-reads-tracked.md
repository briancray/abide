---
"@abide/abide": minor
---

Breaking: a change to a table refreshes the values whose last run called that table, and the browser copies of a handler a run of which called it — no longer every value whose `tags` name the table. A read through `sql` follows nothing: tag it, and refresh the tag from what writes (47.29, 47.39)
