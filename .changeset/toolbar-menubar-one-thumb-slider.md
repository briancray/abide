---
"@abide/abide": minor
---

`toolbar` is new: WAI-ARIA's toolbar as parts, controls sharing one tab stop the arrow keys move along, and given `role: 'menubar'` its menubar, the menus it holds switching between each other as their `group`.

Breaking: `slider` picks one value by default, its `thumb` and `input` among its parts. A two-thumb range now takes `range: true`, its ends still `end(0)` and `end(1)`.
