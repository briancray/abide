# ADR-0018: The consolidation round — align internals to the surface, and the vocabulary to the internals

**Status:** accepted (2026-07-07); execution pending, wave-by-wave

**Supersedes:** ADR-0012 (adopts its correctness invariant as this round's guardrail — see Decision C).

## Context

A surface-down review held abide's **public surface fixed as the spec** (every
`exports` key, the four-pillar semantics, and the behavioral promises —
isomorphism, warm hydration, resumability, dev==build consistency, correct
teardown/reconciliation) and designed the internals clean-room from it. The
finding: the internals **deliver the surface correctly but are not shaped like
it** — roughly **75% aligned**.

- The hard, correctness-critical machinery is already at the clean-room ideal
  and must be kept verbatim: the push-pull reactive graph, the
  positional/skeleton hydration model (ADR-0013), `keyForRemoteCall`, the
  ref-json wire codec, the route grammar of record, `generationGuard`, and
  `createRemoteFunction`'s transport-parameterized shell.
- The remaining ~25% is **accidental complexity concentrated in five sites**: a
  doubled ownership tree, the 1307-line `cache.ts` god-module, a doubled compile
  front-end, a 1061-line resolver closure, and a doubled socket assembler. None
  of it changes what the surface can do; all of it is history-forced
  fragmentation of concepts the surface presents as single. (The review's sixth
  candidate — folding the ~16 `*Slot` boot-holders into one object — was
  attempted and **withdrawn on contact with the code**; see Consequences.)

A parallel vocabulary review found the same drift in the *names*: "scope" was
smeared across five symbols precisely because there were two ownership trees;
"Registry", "Slot", and "Frame" were each bound to two concepts; the type-check
shadow is a third template walker that can disagree with codegen by hand.

**No from-scratch rewrite is warranted.** The gap is concentrated, mechanical
de-duplication plus exactly one genuine architectural rewrite (the ownership
merge). Every large unification a broader review proposed (one registry
substrate, a shared `keyedRange` core, one swappable-range primitive absorbing
`awaitBlock`) was rejected on correctness grounds. This ADR records the decision
to run a bounded **consolidation round** whose waves each collapse one
interpreter-doubling into one source of truth, carry their renames, and shape
their seams to admit the patch-bus capability arc without a second refactor.

## Decision

### A. Adopt the north-star internal model

Three shared substrates every pillar stands on, two symmetric assemblers, two
compute-once/render-many engines:

- **Reactive + ownership + doc** — `ReactiveNode`+graph (verbatim); **one
  ownership tree** whose context-bearing nodes carry a `ScopeContext`; `Cell`;
  `Doc` (path→node + trie + invertible patch bus); `watch`; `generationGuard`.
- **DOM materialization** — `Skeleton`+`walkOrder`+hydration cursor (verbatim);
  **one `MarkerRange`** (mount/adopt/swap/dispose) carrying the detached-anchor
  and adopt-strand guards as first-class mechanics; `RangeList` over it.
- **Transport / data-plane** — `keyForRemoteCall`+wire codec (shared);
  `assembleRemoteFunction(Transport)` (the existing ideal, renamed) and
  `assembleSubscribable(FrameSource)` (one stream shell); the read core, cache
  ops, and probes split out of `cache.ts`.
- **Fan-out engine** — one project scan → a superset descriptor that retains the
  live registry-entry handle → pure renderers (HTTP/CLI/MCP/OpenAPI/Inspector/
  `.d.ts`).
- **Compile engine** — one parsed-once `ComponentPlan`; build/SSR/shadow become
  thin projectors of it (the shadow's *emission* backend stays separate per
  ADR-0014).

### B. The waves, with seam acceptance criteria (⊕)

Sequenced to keep the tree green. `⊕` items are shape constraints that keep a
seam open for the follow-on capability arc — cheap now, a second refactor if
skipped.

