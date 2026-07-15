---
"@abide/abide": patch
---

`invalidate(fn, args)`, `refresh(fn, args)`, and `amend(fn, args)` now resolve their target entry with a direct store lookup instead of scanning every cache entry in every store. A `fn + args` selector identifies exactly one key, so the full-store scan it previously ran was O(total cache entries) work to act on a single known key — noticeable for `amend`, which the real-time path can fire once per incoming socket frame. Behavior is unchanged (the scan is still used for bare-fn, tag, and wire-driven selectors that can match many entries); this is purely a hot-path optimization.
