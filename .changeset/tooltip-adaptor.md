---
"@abide/abide": minor
---

**breaking:** `Tooltip.abide` is replaced by `tooltip.tip(text, options)`, a `bind:element` adaptor on the element it explains, and `Tooltips.abide`, rendered once in the root layout as the one popover every hint opens in. Nothing is written beside the anchor, and the text describes it through `aria-description` (RULEBOOK 50.23-50.27, 50.36)
