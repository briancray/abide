---
"@abide/abide": minor
---

`sortableList({ items, key, label })`, a list put in order by hand: spread `list`, each `item(entry).item`, and its `.handle`. A handle dragged places its item among the others by the pointer; Space grabs it, the arrow keys move it, Space drops it and Escape puts every item back, each step read out through `announce`. `sorted` is the items in the order put, and `order` their keys (51.145-51.149).
