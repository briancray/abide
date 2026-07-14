---
"@abide/abide": patch
---

Fix the JS semantics of reactive-state mutation expressions so `{ }` code behaves like plain TypeScript.

- **Logical assignments now short-circuit.** `count ??= 5` / `x ||= v` / `x &&= v` on reactive state (`state` slot or `linked` cell) now write **only when the guard passes** — `count ??= 5` no longer fires a redundant patch (and reseed) when `count` is already non-nullish. Previously every logical assignment lowered to an unconditional write.
- **Postfix `x++` / `x--` now evaluates to the previous value** (and prefix `++x` to the new value), matching JS. Previously postfix returned the stepped value.
- As a consequence, reactive writes now evaluate to the written value, so chained assignment (`a = b = count`) through a state slot works too.

Internally, `Cell.set` and `Doc.replace` now return the written value, and the two lowering sites share `lowerCompoundAssignment` / `lowerUpdateExpression` helpers so they can't drift.