| Wave | Change | Class | ⊕ Seam acceptance criteria |
| --- | --- | --- | --- |
| **0** | `withoutHydration` (5→1); `buildArtifact` (build-or-die, 5→1) | SHIP ✅ | — |
| **0′** | ~~split `cache.ts`~~ + `callRegistry` + the ⊕ invertible-`Doc`-journal seam | **DEFERRED** to the patch-bus round | moves there — ADR-0001's re-propose gate (a persistent store adapter) is that round, not now |
| **1** | **One ownership tree** (supersedes 0012) | BIG-BET | ⊕ stable `ScopeContext.id` + a dev-gated `walkScopes()` read API |
| **2** | `MarkerRange` + `RangeList` (fold the range zoo, `awaitBlock`/`each`/`eachAsync` reimplementations) | SHIP | guards are `MarkerRange` mechanics, not per-block logic |
| **3** | Fan-out engine: project scan + delegating resolver; superset `describe()`; unconditional typing emit | SHIP | ⊕ the descriptor stays a **superset carrying the entry handle** — a 5th surface must be one new renderer with no `describe()` change |
| **4** | `assembleSubscribable(FrameSource)` | SPIKE | ⊕ `FrameSource.subscribe` is **pluggable** (no single-process `server.publish` baked in); a 2nd fake-cross-instance adapter passes the replay/reconnect corpus. `watch` stays inert in the shell, client-injected |
| **5** | Single compile front-end (`ComponentPlan`); shadow becomes a projector | SPIKE | `Binding` gains `loc`; the typed-emit printer trade-off (readability vs correctness-by-construction) is the author's call |

The patch-bus capability arc (undo → local-first persistence → offline mutations
→ multiplayer) is a **deliberate next round** riding the Wave 0/1 `Doc` seam and
the Wave 4 `FrameSource` seam — not built in this round.

### C. Overturn ADR-0012: one ownership tree, its correctness invariant kept

ADR-0012 kept the lexical scope and the build window as **two separate
systems** because a reactive cell built in a control-flow branch must die when
the **branch** flips (finer than the component), and *receiver-binding* the
primitives to the lexical scope leaked (`reseeds === 2`).

This round overturns 0012's **structural conclusion** (two systems, two types)
while **keeping its correctness invariant**: the primitives stay
**ambient-bound, not receiver-bound**, and branch-granular disposal is
preserved — as finer **nodes in one tree** rather than a separate system. A
block scope is the finest node (disposers only); a component scope is a node
that additionally carries a `ScopeContext { doc, shareMap, capabilities, id }`.
Ambient binding to the nearest node gives exactly the branch-flip teardown 0012
protected.

**Guardrail:** the focused `reseeds === 1` probe and the branch-flip teardown
suite must stay green through Wave 1. They are what proves ambient ≠ receiver
binding and that 0012's leak does not return. If Wave 1's spike cannot keep them
green with one tree, 0012's two-system structure stands and this decision
reverts.

### D. Two mechanisms considered and declined

- **A codegen type checker** — abide already has one: the virtual TS shadow
  (ADR-0010) that `abide check` / the LSP run. That is the correct strategy
  (lean on `tsc`, do not hand-roll inference). Do **not** add a second checker.
  Wave 5 makes the shadow a projector of `ComponentPlan`, so `check == build ==
  ssr` becomes structural rather than hand-maintained. Lean harder into codegen
  only for the *new internal seams* (e.g. the descriptor renderers) so
  their silent-gap classes become compile errors.
- **`Proxy()` on the reactive core** — deliberately and correctly avoided.
  abide compiles reactive access (`readCall`/`lowerDocAccess`) instead of
  intercepting it, which serves three stated principles: performance
  (Proxy get-traps deopt the monomorphic per-frame/per-row loops), stack
  visibility, and isomorphism (compile-time lowering is deterministic both
  sides). Adding Proxy to the doc/cells/props would regress all three. Proxy
  stays confined to **cold ergonomic facades** (`page` already). The one
  tempting target — the imperatively-attached rpc/socket selector surface — is
  hot on the callable and its de-drift win is already captured by the shared
  assemblers (Decision A) at no get-trap cost.

### E. Vocabulary realignment

The round realigns the whole project to one-meaning-per-term. Naming law: one
meaning per term; same word at every altitude; frozen standard names never
rename; descriptive-not-clever with minimal churn; public breaks clear a higher
bar than internal ones.

**Contested words, resolved to one meaning each:**

- **scope** → the single ownership node (type `Scope`); no bare `scope` value.
  Moved off it: `scope(build)`→`blockScope`; `scope()`→`currentScope()`;
  `scopeGroup`→**deleted** (traversal→`walkScopes`, which also removes the
  `.track` vs reactive `track` collision); and the *server request sense*
  `runWithRequestScope`/`RequestScopeInfo`/`requestScopeSlot`→**`RequestContext`**
  family. That last move is load-bearing: without it "one meaning" is false,
  because `runWithRequestScope` wore the `withScope`/`inScope` verb shape over a
  different mechanism.
