---
"@abide/abide": patch
---

under `mount` in `bun test`, a component's browser module calling a private handler (one its `<script server>` declares) is answered by that handler in the test's process, rather than fetching an `/abide-client:/…` address and failing with 503 — as a handler file's call already was
