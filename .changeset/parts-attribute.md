---
"@abide/abide": minor
---

A part now names its element under a `data-` attribute named for the parts function that hands it back, in place of `data-part`: `data-sortable-table="row"`, `data-virtual-list="item"`, `data-toasts="toast"` for `toasts.host`. Parts from two functions spread on one element both stand — a `virtualList` item on a `sortableTable` row, or `followBottom`'s host on `Chat`'s transcript, where one used to overwrite the other. A `combobox` or `commandPalette` option carries its own attribute beside the `data-listbox` of the `listbox` part it is built on. `Chat` and `Pairing` write `data-chat` and `data-pairing`. A selector reading `[data-part=x]` reads `[data-<function>=x]` (RULEBOOK 49.3).
