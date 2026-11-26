---
"@abide/abide": minor
---

`abide upgrade` keeps an `isFailed` check on a `fetchData` answer firing: where the answer is a name the file hands `isFailed`, the renamed `fetchAndHandle` call catches its `FetchFailed` back into the answer, as `fetchData` resolved with it (38.225). What a migration changes the meaning of and cannot rewrite — a `ttl` the call no longer takes, a call in a file that checks a failure whose answer it cannot follow — is printed after the diffs as its path and line, with what to do there (38.226).
