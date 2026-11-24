---
"@abide/abide": minor
---

`carousel` and `lightbox` take `align` — `'start'`, `'center'` (the default) or `'end'`, as `scroll-snap-align` names them — and line an item's start, center or end up with the same point of the scroller, `scroll-padding` included (RULEBOOK 53.99). With `align: 'start'` and items a third and a bit of the scroller wide, three and a tenth show and `next` moves one. The item lined up is `current`, carrying `data-current`. `previous` and `next` pass over any item the scroller ends before it can align, and are disabled where only such items are left, so no press scrolls nowhere (53.67); and a scroll stopped at an end keeps `current` on the item it was (53.100).
