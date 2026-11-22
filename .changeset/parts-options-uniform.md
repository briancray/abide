---
"@abide/abide": minor
---

Every parts function shapes its options one way (RULEBOOK 49.12, 49.13): an option that is a value takes the value or a function answering it, and each option is read where it is used, so a function or an accessor handed in stays live. `listbox` and `combobox` take their options as a list as well as a function, `chart` its `series`; `commandPalette`'s `hotkey` and `label`, `range`'s `labels` and `name`, `dropzone`'s `paste` and `multiple`, `tooltip.tip`'s `side` and `delay`, and every placement option of `popover`, `menu` and `tooltip.tip` take a function too. An option a function answers `undefined` for takes its default, as one left out does. `tabs`, `tree`, `range`, `menu`, `chart` and `commandPalette` take an `id` and hand it back, as `listbox` and `combobox` do (49.10). An `id`, a `multiple`, a `debounce`, a `rowHeight` and a starting size are read once.
