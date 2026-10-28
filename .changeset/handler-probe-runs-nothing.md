---
"@abide/abide": patch
---

a handler no call has reached is not busy, and asking runs nothing — on a server, `save.busy()` over a never-called `POST(async () => …)` ran the write and reported it in flight; it now answers as a handler with no entries (`busy` false, `ready` and `synced` true), for a `GET` with no args as well. A probe over a mutation a `refresh()` invalidated no longer sends the write again (RULEBOOK 3.14, 13.19)
