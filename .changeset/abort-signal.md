---
"@abide/abide": minor
---

Breaking: `stopSignal` is renamed `abortSignal`, and answers the innermost owner of the work it is called in. In a `memo` run it is still that run's own signal. On the server that now holds after the body's `await`s too, and a continuation of a run already replaced is handed a signal that is already aborted. Called in a request outside a run, it is the request's signal, which aborts when the caller hangs up. A run filed in a request aborts with that request. In a browser, read it before a body's first `await`; after one it is the app's (RULEBOOK 7.38, 7.39, 7.45-7.49). A worker thread and a `pipe` step now end on that same signal, so on a replaced run or a request whose caller left too (55.8, 57.13).
