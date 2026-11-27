---
"@abide/abide": minor
---

BREAKING: a `Reactive` is no longer callable — read it with `s.get()` (1.9, 31.7). Inside a `.abide` file a name still reads by name; `x()` on a name bound to a `Reactive` now calls the value it holds (31.11), the way `onsave()` on a prop already did. In a `.ts` file, `count()` becomes `count.get()`
