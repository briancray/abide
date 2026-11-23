---
"@abide/abide": minor
---

A `Line` or an `Area` declaring `curve` is drawn as a curve through its values, and so is a `Sparkline`'s line and area — a monotone cubic that passes through every point and never swings past the two values it joins, a stacked area closing along the curve of the one under it. `chart.path`'s third argument is now an options object, `{ baseline, curve }` — `chart.path(xs, ys, 50)` is `chart.path(xs, ys, { baseline: 50 })` — and a series handed to `chart` takes `curve: true` (RULEBOOK 52.105, 52.106).
