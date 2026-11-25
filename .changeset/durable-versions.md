---
"@abide/abide": minor
---

A served memo entry kept in `store.sqlite` keeps its changes in the store's log: each change is a record — the JSON Patch it wrote, or the value whole every 64 records — and its version is that record's number. A restarted server opens the entry on the log and stands at the same version, so a page reconnecting after a deploy is sent only the patches it missed, not the value; and a second server process sharing the file hears the other's records and sends them on to its own followers, at the same versions (18.42-18.45). A store whose log answers a promise (`store.redis`, `store.indexedDB`) keeps the in-process versions it had.
