---
"@abide/abide": minor
---

Add `share`/`shared` context to `scope()`. The reactive doc does not inherit down the scope tree (each scope owns a separate document), so passing a value from an ancestor to a descendant previously meant threading it through every layer as props. `scope().share(key, value)` now puts a named value on a scope's own side-map, and `scope().shared(key)` reads the closest ancestor (self included) that has the key — an existence-checked, non-tracking upward walk, returning `undefined` when no scope provides it. The value is held by reference and the lookup never subscribes, so reactive context is expressed by sharing a `cell` (or a scope) rather than a plain object — reactivity rides what you share, not the share itself. A shared `undefined` shadows an ancestor (the walk stops on `has`, not truthiness). The shared map is released on `dispose`.
