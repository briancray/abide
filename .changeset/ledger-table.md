---
"@abide/abide": minor
---

`ledger(name, { store, retain, schema })` keeps events appended and never coalesced: `append(entry, { key })` numbers each one past the last (a key already appended keeps nothing), `read(from)` hands on every entry past a position in order and waits for the next, and `read({ cursor })` resumes where that cursor's reader left off — an entry counts as done once its reader asks for the next. `writable` appends what is piped to it, and `head` is the last entry's number. `store.sqlite` and `store.indexedDB` keep a ledger as one record per entry, with its cursors beside them, and an append another tab makes to an IndexedDB ledger moves this tab's `head` and wakes its reads. A ledger crosses the wire as a streaming `GET` that yields `read(after)` and a `POST` that appends with a key the page makes, so an outbox resend keeps one entry.

`table(database, name, { key })` from `@abide/abide/server` is a SQLite table as a stream pair: `readable` hands on every insert, update and delete committed after it is first read — captured by triggers in the writer's own transaction, whoever wrote it — and `writable` upserts rows by `key`, a turn's writes in one transaction. A change to the table refreshes every value whose `tags` name it.
