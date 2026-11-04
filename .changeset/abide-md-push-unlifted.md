---
"@abide/abide": patch
---

ABIDE.md no longer tells an agent to grow a list with `items.push(item)`: a mutator call is not lifted yet (RULEBOOK 31.9), so the push wakes nothing. It names `items = [...items, item]` or `items.patch(…)` instead.
