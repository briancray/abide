---
"@abide/abide": minor
---

A served memo entry kept in `store.sqlite` or `store.redis` keeps its changes in the store's log: each change is a record — the JSON Patch it wrote, or the value whole every 64 records — and its version is that record's number. A restarted server opens the entry on the log and stands at the same version, so a page reconnecting after a deploy is sent only the patches it missed, not the value; and a second server process sharing the file hears the other's records and sends them on to its own followers, at the same versions (18.42-18.45).

A version is named without waiting on the log: the process takes the number after the last it knows, answers followers from memory, and writes the record behind it with the new `LogStore.appendAt`, which appends only where that number is still free — a Lua script in Redis, a transaction in SQLite and IndexedDB (18.46). Two processes that change the value at the same moment meet as a conflict: the one that lost applies the other's records, puts its own change on top, writes the result whole, and sends a follower holding a number it gave up the value (18.47). Once an entry is opened on its log, the store's watch no longer re-reads the value, because the log is how another process's change arrives.

**Breaking for a hand-written `LogStore`:** it must implement `appendAt(entry, expected, at)`, answering the new number, or `undefined` where the last number is no longer `expected`.
