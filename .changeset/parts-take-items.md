---
'@abide/abide': minor
---

**Headless components over a list take its items, and tell them apart by `id`.** `tabs`, `toggleGroup` and `wizard` take the items themselves, where they took a list of keys, and a part for one item is a function of the item: `view.tab(item)`, `group.item(item)`, `steps.step(step)`. `listbox`'s `option` takes the option, not its key. Every headless component's `key` is now optional where an item carries an `id`, which is its key, as a string or a number already is. So `tabs({ items: VIEWS })` over `{ id, label }` records needs no `key`, and the `key: (deal) => deal.id` that `carousel`, `sortableList`, `tree`, `listbox`, `combobox`, `sortableTable` and `virtualList` asked for can go.

**Breaking**:

- `tabs({ keys })` → `tabs({ items, key? })`, and `tab(key)` → `tab(item)`. `TabsOptions` and `Tabs` take the item type.
- `toggleGroup({ keys })` → `toggleGroup({ items, key? })`, and `item(key)` → `item(item)`. `ToggleGroupOptions` and `ToggleGroup` take the item type first.
- `wizard({ steps })` takes steps of any type with `key?`, `step(key)` → `step(step)`, and `valid` is handed the step. `WizardOptions` and `Wizard` take the step type.
- `listbox`'s `option(key)` → `option(option)`.
- `playback`'s `speed` is a `ToggleGroup<number>`: `speed.item(rate)` takes the rate as a number.
