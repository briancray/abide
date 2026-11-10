---
"@abide/harness": patch
---

`testRows` stops a test file still running ten minutes after it started and reports it as `broken`, rather than leaving its row at `running` for as long as the reader watches (43.27).
