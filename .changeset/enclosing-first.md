---
"@abide/abide": patch
---

A block updates before the blocks inside it (RULEBOOK 12.18): an inner `{#if}` woken through a derived value no longer runs after the `{#if}` around it has gone false, so the narrowing the outer block promises holds inside it.
