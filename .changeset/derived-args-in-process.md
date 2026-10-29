---
"@abide/abide": patch
---

a handler whose args schema is derived from its type annotation (no `args` gate) now refuses bad args in process as it does over the wire — a direct call, a call from another handler or `app.run`, and every call under `mount` answer 422 `ValidationError` with the same `Issues` before the body runs, where before the body ran with the bad value
