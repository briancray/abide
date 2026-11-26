---
"@abide/abide": minor
---

An opener's `sql` runs a statement as a tag — every value bound, one statement per call site — and answers its rows (47.32). A `table` is callable: `deals()` is every row and `deals({ stage: 'won' })` the rows matching (47.35). A run that reads a table either way is refreshed when the table changes, by a write through `sql` (once per table per turn, 47.34) or a commit from any connection, with no tag written: the tables a statement reads are the ones SQLite compiles it to read (47.33).
