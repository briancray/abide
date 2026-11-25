---
"@abide/abide": minor
---

`memo(fn)` is now `fn`, remembered: a call answers what `fn` answered for those args — a value, a promise or a refusal, handed back as it was rather than as a `Reactive` — and runs `fn` only for args it has no answer for. A `computed` that calls it holds the answer as a value and runs again when that key is refreshed or invalidated (`m.refresh(pattern)`, `m.invalidate(pattern)`). An async iterable is never kept, since it is read once: a stream several readers share is `memo((args) => computed(async function* () { … }))`, and a keyed value the server patches is `memo((args) => reactive(…))`. `memo` takes `ttl`, `tags`, `global` and `args`; a value's own options (`poll`, `store`, `key`, `schema`) go on the `computed` or `reactive` it answers. A `GET` over a keyed body takes the body and its options directly: `GET((args) => …, { global: true, ttl })`.
