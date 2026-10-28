---
"@abide/abide": patch
---

under `mount` in `bun test`, a dynamic `import('#src/…')` from a component's browser module resolves as the static one does, rather than failing with "Cannot find package '#src'"
