---
"@abide/abide": patch
---

The language server's template completions read a slot's end as the parser does, so a `{` inside a comment, a regex or a template string no longer stops completions for the rest of the file (RULEBOOK 38.117).
