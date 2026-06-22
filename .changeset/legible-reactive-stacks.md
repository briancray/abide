---
"@abide/abide": patch
---

Make reactive errors and stack traces read in authored terms. A method call lowered onto a reactive-doc read now routes through a guard (`readCall`) that throws naming the scope path and member (`cannot call .close() — scope value "modal" is undefined`) instead of the engine's opaque `undefined is not an object`. The client build's source maps ignore-list abide's own framework sources, so a debugger collapses the mount-stack wall (`scope`/`mountRange`/`runNode`/…) and shows only authored `.abide`/`.ts` frames. Reactive bindings emit named thunks (`attr_title`/`text`/`bind_value`) so those surviving frames carry a name instead of `(anonymous)`.
