---
"@abide/abide": patch
---

Fix a hydration desync (and the dead page it could cascade into) when a render reads a `tail`-retaining socket's `peek(socket)`. At SSR the server holds the socket's retained frame so `peek` returns it; a not-yet-connected client's `peek` returned `undefined`, so any markup derived from it (e.g. `state.computed(() => peek(refreshStatus))`) disagreed with the server HTML and tripped a hydration mismatch — which discards the server markup and cold-renders.

Sockets now warm-seed their retained frame across SSR→client like async cells do: the server records each frame read via `peek(socket)` during the render, ships it in `__SSR__.sockets` keyed by socket name, and the client seeds the socket's latest frame before mount so `peek(socket)` returns the same value the server rendered. (Contrast `cache.peek`, which withholds on the client because the server materializes no cache value — sockets carry a real server value forward, so they seed instead.)

Also hardens the hydration-desync recovery: the discard→cold-rebuild path now re-primes the async-cell and doc-state warm-seed manifests the failed hydration pass consumed, so the cold rebuild re-adopts the SSR-resolved values instead of refetching. A cold refetch left blocking `await` cells pending, and a top-level blocking read sits in no suspense region, so its `SuspenseSignal` escaped the rebuild and killed the mount ("page threw while mounting"). The rebuild now reads settled — a live page with real data, no loading flash.

No public API change.
