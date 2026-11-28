---
"@abide/abide": minor
---

A `table` called is a plain read: the memo, computed or handler that calls it no longer reloads when the table changes (RULEBOOK 47.48). What a table's change refreshes is the `GET` of an `rpc` over that table, so every browser following it is sent the new rows after any commit, whichever connection made it (47.26). `table`'s `peek` is gone, since a call now does what it did. `database`'s `changed` is gone too. To refresh a value that reads a table some other way, give it a tag and refresh that tag from the table's `readable`, e.g. `targets.readable.pipeTo(new WritableStream({ write: () => refresh({ tags: ['targets'] }) }))`, or from the write's `refreshes`.
