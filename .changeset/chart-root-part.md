---
"@abide/abide": minor
---

Breaking: `chart`'s root part is `root`, where it was `svg` — the root may be a `div` as well as an `<svg>` — and it carries `data-chart="root"` where it carried `data-chart="svg"` (restyle a `[data-chart=svg]` selector by hand). `pie` and `sparkline` draw only in SVG and keep `svg`. `abide upgrade --from 0.143.0` renames `svg` to `root` where it is read off a name the same file binds to a `chart(` call, in script and markup (38.220); one read off a prop typed `ChartParts` is left for `abide check` to name. RULEBOOK 50.46 amended.
