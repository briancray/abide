---
"@abide/abide": patch
---

A derived value that reads only a probe (`memo(() => x.busy() ? … : …)`) now wakes a guard over its own `busy()` / `ready()` when that probe moves, and its `debounce` / `throttle` holds the run the move marks — the probe walk reaches it as a value's change does (RULEBOOK 3.2, 5.11).
