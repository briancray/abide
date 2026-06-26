# ADR-0012: The lexical scope and the build window are two lifetimes, not one

**Status:** accepted (2026-06-26)

## Context

An architecture review of `scope()` flagged that a component instance is tracked
by two parallel systems and asked whether they should merge:

- The **lexical scope** (`Scope` / `CURRENT_SCOPE` / `createScope` / `withScope`)
  — *component*-granular. Owns the reactive doc, the boundary-crossing
  capabilities (`record`/`persist`/`broadcast`), context (`share`/`shared`),
  identity (`id`), and the explicit `child()` tree.
- The **ownership build window** (`OWNER` / `scopeGroup` / `runtime/scope.ts`)
  — *finest*-granular. Collects effect/listener disposers for one synchronous
  build: a component, but equally a control-flow branch or a list row.

Two findings came out of spiking the merge:

1. **A full merge is wrong.** The two systems encode two *different disposal
   granularities*, and that difference is load-bearing. A reactive cell created
   inside a control-flow branch must die when the **branch** flips, not when the
   whole component unmounts. `OWNER` tracks that finer window; the lexical scope
   does not. Binding the reactive primitives to the lexical receiver instead was
   spiked and demonstrably leaks: a `scope().linked()` built in a branch kept
   reseeding after its branch was disposed (a focused probe failed
   `reseeds === 1`, observing `2`). Reverting to the ambient `OWNER` binding made
   it pass. Inside a branch `scope()` resolves the *component* scope (branches
   establish only an `OWNER` window, not a lexical scope), so receiver-binding is
   strictly coarser than correct.

2. **The teardown *interface* was the only real smell.** A component's two
   teardowns were hand-composed at every mount site as `stop(); lexical.dispose()`
   (`mount`, `hydrate`, `disposeRange`). That seam was collapsible without
   touching granularity: the lexical scope now *adopts* the build's reactivity
   stopper (`own`) and runs it first on `dispose`, so every site tears down with
   one `lexical.dispose()`.

The reactive doc adoption contract was also implicit: a scope created in
`awaiting` mode ADOPTS the first `doc()` its component body creates, so the
compiler emits one data-lowering for scope-owned and plain components alike.

## Decision

- Keep the lexical scope and the ownership build window as **separate
  lifetimes**. Do not delete `OWNER`/`scopeGroup` into the `Scope` tree; their
  finer granularity is the point.
- The reactive primitives reached through a scope (`state`/`linked`/`computed`/
  `effect`) are **ambient-bound, not receiver-bound**: they create their cell in
  whatever scope is rendering and own teardown to the finest ambient build
  window. The scope is namespacing only (`scope()` is the sole public entry); the
  data methods (`read`/`replace`/`cell`/`derive`/…) remain receiver-bound to the
  scope's doc. This split is stated at the `Scope` type and in `createScope`.
- A component has **one teardown**: `Scope.own` adopts the build's stopper, and
  `dispose` runs it first (reverse order), then children, then capabilities.
  `withScope` returns `{ lexical }`; no caller composes a separate `stop()`.
- The `awaiting`/first-`doc()` adoption contract stays — one data-lowering path.

## Consequences

- Do not re-suggest merging the two ownership systems, nor receiver-binding the
  reactive primitives — both reintroduce the branch-granularity leak above.
- `Scope.children` (the explicit `child()` tree) is *not* redundant with
  `scopeGroup`: it disposes lexical context children; `scopeGroup` disposes
  build-window children. The deletion test passes for both — each earns its keep
  at its own granularity.
- A residual unification *is* possible but out of scope here: control-flow
  ownership is threaded through `fillBefore`'s `scope()`, used with two different
  ownership intents (a component child vs a branch). Untangling that is the
  prerequisite to any deeper merge and should be its own effort, not folded into
  the teardown-interface collapse.
- The adoption contract is enforced only by the `awaiting` flag and the doc
  lowering; a body that never creates a `doc()` still mints an empty one lazily.
