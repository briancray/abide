---
"@abide/abide": patch
---

a global production's `Direct` duration is timed from before the call, so the body's work before its first await is counted (RULEBOOK 21.15)
