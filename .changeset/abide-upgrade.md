---
'@abide/abide': minor
---

`abide upgrade [--check] [--from <version>]` applies the migrations keyed to each release after `--from` to your app's own files and prints every change as a diff; `--check` prints it, writes nothing and fails where a file would change (RULEBOOK 38.198-38.201). The first migration, keyed to this release, removes from `AGENTS.md` every paragraph an earlier `abide scaffold` wrote or `ABIDE.md` holds word for word, drops a heading left empty, and puts the pointer to `ABIDE.md` under the title (38.202, 38.203). `abide check` now warns at each such paragraph (38.196, 38.197). A change to a `store`'s key or JSON, or to the shape of a request an `Rpc` sends, now reads the old form until the next minor release (8.43, 16.106).
