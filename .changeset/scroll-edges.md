---
"@abide/abide": minor
---

`scrollEdges`, a `bind:element` adaptor writing on a scrolling element a `data-scrollable` attribute listing the edges it can still scroll toward — `top`, `bottom`, `start`, `end` — so a stylesheet fades or shadows them. `start` and `end` follow the scroll origin, so a right-to-left scroller is marked the right way round, and content growing inside the element, rows arriving and leaving, and a `<details>` opening around it all mark it again. Every read is made in one animation frame before any write (RULEBOOK 32.101-32.108).
