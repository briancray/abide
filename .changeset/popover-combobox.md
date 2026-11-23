---
"@abide/abide": minor
---

`popover(anchor, options)` is a `bind:element` adaptor opening an app's own panel in the top layer against an anchor for as long as it is bound, placed and placed again as `Tooltips` and `menu` are, writing `data-side`, `--arrow-offset` and the new `--anchor-width` (RULEBOOK 50.26, 50.27, 50.48). `Combobox` now opens its list in the top layer as one: the list and the children shown when nothing matches sit in a `data-part="popup"` element under the input, so no `overflow` or scroller clips it (51.57). Migrate CSS that positioned `[data-part=listbox]` inside the combobox to style `[data-part=popup]` instead — give it `margin: 0` and a background, and `width: var(--anchor-width)` to match the input.
