---
"@briancray/belte": minor
---

`cache()` gains a `scope` option, and `cache.invalidate({ scope })` drops every entry sharing that tag in one call. `cache.invalidate` now takes `() | (fn) | ({ key?, scope? })`.
