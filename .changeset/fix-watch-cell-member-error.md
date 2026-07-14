---
"@abide/abide": patch
---

`watch(cell.foo, handler)` is now a compile error instead of a silent no-op.

abide has no per-property cells — a member access on a cell is read once as a plain value, so `watch(s.foo, handler)` subscribed to nothing and the handler silently never fired. It was only flagged by a `console.warn` (easily lost in build output). It now fails compilation with a message pointing at the corrective forms: wrap it in a thunk (`watch(() => …(s.foo))`) or watch the whole cell (`watch(s, v => …)`). A member of a cell is never itself a cell, so this can never reject a valid `watch`.
