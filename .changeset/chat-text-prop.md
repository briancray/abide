---
"@abide/abide": patch
---

`Chat`'s `Text` render prop takes an inline `{#component Text(…)}` the way `Combobox`'s `Option`, `Tabs`' `Tab` and `SortableTable`'s `Cell` do: it was typed to return a `Component`, so the spelling its own docs showed did not compile (RULEBOOK 53.39)
