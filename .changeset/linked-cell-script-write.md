---
"@abide/abide": patch
---

Writing to a `linked` cell from a component `<script>` now works — `let draft = state.linked(() => source); draft = draft + 1` (and `+=`, `++`, `--`, `??=`). Previously the compiler lowered every `linked` reference through `$$readCell(name)` (a call), so an assignment target became `$$readCell(draft) = …` and the build failed with "Invalid assignment target" — only `bind:value={draft}` could write a linked cell, despite `linked` being documented as writable. Assignments to a `linked` binding now lower through a new `$$writeCell` helper (`abide/ui/dom/writeCell`) that dispatches `.value =` for a sync `State` seed and `.set(...)` for an async/stream `AsyncState` seed.
