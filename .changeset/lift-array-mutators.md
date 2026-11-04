---
"@abide/abide": patch
---

An array mutator called on a reactive name in a `.abide` file is a write: `tags.push(tag)`, `deal.notes.splice(0, 1)` and the rest run on a copy that the name then holds, so the page repaints (RULEBOOK 31.9). The receiver's type decides it — a class's own `push` or a `Map`'s `set` is still the value's call. ABIDE.md names `items.push(item)` as the write again.
