---
"@abide/abide": patch
---

A `Reactive` declared inside a function, a method, a block or a listener in a `.abide` file is read and written by name as a top-level one is — `takes(inner)` hands `takes` the value, both as it runs and under `abide check`, where it handed over the `Reactive` itself and `check` reported TS2345 (31.1)
