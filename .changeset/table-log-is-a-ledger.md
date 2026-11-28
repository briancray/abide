---
"@abide/abide": minor
---

A `table`'s change log is now a ledger's log. The triggers write to `abide_table_log`, and a table's `readable` is a ledger read of it (RULEBOOK 47.42). A file a release before this one prepared has its old `abide_changes` tables and triggers dropped the first time a `table` reaches it.

`store.sqlite` gains a `watch` (58.18): a ledger kept there now hears an append another connection or process commits within about 50 ms, where before it heard nothing until its next read. Its numbering also carries on past a trim that let every entry go (58.2); before, such a trim restarted the numbers at 1.

A ledger read errors with a 410 where entries it hadn't read were let go even when nothing newer has been appended yet (58.15), and where its store answers from another file's log (58.17, through `LogStore`'s new optional `origin`).
