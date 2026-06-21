---
"@abide/abide": patch
---

refactor(compile): fold skeleton hole numbering into the single `skeletonContext` walk. `generateBuild` previously threaded its own mutable `{ el, an }` counter through a second document-order walk parallel to the decision walk, free to drift from it — the compiler half of the hand-mirrored hole-ordering protocol. `skeletonContext` now assigns each hole its `el`/`an` index in the same pass that records `inSkeleton`/`markText` (el keyed by node, an keyed by node or by the reactive-text part), and `generateBuild` reads them via `holeIndex` instead of counting. One walk owns both the decisions and the numbering, so a counter-vs-decision drift is structurally impossible; a hole the shared walk didn't number now throws at compile time rather than surfacing as a runtime hydration desync. Behavior-preserving — no API or output change.
