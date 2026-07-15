---
"@abide/abide": minor
---

Hydration internals consolidated — one pass owner, shared claim verbs, one recovery dance, one child adopter.

- `runHydrationPass` now owns the hydration pass lifecycle (claim cursor, cache-withhold window, render pass, and the warm-seed restore a throwing pass owes its cold rebuild) — both entry sites (`hydrate`, the router's hydrating first mount) run the same bracket.
- The claim-cursor mechanics live in four verbs (`claimMarker`, `claimRun`, `claimText`, `parkCursor`) instead of ~15 hand-rolled advance sites across the dom helpers; helpers keep their hydrate-vs-create branch and divergence policy.
- `discardAndRebuild` carries the shared divergence-recovery dance (remove the SSR boundary, build fresh with the cursor cleared) for the await/try blocks and the child adopter.
- **Removed export:** `abide/ui/dom/mountStreamedChild` — `abide/ui/dom/mountChild` is now the single dual-mode child adopter (it probes the markup for inlined vs streamed, so the client build needs no hoistable-child knowledge). Both are compiler-emitted plumbing an author never imports; compiled output now always emits `$$mountChild`.
- Congruence decisions once mirrored by hand across the two compiler back-ends are now single shared sites: the branch render-path segment alphabet (`BRANCH_SEGMENT`), the `{#await}` bare-cell subject classification (`awaitSubjectExpr`), and `<Child/>` render-path ordinals (`componentOrdinals`, one document-order walk — fixing a latent SSR↔client ordinal desync for a `{:default}` case that isn't last and for components in slot content).
- Warm-seed adoption is two-phase (ADR-0048 first slice): a hydration pass marks the `CELL_SEED`/`DOC_SEED` entries it adopts and deletes them only on a clean exit, so a desync throw hands the seeds to the cold rebuild directly — the `warmSeedBackup`/`restoreWarmSeeds` shadow-copy recovery is deleted.

No behavior change; server markup, wire format, and authored APIs are untouched.
