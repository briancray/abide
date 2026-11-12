---
'@abide/abide': patch
---

A framework ambient first built inside a request — `principal`'s members, built on first access — now builds its process-wide home outside that request. Built inside it, the home derived from that request's values for the life of the process, so a read outside every request (a bare `render`, a test) answered the first caller's principal.
