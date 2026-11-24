---
"@abide/abide": patch
---

A shipped component's props reach its parts live, as RULEBOOK 33.5 asks: `Range`'s `labels`, `format` and `name`, `CommandPalette`'s `hotkey` and `label`, `Combobox`'s `search`, `key` and `label`, and `Chart`'s and `Pie`'s formats, `onpick` and `disabled` were read once at setup, so a prop that changed or arrived after mount never applied. The headless components read those options as they use them, so an app handing its own options as accessors gets the same. An `id`, a `debounce` and whether a `Combobox` picks many stay fixed for the life of the parts.
