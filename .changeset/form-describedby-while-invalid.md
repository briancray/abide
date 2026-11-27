---
'@abide/abide': patch
---

A `form` field's `input` names its `error` in `aria-describedby` only while it has a message, so a field whose error element is never rendered — a hidden input's — no longer names an element the document lacks (56.9, 49.7).
