---
"@abide/abide": minor
---

`virtualList` renders only the items of a long list or grid that are in view, measured from the app's own markup rather than described to it: spread `host` on the element the items sit in, render a keyed `{#for}` over `shown`, and spread `item(entry)` on each. How many items a row holds and how tall a row is come from the items as they render and the host's width and gaps, so a CSS grid whose columns change with a breakpoint just works; the scroller is the nearest scrolling ancestor or the page; and the rows left out are the host's block padding, so no spacer breaks a grid. `section` and `labels` give `sections`, a jump per label with the one in view current, and `scrollTo(index)` brings an item to the top. The first `initial` items render on the server and until the first measurement (RULEBOOK 51.58-51.64, 51.95-51.97).
