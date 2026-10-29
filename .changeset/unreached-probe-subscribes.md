---
"@abide/abide": patch
---

a reader that probed a handler before its first call wakes when the call starts — on a server and under `mount`, `disabled={save.busy()}` read before any call stayed enabled for the whole write, because the unreached answer (0.116.3) subscribed the reader to nothing. It now subscribes the reader to the first call in its scope, and still builds nothing and runs no handler (RULEBOOK 3.3, 13.19)
