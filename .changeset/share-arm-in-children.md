---
"@abide/abide": patch
---

an `{#if}` arm or a `{#for}` row inside the children passed to a component finds the `reactive.share` that component holds in the browser, as it already did on the server, rather than filling a value of its caller's own on hydration and on every reopening (RULEBOOK 10.5)
