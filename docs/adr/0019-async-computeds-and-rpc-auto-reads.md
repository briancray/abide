# ADR-0019: Async values — `state` holds, `computed`/`linked` track, and a reactive `{#try}`

**Status:** accepted (2026-07-08). Not yet implemented. Supersedes nothing;
narrows the authored role of `{#await}`, expands `{#try}` into a reactive error
boundary, and unifies async reads under the probe family. Shares the
"one-source-of-truth, fail-closed, high-visibility" design instinct with
[ADR-0020](0020-cache-policy-on-the-endpoint.md) — `state` is the sole dumb
primitive there as the endpoint is the sole policy source here.

## Context

`{#await}` is the only way, today, to read a promise in a template: it owns
promise-lifecycle rendering (pending / then / catch / finally), the
blocking-vs-streaming SSR split, and — via the post-stream cache drain — the only
path that keeps the SSR response stream open (`createUiPageRenderer.ts:205`
hard-returns a buffered response when `ssr.awaits.length === 0`; only
`generateStreamingAwait` pushes `$awaits`).

Two facts make it redundant for the *common* case:

- **Probes already unify async reads.** `peek` / `pending` / `refreshing` /
  `refresh` / `error` are standalone reactive probes with instance sugar
  (`fn.peek(args)` ≡ `peek(fn, args)`) that already **span rpc calls and socket
  streams** (`RemoteFunction.ts:68-77`). `peek`'s type already returns the latest
  frame for a stream and the value for a point-read
  (`peek(args): ([Return] extends [AsyncIterable<infer Frame>] ? Frame : Return) | undefined`).
- **`state.computed` is a lazy sync thunk today** (`computed.ts:17`, `() => T`);
  it does not track pending / error. That capability lives only in `{#await}`.

The model, in one sentence: **`state` holds a value; `computed`/`linked` *track*
an async source; everything tracked is a probe source.** The `await`/no-`await`
distinction from JavaScript carries through the tracking cells.

## Decision

### D1 — `state` holds, `computed`/`linked` track

**`state` is a dumb value-taker — always.** `state(x)` holds `x` opaquely,
whatever it is: a value, a `Promise<T>`, a `NamedAsyncIterable<Frame>`. No
awaiting, no subscribing, no tracking, ever. `state(getFoo())` holds the
`Promise<T>`; `state(getStream())` holds the iterable. If you want either
*tracked*, use a
thunk-taker. This keeps `state`'s meaning airtight and puts *all* async/reactive
behavior in the two thunk-takers.

**`computed` (read-only) / `linked` (writable) track their seed by its kind.** An
async cell requires a re-runnable thunk, which only these two have:

| seed kind | `computed(…)` | `peek` | marker |
|---|---|---|---|
| sync value | `Computed<T>` | — (`.value`) | — |
| `Promise<T>`, awaited | `AsyncComputed<T>` | resolved value | **`await`** |
| `Promise<T>`, bare | `Computed<Promise<T>>` | held opaque | — |
| `NamedAsyncIterable<Frame>` | `AsyncComputed<Frame>` | latest frame | none (self-identifying) |

`linked(…)` is the same table, writable/reseeding — `State<T>`,
`AsyncState<T>`, `State<Promise<T>>`, `AsyncState<Frame>`.

A stream source is a **`NamedAsyncIterable<T>`** — literally an `AsyncIterable<T>`
carrying a stable `name` (the subscription-registry key); `Socket` and a streaming
rpc's bare call both satisfy it. (This renames the existing `Subscribable<T>` type
— see Consequences — because "subscribable" tells a reader nothing, while
`NamedAsyncIterable` says the two things that matter: you can `for await` it, and
it has an identity.)

**The marker asymmetry (deliberate, legible).** A **promise** is ambiguous —
holding it (to pass / `{#await}`) and unwrapping it are both legitimate — so the
`await` marker disambiguates. A **`NamedAsyncIterable` auto-tracks with no
marker**, because (1) there is no expression-level `for await` to write, (2) it
*declares itself* an async iterable (`Symbol.asyncIterator`) whereas a Promise does
not, and (3) holding one opaque in a reactive cell is never useful. So: *a promise
is ambiguous → the marker decides; a named iterable is self-identifying → the cell
tracks it.* Both land in the same probe surface.

