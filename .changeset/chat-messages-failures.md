---
"@abide/abide": patch
---

`chat`'s `messages` takes a `Reactive` with any failures, so one adopting a handler's call — which carries `HttpError` — binds without a cast. While it is failed, `failed` is its failure's message and the composer sends nothing (RULEBOOK 53.47).
