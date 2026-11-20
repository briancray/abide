---
"@abide/abide": patch
---

A refusal `fetchText`, `fetchJson` or `handle` hands back keeps the service's `Retry-After`: a handler returning it answers with the same header, and a value it refused is held until then (RULEBOOK 15.23, 15.24).
