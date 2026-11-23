---
"@abide/abide": minor
---

`chart`, `pie` and `sparkline` hand a chart back as parts: its geometry as data — ticks, marks, bars, points, the crosshair and its readout, and `x`, `y` and `frame` for a drawing of your own — with a part to spread on each SVG element, so `{#for point of plot.points()}<circle {...point.circle} r="3" />` marks every value. `Chart`, `Pie` and `Sparkline` are now default markup over them. `chart` is callable, and keeps `chart.ticks`, `chart.scale`, `chart.path`, `chart.stack` and `chart.nearest` as its members (RULEBOOK 52.78-52.81).
