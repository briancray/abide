---
"@abide/abide": minor
---

`reactive` and `computed` take a value's options alone — `schema`, `transform`, `identity`, `key` and `store` — and throw at construction on `ttl`, `throttle`, `debounce`, `tags` or `global`, which a `memo` or a handler declares and a `computed` reads (11.81). `poll` is gone everywhere: a `memo`'s `ttl` takes its place, refreshing an entry something reads once its life runs out — counted from when its last value landed — and letting go of one nothing reads (6.1-6.5). Work that must run whether or not anything reads it is a `job` writing the memo, and `App.stop` waits on a job's run in flight (54.43). `abide upgrade` rewrites a memo's or handler's `poll` as a `ttl` and notes each, along with every `reactive` or `computed` handed a source's option (38.227).
