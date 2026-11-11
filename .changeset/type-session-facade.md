---
"@abide/abide": minor
---

`TypeSession` (`@abide/abide/compiler`) no longer has `complete`, `references`, `belowRoot` or the `tsconfig` getter. Nothing called them: an editor asks `session.lowered(path)` and then `completionAt`, `LoweredFile.inspect` and `LoweredFile.references` directly, which is what `abide`'s language server already does.
