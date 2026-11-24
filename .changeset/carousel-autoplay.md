---
"@abide/abide": minor
---

`carousel` and `lightbox` take `autoplay`, the milliseconds between steps, and `playing`; spread the new `play` part on a button to pause and play it. It steps as `next` does, stopping at the end unless it loops; a step by hand or a swipe starts the count again. It holds still while the pointer is over, or focus is inside, the scroller or its buttons, only turns while the scroller has a box (so a closed lightbox never does), writes `false` to `playing` for a reader who prefers reduced motion, and carries `aria-live="off"` while it turns (RULEBOOK 53.71-53.78). The clauses after them move up eight: `copy` through `panZoom` are now 53.79-53.98.
