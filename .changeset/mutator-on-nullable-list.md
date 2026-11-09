---
"@abide/abide": patch
---

A mutator on a `Reactive` list typed with `undefined` or `null` — `drafts?.push(d)`, or `drafts.push(d)` once narrowed — is a write that wakes its readers, as on a list typed without them — 31.9
