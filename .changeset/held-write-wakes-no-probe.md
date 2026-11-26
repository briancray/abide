---
"@abide/abide": patch
---

A write a `throttle` or `debounce` window holds behind another no longer wakes the readers of `busy`: only the first write the window holds moves the probe, so a guard reading `busy` beside the value runs once per window rather than once per write (3.3, 5.15).
