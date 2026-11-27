---
"@abide/abide": minor
---

`componentGraph` from `@abide/abide/compiler` answers the set of invoked paths itself, rather than `{ invoked }` around it: `const invoked = componentGraph(files, resolve)`
