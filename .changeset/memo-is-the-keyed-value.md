---
"@abide/abide": minor
---

A `memo` and a handler are one keyed mechanism: `GET(fn, options)` serves `memo(fn, options)` at an address, and `GET(m)` serves the memo `m`. A `memo` call answers a promise of its value for those args — even for a function that answers one synchronously — or the stream of its chunks, and a `reactive.derived` handing it back whole holds the live value. Its owner writes and follows a key directly: `m.set(args, value)`, `m.patch(args, mutate)` and `m.readable(args)` — and so does a handler's, past every rung: `feed.patch({ account }, (entries) => entries.push(row))` reaches every page following that account's feed. `memo` takes `poll` and `key` beside `ttl`, `tags`, `global` and `args` (11.2, 11.76, 11.77).
