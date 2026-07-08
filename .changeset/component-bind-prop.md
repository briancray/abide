---
"@abide/abide": patch
---

`bind:prop` now works on components, mirroring `bind:attr` on elements. `<Child bind:value={target} />` passes the prop with a two-way write-back channel — `target` takes the same forms an element bind does (an lvalue, or a `{ get, set }` accessor). The child reads the prop as usual; if it writes the prop (`value += 1`) or forwards it to another `bind:` (`<input bind:value={value} />`), those writes flow back to the parent's `target`.

There is no child-side marker: bindability is inferred from usage. A prop the child only reads stays a cheap read-only derive (unchanged); one it writes/forwards is upgraded to a writable cell that is a pass-through to the parent when bound, and a local reseeding cell when not (so a component still works standalone). Previously `bind:` on a component was a silent no-op passed through under a `bind:`-prefixed prop key.
