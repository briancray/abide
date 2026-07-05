---
name: later-hydration-removed
description: 2026-07-05 removed ALL later-hydration (deferred {#await cache()} inert path + client:idle/visible islands); hydration is eager again
metadata:
  type: project
---

2026-07-05: removed **all** later-hydration from abide-ui. Both the *inferred* deferred `{#await cache()}` inert-adopt path AND the *explicit* `client:idle` / `client:visible` component islands are gone. A blocking `{#await cache()}` now renders on the server, seeds warm, and hydrates **eagerly** (live on the first frame). `client:idle`/`client:visible` are no longer recognized directives.

**Why:** the defer decision was *inferred* by the compiler (size heuristic `DEFER_MIN_ARRAY_LENGTH` + a static `branchHasInteractiveBinding` scan), and that inference was the source of the whole "control renders dead until the wake fires" bug class (the bookclub logout gap). Two guards were bolted on reactively after it broke real pages — the tell of over-fitting. User's call: delete the smartness, keep the eager contract. Islands (explicit, never buggy) went too — full simplification over one honest escape hatch.

**How to apply:** these memories now describe REMOVED features — do not recommend or re-pitch them: [[deferred-await-inert-adoption]], [[await-then-interactive]], [[layout-await-no-hydrate-bug]]. Deleted: `deferResume`, `whenVisible`, `whenIdle`, `scheduleWake`, `DEFER_MIN_ARRAY_LENGTH`, `branchHasInteractiveBinding`, `DeferMarker`, `CacheEntry.warm`/`.deferred`, `CacheSnapshotEntry.lazy`. `mountRange`/`RANGE_MARKER` stayed (core component/outlet machinery). Regression guard = "blocking {#await} with an interactive control hydrates live" in `tests/uiHydrate.test.ts`. Surgical removal (not git revert — interleaved with keepers). 1545 tests green. Spec at docs/superpowers/specs/2026-07-05-remove-later-hydration-design.md (gitignored). abidemedia's 1494-card grid relied on `client:visible` → needs its own virtualization or a pin to pre-removal abide.
