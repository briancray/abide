---
"@abide/abide": patch
---

A `Pipe` called with a signal ends its item on that signal alone, rather than on it joined to the `abortSignal()` of the place it was called from. A lane called for work many requests share — a job started in the first requester's request — no longer fails for everyone when that requester leaves; called with no signal, an item still ends where its caller's run or request does (RULEBOOK 57.13).
