---
"@briancray/belte": minor
---

When `PORT` is unset, the server now binds the first open port at or above 3000 instead of hardcoding 3000, so a second app boots without colliding. An explicit `PORT` is still honored as-is.
