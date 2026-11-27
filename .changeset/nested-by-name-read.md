---
"@abide/abide": patch
---

A `Reactive` declared inside a function, a method, a block or a listener in a `.abide` file is read and written by name as a top-level one is — `takes(inner)` hands `takes` the value, both as it runs and under `abide check`, where it handed over the `Reactive` itself and `check` reported TS2345. And a binding is a `Reactive` only where it is one as the file runs: `const [held, day] = [quest, today]`, `pick(quest)` or a loop's item over a literal that read its member holds the value, at the top of a script or inside a function, where it was called as a `Reactive` (31.1)
