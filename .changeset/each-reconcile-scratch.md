---
'@abide/abide': patch
---

Reuse the keyed-list (`{#for}`) reconcile scratch across passes so a steady-state reconcile allocates nothing

Each `each` reconcile built two fresh arrays per list change — `list.map(keyOf)` for the desired keys and `new Array(n)` for the resolved rows — then threw them away. On a list re-reconciled per keystroke that churn showed up as avoidable minor-GC pressure mid-interaction. The two buffers are now hoisted into persistent per-`each` scratch, reused every pass and cleared down to the live length on shrink (so no disposed-row references are retained). The `keyOf` pass is fused into the resolve loop — still exactly one `keyOf` call per item. Behaviour is unchanged: keyed diffing, in-place row updates, duplicate-key collapse, and prune-before-place all resolve identically; only the per-pass allocation is gone. The `[...source]` materialization for non-array iterables (generators must be drained) is unchanged.
