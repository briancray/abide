---
"@abide/abide": minor
---

A listener written on an element no longer replaces a spread's listener of the same event: every `on<event>` an element carries, written or spread, is added, the written ones first and then each spread's in source order (RULEBOOK 32.109). `<button {...filters.trigger} onclick={track}>` now opens the popover and calls `track`, where before `track` silently replaced the trigger's own click. Attributes are unchanged: a written attribute still beats a spread's (33.12). On a component, `on<event>` is still an ordinary prop.
