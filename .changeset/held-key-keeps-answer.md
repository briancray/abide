---
"@abide/abide": patch
---

A `reactive.derived` re-pointed onto a key a `memo`'s `throttle` or `debounce` is holding back keeps serving what it served — busy, still ready — until the key starts, and clears for the run as before (5.25, 11.16). Search-as-you-type over a debounced memo no longer empties its list for the whole window.
