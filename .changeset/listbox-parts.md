---
"@abide/abide": minor
---

`listbox` hands back parts: `listbox` for the list and `option(key)` for each option, carrying its id, `role`, `aria-selected`, `data-active` and the pointer that activates it — spread them rather than writing each attribute (RULEBOOK 51.94). `combobox` and `commandPalette` build their options on it.
