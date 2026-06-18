---
"@abide/abide": patch
---

fix(check): value-project a nested control-flow `<script>` like the leading one. The shadow type-checker emitted a branch-scoped `<script>` body raw, so its `state`/`derived` declarations kept their `State<T>`/`Derived<T>` types — every read of a nested signal in the branch's markup false-positived (`'Derived<string>' and 'string' have no overlap`, `Property 'length' does not exist on type 'Derived<…>'`). It now rewrites a nested script's reactive declarations to their value types, matching the runtime, which derefs nested-script signals through the rest of the branch.
