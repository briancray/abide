---
"@abide/abide": patch
---

A page, layout or error page a mounted package places under `/__abide` is refused at build, as the app's own is (23.17, 23.19) — before, only a mounted handler file was. An app's own `__abide` handler file is refused once rather than twice under `abide check`.
