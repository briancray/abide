---
"@abide/abide": patch
---

A client bundle that never queues a write no longer carries the outbox: its busy probe is installed by the queue rather than on import, so an app with no handlers drops it (38.94).
