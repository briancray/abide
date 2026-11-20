---
"@abide/abide": minor
---

**breaking:** `Menu.abide` is replaced by `menu(options)`, two parts an app spreads onto elements of its own — `<button {...actions.trigger}>` and `<div {...actions.menu}>` — so the trigger holds anything and carries its own attributes. `open` takes a `Reactive` the menu writes back on every close, beside `onopen` and `onclose`; `menuitemcheckbox` and `menuitemradio` items change state with the menu left open; and typing moves focus to the item starting with what was typed (RULEBOOK 50.28-50.32, 50.37-50.40)
