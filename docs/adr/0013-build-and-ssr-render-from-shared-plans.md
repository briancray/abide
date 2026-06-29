# ADR-0013: Build and SSR render from shared Plans, decided once and rendered twice

**Status:** accepted (2026-06-29)

## Context

`generateBuild` (client DOM-wiring, ~850 lines) and `generateSSR` (HTML string,
~660 lines) are two code-generation backends that must stay congruent: the
server-rendered markup and the client build have to agree node-for-node or
hydration desyncs. An architecture review (four deepening spikes, 2026-06-29)
found the agreement is currently kept by **parallel derivation kept honest by
tests**, not by construction:

- **Positional numbering** is already shared and deep — `skeletonContext`
  numbers element holes / anchors once, both backends consume it, and
  `walkElementOrder`/`walkAnchorOrder` are one traversal with two adapters. This
  is the model to extend, not replace.
- **Bindings are hand-mirrored.** The set of names a block introduces (an
  `await` `then` value, an `each` item / index, a `catch` error, `snippet` args)
  is computed independently in each backend. `generateSSR` literally comments
  *"the same set the client derives (item leaves + index)"* — an admission. The
  `reactiveBinding` helper that produces the derived-cell names lives *inside*
  `generateBuild`; SSR recomputes the equivalent set. A name registered on one
  backend but not the other — or under the wrong kind — silently mis-lowers to
  the enclosing component signal. This is the recurring `block-binding-shadow`
  bug; Spike 3 (`withShadow`, a `finally`-popped shadow stack) closed the
  *throw-leak* half by construction but could not close the per-backend
  name-set-choice half.
- **Element emission is hand-mirrored.** Per-attribute dispatch
  (`expression`/`interpolated`/`event`/`attach`/`bind`/`spread`), static-attr and
  void-tag handling are written twice. Spike 2 (`classStyleMergePlan`) proved one
  slice can be shared: the *decision* centralizes, the *rendering* stays two
  implementations.

A unified IR — one structure both backends render identically — was rejected:
the backends cannot render identically. Build emits live thunks/effects and
distinguishes `reactive` (a `.value` cell) from `plain` bindings; SSR emits
escaped strings and has no cells (every binding is a plain shadow); `bind:` is
client-only with an SSR initial-value-only counterpart. The shareable thing is
the **decision**, never the rendering.

## Decision

- **A Plan is a per-node shared compile model both backends render from** — its
  structure, its `bindings`, and (for elements) its attribute classification.
  One module per node that introduces structure or bindings: the existing
  `awaitPlan`/`ifPlan`/`switchPlan`/`tryPlan`, plus new `eachPlan`/`snippetPlan`,
  plus an element-level `elementPlan` layered over `skeletonContext`. Plans are
  the per-node sibling of `skeletonContext`'s tree-level positional model.

- **A Binding is carried on its Plan and classified once** as `reactive`
  (`await` `then`, `each` item / index) or `plain` (`catch` error, `snippet`
  args). The name set and classification are the single source of truth. Backends
  differ *only* in rendering: build wires a cell for `reactive` and a bare local
  for `plain`; SSR renders both as a plain shadow.

- **One shared registration path enforces it.** `withBindings(bindings,
  kindMapping, body)` (built on Spike 3's `withShadow`) iterates `plan.bindings`
  once and registers each under the kind the injected mapping returns. Build
  injects `reactive → derived (+ emit cell), plain → plain`; SSR injects
  `_ → plain`. `reactiveBinding` moves to the shared layer as the *renderer* of a
  `reactive` classification — it takes a `Binding` from the plan, not a raw
  author param, so a backend can only render what the plan declared. The
  `generate*` functions receive the `Plan`, not the raw `node.as`/`node.index`;
  there is no second name source to derive from.

- **Block dispatch is exhaustive** — the kind switch ends in a `never` default,
  so a new binding-introducing block cannot compile until it has a Plan (hence
  `bindings`).

- **`elementPlan` shares the classification, not the render.** It returns each
  attribute's kind, void-tag status, and the element's holes/anchors (consumed
  from `skeletonContext`); `classStyleMergePlan` folds in as its class/style
  branch. Each backend renders per kind.

## Consequences

- `block-binding-shadow` is designed out, not fuzz-caught: there is one name set
  and one classification per block, and one registration loop. The only
  per-backend choice left is how to render a classification its language
  supports, which is type-enforced (SSR cannot emit a cell).
- The parity / congruence-fuzz / desync-guard suites move from *sole contract
  enforcement* to *regression guards*. New direct tests become possible because
  bindings are data, not generated strings: per-plan binding unit tests, a
  same-name-shadow fuzz corpus (the nested-only / never-shadow-stressed gap), and
  an enforcement test that names flow only through `withBindings`.
- Sequenced in four green phases: (1) complete the structural plan family
  (`eachPlan`/`snippetPlan`); (2) bindings + `withBindings` + exhaustive dispatch
  — the correctness milestone and a bankable stopping point; (3) `elementPlan`
  and emission migration — the locality milestone; (4) test hardening.
- Do not re-suggest a unified IR (backends can't render identically) nor leaving
  the backends to derive bindings independently (the drift this fixes).
- The render *asymmetry* is permanent and intentional: a Plan is decided once and
  rendered twice. `dispatchRpcInProcess` is the codebase's reference for this
  shape (one decision, every surface routes through it).
- Extends the render-backend-unification work; relates to ADR-0012 (the build
  window is the finer disposal lifetime a `reactive` binding's cell lives in) and
  ADR-0010 (the virtual shadow is a separate type-checking concern, not a Plan).
