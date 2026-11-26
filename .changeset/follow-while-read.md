---
"@abide/abide": patch
---

A browser stops following a `GET`'s copy once nothing has read it for 30–60 seconds, leaving it stale so the next read fetches it and follows it again; a page no longer keeps a follow open for every copy it ever loaded (18.48)
