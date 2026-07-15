---
"@abide/abide": patch
---

`computed`/`linked` now honor the bare-seed contract (ADR-0045) when a bare seed reaches the runtime literally — a branch-nested `<script>` (`{:then names}` + `let total = state.computed(names.length)`) or a direct JS caller. The compile-time `wrapSeed` normalization only covers a component's leading script; a nested branch script keeps its calls literal, so the raw value hit the primitive: `computed(3)` stored `3` as the node's compute and the first read crashed (`node.compute is not a function`), killing the SSR stream mid-drain — a blank page after the shell. Both primitives now route a non-function seed by value: a promise → a streaming async cell, a stream → a frame cell, any other value → a constant seed. Regression-tested against the kitchen-sink templating/async live demo shape.
