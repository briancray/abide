---
"@abide/abide": patch
---

`readOnly({ allow })` lets a write through to an allowed handler when the app is served under a sub-path too; it used to refuse every write there (RULEBOOK 54.6).
