---
"@abide/abide": patch
---

A `reactive.derived` that comes back to a `Reactive` it adopted before, holding the value the derived already serves — one a write made through the earlier adoption — no longer wakes its readers onto that same value (5.1).
