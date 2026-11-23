---
"@abide/abide": minor
---

`sortableTable` is a sortable, selectable table as parts an app spreads onto a `<table>` of its own, writing every cell: each header's `aria-sort` and sort button, the rows in sorted order, and a checkbox per row with a Shift-click range and a mixed header box. `SortableTable` is now default markup over those parts and behaves as before. A `{...expr}` spread onto an element now carries an element binding under `bind:element`, handed the element at mount as `bind:element` hands it, which is how a part sets a property no attribute can (RULEBOOK 32.99, 51.49-51.54, 51.72-51.76).
