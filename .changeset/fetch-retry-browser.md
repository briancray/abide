---
"@abide/abide": patch
---

`fetchAndHandle` retries in a browser: the wait between attempts is a timer rather than `Bun.sleep`, and a relative address it logs is read against the page's
