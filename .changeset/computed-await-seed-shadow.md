---
"@abide/abide": patch
---

`abide check` (and the editor shadow) now type-check a `computed`/`linked` seed written with a top-level `await` — `state.computed(await load())` — as its resolved value, instead of flagging a spurious "top-level await" error and mis-typing the binding (which forced `as unknown as Awaited<…>` casts downstream). The shadow now mirrors the compiler's `wrapSeed` lowering: a non-thunk seed is normalised to a thunk (async when it carries a top-level await) and read through a helper that unwraps a promise/stream to the value a bare cell read peeks. A bare `state(await …)` — not a `computed`/`linked` seed — is still correctly flagged, since it genuinely breaks the synchronous build.
