---
"@abide/abide": patch
---

A `menu` item whose own `onclick` disables it now closes the menu: the pick is read as the click is captured on the menu, before the item's handler runs (RULEBOOK 50.31). And in development, `menu`, `popover`, `combobox`, `tooltip.host` and `chart` warn on `abide:parts` when a popover among their parts is drawn while closed, which is what an app's `display` does by outranking the browser's hiding of a closed popover (RULEBOOK 49.16).
