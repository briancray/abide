---
"@abide/abide": minor
---

`form` tracks what an edit changed: `deal.dirty` and `deal.field(name).changed` read whether the form or a field differs from its baseline — the value the page renders it with, which a cleared field equals where none was rendered — written as `data-dirty` on the form and `data-changed` on the field; `deal.reset` is a reset button's part, disabled while nothing differs; `deal.changes` holds the args a submit would send, only those whose field differs; and a call answered without a failure makes what it sent the new baseline. An edit wakes only the readers of a field it moved. `message`, `invalid` and `issues` are now typed as the getters they are, so a template reading one by name stays bound (RULEBOOK 56.14-56.23).
