# ADR-0049: Addressed component boundaries (per-boundary recovery, local order congruence, islands)

**Status:** **accepted — per-boundary recovery shipped** (2026-07-17). Extends
[ADR-0039](0039-the-addressable-render-boundary.md)'s addressable boundary from "hoistable
children the server may stream" to every component mount. Builds on the hydration-pass
consolidation and [ADR-0048](0048-one-seed-store-one-address-grammar.md). Shipped the
recovery half (see **Shipped** below); the island / deferred-hydration affordance the same
address unlocks stays a later opt-in (ADR-0039's non-goal), not built here.

## Context

Hydration's deepest remaining invariant is GLOBAL: the client build must claim server nodes in
exactly the order SSR emitted them, across the whole page. Everything else the hydration work
consolidated — the claim verbs, the shared ordinals, the segment alphabet — exists to keep that
one invariant true. Its costs:

- **Whole-page blast radius.** A desync anywhere past the last named boundary discards and cold
  rebuilds the entire chain (`router` catch). Only `{#await}`/`{#try}` blocks and streamed
  children recover locally, because only they carry addressed boundaries.
- **Order congruence is global.** A component's ordinal/segment must agree across both compiler
  back-ends AND across every ancestor's emission order (the lazy-slot-resolution rule, the
  `subtreeAwaits` gating, `elementChildAt`'s depth-skipping all serve this).
- **Islands stay blocked.** ADR-0039 records deferred hydration as an affordance; its
  prerequisite is an addressable boundary at the component — which only streamed children have.

A component mount today hydrates through ANONYMOUS `[`/`]` markers claimed positionally. If the
range instead carried the component's render-path (`<!--abide:c:PATH-->…<!--/abide:c:PATH-->`,
the id `mountChild` and `renderPath` already compose identically on both sides), then:

1. `mountChild` adopts BY ADDRESS: locate the boundary, claim inside it, park past its close.
   The positional cursor still runs *within* a component's own template — but the congruence
   invariant shrinks from page-global to per-template.
2. A desync discards ONE component's boundary (`discardAndRebuild`, already shared) and
   re-mounts it cold — its cells re-adopt via the two-phase seeds — instead of the whole page.
3. Islands (`client:visible`) become "don't mount this boundary yet": the address, the adopter,
   and the `CELL_SEED` warm channel already exist (ADR-0039's own analysis).

## Decision (sketch — pending measurement + acceptance)

- `generateSSR`'s component case emits `abide:c:PATH` boundary comments in place of the
  anonymous `[`/`]` pair (PATH = the child's render-path, exactly the streamed-boundary id).
  The inline `[ … ]` content shape inside is unchanged.
- `mountChild` hydrate mode claims the addressed open (a `claimMarker` with the composed id —
  it already computes `childPath` for the streamed probe), adopts the inner range, claims the
  close; on any adopt throw, `discardAndRebuild` that one boundary.
- The wire alphabet gains one prefix (`abide:c:`); `markerDepthDelta` already treats any
  `abide:*`/`/abide:*` pair as a depth level, so depth-counting and `elementChildAt` need no
  change.

## Shipped (2026-07-17)

Implemented as sketched, choosing the **REPLACE** shape over WRAP: a component's range brackets
*become* the addressed pair — `<!--abide:c:PATH-->…<!--/abide:c:PATH-->` in place of the anonymous
`<!--[-->…<!--]-->`, not an extra pair around it. So the node COUNT per component is unchanged (two
comments, as before); only their data grows by the render-path. This keeps the wire delta to
`2·len(PATH)` bytes per component (no `+9` for an added pair) and leaves the `[ … ]` content shape
inside untouched for control-flow, snippets, and the streamed inner range.

- **SSR emit.** `generateSSR`'s non-hoistable component case and `finalizeStreamedChildren`'s
  settled-inline arm both bracket the child's html in `abide:c:CHILDPATH` (id = `$$renderPath(ordinal)`
  / `staged.id`). A STILL-streaming child keeps its outer `abide:await:CHILDPATH` boundary; its
  swapped-in inner range stays anonymous `[ … ]` (it already recovers via its own `discardAndRebuild`).
- **Client adopt.** `mountChild` now emits addressed brackets on the CREATE path too (so a client-only
  mount stays byte-congruent with SSR — the `mountRange` `bracket` param), and on hydrate its inline
  arm claims `abide:c:CHILDPATH`, adopts via the shared `adoptRange`, and on ANY adopt throw calls
  `discardAndRebuild` on that one boundary — a dev-gated `reportHydrationDivergence` names it on the
  `hydrate` channel. The partial scope a throwing build stranded is already disposed by
  `withScope`/`scope`, so the cold rebuild starts clean (same contract `tryBlock` relies on).

### Structural gating on client-asymmetric state now recovers (the motivating case)

The concrete bug this closes: a child gates an element's PRESENCE on a client-true / server-false
value — `{#if pending({ tags })}`, a `refreshing(...)` probe, any state fed by a client-only effect
the server never sees in flight. SSR renders the element absent; the client build expects it present;
the mismatch is a STRUCTURAL divergence (a `skeleton` element hole, fatal — unlike a recoverable
attr/text value divergence). Pre-0049 that threw out of hydrate and the router cold-rebuilt the whole
page (occasionally mis-rendering during the rebuild — the `/media` RefreshIndicator `[object Object]`).
Now it recovers at the child's own boundary: the desync costs one component remount, not the page.
Authors MAY therefore gate structure on `pending`/`refreshing` — it degrades to a local remount rather
than a whole-page discard. (The class-toggle workaround — keep the element present, flip a `hidden`
class — remains the flash-free choice where it fits, since a value divergence never even triggers
recovery; structural gating is now merely SAFE, not free.)

For recovery to engage the desync must THROW. A BOUND gated element already threw (`skeleton` →
`resolveElementHole`); a purely-STATIC one took `cloneStatic`, which claimed a run of nodes without
checking them and so SILENTLY mis-adopted the diverged branch's markers (no throw → no recovery, and
a desynced cursor for every later sibling). `cloneStatic`'s hydrate path now VERIFIES the claimed run
against its template's top-level node shape and throws the standard structural desync on a mismatch —
so both bound and static gated elements recover. A congruent static clone is byte-identical to the
server markup, so the check never fires on a clean hydrate. Regression: `uiComponentBoundaryRecovery`
(bound + static + congruent arms).

