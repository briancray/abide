---
"@abide/abide": patch
---

`tabs`, `menu`, `listbox`, `tree` and `form` check the markup their parts are spread on while developing: an `aria-controls`, `aria-labelledby`, `aria-describedby`, `aria-activedescendant` or `aria-owns` naming an element that is not there, and a tab, option, tree item or menu item outside the list it belongs in, each warn once on `abide:parts`. A build carries none of it (RULEBOOK 49.8).

What the check found is fixed: a tab names its panel by `aria-controls` only while it is selected, so the tabs sharing one panel no longer name panels that are not there (51.42), and `Combobox`'s input names its list only while the list is open.
