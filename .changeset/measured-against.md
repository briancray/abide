---
'@abide/abide': minor
---

`bind:visible` takes a root: `visibleIn={scroller}` beside it measures whether the element is in
view inside that element rather than the viewport, so a panel can tell that a row has scrolled out of
its scroller while the scroller is still on screen. Until `visibleIn` holds an element nothing is
observed; a root that changes is observed against again; and the elements measured against one root
share one `IntersectionObserver`, disconnected with the last of them. RULEBOOK 32.80, 32.82, 32.91.

`bind:size` takes a box: `sizeBox="border"` beside it writes the border box, padding and border in,
where it wrote only the content box before — still as physical `width` and `height` whatever the
writing mode. `"content"` is the default, and an expression moves the observation between the two.
RULEBOOK 32.79, 32.92.

Either attribute without its bind, a static `visibleIn`, or a static `sizeBox` other than
`content` or `border` is a build error, and `abide check` holds `visibleIn` to an element, a
document or nothing and `sizeBox` to `'content' | 'border'`. RULEBOOK 32.93, 32.94.
