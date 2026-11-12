---
'@abide/abide': patch
---

The first `raw()` render in a page no longer counts the template markup is parsed in as a node it created: the page's template is made as the runtime loads, so a harness count over a raw render does not depend on whether anything parsed markup before it (RULEBOOK 32.93).
