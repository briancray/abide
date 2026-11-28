---
"@abide/abide": minor
---

chart: the root fills its container's width (`width="100%"`) and stands at the `height` option, carries no `viewBox`, and never writes its measurement back onto itself, so a server-rendered chart paints its left edge and labels where the measured one will. `measured`, and `data-measured` on the root, say whether the root has been measured yet — for an app that draws its marks only once it has, or hides them until then with `[data-chart="root"]:not([data-measured])`.
