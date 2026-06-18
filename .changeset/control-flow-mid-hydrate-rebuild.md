---
"@abide/abide": patch
---

fix: keyed `each`, `when`, and `switch` no longer crash when a synchronous write rebuilds them mid-hydrate. A page seeding shared reactive state during the hydrate pass (e.g. `breadcrumbs.crumbs = [...]`, or flipping an `if`/`switch` condition) re-ran the block's effect while `RENDER.hydration` was still active, so its fresh build claimed SSR nodes that were never adopted — surfacing as `null is not an object (element.setAttribute)` in `attr`/`openChild`. The reactive rebuild now runs with the global claim cursor cleared (restored after, mirroring `awaitBlock`/`tryBlock`): `each` clears it around its reconcile body, and `when`/`switch` get it for free via `fillBefore`, their single fresh-build path — adopt happens in place, so `fillBefore` is only ever create mode.
