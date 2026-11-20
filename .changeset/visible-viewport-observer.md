---
"@abide/abide": patch
---

`observe.visible`'s shared viewport observer is disconnected with the last element it observes, as every other shared observer is, and the next bind makes one from the `IntersectionObserver` standing then (RULEBOOK 32.98).
