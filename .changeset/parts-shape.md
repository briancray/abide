---
"@abide/abide": minor
---

Every parts function now has one shape (RULEBOOK 49.3, 49.8, 49.9): each element's part writes its own `data-part`, so a shipped component writes none and CSS written against a component matches markup of your own over its parts; every option an app binds is optional and handed back as a `Reactive` of the same name, ids are made where none is given, and a string or a number is its own `key` and `label`; and the parts are a member per element there is one of, a function per item, and an accessor for whatever changes — never a function taking nothing, or an optional argument, to read a value.

Migration:

- `tabs`: `view.tab(key)` → `view.tab(key).button`; `view.panel()` → `view.panel`; `view.panel(key)` → `view.tab(key).panel`; `view.current` → `view.selected`.
- `listbox`: `list.active()`, `list.activeOption()`, `list.activeId()` → `list.active`, `list.activeOption`, `list.activeId`; `id` is optional, and `key` too for string or number options.
- `menu`: unchanged in shape; its trigger and menu write `data-part="trigger"` and `data-part="menu"`.
- `combobox`: `id`, `key`, `label` and `value` optional, `multiple: true` picks many in place of an array `value`; `box.open()`, `box.items()`, `box.nothingFound()`, `box.picks()` → `box.open`, `box.items`, `box.nothingFound`, `box.picks`; `box.remove(item)` → `box.chip(item).remove`, with `box.chip(item).chip` and `box.chips` for the chips; `box.value` and `box.id` handed back.
- `commandPalette`: `palette.option(command)` → `palette.command(command).option`, with `.label` and `.key`; `palette.results()` → `palette.results`.
- `range`: `value` optional (from `min` to `max`) and handed back; `thumb(which)` / `input(which)` → `end(which).thumb` / `end(which).input`.
- `sortableTable`: `rows()` → `rows`; `header(column)`, `sort(column)`, `cell(column)` → `column(column).header`, `.sort`, `.cell`; `row(row)`, `select(row)` → `row(row).row`, `row(row).checkbox`, with `row(row).select` the cell holding it and `row(row).detail`; `selectAll` → `selectAll.checkbox`, with `selectAll.select` its cell; `table.table`, `table.sort` and `table.selected` handed back.
- `tree`: `item(node)`, `group(node)`, `isExpanded(node)`, `toggle(node)` → `node(node).item`, `.group`, `.expanded`, `.toggle()`; `key` and `label` optional for string or number nodes; `expanded` and `selected` handed back.
- `time`: `time(value)` / `text(value)` → `at(value).time` / `at(value).text`.
- `toasts.host`: `notices()` → `notices`; `notice(toast)`, `action(toast)`, `close(toast)`, `act(toast)` → `toast(toast).toast`, `.action`, `.close`, `.act()`, with `toast(toast).text`.
- `prompts.host`: `current()`, `typing()`, `failed()` → `current`, `typing`, `failed`, with `title`, `body`, `field` and `actions` parts.
- `tooltip.host`: `text()` → `text`.
- `chart`: `frame()`, `yTicks()`, `xTicks()`, `zero()`, `marks()`, `lines()`, `areas()`, `bars()`, `points()`, `readout()`, `crosshair()` → the same names read as values; a mark carries `columns`, the readout `heading` and each value `text`. `pie`'s `slices()` → `slices`; `sparkline`'s `trend()`, `ended()` → `trend`, `ended`.
