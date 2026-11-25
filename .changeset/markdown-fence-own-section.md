---
"@abide/abide": patch
---

`markdown.incremental` hands back a fenced block named in `blocks` even with no blank line around it: a code fence opening unindented is a section of its own, so a fence written straight under a line, or two fences back to back, are each a `block` rather than an empty code block inside a paragraph's section (52.43).
