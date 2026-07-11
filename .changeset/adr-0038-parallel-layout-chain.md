---
"@abide/abide": patch
---

A route's layout layers now render in parallel during SSR (ADR-0038). Previously `renderChain` rendered the layout chain (outermost layout → … → page) sequentially, so a route with N layouts each doing an independent I/O read flushed its shell in the sum of their latencies. Now the layers render via `Promise.all`, each under `isolateCellBarrier` (so their async-cell barriers don't cross-drain) and its distinct route-key `withPath` (so path-keyed block ids stay collision-free) — the html fold and state/awaits/resume aggregation run after all settle and are order-independent, so output and hydration are byte-identical, just faster. A lone page with no layouts still renders directly (no wrapping overhead, same bare-read streaming timing). Server-only; reuses the ADR-0037 primitives. Verified with a timing test (three layers ~40ms each render in ~max not ~sum) and the full hydration suite. No API or config change.
