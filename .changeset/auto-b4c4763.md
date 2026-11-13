---
"@abide/abide": minor
---

`native()` answers the version of the native app whose window a request came from, and `undefined` in a browser, on the CLI and outside a request. The window, and the menu bar extra's panel, append `abide-native/<version>` to the user agent of every request they make, so a server render and its hydration read the same answer (RULEBOOK 38.140, 38.141). It decides what a page shows and never who may do what: any client can send that user agent.
