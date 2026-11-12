---
'@abide/abide': minor
---

**Breaking:** `bind:size`, `bind:visible` and `bind:rect` are gone, and so are `visibleIn` and
`sizeBox`. An element is measured by an `observe` adaptor its `bind:element` takes:
`bind:element={observe.size(box)}`, `observe.visible(seen, { in: scroller })`,
`observe.size(box, { box: 'border' })` and `observe.rect(placed)`. Each takes a `Reactive` to write
or a callback to call, and an `in` or a `box` given as a `Reactive` is watched. The old spellings
are a build error naming the new one. RULEBOOK 32.79-32.92.

`bind:element` takes a list of callbacks, each handed the element and each `Disposer` run when it
leaves, so one element can carry more than one adaptor:
`bind:element={[observe.rect(placed), observe.size(box)]}`. RULEBOOK 32.9.

Inside a `.abide` file, a name passed as a member of an object literal holds the `Reactive` where
the parameter's type declares that member one, as a `Reactive`-typed parameter already did.
RULEBOOK 31.3.

The observers, listeners and frame batching are the ones the binds ran on; a page that uses only
`observe.size` loads neither of the other two.
