---
"@belte/belte": minor
---

Add `page.navigating` — a boolean on `belte/browser/page` that is true while a pathname-changing SPA navigation resolves its view, and false otherwise (always false during SSR). Read it inside a `$derived`/`$effect` to drive loading indicators.
