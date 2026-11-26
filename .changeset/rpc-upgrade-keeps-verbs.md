---
"@abide/abide": patch
---

`abide upgrade`'s move to `rpc` (38.231) no longer widens an address: a `GET` over anything it cannot see is a function, a memo or a plain value — a table, a job, a pipe, a ledger, an imported name — keeps `methods: ['GET']`, where a bare `rpc` could also answer that value's writes (16.117). In a `<script server>`, such a `GET` is noted rather than exported bare, to be moved to a server file beside the component. `methods` is written into multi-line options on a line of its own, as a formatter would.
