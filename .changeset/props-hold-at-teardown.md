---
"@abide/abide": patch
---

A prop read while its component is torn down answers the value it last answered, rather than reading its caller's expression again against the write that removed it — a disposer calling back with `marker.id` no longer throws where the caller passed `markers.find(…)` and the marker is gone (33.28). A prop first read at teardown still reads its caller's expression (33.29).
