---
"@abide/abide": patch
---

fix(ui): make signal-ref lowering lexically scope-aware so a callback parameter (or nested local) that shadows a component signal is no longer rewritten to the signal's doc form. Previously `renameSignalRefs` skipped only declaration-site identifiers, so in a component with `prop('option')`, a callback like `list.map(option => option.toUpperCase())` had its loop variable rewritten to `option()` — throwing `option is not a function` at runtime against the array element. The rewrite now threads a per-branch shadowed-name set down the AST (function/arrow params, nested `let`/`const`/`function`/`class`, `for`-headers, `catch` bindings), leaving inner references untouched while un-shadowed signals still lower.
