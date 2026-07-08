# Handoff brief — implement ADR-0023

**Spec (read first, it is the contract):** `docs/adr/0023-type-directed-cell-classification.md`
**Also read:** `CLAUDE.md`, ADR-0019 (the async-cell model this extends), ADR-0010 (the shadow), and the ADR-0019 stage-A/B code you are reusing (`classifyInterpolationType.ts`, `interpolationClassifierForRoot.ts`, `nodeAtShadowOffset.ts`).

## Goal

Make the `computed`/`linked` no-marker stream decision type-directed (reusing the warm shadow classifier) instead of the `isBareCallComputed` syntax guess, so a stream produced by any expression shape auto-tracks and a provably-sync seed skips the runtime probe — fail-open to today's exact behavior when no warm program is available. The `await`-marker path (`isAsyncComputed`) stays syntactic and untouched.

## Hard rules
- **NEVER run git** (no checkout/switch/branch/commit/stash/reset/add). The orchestrator owns all git.
- biome ignores `src/lib` — hand-style there to match the surrounding file; `bun run format` files outside `src/lib`.
- Do not run `readmeSurfaces.ts` / regenerate AGENTS.md (this change touches no public export).
- **Fail-open is non-negotiable.** Any resolution failure (no program, no mapping, no node, checker throw) MUST degrade to today's `isBareCallComputed` + `trackedComputed` path. A type-resolution problem can never break a build. If you cannot guarantee this, STOP and report — do not ship a hard checker dependence.

## Sequencing

1. **Discovery FIRST — resolve the load-bearing open question before writing any lowering.** Do not guess. Confirm whether the shadow `mappings` resolve a `<script>`-region source location to a usable shadow offset:
   - Trace `createShadowProgram.ts` and whatever builds `shadows.get(abidePath).mappings` (the `sourceToShadowOffset` input). Determine whether the mappings cover the `<script>` region or only template interpolations.
   - Write a throwaway probe (a test or a scratch script) that takes a real `.abide` with `const s = computed(getStream())`, builds the warm program, and checks that `sourceToShadowOffset(mappings, <seed source loc>)` returns an offset landing on the seed expression in the shadow, and that `checker.getTypeAtLocation(node)` on the node there yields the seed's real type.
   - **Produce a short findings note** (`docs/handoffs/adr-0023-mapping-findings.md`) recording: does the script region map? with what offset semantics? Then proceed, adjust, or escalate per below.
   - If the script region is NOT mapped with usable offsets: STOP and report. The ADR names two fallouts — a prior step to extend the shadow mapping to the script region, or defer. Do not force it.

2. **Implement D1 + D2** (one workstream) once discovery confirms the mechanism.
3. **D3 (`linked` probe-skip)** — optional second increment; do NOT block D1/D2 on it. The correctness win is entirely in `computed` (D1).

---

## D1 + D2 — the type-directed routing + the threading

**The classifier already reaches the caller.** `analyzeComponent` holds `classify` (`analyzeComponent.ts:28`) and calls `lowerScript` (`analyzeComponent.ts:95`); `lowerScript` (`lowerScript.ts:56`) calls `desugarSignals` (`desugarSignals.ts:181`). Thread a seed-type resolver down these two hops as an **optional** parameter.

**Files**
- `packages/abide/src/lib/ui/compile/` — a new seed-type resolver, sibling to `interpolationClassifierForRoot.ts`. It shares the warm `ShadowProgram` (do not build a second program). Signature shape: given a seed `ts.Expression` (from the component-script AST) plus whatever source-location info the mapping needs, return an `InterpolationKind` (`'asyncIterable' | 'promise' | 'sync'`), wrapping the whole body so any throw returns `undefined`/`'sync'` (fail-open, copy the discipline in `interpolationClassifierForRoot.ts:45-60`). Reuse `classifyInterpolationType` verbatim for the type→kind step. The new piece is script-region offset mapping + a seed-aware node finder (the seed is not an interpolation's parenthesised exact-span shape — `nodeAtShadowOffset` may need a variant; decide from discovery).
- `packages/abide/src/lib/ui/compile/desugarSignals.ts`
  - Replace `isBareCallComputed` **as the classification authority** in the two dispatch sites (`desugarSignals.ts:252` name-collection, `:538` lowering) with: if the resolver is present and resolves the seed, route on `kind` — `asyncIterable` → `trackedComputed` (`cellReadNames`, `$$readCell`); `promise`/`sync` → lazy `derive` (`computedNames`, `name()`). If the resolver is absent or returns nothing, fall back to `isBareCallComputed` (keep the function — it is the fail-open path).
  - `isAsyncComputed` (the `await` marker, `:78`) stays first and unchanged.
  - **Keep the two dispatch sites in lockstep.** The name-collection pass (`:214-268`) and `computedStatements` (`:501`) must make the identical decision for a given declaration, or a binding lands in the wrong read-name set (`cellReadNames` vs `computedNames`) and its references lower to the wrong read form. Route both through one shared predicate that takes the resolver.
- `packages/abide/src/lib/ui/compile/lowerScript.ts` + `analyzeComponent.ts` — thread the resolver param through (optional; default undefined = fail-open).

**Watch:** the read-form coupling. `cellReadNames` → `$$readCell(name)`; `computedNames`/`derivedNames` → `name()`. Moving a seed between buckets changes how every reference to it lowers (the reference-renaming pass reads these sets). A bare-promise seed that today lands in `cellReadNames` (via `isBareCallComputed`→`trackedComputed`) will, under type-direction, land in `computedNames` (`derive`, held opaque). Confirm both yield a `Promise`-returning read at the use site and that no test asserts the old `$$readCell` form for a bare-promise computed. Adjust affected tests to the refined (correct) routing; do not preserve a wrong old shape.

## D3 — `linked` probe-skip (optional second increment)

`linked` always lands in `cellReadNames` and the runtime primitive probes its seed, so there is **no correctness gap** — only the same probe-skip perf opportunity as `computed`'s sync case. If done: annotate `cellStatements` (`:481`) to emit a lazy-only form for a provably-sync `linked` seed. Leave `linked`'s read form (`$$readCell`) unchanged. Skip if it complicates the D1 landing.

## Done criteria (D1 + D2)
- `bun run typecheck` → 0; `bun run test` → green.
- **New tests** (extend `asyncCell.test.ts` / `asyncCellTransform.test.ts`, mirror `typeDirectedInterpolation.test.ts`'s warm-program setup):
  - `computed(cond ? streamA : streamB)` (conditional) and `computed(obj.stream)` (member access) — where the type is a stream — now route to `trackedComputed` / `$$readCell` and auto-track frames. This is the headline correctness fix; assert it fails on `main` (shape heuristic misses it) and passes here.
  - `computed(syncFn())` where `syncFn: () => number` routes to the lazy `derive` slot (no `trackedComputed`) — assert the emitted shape.
  - **Fail-open:** a component compiled with no warm program (resolver absent) reproduces today's `isBareCallComputed` routing byte-for-byte. Prove the degradation path.
  - `computed(await load())` (the `await` marker) is unchanged — still the eager `computed` async cell.
- **Verify by driving a real compile**, not only unit shape assertions: compile a `.abide` whose template reads a `computed(obj.stream)` cell and confirm the frames drive a re-render (the interpolation updates), which the shape-directed `main` does not do.
