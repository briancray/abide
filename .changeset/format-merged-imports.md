---
'@abide/abide': patch
---

`abide format` accepts a script whose imports `bun fmt`'s `sortImports` merged or reordered: a code block's imports are compared as the modules and bindings they name, and the rest of the script as its tokens in order (RULEBOOK 38.127).
