---
"@abide/abide": patch
---

A worker call's `AbortSignal` now ends the call's thread the moment it aborts, rejecting the call with the signal's reason — a loop that never yields stops all the same — and a call whose signal has aborted already, or made where `abortSignal()` has, starts no thread. A signal handed to a call is what it ends on, in place of the request's or run's, as a pipe's item does: work many requests wait on is no longer the first requester's to end. The export is handed a signal that never aborts in its place (RULEBOOK 55.6, 55.8).
