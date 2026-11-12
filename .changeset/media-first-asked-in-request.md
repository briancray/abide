---
'@abide/abide': patch
---

`media(query)` first asked inside a request — a page's server render, in a test process that also mounts components — answers the browser's `matchMedia` outside it again, rather than the server's `false` for the rest of the process: the one value per query is built outside every request wherever it is first asked (RULEBOOK 23.30).
