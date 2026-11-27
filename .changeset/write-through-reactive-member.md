---
"@abide/abide": patch
---

A write through a member typed as a `Reactive` is that member's: `buffer.values[kind] = path`, where `buffer` is a prop or a `Reactive` and `values` a `Reactive` member, writes `values` (31.8, 31.15) rather than writing the whole path through `buffer` as well, which compiled to two overlapping writes and threw. A `{#for}` row's item is bound as a `for…of` binds one, a name or a destructuring pattern (32.116).
