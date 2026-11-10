---
"@abide/abide": patch
---

A blank `ABIDE_MAX_LOG_BUFFER_COUNT=` falls back to the default buffer rather than reading as 0 and keeping no log records.
