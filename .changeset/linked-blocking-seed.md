---
"@abide/abide": minor
---

`linked` seed that reads a pending blocking cell becomes a blocking `AsyncState`

A `linked()` whose seed transitively reads a blocking (`await`-marked) async cell used to throw a `SuspenseSignal` out of its eager reseed effect at construction — the effect is a leaf with no reader to swallow the suspend, so it escaped to the caller. The classification probe now routes a seed that suspends to a writable async cell, and that cell marks itself blocking when its seed synchronously suspends, so its own reads pause too. A blocking read now behaves the same inside a `linked` seed as it does in a `computed` seed or a template binding.
