---
"@abide/abide": minor
---

Calling a handler answers what its body answers: a promise of the value that rejects with the refusal — so `await save(args)` hands back the value, and a `try`/`catch` with `save.isError(error, 'Name')` handles a refusal — or, where the body is an async generator, an async iterable of its chunks. Only `reactive` and `computed` hand back a `Reactive` now. A page reads a call as a value with `const deal = computed(() => getDeal({ id }))`: a `computed` handing a call's answer back whole adopts the handler's value, so it follows the server, takes its patches, holds an `offline` stand-in, and is busy, ready and refused exactly as the call used to be; `saving.set(save(args))` adopts it the same way. A call awaited inside a `computed` subscribes it to that value. Where a page wrote `const deal = getDeal({ id })`, write `computed(() => getDeal({ id }))` (1.1, 16.3, 16.107, 16.108).
