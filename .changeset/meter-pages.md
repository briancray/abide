---
"@abide/abide": minor
---

`meter` and `pages`. `meter({ value, min, max })` is a track and a fill: `role="meter"` with the value read out, the fill as wide as the value is along its range, and `data-level` of `low`, `middle` or `high` where `low` or `high` is given; `role: 'progressbar'` with no value is indeterminate (52.106-52.109). `pages({ count })` is pagination: `items` lists the first page, the last and those around the page on, folding the rest into gaps, with a `link` per page, `previous` and `next`; given `href`, each is a link to its page's address (51.125-51.129).