- **Registry** → the reactive store of registered async work with a lifecycle
  channel (cache calls, tail streams, `rpcErrorRegistry`). The read core is
  **`callRegistry`** — *not* `readRegistry`, because a Probe is defined as a read
  that *reports, never acts*, and the read-through core *acts* (coalesces, opens
  fetches). The build-time file scan moves off "Registry" → **`ProjectManifest`**.
  Plain-`Map` handler tables (`rpcRegistry`/`socketRegistry`/`promptRegistry`)
  are the grandfathered qualified sub-sense.
- **Slot** → the resolver-seam indirection hole (`ResolverSlot`/
  `createResolverSlot` and instances) *plus* the ad-hoc hand-rolled boot-holder
  singletons (`tailProbeSlot`, `logTapSlot`, …), which **stay as one file per
  purpose** (see Consequences — the fold was withdrawn). Off the word:
  `mountSlot`→`mountChildren`; the range primitive is `MarkerRange`, never
  `RangeSlot`.
- **Frame** → the unit event of any Subscribable stream (`AgentFrame`, socket
  frames, `FrameSource` all reinforce it); broaden the glossary entry out of the
  Agents-only section.
- **Range** → `MarkerRange` (not bare `Range` — a DOM standard) + `RangeList`
  (not `KeyedRange` — unkeyed `{#for}` exists).

**Proposals overturned on evidence** (from the realignment stress passes):
`SurfaceManifest`→**`ProjectManifest`** (`Surface` is publicly loaded via
`AgentSurface`/`InspectorSurface`); `assembleCallable`→**`assembleRemoteFunction`**
(the product is the protected `RemoteFunction` type, and `assemble*` mirroring
the product type is the consistent convention vs `create*` for primitives).

**Master rename table (the load-bearing renames; internal unless marked):**

| Current | Proposed | Kind |
| --- | --- | --- |
| `./ui/dom/mountSlot` key + fn | `mountChildren` (+ `$$` alias) | **PUBLIC** (compiler-emitted plumbing; ~0 author blast radius) |
| `scope(build)` | `blockScope` | fn |
| `scopeGroup` + `.track` | deleted → `walkScopes` | fn/module |
| `createScope` | `createComponentScope` | fn |
| `scope()` / `scope.ts` | `currentScope()` / `currentScope.ts` | fn (key stays) |
| `enterScope`/`exitScope` | `enterRenderScope`/`exitRenderScope` | fn (keys stay) |
| `runWithRequestScope`/`RequestScopeInfo`/`requestScopeSlot` | `runWithRequestContext`/`RequestContext`/`requestContextSlot` | fn/type/slot |
| `RegistryManifests`/`RemoteRoutes`/`SocketRoutes`/`PromptRoutes` | `ProjectManifest`/`RpcManifest`/`SocketManifest`/`PromptManifest` | type |
| `AnalyzedComponent`/`analyzeComponent` | `ComponentPlan`/`componentPlan` | type/fn |
| `desugarSignals`/`renameSignalRefs`/`signalCallee` | `desugarReactive`/`renameReactiveRefs`/`reactiveCallee` | fn (compile "reactive", runtime leaf "signal") |
| `createRemoteFunction` | `assembleRemoteFunction` | fn |
| `buildSocketOverChannel`+`subscribableFromResponse` | `assembleSubscribable(FrameSource)` | fn/type |
| cache.ts read core | `callRegistry` (cache.ts → thin facade; ops split to siblings) | fn/module |
| — | `ScopeContext`, `MarkerRange`, `RangeList`, `FrameSource` | new types |

**Public cost of the entire realignment: one plumbing exports key**
(`mountSlot`→`mountChildren`), imported by no author. Renaming the public keys
`./ui/currentScope` / `enterRenderScope` / `exitRenderScope` down to bare words
is **rejected** as a manufactured break onto the more-overloaded word.

**Frozen and protected (do not rename):** all HTTP-method / web-standard names
(`GET`…`HEAD`, `json`/`jsonl`/`sse`/`redirect`/`cookies`/`request`/`env`,
`Response`/`Request`/`FormData`/`AbortController`/`URL`/DOM `Range`); the author
surface (`tail`/`watch`/`peek`/`pending`/`refreshing`/`done`/`online`/`refresh`/
`patch`/`state`/`props`/`html`/`snippet`/`effect`/`page`/`url`/`navigate`/
`socket`/`broadcast`/`health`/`reachable`/`log`/`trace`/`HttpError`/`error.typed`
and the augmentation interfaces); the reactive core, Plan/Skeleton family,
`Binding`, DOM runtime verbs, `Subscribable`/`Descriptor`/`Topic`/`Call`/`Doc`/
`Cell`, and the resolver-seam `Slot` instances.

