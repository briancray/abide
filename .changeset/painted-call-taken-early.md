---
'@abide/abide': patch
---

A call the server painted settled is settled where the page hydrates, even when a module's value took it before it answered. `export const health = reactive(() => serverHealth())` and the like no longer have `{#if value.ready()}` rebuilt with an `abide:hydrate` warning ("server painted arm 0 … client chose arm 1") whenever the call answers after the page's modules load: hydration waits for it as it waits for any call painted settled, and it is no longer held until hydration ends. A call painted in flight is still in flight where the page adopts.
