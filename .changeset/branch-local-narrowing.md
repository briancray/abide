---
'@abide/abide': patch
---

Fix: `abide check` narrows a value a branch-local `<script>` declares the way it narrows the page's own — `{#if proposal}{#if other}{proposal.x}{/if}{/if}` no longer reports `proposal` possibly undefined, nor does an `{:else if}` arm or a `{#for}` row inside the guard; no `proposal!` or `?.` needed. A read outside the guard, after a write, or in a listener is still checked as the union (RULEBOOK 38.138).
