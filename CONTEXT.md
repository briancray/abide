# Domain language

Terms the code and its discussions use exactly. One meaning per term; sharpen here when a term drifts.

> **Vocabulary realignment in progress (ADR-0018).** The names below are the
> agreed *target*; the code adopts them wave-by-wave. Entries marked *(target;
> ADR-0018)* describe a name the restructure lands, not the symbol shipping in
> `main` today — the prior name holds until that name's wave. See ADR-0018 for
> the master rename table, the frozen/protected list, and the phasing.

## Routing & rendering

**Route**
A page URL in readable bracket form (`/post/[id]`, `/docs/[...rest]`), derived from the `page.abide` file's directory path. Translation to Bun's `:name` / `*` pattern syntax happens only at server registration; everywhere else the bracket form is the identity.

**View**
What a resolved route mounts: a page component plus the layout chain wrapping it.

**View resolution**
Route in, view out: layout-chain selection plus the page+layout module load. The prefix-matching rule lives in `layoutChainForRoute` (`lib/shared/layoutChainForRoute.ts`); `createUiPageRenderer` (server render) and the client `router` (navigation) both call it to assemble the page folded into each layout's `<slot/>` outlet.

**Nearest-only layout**
The deepest `layout.abide` prefix that is an ancestor of the route wins; layouts never stack.

**Page renderer**
Matched route in, finished SSR document (or JSON view payload) out: the page render, the inline-vs-streaming cache partition, the `__SSR__` state tag, and shell splicing. Owned by `createUiPageRenderer` (`lib/server/runtime/createUiPageRenderer.ts`); the route dispatcher and the 404 path are its callers. `createServer` is wiring, not behavior.

**Match**
URL → route + decoded params. Server-side only: Bun's router matches, the catch-all param is reconstructed from the pathname. The client never matches URLs — it asks the server (`Accept: application/json`) and receives `{ route, params }`.

## Cache & streaming

**Registry**
The *reactive* store of registered async work with a lifecycle channel. There
are two: the cache (calls — request/tab store + process-level shared store,
entries keyed by wire or reference identity) and the tail registry (streams,
keyed by `Subscribable.name`, with the window size `last` folded into the key);
`rpcErrorRegistry` is the same signal-node-backed kind. A **handler registry**
(`rpcRegistry` / `socketRegistry` / `promptRegistry`) is the qualified
sub-sense: a plain `Map` populated at boot, no reactive channel. The build-time
scan of `src/` is *not* a Registry — it is the `ProjectManifest` *(target;
ADR-0018)*.
Registries act: they coalesce identical in-flight calls
(always on; `ttl` is only the retention dial — `ttl: 0` is the mutation idiom,
retaining nothing beyond the store's atomic unit: the whole request on the
server, the in-flight window in the tab),
retain results, revalidate stale-in-place under an invalidate policy, and
reconnect a dropped stream with its last value retained.

**Probe**
A reactive read of registry state: `pending()` (no value yet — an in-flight
call, or a stream awaiting its first frame) and `refreshing()` (value held, a
fresher source in flight — a policy refetch, a drop-then-reload, or a stream
reconnecting; never a merely-open stream). Standalone modules
(`abide/shared/pending`, `abide/shared/refreshing`) spanning both registries
via the same selector grammar as `cache.invalidate` plus a Subscribable form.
Probes report, never act: reading one opens no fetch and no stream, and every
registry behavior works with zero probe readers. A proposed probe that would
need to trigger something is a registry feature wearing the wrong hat.
`cache.invalidate` stays attached to cache because its sentence is about the
cache (end retention early); `tail.status`/`tail.error` stay on
tail as the stream's richer state view.

