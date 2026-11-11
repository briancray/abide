---
'@abide/abide': minor
---

Keep the call: a form holds the `Reactive` its write's call hands back instead of awaiting it in a `try` and copying the outcome out.

- `reactive<typeof save>()` is typed as the value a call of `save` is — its value and its failures, `HttpError` and the `ValidationError` included (RULEBOOK 4.19) — so `saving = save(args)` type-checks and `saving.isError(saving.error(), 'Name')` narrows with no cast.
- New probe `s.issues()`: the `data` of the standing `ValidationError`, typed `Issues<Args>` over a call, or `undefined` when none stands (RULEBOOK 3.15).
- Fix: adopting a `Reactive` that has already failed, such as a call its `args` gate refused at the call, now wakes the readers of `s.error` (and `s.issues`). Before, `{saving.error()}` never heard that refusal.
