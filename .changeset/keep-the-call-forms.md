---
"@abide/abide": minor
---

A kept call covers a real form. `reactive<typeof resetHome | typeof deleteHome>()` keeps a call of either handler — one value, its failures the union of theirs (RULEBOOK 4.19, amended). `s.then` takes one result type per arm, as `PromiseLike` does, so `saving.then(close, () => {})` type-checks whatever `close` answers: the step after a save is `saving = save(args); saving.then(onSaved, () => {})`, the refusal still on `saving.error()` (2.7, 2.8). A call is let go by keeping one nothing has made — `saving = reactive<typeof save>()` — where `saving = undefined` is a write to the call kept (11.59, 11.61, 11.16). A `Reactive` handed to `GET` as a value with a value's options is refused again now that it matches `PromiseLike` exactly.
