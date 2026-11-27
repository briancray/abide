---
'@abide/abide': patch
---

`abide check` no longer reports TS6133 on a generated `__valuesN` record when an inline component's or a branch's `<script>` only hands a prop on as its `Reactive` (for example `toggleGroup({ value: method })`): a body's record is declared only when something reads through it (RULEBOOK 38.138).
