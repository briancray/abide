---
"@abide/abide": patch
---

Reactive-doc `Set`/`Map` mutations now emit a patch. The doc codec already serializes `Map` and `Set`, but a mutating method on a doc-held collection (`model.tags.add(x)`, `model.byId.set(k, v)`, `.delete`/`.clear`) lowered to a bare in-place call that mutated the live tree by reference and fired no patch — so readers never re-rendered and undo/persistence/sync never saw the change. These now route through the same clone-apply-replace path the in-place array methods use (`$$mutateDocArray` generalized to `$$mutateDocContainer`, covering Array, Map and Set); the mutating method names are disjoint across the three kinds, so the container kind is decided at runtime with no compile-time type check.
