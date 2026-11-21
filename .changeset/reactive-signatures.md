---
"@abide/abide": patch
---

`reactive` has three signatures where it had ten — a value, a body, and nothing written yet — with fewer overloads and the same inference: a body's key, stream and adopted failures are read off the body by one signature. Spelling `args` on a body that declares no parameter is now a compile error (RULEBOOK 11.41), and `reactive<T[]>(() => …)` types its value as `T[]` where it read a stream of `T[]` chunks.
