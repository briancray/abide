---
"@abide/abide": patch
---

A `{#for}` over an async source that is replaced empties the rows the last source appended in one write, rather than removing them one at a time.