**Tail**
The retained end of a stream, and the one word for reading it at every
altitude: a socket declared `{ tail: n }` retains its last n frames (omitted =
pure live pipe, storage is the consumer's concern); `chat.tail(count)` is the
raw read seeded from it (no-arg = the whole retained tail; bare iteration is
live-only — replay is exclusively tail's job); `tail(x)` is the reactive
latest-wins read and `tail(x, { last: n })` a live window of the last ≤n
frames, however they arrived. `last` is the read-side word (how much the
reader keeps), `tail` the declaration-side word (how much the topic retains);
`last` clamps to the declared `tail`. Retention exists for readers who weren't
there — late joiners, reconnect gaps, the CLI/MCP/SSE faces — which is why it
can't be delegated to consumers. Seeding rides `Subscribable.tail(count,
hooks?)`, an optional capability: sockets implement it verbatim, one-shot rpc
streams omit it, and the consumer never special-cases either. Replay is
demarcated on the wire: the seed arrives as one per-sub `replay` batch, so a
window commits atomically (no frame-by-frame rebuild), an empty replay keeps
the held window across a gap, and one sub's replay never leaks into siblings
on the same socket.

**Replayable method**
A remote method safe to re-issue without the caller asking: GET only
(`REPLAYABLE_METHODS`). Gates the SSR snapshot and the invalidate-policy
guard — a write never re-fires from hydration and never carries a policy.
(It does not gate the server's ttl: 0 keep: within one request, writes
coalesce like everything else.)

**Streaming protocol**
The SSR→client agreement for pending `{#await}` reads: the document ships `__SSR__.streaming` placeholders (`StreamingPlaceholder`) plus a single-use `streamToken`; the resolve channel (`RESOLVE_STREAM_PATH`) streams one `StreamedResolution` per entry — a `CacheSnapshotEntry` to settle warm, or a `{ key, miss }` marker meaning "re-fetch live". Keys derive from the route template via `keyForRemoteCall` on both sides. The protocol's shapes live in `lib/shared/types/`; its enforcement is the round-trip contract test (`tests/streamingRoundTrip.test.ts`), which feeds the server half's real output into the browser half. Streaming-vs-inline is chosen by `await` vs `{#await}` in the component — never by an option.

## Reactivity

**Lexical scope**
The *component*-granular reactive unit (`Scope`, established per lexical level by
the compiler via `CURRENT_SCOPE`/`withScope`). Owns a region's reactive doc, its
boundary-crossing capabilities (`record`/`persist`/`broadcast`), its context
(`share`/`shared`), its identity (`id`), and an explicit `child()` tree. `scope()`
is the sole public entry; everything else is a method reached through it. Its data
methods (`read`/`replace`/`cell`/`derive`/…) are receiver-bound to that scope's
doc.

**Build window**
The *finest*-granular ownership unit (`OWNER`/`scopeGroup`/`runtime/scope.ts`):
the disposers collected during one synchronous build — a component, but equally a
control-flow branch or a list row. Distinct from the lexical scope on purpose: a
reactive cell built in a branch must die when the **branch** flips, which is finer
than the component the lexical scope spans (see ADR-0012). The reactive primitives
(`state`/`linked`/`computed`/`effect`) bind the ambient build window, not the
lexical receiver — so `someScope.computed(fn)` does not create state in someScope.
(A merge of these two into one tree was spiked under ADR-0018 and **deferred** —
0012 stands.)

**Adoption**
A lexical scope created in `awaiting` mode takes its doc from the first `doc()`
its component body creates, rather than minting one eagerly — so the compiler
emits one data-lowering whether or not a component owns a scope. A body that never
creates a `doc()` mints an empty one lazily on first data access.

## Runtime substrate *(target; ADR-0018)*

These names land wave-by-wave; each replaces a fragmented set of today's
constructs.

**MarkerRange / RangeList**
The one marker-bounded swappable DOM region (`mount`/`adopt`/`swap`/`dispose`),
carrying the detached-anchor short-circuit and adopt-strand-dispose guards as
first-class mechanics; every block runtime (`if`/`for`/`await`/`try`/`switch`)
mounts through it. `RangeList` is the keyed/unkeyed list form over it. Named
`MarkerRange` — not bare `Range` (a DOM standard) nor `RangeSlot` (the `<slot>`
vocabulary was purged).

**FrameSource**
The per-side carrier (`subscribe`, `publish?`, `tail?`, `peek`, `refresh`) that
`assembleSubscribable` wraps into one `Subscribable` shell — server and client
supply different adapters (`peek`/`refresh` are genuinely per-side;
`subscribe` owns replay atomicity). Kept pluggable so a cross-instance adapter
is additive.

## Compilation

**Plan**
A shared compile model both code-generation backends render from
(`generateBuild` → client wiring, `generateSSR` → HTML string). Per **block**:
one module per binding-introducing block
(`awaitPlan`/`ifPlan`/`switchPlan`/`tryPlan`/`eachPlan`/`snippetPlan`), the
per-block sibling of `skeletonContext`'s element-level positional model — the
single source of truth that keeps the backends congruent for hydration. Per
**component**: `ComponentPlan` *(target; ADR-0018 — the renamed
`AnalyzedComponent`)*, the whole-file parsed template + styles a component
compiles from, from which the type-check shadow also projects. A component is
not a block — there is no `{#component}` form.

**Binding**
A name a block introduces into its body's scope, carried on its `Plan` and
classified once as `reactive` (an `await` `then` value, an `each` item / index —
a `.value` cell on the client) or `plain` (a `catch` error, `snippet` args). The
name set and classification are the single source of truth both backends read;
they differ only in how they render it — build wires a cell for `reactive` and a
bare local for `plain`, SSR renders both as a plain shadow (it has no cells). A
binding that mis-lowers to the enclosing component signal is the
`block-binding-shadow` bug this model designs out.

## Agents

**Engine**
A provider adapter satisfying `AgentEngine`: surface + neutral conversation in, `AgentFrame` stream out. It owns its own loop. Lives in `@abide/<provider>`, never in core.

**Frame**
The unit event of any `Subscribable` stream. An **`AgentFrame`** is the
provider-neutral engine event (`text` / `tool_use` / `tool_result` / `done`);
the same word names a socket topic's message and the per-side event a
`FrameSource` *(target; ADR-0018)* feeds into `assembleSubscribable`. The
`AgentFrame` contract (below) is what all engines must agree on.

**Frame conformance**
The invariants every engine's stream must satisfy — exactly one `done`, last; every `tool_use` answered by a same-id same-name `tool_result`. Encoded once in `abide/test/assertAgentFrameConformance`; each provider package runs it against scripted provider output (`abide/test/createScriptedSurface` records tool dispatches).
