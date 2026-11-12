---
"@abide/abide": minor
---

A sign-in or sign-out refreshes everything every tab of the browser reads, not only `principal`: a call whose handler ran `principal.set` or `principal.clear` has each tab refresh every value it holds save a `global` one, each serving what it holds until the new caller's answer lands, so a page no longer refreshes its per-user reads by hand after one. A `GET` that signs in reloads `principal` alone, since a `GET` is what the refresh calls. A value the server painted settled is now reached by a bare `refresh` too. RULEBOOK 26.24, 13.6.
