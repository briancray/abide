# ADR-0048: One hydration seed store, one address grammar, two-phase consume

**Status:** proposed (2026-07-15). Follows the hydration-pass consolidation (runHydrationPass /
claim verbs / discardAndRebuild / sole `mountChild` adopter, branch `refactor/hydration-pass`).
Depends on the render-path identity of [ADR-0033](0033-render-path-survives-a-renders-awaits.md);
respects the two-codec split of [ADR-0011](0011-warm-seed-uses-two-codecs.md) and the per-phase
timing guards of [ADR-0040](0040-hydration-timing-guards-stay-distinct-by-phase.md).

## Context

Every server→client hydration value is keyed by a render-path-derived address and stored in a
per-kind global manifest. Today that is **three id grammars** and **six stores**:

- cell warm key `${scope.id}:${index}` (`warmSeedKey`) → `CELL_SEED` (`__abideCells`)
- await/try block id `${path}:${n}` (`blockId`) → `RESUME` (`__abideResume`)
- streamed-child boundary `${path}/${ordinal}` (`renderPath`) → boundary comments
- doc snapshot by scope id → `DOC_SEED` (`__abideDocs`)
- streamed cell values by warm key → `STREAMED_CELLS` (`__abideStreamedCells`)
- socket frames by name → `SOCKET_SEED`; plus the two cache partitions (`ssr.cache`,
  `__abideResumeCache`)

Three problems are structural, not incidental:

1. **The grammar is convention, not construction.** `escapeKey` escapes only `~` and `/`; `:` —
   the delimiter of both the cell and block grammars — passes through unescaped. Collision
   avoidance rests on a comment ("a child path never carries a `:`") and on cell/block ids
   living in different stores despite sharing a format. A route or row key containing `:` can
   shift or collide a warm-seed key today.
2. **Consume-once deletes force a shadow store.** `CELL_SEED[key]` is deleted on adoption and
   `DOC_SEED[id]` on read, so a FAILED hydration pass has already drained them —
   `warmSeedBackup`/`restoreWarmSeeds` exists only to undo that for the cold rebuild. The
   recovery path depends on a pristine copy being stashed at boot and kept in sync.
3. **Degradation is scattered.** An unserializable value drops at seven independent sites
   (`tryEncodeResume`, `encodeStreamResume`, `resolvedCellCells`, `docSeedSnapshots`,
   `socketTailSnapshots`, the streaming-cell emit, the cellSeed emit), each with its own warn
   wording and its own silent-refetch consequence.

## Decision (sketch)

1. **One address module.** `seedAddress(kind, path, ordinal)` composes every wire id; `escapeKey`
   grows `:` (or the kind becomes a typed prefix outside the escaped segment space). The three
   existing grammars become three kinds of one address; `warmSeedKey`/`blockId`/`renderPath` stay
   as thin callers so call sites don't churn.
2. **One seed manifest.** A single `__abideSeeds` store of kind-tagged entries replaces the
   per-kind globals. The per-phase APPLY timing (streamed-cell microtask defer, arrival mark,
   adopt-ttl eviction) stays exactly where ADR-0040 put it — only storage, lookup, and the
   `??=` global bridging unify. The two codecs stay per ADR-0011; the entry records which one
   encoded it.
3. **Two-phase consume.** Adoption MARKS an entry consumed; the pass owner (`runHydrationPass`)
   DELETES marked entries on a clean exit and UNMARKS them on a throw. `warmSeedBackup` and
   `restoreWarmSeeds` are deleted — recovery stops depending on a shadow copy.
4. **One degradation site.** Seed encoding funnels through one encoder that owns the
   can't-serialize warn (naming the kind + address) and the documented consequence per kind.

## Consequences

- Address collisions become impossible by construction rather than avoided by comment; the
  latent `:`-in-key hazard closes.
- A failed pass rolls back instead of restoring from a copy; the pass owner already brackets
  the lifecycle, so the mark/sweep lands in one module.
- The wire format changes shape (one global instead of five); `SSR_SWAP_SCRIPT` remains
  hand-written vanilla and must keep writing raw strings the bundle decodes lazily.
  Version-skewed hydration (old server HTML + new bundle) falls back to cold rebuild, as today.

## Rejected alternatives

- **Unifying the codecs too** — rejected by ADR-0011 until the RPC/cache response direction
  moves to ref-json; out of scope here.
- **Folding the apply-timing guards into the store** — rejected by ADR-0040; they encode
  distinct phases, not plumbing.
- **Keeping consume-once + backup** — works, but couples recovery correctness to a second
  store staying faithful; two-phase consume makes the pass itself own its rollback.
