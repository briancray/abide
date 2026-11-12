---
'@abide/abide': patch
---

`abide check` holds a write through a member path to the member's type: `query.tab = 3`, `rec.n += 'x'`,
`rec.list[i] = 'z'` and `rec.deep.s++` are refused on the line they are written, as a whole-value set
already was. RULEBOOK 31.16.
