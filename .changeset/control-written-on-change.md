---
"@abide/abide": patch
---

a form control's value, checked or selected is written into its property only where it moved from what the binding last wrote, and not where the field's text reads as the number written — `value={n}` with `oninput={e => n = +e.target.value}` keeps the `1.` typed on the way to `1.5`, and inlineEdit's field opens again on the value after Escape — 32.113
