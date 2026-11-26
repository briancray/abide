---
"@abide/abide": minor
---

Breaking: `reactive.derived` is `reactive` handed a body. `reactive(value)` holds a value, and `reactive(() => …)` takes and does everything `reactive.derived(() => …)` did. A function handed to `reactive` now runs as a body rather than being held (4.20); a function to hold is what a body hands back, `reactive(() => format)`. `abide upgrade` wraps each function an app held in `reactive` in a body (38.232), then spells every `reactive.derived` as `reactive` (38.233).
