# ADR-0049: Addressed component boundaries (per-boundary recovery, local order congruence, islands)

**Status:** proposed (2026-07-15) — needs a decision plus one instrumentation follow-up (exact
per-page component-mount counts; see Measurement). Extends
[ADR-0039](0039-the-addressable-render-boundary.md)'s addressable boundary from "hoistable
children the server may stream" to every component mount. Builds on the hydration-pass
consolidation and [ADR-0048](0048-one-seed-store-one-address-grammar.md).

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

## Measurement (kitchen-sink, dev server, 2026-07-15)

| page | raw | gzip | `<!--[-->` count |
|---|---|---|---|
| `/` | 5.59 MB | 1.19 MB | 2,372 |
| `/media` | 5.56 MB | 1.19 MB | 5,657 |
| `/people` | 76.7 MB | 11.3 MB | 3,166 |

Upper bound: if EVERY range-open pair were addressed (components are only a subset — most `[`
pairs on these pages are `{#for}` rows of code samples), the added bytes per pair are
`~9 + 2·len(PATH)`; at a 40-char average path that is ~0.5 MB raw on `/media` (~9% raw). Two
honest correctives before reading that as the cost: (a) only component MOUNTS get addressed —
the per-page component count needs instrumentation (a counter in `mountChild`/`generateSSR`),
and on these pages it is plausibly 5–20% of range-opens; (b) render paths share long prefixes,
which gzip compresses aggressively — the gzip delta is the number that matters and it needs a
prototype to measure, not an estimate. These pages are also atypically enormous (megabytes of
inlined highlighted code); a typical app page would see proportionally more overhead per byte,
so a second measurement on a small page is part of the follow-up.

## Consequences

- Order congruence becomes a per-template invariant; the compiler-congruence machinery keeps
  working but a violation costs one component, not the page.
- Recovery granularity matches the unit authors think in (the component), and the router's
  whole-page discard becomes the last resort instead of the only one.
- Wire cost is real and path-length-proportional; accept only with the measured gzip delta in
  hand. If it lands, ADR-0039's island affordance is one opt-in directive away.

## Rejected alternatives (provisional)

- **Status quo** — free, but keeps whole-page recovery and the global invariant.
- **Address only hoistable children** — today's line; recovers nothing for the common
  non-hoistable component.
- **Opt-in per component (`boundary` directive)** — avoids the blanket wire cost but reintroduces
  an authored construct ADR-0039 explicitly rejected; revisit only if the blanket cost measures
  too high.
