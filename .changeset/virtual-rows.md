---
"@abide/abide": minor
---

`virtualRows` answers the range of a long list's rows its scroller shows, so an app's keyed `{#for}` over just those rows mounts ten thousand as fast as twenty: bind the scroller with `viewport`, render `start` to `end` between spacers `before` and `after` tall, and `scrollTo` a row. The range moves by whole rows, reads nothing as it is bound, and renders on the server at the `height` given (RULEBOOK 51.65-51.71).
