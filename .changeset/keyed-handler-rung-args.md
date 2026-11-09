---
"@abide/abide": patch
---

A `Middleware` whose `Extra` asks for `args` fits a keyed handler again — 16.86. 0.125.1's plain rung array inferred the handler's `Args` off the rung's `args: () => unknown` as well as off the `Keyed`, and refused the handler.
