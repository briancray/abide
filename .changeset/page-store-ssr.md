---
"@belte/belte": patch
---

fix: make the `page` store readable during SSR. It was a raw module singleton — empty server-side (and unsafe to populate, since one singleton would leak across concurrent/streaming renders), so layout-scoped components couldn't read `page.route`/`page.params`/`page.url` on the server (e.g. active-link styling rendered wrong). `page` is now a getter proxy over a side-registered resolver, mirroring the cache store: the server entry installs a request-scoped resolver backed by the AsyncLocalStorage request store, the client entry installs the module singleton.
