---
"@abide/abide": patch
---

the rulebook now states that the effects one turn wakes, a slot's own update among them, run in no guaranteed order (12.15) — a `watch` that post-processes what a sibling `{raw(...)}` slot renders cannot count on the slot having updated first
