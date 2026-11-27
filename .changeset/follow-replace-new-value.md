---
"@abide/abide": patch
---

a followed copy takes a replacement the server sent as its JSON Patch (18.41) as a new value, so what a page read from it before is left as it was and each part the patch does not reach keeps its identity; an `s.patch` is still written in place — 18.49
