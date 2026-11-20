---
"@abide/abide": minor
---

`markdown` and `Markdown` render model output as a model writes it: `<br>` and a short list of attribute-free formatting tags (`<kbd>`, `<sup>`, `<sub>`, `<b>`, `<i>`, …) are markup rather than text, numeric and common named character references are their characters, `[ ]`/`[x]` list items are checkboxes, and math is kept as its TeX in a `data-math` element. Given `streaming`, both leave out what the end of a stream is still writing — an unclosed mark, a half link, a table's head before its delimiter — until it can't change (RULEBOOK 52.46-52.50).
