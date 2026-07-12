# ADR-0040: The hydration lifecycle gets one owner; the warm-seed timing-guards stay distinct by phase

**Status:** accepted (2026-07-11)

## Context

An architecture review flagged that the warm-seed invariant — *server text ≡
the client's first render* — has no owning module. It observed the invariant
enforced by ~6 independently-placed guards, each answering what looked like the
same question ("we are mid-hydration; may this warm value be surfaced now?") in
its own module with its own mechanism, and proposed folding all six behind one
`hydrationWindow` so a regression in any one couldn't silently reopen the
SSR/hydration divergence bug class.

On inspection the six split cleanly into two groups:

- **The pass *lifecycle* genuinely had no home.** `hydratingSlot` (the
  save/restore-nested "is a pass active?" boolean) and `wakeHydrationPeeks`
  (the "outermost pass ended → re-run the scopes that withheld" wake) were two
  halves of one concept living in two modules, hand-composed at the two writer
  sites (`router` hydrate branch, `hydrate` mount) as a `previous` save/restore
  plus an `if (!previous) wakeHydrationPeeks()` dance. `cache.peek`'s
  synchronous withhold read the bare boolean directly. This is a real missing
  module.

- **The remaining guards are not the same question — they are different
  *phases*, and the phase difference is load-bearing.** They were probed
  against the deletion test and against "would folding erase a distinction":

  1. **`STREAMED_CELLS.deferApply`** fires a **microtask**, per streamed value,
     at the end of the current synchronous task — and is decoupled from whether
     a hydration pass is even active (the `__abideResolve` chunk can parse
     before, during, or after mount). ADR-0033's `assertClaimedText` guard is
     "after this sync task," not "on outermost pass exit."
  2. **`adoptTtl`'s `setTimeout(…, 0)` eviction defer** is a **macrotask** on a
     different *axis* (retention/eviction, not surface/withhold), runs partly
     *outside* the request ALS, and is unconditional — it keeps the warm value
     alive for every reader in the pass, it does not decide whether to show it.
  3. **`seedStreamedResolution`'s markLifecycle-after-seed** triggers on
     **value arrival** and marks the *one* seeded key; the lifecycle wake
     triggers on **pass exit** and marks *every* key. Different trigger,
     different granularity.
  4. **The renderer's key-align zip-filter** and the **`seededCellKeys`
     double-ship delta** are on the *key/index/tier* axis (which value, keyed
     stably across a dropped layout; which tier ships it), not the timing axis
     at all.

Folding 1–3 into the lifecycle window would force one module to conflate
"microtask after this task" / "macrotask, outside the ALS" / "on value arrival"
with "once, on outermost exit," erasing distinctions the streaming boundary
(ADR-0039), the two-codec split (ADR-0011), and the request-ALS boundary each
make real. That is the same shape as ADR-0016: the apparent repetition is a set
of genuinely per-phase domain facts, not accidental duplication.

## Decision

Give the hydration pass *lifecycle* one owner and leave the *phase* guards
alone.

`hydrationWindow` (`lib/shared/hydrationWindow.ts`) is a single monomorphic
object owning the pass lifecycle: a `depth` counter, a readable `active`
withhold flag, `enter()`/`exit()` bracketing a pass, and `wake()` firing
exactly once when the outermost `exit()` returns depth to zero. It absorbs and
deletes both `hydratingSlot` and `wakeHydrationPeeks`; the two writer sites
collapse to `enter()`/`exit()`, and `cache.peek`'s withhold reads
`hydrationWindow.active`. The `!previousHydrating` outermost test maps 1:1 to
`depth === 0`, so nesting and once-only-outermost-wake are byte-preserved.

The streamed-cell microtask (1), the ttl eviction macrotask (2), and the
seed-arrival mark (3) stay where they are, on their own phases. The key/tier
guards (4) are a separate axis and out of scope for the timing window.

## Consequences

- The hydration open/close/wake lifecycle is now one module with a small
  interface; a change to when a pass begins, nests, or wakes lands in one
  place. `cache.peek`'s withhold sources its flag from that owner.
- A new *lifecycle* concern (a new writer site, a change to nesting or the
  wake) is added to `hydrationWindow`. A new *timing* guard is written on its
  own phase with its own doc, as the microtask/macrotask/arrival guards are —
  the phase, not the module, is the unit.
- Re-propose folding a timing-guard into the window only if it stops encoding a
  distinct phase — e.g. a streamed-value apply that genuinely fires once on
  outermost exit rather than per-value on a microtask. That would change the
  domain fact, not just the plumbing.
