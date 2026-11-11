---
'@abide/abide': minor
---

`bind:size={box}` writes an element's content-box `{ width, height }` and `bind:visible={seen}` whether it intersects the viewport — one way, from one `ResizeObserver` and one `IntersectionObserver` shared by every bound element, unobserved when the element leaves, and nothing written by the server (RULEBOOK 32.79-32.85). `media(query)` is a `Reactive<boolean>` following `matchMedia`, one value per query text, `false` on the server (RULEBOOK 23.30-23.32).