**Phasing:** every internal rename rides the wave that already rewrites its
module — no standalone rename pass. The one public key change ships as its own
atomic low-priority commit now (pre-1.0, plumbing, zero author imports); it is
**not** held for a 1.0 break-batch. `CONTEXT.md` is updated to the target
vocabulary per wave as each rename lands.

## Consequences

- **Supersedes ADR-0012**, but adopts its invariant (ambient binding,
  branch-granular disposal) as Wave 1's guardrail. Do not re-pitch the
  two-system structure unless the `reseeds === 1` probe cannot be kept green
  under one tree — in which case 0012 stands.
- **Does not decide the questions ADR-0015/0016/0017 settled.** Wave 3 ships
  only the internal-dedup form that *respects 0017* — the resolver delegates to
  a producer table without extracting the side-crossing guard, and the single
  `describe()` is safe where the "universal catalog" 0015 declined was not
  *because it retains the live entry handle* (killing `tools/list`↔`tools/call`
  drift). Any guard extraction or true universal catalog remains 0015/0017's
  call and needs its own ADR.
- **Do not re-pitch:** a from-scratch internals rewrite; Proxy-based reactivity;
  a second type checker; renaming public export keys to bare words; renaming any
  frozen standard name; the large unifications a broader review rejected (one
  registry substrate, a shared `keyedRange`, `awaitBlock` absorbed into a generic
  range).
- **The `cache.ts` split is DEFERRED to the patch-bus round, not done now.**
  On validation, `cache.ts` has a single export (`cache`, a function with
  `.invalidate`/`.refresh`/`.patch`/`.peek`/`.on` attached inline; the public
  `refresh`/`patch`/`peek` modules are already thin wrappers over it), so there is
  no one-export-per-file violation, and `cache` is on the realignment's protected
  list. Decisively, **ADR-0001 already declined extracting the cache lifecycle**
  and named the exact re-propose trigger — "a persistent cache store with
  different settle semantics" — which *is* the patch-bus / local-first store, a
  future round. Splitting now would re-propose a declined change before its gate,
  turn tightly-coupled lifecycle internals (`registerEntry`/`notify`/`emit`/
  `fireRefetch`) into a cross-module API, and churn a hot path for ~0 net LOC. So
  the split, the `cache`→`callRegistry` rename, and the invertible-`Doc`-journal
  seam all move into the patch-bus round, shaped by the persistent store's real
  requirements. Wave 0's *mechanical* work (withoutHydration, buildArtifact) is
  therefore complete; BootShims and the cache split were its two non-survivors.
- **`BootShims` (the `*Slot` boot-holder fold) was attempted and withdrawn.**
  The clean-room review's premise — "~16 loose `*Slot` singletons, each
  independently forgettable → one typed object kills the silent-gap class" —
  did not survive contact with the code: (1) the `ssr-payload-slot-seeding`
  silent-gap it targeted is **already closed** by `seedBootState`'s `SEED` map,
  typed exhaustively over `SsrBootState` so a stamped `__SSR__` field cannot lack
  a seeder; (2) the capability fn-seams (`tailProbeSlot`, `logTapSlot`,
  `socketTapSlot`, `healthReadSlot`, the two probes) degrade to a **correct
  no-op** when uninstalled — no silent gap is possible; (3) the holders are
  **heterogeneous** (fn-seams vs SSR-seeded values vs transient render/call flags
  like `hydratingSlot`/`cacheManagedSlot` vs server-only infra like `serverSlot`),
  so one object would group by mechanism at the cost of per-concept clarity. Each
  current `*Slot` is one file, one export, one purpose, well-documented — already
  the CLAUDE.md ideal. Do not re-pitch the fold. (A pilot migration of the two
  probe slots was implemented green, then reverted on this finding.)
- **Capability payoff:** because Wave 0/1/4 land their seams invertible and
  pluggable, the patch-bus arc (undo/persist/local-first/multiplayer) becomes a
  bounded next round rather than another refactor of the same modules.
- **First concrete step:** this ADR + the `CONTEXT.md` glossary edits (Scope
  merge, Registry qualify, Frame broaden, Plan broaden, add `ScopeContext`/
  `RequestContext`/`MarkerRange`/`RangeList`/`FrameSource`) land *before any
  codemod*, so each wave renames straight to the agreed target instead of twice.
  Then the Scope-collapse wave runs first: its `walkScopes` / `track`
  de-collision is the load-bearing correctness change the rest depend on.
