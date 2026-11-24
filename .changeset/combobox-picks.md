---
"@abide/abide": minor
---

`combobox` no longer hands back `picks` or `unpick`: where it picks many, its `value` is already every item picked, and `chip(item).remove` is the button taking one out — iterate `box.value` for the chips
