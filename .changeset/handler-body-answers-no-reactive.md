---
"@abide/abide": minor
---

A handler whose body answers a `Reactive` — `GET(() => liveValue)` — now throws on the run that answers it, as `GET(liveValue)` already threw where it was declared (16.109): the server serves a function or a `memo`. Serve the value as a memo (`GET(memo(fn, { global: true, ttl }))`), and read whether it is loading with `busy({ tags })`.