**The `for await` sibling axis.** `await` unwraps a promise to `T`; `for await`
iterates an async iterable's frames. abide already has both template blocks —
`{#await}` for promises, `{#for await (frame of s)}…{:catch}…{/for}` for streams
(`parseTemplate.ts:326,350`). Streams don't get the `computed(await …)` sugar
(`for await` isn't an expression); they are cell-tracked via `computed(stream())`
/ `linked(stream())` (auto-track, above) and iterated in templates via
`{#for await}`.

**Async cells are probe sources — no new surface.** `AsyncComputed` /
`AsyncState` register in the same registry as rpc references and sockets and wear
the *identical* probes:
```
peek(cell)      ≡ cell.peek()        // T | undefined (or Frame for a stream)
pending(cell)   ≡ cell.pending()
refreshing(cell)≡ cell.refreshing()
error(cell)     ≡ cell.error()
refresh(cell)   ≡ cell.refresh()     // re-invoke the thunk (rpc: refetch; promise: re-run fn; stream: resubscribe)
```
The probes are **always methods**, never properties — uniform with the
args-scoped rpc/socket/stream probes (`fn.pending(args)`), so the no-arg cell form
is just `cell.pending()`; no property alias re-forks the surface.

**One conceptual line: `.value` = synchronously available (sync `State`/
`Computed`); probes = may-be-pending (rpc, socket, stream, async cell).** The
`await`/named-iterable markers are exactly the sync→async switch — an async cell has
**no `.value`**, you `peek()` it, like every other async source. `AsyncState`
(writable) adds `cell.set(v)` (stays in the method family) and a `bind:value`
sugar composing `peek`/`set`. **The write rule is normal `linked`: a local write
holds until the next *reseed*.** For a stream cell this is load-bearing —
distinguish three inputs: a **reseed** (deps change → the thunk produces a *new*
stream) replaces the value and clears the write, exactly like sync `linked`; a
**frame** (the same stream pushes) is *not* a reseed, so it updates the value only
while unwritten and **does not clobber a local write** (otherwise a high-frequency
stream would erase edits within milliseconds); a **write** latches until the next
reseed. So while an edit is held the cell shows your value, frames arrive into the
background, and a reseed snaps it live again. (Last-event-wins — frames override
writes for optimistic-echo UI — is the coherent alternative, rejected as default
because it adds a rule sync `linked` lacks. Live-collaborative reconciliation is
out of scope — app-level `patch`/CRDT.)

**Reading in templates.**
- **Async cell / bare rpc read** (`{user}`, `{#each getTodos() as t}`,
  `{#if getFoo()}`): the compiled read is a **throwing peek** — throw-on-error-
  no-value, `undefined`-on-pending, value otherwise (see D3). The throw is a
  *template-lowering* behavior, not a facet: `cell.peek()` in JS **never throws**.
  The read type is `T | undefined`; the author handles `undefined`
  (`?.`, `{#if x.pending()}`) and errors locally (`{#if x.error()}`) or by letting
  the throw reach `{#try}`. This applies **uniformly in every position** — leaf,
  `{#if}` test (undefined is falsy), and `{#each}` iterable (**pending `undefined`
  is treated as empty, never a throw**, so loading ≠ error).
- **`Computed<Promise<T>>`** (bare promise cell): not a direct-interpolation form
  — render with `{#await foo}` or consume in JS.
- **Sync `Computed<T>` / `State<T>` / plain values:** read directly via `.value`.

**The rpc case of the throw-on-read lowering** (an rpc source):
- **Client:** the read must subscribe to the lifecycle channel *and* **trigger**
  the cold fetch — `peek` alone is non-triggering. Lowered as "trigger the smart
  read, return `peek()`."
- **Server:** `peek`-only — no fetch, no block, returns `undefined`; lands in the
  buffered branch (no `$awaits` push), so the shell ships immediately and the
  client fetches on hydrate.

**The three SSR tiers** — the author picks by *how they read*:

| authored form | server | client |
|---|---|---|
| bare read `getUser.peek({id})` / `computed(getUser({id}))` | renders `undefined`, ships **buffered** | refetches on hydrate, re-renders on settle via lifecycle wake |
| `const u = await …` · `computed(await …)` blocking · `{#await p then v}` | awaited inline, snapshotted into `__SSR__` (in the HTML) | warm, no refetch — *blocking / awaited* |
| `{#await p}…{:then v}…{/await}` (separate `:then`) · `{#for await …}` | streams: pending shell + out-of-order resolved fragment | adopts streamed branch, no refetch — *streaming / promise* |

A **stream cell** renders its `peek()` (latest frame or `undefined`) at flush —
you can't block an SSR barrier on an unbounded stream — so it is Tier-1 buffered
unless streamed explicitly via `{#for await}`.

**`{#await}` sits on the same axis, unchanged** (`awaitPlan.ts`: `blocking =
then-on-tag`): `{#await p then v}` is the blocking/awaited form (matching
`await p` / `computed(await p)`); `{#await p}…{:then v}` is the streaming/promise
form (the canonical way to render a `Computed<Promise<T>>`). Exactly today's
behavior; the model just names the axis the block already rides.

### D2 — the `computed` / `linked` transform

`state.computed(EXPR)` / `state.linked(EXPR)` accept an expression; the compiler
wraps it into the runtime thunk, choosing the seed-kind case (D1) by the
expression's shape. The runtime signature stays `computed(() => T)`.

The transform targets **only the thunk-takers** (`computed`, `linked`). Plain
`state` is a value-taker — its arg is passed through untouched (wrapping a value
in `() =>` would be wrong, and `state` has no thunk to make async). So
`state(await p)` awaits normally at construction (a blocking `State<T>` seed);
`state(p)` / `state(stream)` hold opaquely — none rewritten.

**1. Wrap-vs-literal-thunk predicate.** Wrap **unless** the argument AST node is
literally an arrow-function or function expression.
- `computed(() => x)` / `computed(function () { … })` → **literal thunk**, passed
  through (the `.by`-style escape hatch for multi-statement bodies).
- `computed(x)`, `computed(getFoo())`, `computed(getFoo)`, `computed(await bar())`
  → **wrapped**.
- Consequence: `computed(someFn)` means `computed(() => someFn)` — one unambiguous
  rule; no reference/thunk guessing.

**2. Async lowering: eager first-run + parallel + `Promise.all` at the blocking
boundary.** An async cell is **eager**, unlike a sync `computed`.
- The transform emits the reactive thunk **and** fires the cell's first run at the
  declaration site, *without awaiting it*:
  ```
  const foo = state.computed(await bar())
  const qux = state.computed(await baz())
  ```
  lowers to:
  ```
  const foo = state.computed(async () => await bar())   // thunk → reactive re-runs
  const qux = state.computed(async () => await baz())
  // runtime kicks foo's and qux's FIRST run here, in source order, awaiting neither
  ```
  Both first-runs start before any await → `bar()` and `baz()` in flight
  concurrently → latency `max(bar, baz)`, not the sum. **The transform must not
  emit `const foo = await bar()`** — that is the sequential waterfall it exists to
  avoid. (This is why it can only be a compile-time transform: a runtime
  `computed` would receive the already-resolved value — thunk and concurrency gone
  before it runs.) Stream cells subscribe eagerly too.
- **Independence ⇒ parallel falls out of the reactive graph; no analysis needed.**
  A dependent cell reads its dependency synchronously (call args evaluate before
  the call), so it is tracked before the cell's own first `await`:
  ```
  const zed = state.computed(await baz(foo.peek()?.id))  // reads foo → dependent
  ```
  `zed` re-runs when `foo` settles; cells sharing no reads never serialize.
- **Blocking / SSR-inline tier** awaits all still-pending *promise* cells together
  (`Promise.all` over the component's pending cells at the flush boundary). Stream
  cells render `peek()` at flush (no blocking on an unbounded stream).
- **Eagerness tradeoff — document.** A sync `computed` stays lazy; an async cell is
  eager (its work starts at declaration whether or not read). The price of
  parallel-by-default, correct for data-loading. Safe because a `computed` is a
  read/derivation — never a mutation.

**3. Post-await tracking lint — a *warning*.** Only dependencies read before the
first `await` in a wrapped thunk are tracked; a signal read after an `await` runs
in a later microtask, outside tracking, and silently fails to trigger re-runs. The
analyzer already tracks signal reads (`REACTIVE_CALLEES.ts`). Emit a compile
**warning** (not error) — there are legitimate post-await reads (a value captured
once at fetch time — nonce, timestamp, request id) and static detection is
imprecise; a hard error on an imprecise check is hostile (cf. React's
exhaustive-deps as a warning). Leave room to upgrade under a strict flag.

### D3 — Error handling: a reactive `{#try}`, both directions

`{#try}` / `{:catch err}` / `{:finally}` (`tryPlan.ts`, `parseTemplate.ts:233`) is
the boundary — no new construct. Its current runtime (`tryBlock.ts`) is
**synchronous and render-once**, so it catches a build throw and an *initial*
reactive-read throw, but **not** a throw from a *later* re-run — exactly where an
async error lives. This decision makes `{#try}` **fully reactive**: it is a
function of whether the guarded content currently throws, tracked both directions.

**Semantics (the model):** for any reactive change inside the boundary —
- **same state** (success→success or catch→catch) → **update in place**
  (fine-grained inner bindings; the `err` binding is reactive);
- **crosses the throw/no-throw line** (success→catch or catch→success) → **swap
  the block**.

**1. Kickoff always attaches `.catch` (mandatory plumbing).** The eager first-run
(D2.2) attaches a `.catch` landing the rejection in `error()` — contained, never
an unhandled rejection, never Bun-fatal (`createUiPageRenderer.ts:247`).

**2. Value-aware throw rule.** The compiled bare read (a throwing peek) resolves
to:
- **error *and no retained value*** → **throw** (→ nearest `{#try}`);
- error *with* a retained value → return the value (a failed background refresh
  keeps the stale value — SWR; error surfaced via `error()` / `refreshing()`);
- pending → `undefined`;
- resolved → the value.

The boundary swap is reserved for "nothing to render," not a revalidation hiccup.
Inspection probes (`peek()`, `pending()`, `refreshing()`, `error()`) **never
throw** — reading them is how an author handles an error *locally*.

**3. Mechanism: keep watching what threw.** The terminal alternative disposes the
guarded scope on throw, killing the only subscription to the failing dependency —
the boundary goes *deaf* to recovery (not oscillation; that worry is retracted —
re-arm is driven by an actual value change, so a rebuild reads good data). So the
throw carries the originating cell (`AsyncCellError { cell, error }`); on catching,
the boundary renders catch **and subscribes to that cell's lifecycle**.
- **catch → success:** cell goes error→value (a `refresh()` or dep change) → the
  watch fires → dispose catch, rebuild guarded fine-grained. One rebuild, then
  surgical updates; focus/scroll/input survive same-state changes.
- **catch → catch:** a different error → update the reactive `err` in place.
- **success → catch / success → success:** normal fine-grained reactivity.

`onclick={() => user.refresh()}` heals the boundary — no manual `retry()` or
key-bump — because `refresh()` (re-invoke the thunk) drives error→value and the
watch hears it. Source-agnostic: works identically for a promise cell, a stream
cell, and an rpc.

**4. Non-reactive throws are terminal (v1).** A throw with no reactive source — a
plain render bug — carries no handle to watch, so catch→success is undetectable in
principle. Terminal until remount: the catch branch gets a `retry` reset handle
(`{:catch err, retry}`) that rebuilds guarded fresh, or the author remounts via a
key. This is correct — a bug is not a data state that self-recovers, and silent
auto-recovery from a bug is worse UX than a visible, explicitly-retried error. A
coarse re-run fallback is a strict superset, addable later without breaking this.

**5. Runtime cost (sketch).** A new ambient `CURRENT_BOUNDARY` (mirror of
`CURRENT_SCOPE`); an effect→boundary association via a `WeakMap<ReactiveNode,
Boundary>` populated only for effects created inside a `{#try}` (node shape
untouched → monomorphism preserved; looked up only on the cold throw path); a
~8-line addition to `flushEffects.ts` `drain()`'s existing catch to route a
throwing node to `boundary.handle(error)`; and a `tryBlock.ts` rewrite from
render-once to render-many (range markers — SSR already emits `<!--abide:try:N-->`
— plus the keep-the-watch swap). The only perf-sensitive edit is confined to the
scheduler's throw branch.

**6. SSR blocking barrier awaits `allSettled`, not `all`.** A rejected cell
settles into its error state rather than rejecting the whole render; the throw
happens at the read site, caught by the enclosing `{#try}` (or the page error path
if none). Per-region isolation, for free. (SSR `generateTry` already wraps guarded
content in `try/catch` with output truncation — the server tier is covered.)

**7. `{#await}` / `{#for await}` streaming is unchanged** — they keep their own
`:catch` branch and `controller.error` stream path (`createUiPageRenderer.ts:277`).

**8. Dev-mode warning (optional).** An eager cell that rejects but whose error is
never observed (never read, never watched) is contained-but-swallowed — safe, but
a possible hidden bug. A dev-only warning is cheap.

## Consequences

- **One async-read concept: the probe family.** rpc point-reads, streaming rpcs,
  sockets, promise cells, and stream cells all wear the identical
  `peek`/`pending`/`refreshing`/`error`/`refresh` surface (standalone + instance).
  `state` is the only cell with `.value` and the only one with no async magic.
- **`state(fn(args))` streaming sugar migrates to `computed`/`linked`.** Today
  `state(fn(args))` subscribes to a streaming rpc (`RemoteFunction.ts`). Under
  "state holds, computed/linked track," that becomes `computed(fn(args))`
  (read-only) / `linked(fn(args))` (writable, resubscribes on reseed). **Hard
  break** — no shim; `state(fn(args))` stops subscribing and holds the stream
  opaquely, so the migration is mechanical and the change is loud (a held
  `NamedAsyncIterable` where a frame value was expected fails fast, not silently).
- **`Subscribable<T>` → `NamedAsyncIterable<T>`.** Rename the existing
  `shared/types/Subscribable.ts` and its usages (`Socket`, streaming-rpc return in
  `RemoteFunction`, the `pending`/`refreshing`/`done`/`error`/`peek` stream
  probes, `watch`/`cache.on`) — plus the `exports` map and AGENTS.md surface. The
  shape is unchanged (`extends AsyncIterable<T>` + `name` + optional `tail`); the
  name now tells an unfamiliar reader it's a `for await`-able source with an
  identity, which `Subscribable` did not.
- **`{#await}` / `{#for await}` retained, unchanged**, on the same awaited/promise
  (blocking/streaming) axis. No new `{#stream}` primitive.
- **rpc/non-rpc split collapses.** One model for all promises and streams; rpc/
  socket are just cache-/registry-backed sources.
- **Removed authored notions for the common case:** the four await branch keywords
  are no longer *required* to read async data — pending / error / SWR collapse into
  `{#if x.pending()}` / `{#if x.error()}` / `{#if x.refreshing()}`, or into a
  `{#try}` boundary.
- **Traded away, consciously:** (1) `{:then value}` narrowing → honest
  `T | undefined`; (2) automatic SSR streaming for the bare-read path (client-
  fetched, Tier 1) — opt back in with top-level `await` (Tier 2) or `{#await}` /
  `{#for await}` (Tier 3).
- **Consistency with existing magic:** the transform is the same AST-rewrite family
  as assignment-reactivity (`desugarSignals.ts`, `lowerScript.ts`,
  `reactiveBinding.ts`). Well-precedented (Svelte's `$derived(expr)` /
  `$derived.by(thunk)`).
- **New runtime capability required:** the source-agnostic async-cell node (eager
  first-run, self-tracked lifecycle probes, `refresh()`, named-iterable auto-track),
  and the reactive `{#try}` (boundary context + render-many swap + keep-the-watch).
  This is the bulk of the work.

## Optional follow-up (v2 — auto-streaming bare reads)

To let a Tier-1 bare read *stream* its value without an `{#await}` — two deferred
changes:
1. Force streaming mode without an await block: keep the SSR stream open when any
   read is pending at render-return, draining cache frames the way the await path
   does (`createUiPageRenderer.ts:266-274`).
2. Make the streamed seed notify. `seedStreamedResolution` does a bare
   `entries.set()` with no lifecycle dispatch (relies on seed-before-mount
   ordering); it must fire `markLifecycle(key)`.

A half-built seam exists: the `<abide-cache>` tag frame in `applyResolved.ts:32-38`
is a consumer with no producer — v2 lights it up.

## Open questions

*All resolved — recorded here for the trail:*

- **`state(fn(args))` migration → hard break** (D1 / Consequences). No shim;
  `state(fn(args))` stops subscribing and holds the stream opaquely, so the change
  fails fast rather than silently.
- **`AsyncState<Frame>` write semantics → write latches until reseed** (D1). A
  frame is not a reseed, so incoming frames update the value only while unwritten
  and never clobber a local write; only a reseed (new stream via dep change) clears
  it. The literal sync-`linked` contract; live-collab reconciliation is app-level.
- **Facet call-form → always method** (D1). `cell.pending()`, uniform with the
  args-scoped rpc/socket/stream probes; no property alias.

Deferred (scoped, not open): v2 auto-streaming bare reads (above); the coarse
re-run fallback for non-reactive-throw recovery (D3.4, terminal in v1).
