---
"@abide/abide": patch
---

a store miss that falls back to the initial value no longer writes it back through `set`, so a server render no longer overwrites a browser's store with the default — 8.8
