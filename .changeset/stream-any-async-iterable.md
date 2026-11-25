---
"@abide/abide": minor
---

A `memo` body that hands back any async iterable streams — a `ReadableStream` as well as an async generator — so `memo(() => log.read())` holds the entries a stream hands on. A run superseded cancels the stream it was reading at once, even while it waits on its next chunk. A `Reactive` handed back is still adopted, never streamed — 9.6
