---
"@abide/abide": minor
---

`copy` takes one options object, and what it copies is its `value` option. With no `value`, a click copies the element clicked as one clipboard item: its `textContent` as `text/plain` and its `innerHTML` as `text/html` (RULEBOOK 53.74). Move the first argument into the object: `copy(text, { copiedFor })` is now `copy({ value: text, copiedFor })`.
