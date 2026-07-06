# ADR-0014: The type-check shadow stays off the shared Plan model

**Status:** accepted (2026-07-05)

## Context

ADR-0013 made `generateBuild` (client DOM-wiring) and `generateSSR` (HTML string)
render from shared **Plans** — a block's branch structure and its `Binding[]`,
classified once, rendered twice — so the two code-generation backends can't drift on
what names a block introduces or how it partitions its branches.

An architecture review then flagged a natural follow-on: `compileShadow` (the virtual
TS shadow that type-checks `.abide` templates, ADR-0010) is a **third** renderer of the
same template block structure, and it consumes none of the `*Plan` modules. It
re-derives, by hand, the same facts — the `{#each}` item/index it introduces, the
`{#await}` blocking-vs-streaming resolved-content split, the `{#if}`/`{:elseif}`/`{:else}`
partition. The review asked whether the shadow should be folded onto the Plan model to
close the same "parallel derivation kept honest by tests" gap.

Spiking the fold showed it does not deliver the win, for three connected reasons.

1. **The shadow reads the same authoritative tree the Plans read.** Both consume the
   `TemplateNode` tree from `parseTemplate` — the same `kind: 'case'`/`kind: 'branch'`
   node kinds and the same `node.as`/`node.index`/`node.condition` fields. The shadow's
   branch partition (`children.filter((c) => c.kind === 'case')`, etc.) is byte-for-byte
   the partition the Plans compute, off the same source. There is no independent
   *classification* the shadow could get wrong — so no drift of the kind the Plan model
   was built to eliminate.

2. **The shadow does not do the lowering the Plan classification exists for.** A
   `Binding`'s `reactive`/`plain` classification exists so the two codegen backends agree
   on whether to wire a `.value` cell (`reactiveBinding`) or a bare local — the
   `block-binding-shadow` bug. The shadow renders to *types*, not cells: it binds each
   name to a type source per block kind (an `each` item → element-of-`items`, an `await`
   value → the awaited type, a `catch` error → `any`, an `index` → `number`). The
   reactive/plain bit carries none of that, so the Plan's `Binding` is the wrong currency
   for the shadow.

3. **The shadow's real coupling is exactly what the Plan omits.** Every name the shadow
   declares is `mapped` to its source `loc` for hover, go-to-def, and diagnostic
   remapping (the source-text == shadow-text invariant). The `Binding` type is
   deliberately `{ name, classification }` with no `loc` — the codegen backends don't need
   one. Routing the shadow through Plans would still leave it reading `node.asLoc` /
   `node.indexLoc` off the node for every binding, so the "names derive from one place"
   benefit never materializes; the `await` case in particular gets *messier* (the plan
   collapses blocking/streaming into `resolvedChildren`/`resolvedAs`, but the shadow still
   needs the per-branch loc to map).

The shadow's strategy — recurse with `emitNode`, let each `case`/`branch` node self-emit
its binding — is also simply smaller than the Plan machinery for a renderer that has no
hydration-congruence constraint to keep.

## Decision

`compileShadow` stays off the `*Plan` modules and keeps its own per-kind block emission.
ADR-0013's Plan model remains scoped to the two code-generation backends, whose shared
problem (cell-vs-plain binding registration + node-for-node hydration congruence) the
shadow does not share.

## Consequences

- The `.abide` template has three renderers; two share Plans, the shadow does not — by
  design, not by omission. A future review that re-notices "only two of three unified"
  should read this ADR before re-pitching the fold.
- The shadow and the codegen backends can still diverge on *branch structure* in
  principle, but only if `parseTemplate`'s tree shape changes under one and not the
  other — a `TemplateNode` change both already consume — not on binding classification.
- If the shadow ever needs the reactive/plain distinction (it does not today), or the
  `Binding` type gains a `loc` for another reason, this decision is worth revisiting.
