---
"@abide/abide": minor
---

`rpc` over a `memo`, a `table`, a `job`, a `pipe` or a `ledger` answers its whole face: its read by `GET`, and each write by its own verb — a memo's `set`, `patch` and `refresh`, a table's `set`, `patch` and `delete`, a job's `run`, a pipe's `push`, a ledger's `append` — in process on the server and sent from a browser's copy (16.117). `columns` narrows what a table's `rpc` reads and writes (16.118). A `table` is written by key with `set`, `patch` and `delete`, refreshing its tag at once (47.33, 47.34). Every `.server.ts` exporting an `rpc` answers at its own path, a `lib` directory's among them, and one exporting none is a module (16.2, 16.73). A browser import of a server file's export that is no `rpc` is refused in abide's words (16.29).
