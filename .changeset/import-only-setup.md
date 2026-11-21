---
"@abide/abide": patch
---

A component whose `<script>` holds only imports no longer pays for a setup on every mount: the client opens no `Scope` and no `try` for it, and the server renders it once rather than counting its calls (RULEBOOK 41.6).
