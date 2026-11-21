---
"@abide/abide": patch
---

Fewer overloads, same inference: `reactive` has three signatures where it had ten — a value, a body, and nothing written yet — and `GET`, `POST`, `PUT`, `PATCH` and `DELETE` three where they had nine — a body, a `Reactive` or `Keyed` already built, and a value. A body's key, its stream and what it adopts are read off the body by one signature. One call types differently: `reactive<T[]>(() => …)` types its value as `T[]` where it read a stream of `T[]` chunks.
