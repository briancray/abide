---
'@abide/abide': patch
---

ABIDE.md's testing notes say to mount a component inside the same `app.run` as the click whose call needs that scope: mounted outside and clicked inside, the call is written into the run's own copy of the value (11.32), and the mounted DOM never sees it busy or landed.
