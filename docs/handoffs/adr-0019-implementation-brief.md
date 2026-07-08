# Handoff brief — implement ADR-0019 (Agent B)

**Spec (read first, it is the contract):** `docs/adr/0019-async-computeds-and-rpc-auto-reads.md`
**Also read:** `CLAUDE.md` (coding guidelines), `CONTEXT.md` (domain vocab — use
"Probe"/"Registry"/"Build window"/"Lexical scope"/"Plan"/"Binding" exactly),
`AGENTS.md` (public surface).

## Goal

`state` holds; `computed`/`linked` track. Add the source-agnostic async-cell
primitive, unify it under the probe family, and make `{#try}` a reactive
both-directions error boundary. Everything here EXCEPT the bare-rpc auto-read (D1),
which waits for ADR-0020.

## Pre-step 0 (do first, standalone — both ADRs depend on it)

**Rename `Subscribable<T>` → `NamedAsyncIterable<T>`.** Shape unchanged
(`extends AsyncIterable<T>` + `name` + optional `tail`). Touches
`shared/types/Subscribable.ts` → `NamedAsyncIterable.ts`, `Socket.ts`,
`RemoteFunction.ts` (streaming return), the stream probes
(`pending`/`refreshing`/`done`/`error`/`peek`), `watch`/`cache.on`, the `exports`
map, and AGENTS.md. Land this as its own commit before the rest so Agent A branches
off the renamed file.

## Scope — IN

1. **The async-cell node — `AsyncComputed<T>` (read-only) / `AsyncState<T>`
   (writable).** Source-agnostic:
   - Facets self-tracked from the thunk's promise when nothing backs the cell;
     from the cache lifecycle channel (`markLifecycle`/`trackLifecycle`) when it
     wraps an rpc. Same surface either way.
   - **Eager first-run** at declaration (not lazy) — kicks the promise without
     awaiting, so independent cells run in parallel; `Promise.all` barrier at the
     SSR blocking flush. Stream cells subscribe eagerly; render `peek()` at flush.
   - `refresh()` = re-invoke the thunk (rpc: refetch; promise: re-run fn; stream:
     resubscribe). Kickoff attaches `.catch` → contained in `error()` (never an
     unhandled rejection).
   - `AsyncState` write rule = normal `linked`: a write holds until the next
     *reseed* (dep-driven new stream/promise); a **frame is not a reseed** and
     never clobbers a local write.
2. **Seed-kind dispatch (D1 model, minus the template auto-read):** `computed`/
   `linked` produce `Computed<T>` (sync) / `AsyncComputed<T>` (`await`) /
   `Computed<Promise<T>>` (bare promise) / `AsyncComputed<Frame>` (named async
   iterable, auto-track). **`state` stays a dumb value-taker — never wrapped.**
3. **Probe unification.** Register async cells as probe sources alongside rpc/
   socket/stream. Probes are **always methods** (`cell.peek()`, `cell.pending()`,
   `cell.refreshing()`, `cell.error()`, `cell.refresh()`) + standalone forms.
   **Async cells have NO `.value`** (sync `State`/`Computed` keep `.value`); the
   line is *sync → `.value`, async → probes*.
4. **The `computed`/`linked` wrap transform** (compile):
   - Wrap-vs-literal-thunk predicate: wrap unless the arg is literally an
     arrow/function expression. Targets `computed`/`linked` only — **`state` is
     never wrapped.**
   - `await`-present → async lowering (eager, `async () => await EXPR`); bare
     promise → `Computed<Promise<T>>`; sync → `Computed<T>`.
   - **Post-await tracking lint = WARNING** (a signal read after the first `await`
     is untracked). Use `REACTIVE_CALLEES` analysis.
5. **Reactive `{#try}` (D3):**
   - Ambient `CURRENT_BOUNDARY` (mirror `CURRENT_SCOPE`); effect→boundary
     association via `WeakMap<ReactiveNode, Boundary>`, populated only for effects
     built inside a `{#try}` (keep node shape monomorphic; look up only on the
     cold throw path).
   - `flushEffects.ts` `drain()`: on a throwing node, route to
     `boundary.handle(error)` before falling back to collect-and-rethrow.
   - `tryBlock.ts`: render-once → render-many (range markers — SSR already emits
     `<!--abide:try:N-->`; the CSR path must emit them too) + **keep-the-watch**:
     on catch, subscribe to the throwing cell (`AsyncCellError { cell, error }`)
     so recovery (error→value) re-arms guarded fine-grained; `err` updates in
     place on catch→catch.
   - **Value-aware throw:** the compiled bare read throws only on *error AND no
     retained value* (a failed refresh with a retained value stays visible — SWR);
     pending → `undefined`; the throw is template-lowering (JS `peek()` never
     throws).
   - **Non-reactive throws are terminal** (v1): `{:catch err, retry}` reset handle;
     no coarse re-run.
   - SSR blocking barrier awaits `allSettled`, not `all`.

## Scope — OUT (deferred)

- **D1 — the bare-rpc auto-read** (`{getUser()}` → reactive `peek` + trigger). It
  sits on the smart-read call surface ADR-0020 rewrites (`fn(args)`), so **do it
  AFTER 0020 lands.** A separate small pass.
- v2 auto-streaming bare reads (deferred in the ADR).
- Non-reactive-throw coarse re-run (terminal-only in v1).

## Files (ownership)

- `ui/computed.ts`, `ui/state.ts`, `ui/linked.ts` — primitives + transform targets
- `ui/runtime/*` — new async-cell node, `createComputedNode`, `CURRENT_BOUNDARY`, `flushEffects.ts` (drain edit), `createEffectNode.ts` (WeakMap capture), the `Boundary` type
- `ui/dom/tryBlock.ts` — render-many rewrite (`awaitBlock.ts` mostly untouched; `applyResolved.ts` desync guard already fixed)
- `ui/compile/*` — the wrap transform (`desugarSignals`/`lowerScript`), `generateBuild`/`generateSSR` for reactive `{#try}` (range markers), the tracking-lint warning, `tryPlan`
- `shared/` probes — `pending.ts`/`refreshing.ts`/`peek.ts`/`refresh.ts` extended to cells (+ a cell `error` probe); the async-cell facet type
- `shared/types/Subscribable.ts` → `NamedAsyncIterable.ts` (pre-step 0)

## Coordination (overlap with Agent A / ADR-0020)

- `RemoteFunction.ts` — Agent A adds cache-policy fields; you only touch the
  streaming-return type (via pre-step 0). Keep off the call signature and policy.
- Cache lifecycle channel (`createCacheStore`/`markLifecycle`) — you *read* it for
  rpc-backed cells; Agent A rewrites `readThrough`, not the lifecycle channel. Low
  overlap.

## Done criteria

- `computed(await x)`/`linked(await x)` yield facet-bearing async cells;
  `computed(getStream())` auto-tracks latest frame; `state(x)` holds opaquely.
- Probes work uniformly on cells + rpc + socket + stream, all method-form.
- Reactive `{#try}` swaps both directions for cell errors, terminal for
  non-reactive throws; catch→success heals via `refresh()`.
- `NamedAsyncIterable` everywhere; `exports`/AGENTS.md synced.
- Typecheck + tests green. `bun format` touched files (biome ignores `src/lib` —
  match surrounding style).
