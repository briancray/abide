---
'@abide/abide': patch
---

`url()` parses each route literal once rather than per call (1.6–2.2x per call in a `{#for}` row), an editor's check reuses the sources the app layout already parsed (~21% per check), and the language server joins a message's chunks once instead of per chunk (a 16 MB message: ~106 ms → ~4 ms).
