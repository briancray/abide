---
"@abide/abide": patch
---

A value that passes a patched object through — `reactive(() => rows.get())`, `x ?? []`, a filter that only sometimes runs — now wakes its readers on an `s.patch`, a server `memo.patch` arriving over the wire among them, rather than reading the same reference as no change — RULEBOOK 5.26
