---
"@abide/abide": minor
---

Breaking: the box a `chart` measures is its plot, edge to edge. It keeps no room inside it for its labels any more: the x positions and the y range span the whole box, the gridlines, the zero line and the crosshair run across all of it, and a y tick's label ends at the plot's left edge (`text-anchor: end`) while an x tick's stands at its bottom edge. Keep room for the labels on the element around the root (`pl-12 pb-6`, say), let an `<svg>` root show what overflows (`overflow-visible`), and give a label its gap from the plot (`dx="-6"`, `dy="6"`). Every position is now a pure share of the box, so percent positions are exact before the root is measured and on the server, and gridlines no longer depend on labels. `frame` is removed: the plot's edges are the box's, so a drawing across it spans `0` to `100%`. RULEBOOK 52.68 amended.
