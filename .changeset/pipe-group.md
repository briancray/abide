---
"@abide/abide": minor
---

`pipe`'s `key` option is now `group`: `pipe(steps, { group: (contact) => contact.id, concurrency: 1 })` runs one item per group at a time, as a FIFO queue's message group does. `key` now means one thing across abide — what tells one element of a value from another.
