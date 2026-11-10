---
"@abide/abide": patch
---

`trace.span` stays open until a thenable its body returns settles, not only a native `Promise` — a `PromiseLike` from a client library no longer logs a 0 ms span or a 0 ms `server-timing` entry. A `Reactive` is still taken as a value and closes the span at once (24.8, 1.6).
