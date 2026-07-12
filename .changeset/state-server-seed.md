---
"@abide/abide": minor
---

Plain `state(initial)` now warm-seeds from the server across hydration, so a nondeterministic initializer carries the server's value through instead of recomputing a divergent one on the client. `state(crypto.randomUUID())`, `state(Date.now())`, `state(Math.random())` — previously the client re-ran the initializer on hydrate and produced a different value than the SSR HTML (a divergence class the `hydrate` channel now reports). Each rendered scope's document snapshot is serialized into `__SSR__.docs` keyed by its render-path id (the same keying the async-cell warm-seed uses), and on hydration the first write to each slot adopts the server value (consume-once) while the throwaway fresh init is discarded. No new public API — same `state()` call, same authoring. Values that don't round-trip the wire codec (functions, class instances) or state read only client-side fall back to a cold init, unchanged.
