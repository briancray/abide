---
"@abide/abide": minor
---

`Chart` replaces `LineChart`: its `Line`, `Column` and `Area` children declare the series it draws over one pair of axes, `stack` and `normalize` pile them into stacks or shares, a child's `stack` names its stack or keeps it out of one, and `bounds` fixes an axis's range. The y labels stand in a gutter left of the plot, so no mark is drawn over one. The readout opens in the page's `Tooltips`. `Pie` draws shares of a whole as a pie or a donut. `chart.stack` is the stacking arithmetic, `chart.path` closes an area onto a baseline of one point per x, and `tooltip` takes `trigger: 'bound'` to stay open while it is bound (RULEBOOK 52.24-52.30, 52.37-52.39, 52.51-52.69, 50.24, 50.25, 50.47). Migrate `<LineChart series={[{ label, values, kind: 'bar' }]} />` to `<Chart><Column label={label} values={values} /></Chart>`, and render a `<Tooltips />` for the readout.
