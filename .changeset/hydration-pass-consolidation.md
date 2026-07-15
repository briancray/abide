---
"@abide/abide": minor
---

Hydration internals consolidated — one pass owner, shared claim verbs, one recovery dance, one child adopter.

- `runHydrationPass` now owns the hydration pass lifecycle (claim cursor, cache-withhold window, render pass, and the warm-seed restore a throwing pass owes its cold rebuild) — both entry sites (`hydrate`, the router's hydrating first mount) run the same bracket.
- The claim-cursor mechanics live in four verbs (`claimMarker`, `claimRun`, `claimText`, `parkCursor`) instead of ~15 hand-rolled advance sites across the dom helpers; helpers keep their hydrate-vs-create branch and divergence policy.
- `discardAndRebuild` carries the shared divergence-recovery dance (remove the SSR boundary, build fresh with the cursor cleared) for the await/try blocks and the child adopter.
- **Removed export:** `abide/ui/dom/mountStreamedChild` — `abide/ui/dom/mountChild` is now the single dual-mode child adopter (it probes the markup for inlined vs streamed, so the client build needs no hoistable-child knowledge). Both are compiler-emitted plumbing an author never imports; compiled output now always emits `$$mountChild`.

No behavior change; server markup, wire format, and authored APIs are untouched.
