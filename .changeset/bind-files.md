---
"@abide/abide": minor
---

`bind:files` — a file input's files as an array, one or many: a pick writes them, and an array written to it (one dropped, or `[]` to clear) is what the input holds. A `bind:` an element has no property for, such as `bind:file` or `bind:vlaue`, is now a build error where it compiled to an attribute that bound nothing. RULEBOOK 32.73, 32.74
