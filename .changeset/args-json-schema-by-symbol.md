---
"@abide/abide": patch
---

The 11.30 warning reads abide's `jsonSchema` by symbol, as the build does: `import { jsonSchema as js }` is still read for its defaults, and an app's own function named `jsonSchema` no longer is.
