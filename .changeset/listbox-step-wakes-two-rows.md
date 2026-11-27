---
"@abide/abide": patch
---

`listbox`'s `option` — and so `combobox`'s and `commandPalette`'s — hands back the same listeners for a key at every call, and each row reads its own active and selected state, so an arrow step wakes only the two rows it moves the mark between and binds no listener again (RULEBOOK 51.192).
