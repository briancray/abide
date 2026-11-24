---
"@abide/abide": minor
---

Breaking: `Router` from `@abide/abide/routing` no longer carries `region`. Nothing read it; the page region is `LevelChain`'s, and a test that needs it finds it in the document.