## Measurement (kitchen-sink, dev server, 2026-07-15 — read against the REPLACE shape shipped)

| page | raw | gzip | `<!--[-->` count |
|---|---|---|---|
| `/` | 5.59 MB | 1.19 MB | 2,372 |
| `/media` | 5.56 MB | 1.19 MB | 5,657 |
| `/people` | 76.7 MB | 11.3 MB | 3,166 |

The original upper bound assumed a WRAP shape (an ADDED pair around each `[ … ]`, `~9 + 2·len(PATH)`
bytes each). The shipped REPLACE shape removes the `+9`: it renames the two comments a component
already emits, so the per-component delta is only `2·len(PATH)` bytes and only on component MOUNTS —
not the `{#for}` rows of code samples that dominate the `[` counts above. Render paths also share
long prefixes, which gzip collapses. Net: the transport cost is bounded well under the WRAP estimate
and pays for per-boundary recovery replacing the whole-page discard; a precise gzip delta on a small
typical page remains a nice-to-have, no longer a gate.

## Consequences

- Order congruence becomes a per-template invariant; the compiler-congruence machinery keeps
  working but a violation costs one component, not the page.
- Recovery granularity matches the unit authors think in (the component), and the router's
  whole-page discard becomes the last resort instead of the only one.
- Wire cost is real and path-length-proportional, but bounded by the REPLACE shape (rename, not add)
  and paid only per component mount. ADR-0039's island affordance is now one opt-in directive away —
  the address, the adopter, and the `CELL_SEED` warm channel all exist.

## Rejected alternatives

- **Status quo** — free, but keeps whole-page recovery and the global invariant. Rejected: the
  whole-page discard mis-rendered on recovery in practice (the `/media` case).
- **WRAP, not REPLACE** — wrap each `[ … ]` in an added `abide:c` pair. Rejected for the shipped
  REPLACE shape: WRAP doubles the per-component comment count for no semantic gain (the brackets
  themselves can carry the address).
- **Address only hoistable children** — the pre-0049 line; recovers nothing for the common
  non-hoistable component.
- **Opt-in per component (`boundary` directive)** — avoids the blanket wire cost but reintroduces
  an authored construct ADR-0039 explicitly rejected; the REPLACE shape's bounded cost made the
  blanket default acceptable, so no directive was added.
