---
'@abide/harness': patch
---

The test DOM opens and closes a popover: `showPopover`, `hidePopover` and `togglePopover` stand in for the methods happy-dom lacks, fire `toggle`, and `matches(':popover-open')` reads the open state — 43.36.
