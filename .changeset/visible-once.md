---
"@abide/abide": minor
---

`observe.visible` takes `once: true`: the first `true` it writes is the last, and the element stops being observed in the same delivery, so what the value gates renders the first time it is seen and stays mounted (RULEBOOK 32.100).
