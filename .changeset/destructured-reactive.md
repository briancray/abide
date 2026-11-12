---
'@abide/abide': minor
---

A name a destructuring pattern binds to a `Reactive` is read and written by name, as a declared one is:
`const { status, step } = pairing()` reads `status` as its value and `step = 'x'` writes the `step` the
pattern bound — object and array patterns, renames, defaults and nested patterns, `const` or `let`.
RULEBOOK 31.17.
