---
"@abide/abide": minor
---

a `<name>.worker.ts` under `lib` runs its exports in a thread of their own — a `Worker` on a server and in an executable, a Web Worker in a browser — behind functions of the same name and type: an `async function*` streams a chunk per read, an `AbortSignal` argument aborts in the thread, and the app stopping ends the thread (RULEBOOK 55)
