---
"@abide/abide": patch
---

`abide upgrade`'s `computed` migration drops an import it empties with the blank line under it, as the other migrations do, rather than leaving the module opening on a blank line
