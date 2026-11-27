---
'@abide/harness': patch
---

The DOM preload empties a file input on its form's `reset()`, as a browser does — happy-dom kept the files picked, so a form starting over after its call left the file standing under `bun test` (43.48).
