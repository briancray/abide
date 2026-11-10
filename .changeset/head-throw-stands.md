---
"@abide/abide": patch
---

A `<head>` whose markup throws (a `<title>` reading a failed load) now stands as it last read and is reported once, rather than throwing out of every later head reconcile — a navigation, a component leaving — for as long as it stays mounted (39.20).
