---
"@abide/abide": patch
---

An array mutator whose arguments `await` compiles: `items.push(...(await load()))` in a `.abide` file evaluates its arguments before the copy is taken, rather than inside the mutator's own function, which is not async, so the build no longer fails with `"await" can only be used inside an "async" function` — and a write made while they are pending is kept (31.9).
