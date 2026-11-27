---
'@abide/abide': minor
---

A headless component picks by its items' keys as they are: `toggleGroup`'s `value`, `tabs`' and `carousel`'s `selected`, `listbox`'s, `tree`'s and `sortableList`'s `selected`, `sortableTable`'s `selected`, `tree`'s `expanded`, `sortableList`'s `order`, `wizard`'s `current` and `accordion`'s `open` are typed by what `key` answers — the item itself, or its `id`, where none is given — so a number id is picked as a number, with no string copy and watch converting back. A key becomes text only in an element's id. `playback`'s speeds are keyed by the rate itself (49.21, 51.134).
