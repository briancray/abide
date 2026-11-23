---
"@abide/abide": minor
---

`combobox`'s `runs(item)` and `commandPalette`'s `command(command).runs` cut a label into `LabelRun`s where what was typed was found — by the same match that narrowed the list, so the two never disagree — each matched run carrying a `match` part to spread on a `<mark>`. `Combobox` and `CommandPalette` mark what was typed in each option (RULEBOOK 51.106-51.107)
