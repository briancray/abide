---
"@abide/abide": patch
---

a handler's value, and any `reactive` a module declares, built on a server where it is first reached, is no longer owned by the render or the component setup that reached it first — so it is not released when that one ends, and the next read neither runs its body again nor restarts its stream. A request's own instance is still that request's — 12.17
