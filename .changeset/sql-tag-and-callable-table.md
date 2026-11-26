---
"@abide/abide": minor
---

An opener's `sql` runs a statement as a tag — every value bound, one statement per call site — and answers its rows (47.32). A `table` is callable: `deals()` is every row and `deals({ stage: 'won' })` the rows matching (47.35). What reads a table declares its name among its `tags`, and is refreshed when the table changes (47.29).
