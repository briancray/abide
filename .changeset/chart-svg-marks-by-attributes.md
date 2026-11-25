---
"@abide/abide": minor
---

Breaking: a `chart` column is placed and sized by its rect's own `x`, `y`, `width` and `height` rather than a `transform` in its `style`, so an HTML column needs no `transform-none!` and a CSS transition eases it on `x`, `y`, `width` and `height` (write `transition-[x,y,width,height]` where `transition-transform` was); and a chart whose root part is bound to an `<svg>` writes no `--x`/`--y` vars on its parts, which were 45% of a 600-mark redraw there (`bun run bench:chart-vars`). RULEBOOK 52.63 and 52.116 amended.
