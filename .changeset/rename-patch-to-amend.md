---
"@abide/abide": major
---

Rename the cache-mutation verb `patch` → `amend`. The word "patch" collided with the HTTP `PATCH` method (`abide/server/PATCH`) and the internal DOM-tree `Patch` type; `amend` names the same intent — mutate the retained value of matching cached reads in place, reactive, no network — without the overload.

**Breaking:**

- **`abide/shared/patch` is now `abide/shared/amend`.** The standalone `patch(fn, args?, updater)` / `patch({ tags }, updater)` is now `amend(...)` with identical signatures.
- **The rpc selector method `fn.patch(...)` is now `fn.amend(...)`.** `fn.amend(args?, updater)` ≡ `amend(fn, args, updater)`. Still fetch-only (omitted for a streaming rpc).

Mechanical rename — no behavior change. Update imports (`abide/shared/patch` → `abide/shared/amend`) and call sites (`.patch(` → `.amend(`). The HTTP `PATCH` method export is unaffected.
