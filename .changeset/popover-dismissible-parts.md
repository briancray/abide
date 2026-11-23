---
"@abide/abide": minor
---

`popover` and `dismissible` hand back parts for each element they involve, so no element is handed from one to the other. `popover(options)` returns `{ trigger, anchor, popover, open, id }`: spread `trigger` on the button that opens it (or `anchor` on a field that opens it some other way) and `popover` on the panel. `open` is a `Reactive` you may pass in, and a press outside or Escape closes it unless `outside` or `escape` is `false` (RULEBOOK 50.48, 50.59, 50.60). The panel stays mounted and is shown and hidden in the top layer, so drop the `{#if open && opener}` around it, the `bind:element={opener}` ref and the `dismissible` beside it. `dismissible(onDismiss, options)` returns `{ host, inside }`: spread `host` on the panel and `inside` on the button that opens it, in place of `{ inside: [opener] }` (53.12).
