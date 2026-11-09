---
'@abide/abide': patch
---

`onError` from `@abide/abide` throws where it could never file — a `<script server>`, a server module, a module's top level, a later callback — naming `@abide/abide/server`'s, rather than doing nothing (RULEBOOK 37.21).
