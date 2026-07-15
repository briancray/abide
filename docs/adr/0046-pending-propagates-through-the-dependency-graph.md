# ADR-0046 — pending propagates through the dependency graph

**Status:** accepted (2026-07-15); implemented 2026-07-15. Amends [ADR-0042](0042-await-means-resolved-client-suspends-to-mirror-the-flush-barrier.md): keeps its "`await` = resolved `T`, suspend-on-pending" semantics but replaces its D5 **read-callee** mechanism (a distinct `$$readCellBlocking`, threaded blocking set, client-template-only) and extends the suspend to **script** reads. Builds on ADR-0042's `SuspenseSignal` channel (D3), the fine-grained per-region catch (D2, as-shipped), and the `$$settleAsyncCells` barrier (ADR-0019 Tier-2).

## Context

ADR-0042 made a pending `await` cell **suspend** its reader — but only at **template** read sites, and only by emitting a *different* read callee there (`$$readCellBlocking` vs `$$readCell`), with the "which names are blocking" set threaded through `renameSignalRefs` / `lowerContext` / `generateBuild` and populated on the **client template lowering only**. A **script** read — a `computed`/`linked`/derive seed, e.g. `computed(() => result.root)` over a blocking `result` — kept the plain peek, returning `undefined` while pending. On a cold client nav (no warm-seed) that peek handed downstream script derivations `undefined`, and a structural read (`result.root`) crashed the mount. This was the reported `~/code/media` bug: in belte `$derived(await …)` propagated *pending* through the whole derived graph; in abide only template reads suspended, so pending stopped at the script boundary.

The read-site split is also the wrong seam: whether a read pauses is a property of the **cell** (did its seed carry `await` → does it join the SSR barrier), not of *where* it is read. Encoding it per-site forced a blocking set through four compile passes and a client/SSR asymmetry.

## Decision

Model the whole thing as one rule: **each cell is a node in the dependency graph; `await` marks a node whose branch *pauses* (is pending) until it resolves; pending propagates down dependency edges like any value.** Only the graph's boundaries — a rendering region, the SSR await — actually block on a pause. Middle nodes need no special logic.

### D1 — blocking is a property of the node, read through one callee

There is one read, `$$readCell(name)`, everywhere (script and template, client and server). For an async cell it consults the cell's own `blocking` bit (`createAsyncCell`, set from the same `streaming` flag that decides SSR-barrier registration — `blocking === !streaming`): a pending **blocking** cell throws `SuspenseSignal`; a pending **streaming** cell peeks `undefined`. `$$readCellBlocking`, the `blockingCellNames` threading through `renameSignalRefs`/`lowerContext`/`generateBuild`, and the client-only asymmetry are **deleted**. The shadow type still derives blocking-ness from the same `hasTopLevelAwait` walk (ADR-0042 D5 unified predicate), unchanged.

### D2 — a pause is a value that flows down edges

A read of a pending blocking node throws; whatever reads *it* inherits the pause. Middle nodes add nothing:

- **A sync `computed`/derive** (`computed(() => result.root)`) has no try/catch — the `SuspenseSignal` propagates through its lazy read to the enclosing region, which catches it and withholds, re-running when the branch resolves (the throwing read subscribed the chain to the pending cell).
- **An async cell seed** (`computed(await f(dep))`) that reads a pending `dep` **stays pending, not error** — the throw arrives synchronously (`run`) or as the thunk's rejection (`settleError`); either way a `SuspenseSignal` is treated as pause, never latched into `error()`. The seed subscribed to `dep` during its synchronous prefix, so it re-runs and produces the real source once `dep` settles.

Two reactive-core adjustments make edges honest across a pause:

- **`readNode`** records the reader→node subscription even when the node's compute throws (track in a `finally`, computed branch only — the signal fast-path is untouched). An edge to a currently-paused node is still an edge.
- **`runNode`** settles a node that threw to `CLEAN` (value left stale) so a later change to the deps it *did* track re-marks it `DIRTY` and re-propagates to its subscribers; left `DIRTY`, `mark`'s status gate would treat the settle's `CLEAN→DIRTY` edge as already-dirty and leave the node permanently inert. This is the same reset `flushEffects` already applies to a thrown effect.

### D3 — the SSR barrier drains to a fixpoint

`settleAsyncCells` loops (`while (promises.length) await allSettled(splice(0))`) instead of awaiting one snapshot. A blocking cell whose seed reads a still-pending blocking dependency pauses and registers no promise; when the dependency settles *inside* the barrier the reactive flush is synchronous, so the dependent's seed re-runs with the dependency resolved and registers its promise — which the same drain then awaits. Chained blocking cells resolve in order and bake correct values into the first-pass HTML (before, a dependent read its dependency as `undefined`). Per-render list isolation (`isolateCellBarrier`) keeps the loop draining only this render's cascade.

### D4 — a non-node cannot pause

A pause only exists on a graph node. An *eager* top-level script read of a blocking cell (`const root = result.root`, a plain const — not a `computed`/derive) is not a node: it has no branch to pause and no reactive region to re-run it, so a pending read throws a `SuspenseSignal` into nothing and is fatal at mount (as `undefined.root` already was). Read a blocking cell inside a `computed`/derive or the template, never as a plain top-level value.

## Consequences

- **The `~/code/media` crash is fixed at the model level.** A script derivation over a blocking cell suspends its region instead of dereferencing `undefined`, both on cold client nav and (via the fixpoint barrier) in chained SSR.
- **Less machinery, not more.** One read callee; no blocking set threaded through the compiler; blocking-ness lives on the cell where the SSR-barrier flag already lives. `$$readCellBlocking` (and its export) are removed.
- **Breaking:** a script read of an `await` cell now **suspends** where it previously peeked `undefined`. Code that relied on the peek (reading a pending blocking cell in script and tolerating `undefined`) now withholds until settle. Bare/streaming reads (no `await`) are unchanged. Examples migration + changeset.
- **The throw paths are inert unless a blocking cell is actually pending at a read** — on SSR the barrier resolves blocking cells before the template, and on hydrate warm-seed makes them `refreshing()` not `pending()`, so the suspend machinery does not fire on the common paths (measured: no render-time regression).

## Alternatives considered

- **Thread the blocking set into the script pass too** (keep `$$readCellBlocking`, just emit it in script). Rejected — it keeps the per-site distinction and the four-pass threading that the node-property model deletes; the read site is the wrong place to know blocking-ness.
- **Make eager top-level reads a compile error** (D4 as a diagnostic). Deferred — the model already makes them incoherent (a non-node can't pause); a dedicated diagnostic is a separable DX addition, not part of the semantic.
- **A `blocking` flag distinct from `streaming`** so cache/socket reads could pause independently. Rejected — for every compiler-lowered cell `blocking === !streaming` (barrier-join and pause-on-read are the same property), so one bit is the honest expression.
