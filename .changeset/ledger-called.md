---
"@abide/abide": minor
---

Calling a ledger reads it: `calls()` / `calls(after)` / `calls({ cursor: 'scorer' })` answers the stream `calls.read(...)` did, and `read` is gone. A ledger is no longer a `Reactive` of its entries — it holds no copy of what its store keeps and asks the store nothing until it is appended to or read (58.8), so one only appended to and read by a cursor costs no memory for its log. A page that wants the entries as a value hands the read to a body: `memo(() => calls())`, `global` where many readers share one read. Serve it across the wire as a streaming `GET` that yields `calls(after)`. Its docs page moves to Orchestration, beside `pipe`.
