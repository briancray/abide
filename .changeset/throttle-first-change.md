---
"@abide/abide": patch
---

a throttled value lets its first change through at once — `reactive(x, { throttle })` then `s.set(v)` reads `v` back in the same turn, where the value it was built with had opened a window that held the first `set` back. RULEBOOK 5.12
