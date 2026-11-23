---
"@abide/abide": minor
---

Breaking: `sortRows` is replaced by `sortBy(items, value, direction?)`, a general sort: a new array of `items` ordered by the value `value` answers for each, ties kept in order, blanks last in either direction, numbers and dates compared as themselves, and text compared in abide's locale with its numerals by value, so a list the server sorts is in the order hydration sorts it (RULEBOOK 51.43-51.46, 51.48). `sortableTable` sorts its rows through it. Replace `sortRows(rows, columns, { key, direction })` with `sortBy(rows, (row) => row[key], direction)`.
