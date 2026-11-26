---
"@abide/abide": minor
---

`m.set(value)` and `m.patch(mutate)` without args now type-check only on a memo (or handler) that takes no args at all. Where its args are optional, a lone argument could be the args or the value, so name the entry: `m.set(undefined, value)` or `m.set({ page: 2 }, value)` (11.81).
