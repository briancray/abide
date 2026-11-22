---
"@abide/abide": minor
---

**breaking:** a click on a `listbox` option now makes it active and calls `onpick` with it, as Enter does, so an option no longer needs an `onclick` of its own (RULEBOOK 51.112). `listbox` and `tree` take `multiple: true` and select many, as `combobox` does, holding the keys in `selected` (`Reactive<Picked<string, Multiple>>`, read and set): a click selects one, ⌘ or Ctrl with it adds or takes one out, Shift takes the run from the last one picked, Space toggles, Shift with an arrow extends and ⌘A or Ctrl+A selects all, written as `aria-multiselectable`, `aria-selected` and `data-selected`. A `listbox` selecting one hands back the key last moved to as `selected` (RULEBOOK 51.105-51.111, 51.86, 51.90)
