---
"@abide/abide": patch
---

`fetchJson` and `fetchText` wait out a retry by the same rule the outbox and the socket mux do: the step doubled from 250 milliseconds, or the answer's `Retry-After` where that is later. A `Retry-After` sooner than the step no longer shortens the wait (RULEBOOK 54.10).
