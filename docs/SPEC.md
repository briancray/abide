# abide primitives

A reference of every public capability, in tables. Three isomorphic primitives — `state` (own),
`memo` (load), `channel` (subscribe) — one effect (`watch`), and two transport laws over them:
`rpc` = `memo` + transport, `socket` = `channel` + transport.

## Entry points

| Specifier | Holds |
| --- | --- |
| `abide` | What an author TYPES — **16 values and 23 types**, and the file behind it is CURATED rather than collected: `./abide.ts`, one line per decision, not a barrel over a directory. `state` / `memo` / `channel`, `watch`, `html` / `raw` / `props` (with `Props`, the type a compiled component's parameter is written in), `log`, `online()` / `health()` / `identity()`, `route()` / `navigate()` / `url()`, `invalidate` / `refresh`. Nothing about the PENDING SIGNAL is on it — see "a read that signals": a total `catch` cannot commit the value it builds, so an author's own `try` owes nothing, and the one shape that has to ask is `swallowed()` on `abide/runtime`. A VALUE is here because a user-facing app types it — the standard is the dogfood app's own pages and server, never its demos, which test the framework rather than use it. A TYPE is here because it is the input or output of one of those values, which is why `Route` is here and `RouteEntry` is not. `scope`, `untrack` and `isolate` are on no entry point at all: nothing an app writes calls one, so the suites that test the graph reach `$shared/*` directly |
| `abide/runtime` | What only the COMPILER writes, plus the predicates that read what it wrote. Emitted: `classes` / `styles` (a `class:` / `style:` toggle), `adopt` (a `<style>` block), `boundary` / `streamed` (the blocks), `awaited` (no longer emitted for any spelling — a hand-written `.ts` component still builds one, and both renderers read it back), `component` / `propCell` (a `<Name/>` tag and the props it binds), `keyed` (`by` on a `{#for}`), and `routes` / `outlet` / `ready` / `navigate` (what `abide build` writes into the client entry). Read-back: `isTemplate`, `isKeyed`, `classifySlots`, `escape`, `cellProps`, and `swallowed` — did a read in the body running now signal and get caught on the way out. That last one is the only thing about the pending signal on any entry point, and it is here rather than on `abide` because a body that RETURNS needs nothing: the run boundary discards what a total `catch` built. Only a body that ACTS mid-run — a slot binder, the harness's recording reader — has already acted by then. `navigate` is the one name on both this specifier and `abide`, and the duplication is a BUNDLING one, the same kind the row below states: the generated entry's link handler reached for it on the barrel, and that pulled `identity`, `online`, `memo` and `tags` into the chunk every page loads — 4,338 minified bytes of the perf app's first load, 7.3% of it, for a name already one import down in `router.ts`. An author still types `navigate` and still finds it on `abide`. Each emitted name is what the compiler writes for a SPELLING, never a name a source file says. `html` and `raw` are the two that stay on `abide`: the template tag and the escape hatch, both of which a hand-written `.ts` component writes too. Nothing here may import a renderer, which is why `hydrate` is on `abide/ui` |
| `abide/runtime/transport` | What a server module ELIDES TO in the client lane — `remote` / `remoteSocket` / `asRpc` and the shapes describing one (`Rpc`, `RpcHandle`, `RemoteOptions`, `RemoteSocket`, `RemoteSocketOptions`, `CallOptions`, `Kind`, `Method`, `Wire`). Split off `abide/runtime` for a BUNDLING reason and no other: that module is what the generated client entry imports for `routes` / `outlet` / `ready`, so anything re-exported from it sits in the chunk every page loads, and one lazy route with one rpc put the whole call-and-decode path in front of every page — 4,066 bytes of the perf app's shared entry, on a page that calls nothing. Reached by its own specifier it lands in the chunk of whatever page imports it |
| `abide/ui` | The DOM substrate: `mount`, `hydrate`. Reached by `abide build`'s GENERATED client entry and by benches, never by an app's own pages — so it is a real entry point that is NOT on `/docs`, which lists what an author types. The `client` and `hydrate` ladders document these two and claim no name; `dogfood/test/docs.test.ts` holds that exclusion in both directions |
| `abide/server` | What a SERVER-SIDE author types — the declaring half of both transports (`GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `socket`), what a route answers with (`error` / `json` / `jsonl` / `page` / `redirect` / `sse` / `HttpError`), `render`, the process lifecycle as an app DECLARES it (`server()` / `middleware` / `onError` / `onStart` / `onStop`), the request scope as an app READS it (`request()` / `bag()` / `cookies()` / `nonce()` / `trace()`), `config()` / `onConfig`, the server half of the two ambients (`onHealth` / `onIdentity` / `identity`), and `csp()`. Curated by the same rule as `abide` and one more: **what the docs app covers is what is public** — every name here has its own page at `/docs/<name>` with at least one rung on it, and a name with no page belongs on the entry point below. Asserted in both directions in `dogfood/test/docs.test.ts`, against `Object.keys` of the module rather than against prose |
| `abide/server/internal` | The server surface an APP does not type: what `abide start` does on its behalf. Running the process rather than declaring it (`boot`, `handle`, `shutdown`), INSTALLING the request scope rather than reading it (`serve`, plus the `heldStream` / `isServing` probes only a body-building path asks), the SERVING half of the transport seam (`dispatch` and `websocket` are the DOORS, in `registry.ts`; `endpoints` / `register` / `registered` are the CATALOGUE, in `catalogue.ts`, which the doors and both projections read without reaching back through each other — `register` is what a compiled transport module imports), the route table read off a directory (`pages`), the document pages are served IN (`shell`, `Shell`, `styleTags`), and running a declared shape check (`validateJson`, `SCHEMA_ERROR`). A specifier rather than a comment because the apps may not use abide's `$server` alias: without it a demoted name would be unreachable from the suites that test it, and the split would rest on prose. Anyone hand-rolling a `Bun.serve` reaches here and gets the same functions the CLI uses — there is no second implementation |
| `harness` | Its own PACKAGE, not an entry point of this one. The `Case` shape, the assertions, the headless runner and `loopback()`; `harness/measure` is the half with no abide in its graph (timing, ratios, DOM counters) and `harness/spawn` is the bun-only half. See "The harness" below |
| `abide/compiler` | `compile()`, `elide()`, and their diagnostics. Pure: text in, text out, no filesystem |
| `abide/compiler/check` | `emitFor`, `emitAll`, `remap`, `diagnose` and `TYPES_DIR` — the lane `abide check` runs |
| `abide/compiler/shapes` | `deriveShapes` — the real checker over a project, for the shapes tokens cannot read |
| `abide/compiler/assemble` | `NAMED_FORMATS` and the JSON Schema assembler — the closed set of `format` names abide will publish, so what `deriveShapes` emits and what `validateJson` accepts cannot drift |
| `abide/compiler/plugin` | The Bun plugin: compiles `.abide` on import, elides a transport module per lane |
| `abide/cli` | `cli(argv)`, `COMMANDS`, `commandNamed`, `usage`, `CLI_EXIT_CODES`, `exitForStatus`, the client-build manifest shape, the REPL's `LineEditor` / `suggest` / `EditorHooks`, and the language server's `LanguageServer` / `LanguageHooks` |

## Terms

| Term | Definition |
| --- | --- |
| `value` | Anything representable by TypeScript |
| `key` | Idempotent string standing for another `value` |
| `serializable` | Any value that survives `JSON.stringify` |
| `args` | A single-arity argument presented as an object, e.g. `{a, b}` |
| `dependencies` | In a 0-arity function, discovered by reading. In a 1-arity function, they are `args` |
| `tracked` | Re-runs when `dependencies` change |
| `untracked` | Has no `dependencies`; re-runs imperatively |
| `transform` | An untracked function that returns a value, or a promise of one — which is a `load` |
| `source` | `state`, `memo` or `channel` — anything whose CALL is a reactive read |
| `cell` | A `source` you can also `set` and `await`. A `channel` is a source that is not a cell |
| `handler` | A function whose return value is a `dispose` function |
| `dispose` | Runs before every re-run of a `handler`, and once when it is unsubscribed |

## `state` — the owned value

| Name | Type Signature | Description |
| --- | --- | --- |
| `state` | `<T>(initial: T, transform?: (v: T) => T) => State<T>` | A cell holding a value you write yourself. |
| `state` | `<T>(initial: Promise<T>, transform?) => Cell<T>` | The same cell started cold on a LOAD; `pending` until it lands. A `Cell` rather than a `State` because it starts with nothing retained, which is the one thing `peek` can see. |
| `state` | `<T>(initial: AsyncIterable<T>, transform?) => Cell<T>` | The same cell started on a STREAM: it holds the latest chunk, `chunks()` holds the transcript. A CELL is one of these — an rpc handle included — so `state(catalogue())` is the latest row plus the whole transcript. What it does not gain is a body: `refresh` stays with whoever owns the load. |
| `transform` | `(value: T) => T` | Every write passes through it before storage, the `initial` included. Untracked; on a load or stream it sees what LANDED. A promise it RETURNS is a load like any other — on the `initial` too, so the cell starts `pending` and holds what it resolved to. A throw is a failed write. |
| `state.shared` | `<T>(key: string, initial: T, transform?) => State<T>` | A cell shared by `key` across component instances, per-caller. The first call decides the value; a later one gets the existing cell. |

## `memo` — the loaded value

| Name | Type Signature | Description |
| --- | --- | --- |
| `memo` | `<T>(body: () => T, options?: MemoOptions) => Memo<T>` | A derived value that recomputes whenever anything it read changes. A promise or async iterable body is the same `Memo<T>`: a load that has not landed is not part of the read's type, because the read signals instead. |
| `memo` | `<Args, T>(body: (args: Args) => T, options?: MemoOptions<Args>) => KeyedMemo<Args, T>` | A value computed per argument key, one independently cached slot per distinct args. Only the key is tracked; the body is untracked. |
| `memo` | `(body, transform: (v: T) => Out, options?) => Memo<Awaited<Out>>` | The derived value passes through `transform`, untracked, and the memo becomes its return. Options still follow third. This is also the DECLARED-DEPENDENCY form — `memo(() => [a, b], ([a, b]) => …)` — since only `body` is tracked: what `transform` reads does not subscribe, exactly as in `watch(source, handler)`. A `transform` that returns a promise is a LOAD like any other, so the form has an async arm and the cell holds what it RESOLVED to; over a stream it is awaited per chunk, in source order. |
| `m` | `(args: Args) => MemoHandle<T>` | SELECTS the slot and hands back its cell. Selecting starts nothing; ASKING it anything — a read, an `await`, a probe — kicks the load. |
| `m.invalidate` | `(pattern?: Partial<Args>) => void` | Every slot matching a subset of the args, compared the way slots are keyed. No pattern means every slot. |
| `m.refresh` | `(pattern?: Partial<Args>) => void` | The same match, re-running each slot's body while it keeps serving what it holds. |
| `invalidate` / `refresh` | `(selector: { tags: string[] }, scope?) => void` | Everything carrying any of the tags, without the caller knowing which memo that is. `scope` narrows to one memo's slots. |

### `MemoOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `ttl` | `number` | ms a settled slot is served before the next read recomputes it. Default: forever. |
| `global` | `boolean` | One slot shared by every caller regardless of request or process. Without it a slot belongs to the caller that filled it. Bounded by `ABIDE_MAX_GLOBAL_CACHE_SIZE`. |
| `tags` | `string[] \| ((args: Args) => string[])` | Names this joins, so tag invalidation reaches it. The function form receives the slot's args, naming one ROW rather than every row. |
| `throttle` | `number` | Explicit revalidation of a WARM slot fires immediately, then at most once per window. A cold slot is never paced. |
| `debounce` | `number` | Explicit revalidation of a WARM slot waits until the triggers stop. Set with `throttle`, this wins. |

## `channel` — the subscribed value

| Name | Type Signature | Description |
| --- | --- | --- |
| `channel` | `<T>(options?: ChannelOptions) => Channel<T>` | One stream of messages anyone may publish to and anyone may subscribe to. |
| `channel` | `<T, Args>(options?: ChannelOptions) => KeyedChannel<Args, T>` | The same, split into independent rooms addressed by `Args`. Rooms are process-wide. |
| `ch` | `(args: Args) => Channel<T>` | SELECTS a room and hands back an ordinary channel. A room that has been subscribed to is FORGOTTEN when its last subscriber leaves, with whatever it retained — rooms are named by the caller, so a table that only grew is one an arriving connection could grow without bound. Selecting the same args again builds a fresh room. |
| `ch.publish` | `(message: T) => void` | Sends one message to every current subscriber. Delivery is against a snapshot of subscribers. |
| `ch.subscribe` | `(listener: (m: T) => void) => () => void` | A plain listener outside the graph; returns its own unsubscribe. |
| `ch.tail` | `(options?: TailOptions) => AsyncGenerator<T>` | The transcript replayed, then every message after it. Snapshot and subscribe happen in one synchronous run, so nothing is missed. `{ limit, idle }` ENDS it — how many messages are enough, and ms to wait for the next before giving up — which is what makes the same sequence answerable to a reader that has to return. Both end it normally, so it unsubscribes on the way out exactly as an abandoned reader does; imposing either from outside could not, because a parked generator does not process a `return()` until a message arrives. |
| `ch[Symbol.asyncIterator]` | `() => AsyncIterator<T>` | Subscribes and receives every message published from that moment on. |
| `ch.invalidate` | `(pattern?: Partial<Args>) => void` | Forgets what has arrived. On the room form, every room matching the pattern; no pattern reaches every room and the bare stream. |
| `options.tail` | `number` | How many past messages `chunks()` retains. Default 0 — latest only. |
| `options.maxAge` | `number` | ms a message counts as current. Expiry WAKES readers of both the latest and the transcript. |

A channel never loads, so `pending` / `refreshing` / `error` are always the cold answer, `streaming()`
is always true and `done()` always false. `settled()` asks whether anything current has arrived.

**A `remoteSocket` is the one exception, for `pending` and `refreshing`.** Its CONNECTION is a load: from the
first read until the first message arrives, `pending()` is true and the read SIGNALS, exactly as a
cell whose load is in flight does. That is not a special case for hydration — it is what stops one.
A client adopting server markup runs each slot's thunk once, and a cold channel handing back
`undefined` painted empty over a value the server had got right, warned, and filled it back in a
round trip later; the same slot over a `memo` did not, because a pending read signals and the slot is
left alone. Spelling the connection as the load it is puts a socket on the path every catcher already
walks. `chunks()` deliberately does NOT signal — at `tail: 0` the transcript is empty however many
messages have arrived, so a reader waiting for it to fill would wait forever. The server half is
untouched: `socket()` is `channel()`, and a walk that waited on a channel which may never receive
would wait forever too.

`refreshing()` is the same reading carried forward: a reload in flight over a value still being
served is, for a socket, **RECONNECTING** — the wire dropped, a retry is armed, and the last message
is still what is on screen. Connected and idle is not it; nothing is in flight there, and
`streaming()` already says the stream is open. It is the one thing a subscriber could not otherwise
ask, because after the first message a healthy connection and a dead one read identically. Note which
way round it goes: true-while-CONNECTED would be false on the server, where `refreshing()` is always
the cold answer, so a region asking it would render one thing on each side and mismatch on hydration.
The two probes stay disjoint — a wire that drops before anything ARRIVED has nothing to serve, so it
is still `pending`.

| the wire | `pending()` | `refreshing()` |
| --- | --- | --- |
| never read | false — nothing asked, so nothing is in flight | false |
| connecting, nothing received | **true** | false |
| connected, nothing received | **true** | false |
| connected, message received | false | false |
| dropped, retry armed | false | **true** |
| `close()`d | false | false |

## `watch` — the effect

| Name | Type Signature | Description |
| --- | --- | --- |
| `watch` | `(handler: () => void \| (() => void)) => () => void` | Runs side effects; reading a source inside IS the subscription. Batched onto a microtask. Returns the disposer. |
| `watch` | `<T>(source: () => T, handler: (v: T) => void \| (() => void)) => () => void` | The dependency DECLARED: only `source` is read under tracking, so the handler may read anything without subscribing. |
| `x.watch` | `(handler: (v: T) => void \| (() => void)) => () => void` | The same effect spelled off the source. Which source you asked IS the declaration, so the handler is untracked. |
| the handler's return | `() => void` | The teardown, run before every re-run and once on disposal. There is no `onMount`/`onDestroy`. |
| `untrack` | `<T>(fn: () => T) => T` | Runs `fn` reading whatever it likes without any of it becoming a dependency. On no entry point — `$shared/reactive.ts`. |
| `scope` | `<T>(fn: () => T) => { value: T; dispose: () => void }` | Runs `fn`; `dispose` tears down every `watch` created inside it, in reverse order. A `watch` inside registers automatically. On no entry point — `$shared/reactive.ts`; `mount` calls it for you, which is why no app writes one. |

## The shared surface

Every source carries these, and **none of them takes arguments** — `m(args)` selects the slot once
and everything below is read off the cell. Args reappear only on the keyed memo or room channel
ITSELF, where they are a pattern.

### Verbs — they cause

| Name | Type Signature | Description |
| --- | --- | --- |
| `x.set` | `(value: T \| Promise<T> \| AsyncIterable<T>) => void` | Writes directly. A promise is a load and an async iterable a stream; anything else settles in the call. A value that is BOTH — every cell, which is awaitable and iterable at once — is a STREAM, so the transcript survives the write. On a body-bearing cell the write holds until the next real load. |
| `x.invalidate` | `() => void` | Discards what is held and any error, cancels what is in flight, and goes back to cold. |
| `x.refresh` | `() => void` | Recomputes now while continuing to serve what is held. Needs a body, so it is on `Memo` and `MemoHandle`, never on plain `state`. |
| `x.publish` | `(message: T) => void` | A channel's write — appends to a stream rather than replacing a value. |
| `x.dispose` | `() => void` | Drops a `Memo`'s own subscriptions. |

### Reads — they subscribe, and may start work

| Name | Type Signature | Description |
| --- | --- | --- |
| `x()` | `() => T` | The current value, filling in on its own once it arrives. THROWS if the last load failed, and SIGNALS if a first load has not landed yet — see below. On a stream, the latest chunk. |
| `x.chunks` | `() => T[]` | Everything a stream produced, in order. On a CELL it is the LIVE transcript, not a copy: the same array across chunks as well as between them, so its identity moving means the transcript was replaced (a reset, or an overflow drop), never appended to. A `channel` is the exception, in two ways: with `tail > 0` its retention carries a dead head, so the window is a fresh array after every publish and the same one between them, bounded by `tail`; with `tail === 0`, which is the default, nothing is retained at all and this is always the same empty array however many messages arrived. Either way a reader wakes on the VERSION rather than on the identity and re-reads it; do not hold it across an await expecting it frozen. The same empty array on a source that never streamed. |
| `for await (… of x)` | `AsyncIterable<T>` | The cursor face of the same transcript, for a consumer that reads each chunk once: everything already produced, then everything that comes next. A second consumer replays the whole of it, because the transcript is retained on the cell. A cell that never streamed yields its value once and ends. |
| `x.peek` | `() => T \| undefined` | Exactly what is RETAINED now, subscribing to nothing, starting nothing, never throwing and never signalling — so `undefined` here means nothing has landed yet. `State<T>` narrows it to `T`: a cell handed a value was never cold, which is what keeps `x += 1` from needing a narrowing that cannot fail. |
| `await x` | `PromiseLike<T>` | The settled value. Its type is the one `x()` has; the two differ in HOW they wait, not in what they hand back. Awaiting a cold slot starts it. |

### A read that is not ready SIGNALS

`x()` on a cell whose first load is still in flight does not hand back `undefined` for a caller to
narrow. It throws, and whoever is standing under the read produces no output for that region and runs
again when the load lands. Nothing else in the expression runs, so a member access or an arithmetic
on a read that is not ready produces nothing rather than `undefined.name` or `NaN`.

It signals only where RE-RUNNING is the recovery, which is where somebody is standing under it:

| position | a pending read |
| --- | --- |
| slot thunk · `memo` body · `watch` body | signals — the region paints nothing and repaints on the wake |
| the server walk | signals — the walk waits for that load and calls the thunk again |
| `await x` | waits — it is the settled value by definition |
| `<script>` setup · event handler · module scope · an rpc handler body | hands back what is there (`undefined`) |

The type follows the position, because the compiler already knows it: a template read is `T` and
needs no narrowing, and a `<script>` statement is emitted as `peek()` and is honestly
`T | undefined`. The split inside a `<script>` is STATEMENT vs FUNCTION BODY — a `memo` or `watch`
body is re-run, and nothing syntactic tells one from an event handler, so a function body there reads
rather than peeking. Write `x.peek()` for the honest type in a handler. An rpc handler is the same
position and the one it costs most: nothing re-runs it, so `await x` is how it asks a memo for a
value — `x()` there is the retained value or nothing, and a member access on nothing is a 500.

A `memo` is transparent to it: the signal names the CELL it started at, since that is the only thing
that can be waited for, and the derivation is left to run its body again on the next read. A
`refreshing` cell never signals — it has a value to serve.

**Catching one cannot change what renders.** `{#try}` does not catch a signal at all. A hand-written
`try` in a helper does — a JavaScript `catch` is total — but what it builds is discarded and the
region waits anyway, so both substrates show the same thing either way. What a `catch` block DOES,
though, it still does: side effects in one are not undone.

### Probes — they only observe

Probes never throw and never start work.

| Name | Type Signature | Description |
| --- | --- | --- |
| `x.pending` | `() => boolean` | A first load is in flight and there is nothing to show. A stream reports this until its first chunk. |
| `x.refreshing` | `() => boolean` | A reload is in flight over a value still being served. Its own signal; it never wakes value readers. |
| `x.settled` | `() => boolean` | It has finished, however it finished. |
| `x.done` | `() => boolean` | It landed, it did not fail, and nothing is still arriving. `streaming` is in that conjunction; `refreshing` is not. |
| `x.streaming` | `() => boolean` | It is currently producing chunks. |
| `x.error` | `() => unknown` | The failure it ended with, if it failed. |
| `x.isError` | `(error: unknown, name: string) => boolean` | Whether a caught failure is the one named — directly, or wrapped as another's `cause`. The NAME, so it answers over a wire. |

**A probe does not repaint markup it is ADOPTING.** During hydration a producer that probed an
unlanded load keeps what the server sent rather than painting its placeholder over it — the markup
under the claim was built from the settled value, either awaited inline or patched in before this
side ran, so painting would be a flash back to a state nobody saw. The claim is kept rather than
dropped: the probe subscribed that region to the load, so the settle re-runs it and ADOPTS the same
markup, at no write. Only while adopting — a `mount` has no markup to keep, so the same region paints
its placeholder and then the answer.

**A live STREAM is the other answer.** The server DRAINED it before writing, so those rows are a
different point in the same stream and no chunk to come makes them match; a region that probed one
drops them and rebuilds, exactly as a `{#for await}` block does. Keeping them instead freezes the
list at the server's last chunk while a plain read of the same cell beside it counts up from one —
`latest 1` over a list showing `1..5` — which agrees at both ends and is nonsense for the whole
middle, with no mismatch and no warning to say so.

**A probe KICKS the load it reports.** Asking about a value is a way of asking for it: a page writes
`{#if x.pending()}` because it is about to show `x`. On a cold slot a probe used to answer `false`,
which reads as "no load is running" and meant "none has begun" — a different fact wearing the same
answer — so the arm shown was a placeholder for work nobody had started. Every probe now starts it,
which is what lets ANY probe-first spelling defer without a compiler recognising the shape of it: a
`memo` over a probe, an inverted test, a chain a regex could not match.

It can only start what is EVALUATED. `||` short-circuits, so `{#if a.pending() || b.pending()}` starts
`a` and leaves `b` cold until something reads it; a gate over several loads has to ask about all of
them. `peek` is the one member left that observes without causing, and SELECTING a keyed slot still
starts nothing — those two are how a caller asks about a key it does not intend to show.

**A DERIVATION answers for the load it reads.** `memo(() => rows({ q })())` settles nothing of its
own, so it has no `pending` of its own to report; what it has is the read that could not finish. A
probe on it therefore answers from the SIGNAL — `pending()` true, `settled()` and `done()` false —
and subscribes the asker to the cell that signalled, which owns the flip that stands the probe back
down. So a load named once and asked about twice reads the way the direct spelling does:

```
const found = memo(() => rows({ q: query }))
{#if found.pending()}<p>searching…</p>{:else}<ul>{#for row of found}…{/for}</ul>{/if}
```

`refreshing()` is the one probe that stays the derivation's own, because a body that cannot finish
has nothing retained to be refreshing OVER.

## `rpc` — `memo` + transport

| Name | Type Signature | Description |
| --- | --- | --- |
| `GET` | `<Args, T>(body: (args: Args) => Produced<T>, options?: RpcOptions<Args, T>) => Rpc<Args, Answer<T>, Refusals<T>>` | Declares a read any surface may call, addressed by its arguments. The handler's type is SPLIT: what it answers with, and the `error.typed` failures it `return`s. |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declare a mutation, which retains nothing by default. |
| `fn` | `(args: Args, options?: { signal?: AbortSignal }) => RpcHandle<T>` | SELECTS the slot and hands back its cell, exactly as a keyed memo does. Reading it reaches the handler. `signal` abandons this await alone. |
| an OMITTED argument | `fn()` | The argument may be left off exactly when `{}` satisfies `Args` — a handler declaring no parameter, or one whose every field has a default (`({ page = 1 }) => …`). An omission IS `{}`: it selects the slot `fn({})` selects, travels as the query `fn({})` travels, and reaches a handler with something to destructure. A required field keeps the argument mandatory. Read off the ARITY, so a `void`-args read passing `undefined` explicitly is still `undefined` and still has the bare address. |
| `fn(args).isError` | `(failure: unknown, name: DeclaredName) => failure is Failed<name, Data>` | The cell's `isError`, NARROWED by what the handler declared: matching the name gives back `.data` with the schema's type on it, `.status` and `.name`. A name the endpoint never declared is the ordinary boolean. |
| `fn.raw` | `(args?: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response instead of a decoded value. |
| `fn.url` | `(args?: Args) => string` | WHERE that call would go — mounted, with a read's args on the query, through the same expression `raw` addresses with. For the consumers that are not a fetch: an `EventSource` over an `sse()` handler, a `<form method="post" action>` posted straight at an endpoint, a `curl` line. A MUTATION answers with its bare address and IGNORES what it is handed, because its args are in the body: that address is where the call goes whatever they say, and it is the one `openapi.json` publishes. THROWS on a READ whose args carry a file or are too long for a URL — those travel in a body, so the bare address would be a URL missing the arguments that were the request, and a 404 at a plausible-looking path. |
| `fn.method` / `fn.description` | `Method` / `string \| undefined` | What the declaration said, readable off the handle. |
| `for await (const c of fn(args))` | `AsyncIterable<T>` | Consumes a handler that streams, replaying what already happened before following what comes next. A handler streams iff declared `function*` OR framed with `jsonl()` / `sse()` — the compiler reads both off the syntax for the stub, and the server reads the framing off the value the handler returned. In a `.abide`, the head HOLDS the source: `for await` iterates the cell, where a synchronous `for … of` reads it. |
| a FRAMED handler, IN PROCESS | the same chunks, by the same loop. The lane takes the framing's VALUES and `respond` writes the framing again over the cell, so `application/jsonl` and `text/event-stream` still go out unchanged for the readers that are not stubs. Decided by the VALUE, not the declaration: `isGenerator` cannot see `() => jsonl(items())`, and a hand-written `register` never meets the compiler that can. A framing must be returned SYNCHRONOUSLY — see `Produced<T>`. |
| a `File` in `args` | — | Travels as multipart, the JSON keeping a reference where the file sat. Nothing in the declaration or call says "upload". |
| `remote` | `<Args, T, F extends Failed>(id: string, options?: RemoteOptions) => Rpc<Args, T, F>` | The client half: the address and nothing else. What a generated stub imports, and identical written by hand. `F` is how a HAND-written stub says what the endpoint refuses with; a generated one says nothing, because the caller's checker reads the handler's own declaration. |

### `RpcOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. |
| `schemas` | `{ input?: Schema<Args>; output?: Schema<T> }` | The declared shape in each direction, enforced at every door. Derived from the handler's TYPE when nothing is declared. |
| `middleware` | `RpcMiddleware<Args, T>[]` | `(next, args) => …` — the chain authorizing and observing every read, including in-process ones. |
| `memo` | `MemoOptions<Args>` | What the call retains, how long, and under which tags. |
| `timeout` | `number` | ms the call may go without progress before it fails. Per chunk on a handler that yields. |
| `crossOrigin` | `string[]` | Which other origins may call it, closed unless declared. `'*'` opens it; the websocket upgrade is gated by the same list. |
| `clients` | `Clients` | Which generated surfaces this appears on — `{ mcp?, openapi? }`, both on unless said otherwise. See "The projection". |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. |
| `seed` | `boolean` | Whether a render hands what this resolved to the client that adopts it. **Default on.** See below. |

### Seeding — the answer travels WITH the markup it produced

A document render resolves a read to build the markup; the client then adopts that markup with a cold
slot of its own, so its first read of the same call would reach the network for an answer already on
screen — and the handler would run a SECOND time, because a slot is per-caller and the browser is a
different caller. On the `data` use case (`/demos/data`) that was a 254 KB document followed by a 623 KB fetch,
120 ms of handler on each side, and a client-side filter that could not run until the second landed.

So the render collects what it resolved and writes it into the document as a
`<script type="application/json" id="abide-seed">` — **after every deferred region has settled**,
which is why it is at the end: a `{#if x.pending()}` region resolves long after the shell is on the
wire, and a block written with the head would carry only the slots that were already warm. It is a
data block, never executed, and it carries the request's CSP nonce because a policy does not read
`type`.

The browser takes its value SYNCHRONOUSLY on the first read of that slot — a `memo` settles a sync
body in the call — so the settled arm paints immediately rather than showing a placeholder for one
round trip. A seed is consumed on that first take, so `invalidate` goes back to cold and the next
read reaches the network, exactly as it would have.

| | |
| --- | --- |
| keyed by | the endpoint's ADDRESS and `keyOf(args)` — what the compiler wrote into the stub, and what a keyed memo already addresses its slot by. Neither side is told about the other |
| a handler that YIELDS | seeded by its TRANSCRIPT, not by its value — the value is the latest chunk, so there is no one answer while it runs, and by the time the block is written there is. Without it the browser re-streams from the top: duplicated rows for a list, and for a generated answer the whole generation, paid twice and watched restarting. The client hands the transcript to `set` as one rather than replaying it, so the slot is settled in the call and a hydrating region adopts its rows instead of rebuilding them against a half-filled one |
| a handler that built its own RESPONSE | never seeded — `json`, `page`, `redirect`. In process the handler answers the ENVELOPE, which `JSON.stringify` writes as `{}`; seeded, the browser adopts `{}` as a settled answer and never asks. The browser fetches instead, which is what it would have done with no seed |
| a handler that FRAMED one | seeded by its TRANSCRIPT, exactly as one that yields — `jsonl()` and `sse()` are streams, so the cell holds the chunks and there is a transcript to write |
| never seeded | `renderDocumentToString`, whose whole reason to exist is a reader that runs no scripts |
| costs nothing when off | a request that is not rendering a page opens no table, so an endpoint answering a fetch records nothing and builds no key |
| turn it off for | a payload big enough that inlining costs more than fetching it, and an answer carrying FIELDS THE PAGE DID NOT RENDER — seeding writes the whole value into the document, not just the part the markup showed |

A NAVIGATION is seeded the same way, as its LAST piece. The placement is the opposite of a document's
and for the same reason — who is doing the parsing. A document's client hydrates as the browser's own
parser reaches the markup, so the block must precede the reads that consume it; a navigation's client
is holding the stream and commits only when it ends, so a block written after the drain still lands
first. That is what lets a navigation seed the DEFERRED half as well: a panel whose load settles
during the drain is in the table, so the arriving page paints its settled arm rather than a
`pending()` placeholder over markup that already has the answer in it.

The piece is the same `<script type="application/json" id="abide-seed">`, framed by the same sentinel
as every other piece, and it carries NO nonce: the client parses it out of a `<template>` and reads
its text, so no element of it enters the document for a policy to evaluate. An OVERTAKEN navigation's
seeds are dropped rather than merged — its answers are for a page nobody will see, and nothing would
ever consume them.

## `socket` — `channel` + transport

| Name | Type Signature | Description |
| --- | --- | --- |
| `socket` | `<T>(options?: SocketOptions<T, void>) => Channel<T>` | Declares a stream of messages reaching subscribers on both sides of the wire. |
| `socket` | `<T, Args>(options?: SocketOptions<T, Args>) => KeyedChannel<Args, T>` | The room-addressed form. The server half is `channel()` unchanged. |
| `remoteSocket` | `<T, Args>(id: string, options?: RemoteSocketOptions) => RemoteSocket<T, Args>` | The client half: an ordinary `Channel`/`KeyedChannel` plus `close()`, reconnecting on its own if the connection drops. Its connection is a LOAD — `pending()` until the first message, and the read signals until then, which is what lets a hydrating client keep the value the server rendered. See "`channel` — the subscribed value". |
| `options.channel` | `ChannelOptions` | The underlying stream's own memory: how many messages it keeps and how long one stays current. |
| `options.clientPublish` | `false \| ((message: T, room: Args \| undefined, into: Channel<T>) => void \| Promise<void>)` | Whether clients may publish, and what happens to what they send. `false` by default — a socket is a broadcast until an app says otherwise. `into` is the sender's own room, already resolved, so an echoing policy never names the declaration it is inside. |
| `options.schema` | `Schema<T>` | The declared shape of a message a CLIENT sends — the wire is the only door one arrives through from outside the process. |
| `options.middleware` | `SocketMiddleware<T, Args>[]` | `(next, event) => …` where `event` is `{ kind: 'subscribe' \| 'publish', room, message, request }`. A throw refuses it. Runs on the HTTP tail and publish too — a `subscribe` and a `publish` respectively. |
| `options.crossOrigin` | `string[]` | Which origins may upgrade, closed unless declared. Gates the two HTTP arms as well as the websocket. |
| `options.clients` | `Clients` | Which generated surfaces this appears on — `{ mcp?, openapi? }`, both on unless said otherwise. |

## How a handler is addressed

| Rule | Detail |
| --- | --- |
| directory is the kind | `src/server/rpc/**` is rpc; `src/server/sockets/**` is a socket |
| syntactic recognition | `export const NAME = GET(…)`, or `const NAME = GET(…)` with `export default NAME`. Any other export in those directories is a compile error naming the export |
| the module as the endpoint | `export default NAME` addresses by the module PATH ALONE — `src/server/rpc/users.ts` answers at `users`, not `users/default` — so a route whose whole job is one endpoint does not repeat itself in its own address. The stub is a default too, so the import side is unchanged |
| a default needs a BINDING | `export default GET(…)` inline is refused, and the message says how to bind it. The server lane is the module UNCHANGED plus an appended registration, and that registration maps an address to a local name; a bare default declares no name, and a module cannot reach its own default export to supply one. The `const` may sit above or below the `export default` that names it |
| addressed ONCE | `export const h = …` plus `export default h` is a compile error: it would answer at both `…/h` and the module |
| reserved prefix | Everything abide serves is under `/__abide/`; `dispatch` returns `undefined` for anything outside it |
| who imports it | The BOOT does. A handler is reachable once its module has been imported, and `abide start` / `abide dev` scan `src/server/rpc/**` and `src/server/sockets/**` under the app's source directory and import each — anchored there, so a transport directory nested elsewhere in the tree is not this app's. An app importing one for its side effect is a list kept in step by hand |
| no hash | The module's path IS the address, so it is legible in a stack trace and a network panel |

| File | Export | Served at |
| --- | --- | --- |
| `src/server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `src/server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

| Lane | Gets, for `src/server/rpc/users.ts` |
| --- | --- |
| browser | `export const getUser = remote("users/getUser", { method: "GET" })` — the address, and none of the module |
| server | The module VERBATIM, plus an appended `register("rpc", [["users/getUser", "getUser"]], { getUser })` |

| Wire fact | Detail |
| --- | --- |
| bytes are a VALUE | A handler answering with binary RETURNS it — `Uint8Array`, `ArrayBuffer`, `Blob`, `DataView` — and abide sends it as `application/octet-stream`, or as a `Blob`'s own `type` where it has one. The client decodes it back to a `Uint8Array`, so the same callable answers the same value in-process and over the wire. Building a `Response` instead is allowed and passes through, but it is NOT isomorphic: read in-process it is a `Response` the caller must unwrap, read over the wire it is the payload |
| what decodes as text | Everything else, and anything with no `content-type` at all. The allowlist points that way on purpose: the bodies abide did not write are a proxy's error page and a gateway's plain-text refusal, and reading one as bytes turns a diagnostic a human can read into a byte array |
| a read | HTTP GET with ONE QUERY PARAMETER PER ARGUMENT — `?id=7&q=ada`, so the URL is the call and anyone can type it. Past a URL length ceiling it falls back to a POST body, accepted for a read only |
| a mutation | Its own method with a JSON body |
| the query | A value JSON would read as something other than a string travels as its JSON text (`42`, `true`, `{"from":1}`); a STRING that would be misread that way travels quoted (`"42"`). At the door the declared shape decides — `?name=42` on a `name: string` is the string — and without one the text speaks for itself. `?tag=a&tag=b` is a list, and one `?tag=a` against a declared list is a list of one. A socket's ROOM travels the same way, and is decoded with the room shape the compiler derives from a keyed socket's SECOND type argument — its `input` is the MESSAGE, and the two are separate derivations because a generated tail or publish arm has to name the room it acts on |
| a form body | `multipart/form-data` and `application/x-www-form-urlencoded` are a door IN, not just what the stub writes for a file: with no `__abide_args` part their ENTRIES ARE THE ARGUMENTS, one each, read by the same reader the query goes through — same shape coercion, same repeated-name list, and a file entry lands on a declared `File` as itself. So a submitted form element is the same call, with no per-door declaration and no second handler. Two encodings, one door: `Request.formData()` reads both, and only multipart can hold a file. A checkbox sends `on`, which is not a declared `boolean` — the form says `value="true"` |
| `__abide_args=` | The escape hatch: every argument as one JSON value. What carries args that are not an object, what an over-long read's body holds, and what the stub writes beside a file — its presence in a form is what says the parts are that encoding rather than plain arguments |
| coalescing | Three concurrent readers of one key cost one request — the memo slot does that, not the transport |
| options | Never cross. A `ttl` crosses as its CONSEQUENCE, an `abide-ttl` response header in ms. Tags do not cross |
| a failure | Crosses as `{ name, message, data? }` and is rebuilt as an `HttpError` carrying all three plus the status, which is what makes `isError(e, name)` answer over a wire and `.data` mean the same thing on both sides. `data` is absent unless the declaration carried one, and is read off an `HttpError` and nothing else — a payload crosses because a declaration said it may, not because a thrown object had a field by that name |
| a refusal | Bad input is 422, bad output 500 (checked per CHUNK on a handler that yields), both under `AbideSchemaError` — carrying every issue as its `data`, so a caller reads the path rather than parsing the message |

## Schemas

| Name | Type Signature | Description |
| --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T> \| JsonSchema` | The three forms. A schema RETURNS what it accepts, so it normalises as well as refuses. |
| JSON Schema | `JsonSchema` | The native form — what a declaration MEANS, and the only one publishable to a tool definition or OpenAPI operation. |
| plain function | `(value: unknown) => T` | Returns what it accepts and THROWS what it refuses. Synchronous by that contract. |
| Standard Schema | `StandardSchemaV1<T>` | The interop spec zod/valibot/arktype answer to; `validate` may return a promise. Validate-only, so it cannot be published. abide declares the interface and imports no implementation. |
| `SCHEMA_ERROR` | `'AbideSchemaError'` | The one name every shape refusal in abide travels under. |
| `SchemaRefusal` | `Failed<'AbideSchemaError', readonly Issue[]>` | That refusal as it is caught. In the refusal union of EVERY declaration, so `fn(args).isError(e, SCHEMA_ERROR)` narrows `e.data` to the issues with nothing declared. |
| `Issue` | `{ path: string; message: string }` | One thing wrong, and where. `path` is `''` for the value itself, and for the plain-function form, which throws a sentence and has no path to give. |
| `validateJson` | `(schema: JsonSchema, value: unknown) => Issue[] \| null` | The native validator, `null` when it matches. |

Checked in the memo's BODY, the one place every door leads to. The slot stays keyed by what the
CALLER asked with. The published shape is the WIRE form (`File` → `string`/`binary`; `Date` and `URL`
→ their `toJSON` strings), and the gate accepts the local form beside it.

The input shape is also what READS A READ'S QUERY: a query is strings, so `?name=42` on a
`name: string` is the string a caller obviously meant rather than a number their handler then
refuses. An endpoint with no shape falls back to the text itself — valid JSON is what it says,
anything else is a string — which is exactly what the client wrote it to be.

### The derived shape

`GET(({ id }: { id: number }) => …)` already says what the call takes, so the compiler reads it off
the annotation and appends it to the `register(...)`. A declared schema OVERRIDES the derivation.
A derived shape may know LESS than the type does — an unreadable member is the empty schema, and a
wholly unreadable type publishes nothing. The shape reaches the SERVER lane only.

| Read from | What it says |
| --- | --- |
| `GET<Args, T>(…)` | Both directions, explicitly. Wins. On a socket the first argument is the MESSAGE and the second the room |
| the first parameter's annotation | the input |
| the return type's annotation | the output — `AsyncGenerator<T>`'s argument on a handler that yields |
| a `type`/`interface` in the same file | resolved, including one that names another |
| a type imported from another file | resolved, aliased or not, transitively, with a cycle guard — when the caller supplies a `resolve` |

| Not derived | Why |
| --- | --- |
| an imported type with no resolver | one file's tokens cannot reach another file's text |
| a generic alias, or a reference with type arguments | its body mentions a parameter nothing here can bind |
| `Pick` / `Omit` / `Required` / `Exclude` / `ReturnType` … | a utility that has to compute over a type is one a checker computes |
| `keyof`, `typeof`, conditional, mapped, template-literal types | readable by a checker, not by a scanner |
| a TypeScript `enum` | a value declaration, not a type this reads |
| a qualified name (`NS.Args`) | no part of it resolves from here |
| a handler passed by NAME rather than written at the call site | the same limit `streams` has |
| a `Map` or a `Set` | neither survives `JSON.stringify` |
| an intersection with a non-object side | only object literals merge |

| Derived loosely | How |
| --- | --- |
| a tuple | an array of whatever its positions hold, losing order and length |
| a recursive member | stops at the cycle |
| an object | left OPEN — `additionalProperties` is never `false` |
| an output | only from an explicit type argument or an annotated return type |

The utility types that ARE understood are the structural ones: `Array`, `ReadonlyArray`, `Record`,
`Partial`, `Readonly`, `NonNullable`, `Promise`/`Awaited`, and the async-iterable family.

### The second speed

| Name | Type Signature | Description |
| --- | --- | --- |
| `deriveShapes` | `(options: DeriveOptions) => Promise<Record<string, Shapes>>` | Runs the real TypeScript checker over a project for the computed types tokens cannot read. Joined by `endpointId`. |
| `SHAPES_FILE` | `'.abide/shapes.json'` | Where `bun run shapes` writes it; the Bun plugin reads it and hands it to `elide`. |
| staleness | — | It only ever UPGRADES: an endpoint it says nothing about keeps what the tokens said, so a missing or old file costs detail and nothing else. |
| what it adds | — | The computed types, and an OUTPUT for every endpoint — a declaration IS an `Rpc<Args, T>`, whether or not a handler annotated a return. |

Both derivations assemble their answer in one place (`compiler/internal/assemble.ts`) so the two can
never differ; a union's `type` list is sorted for the same reason.

## The projection

| Name | Type Signature | Description |
| --- | --- | --- |
| `endpoints` | `() => EndpointShape[]` | Every registered endpoint as `{ id, kind, method, description, streams, input, output, room, clientPublish, clients }`, sorted by address. `streams` is said only when true, and it is what the DECLARATION says rather than what a call turned out to do: a `function*` the runtime can see for itself, and a `jsonl()` / `sse()` framing only the compiler can, which is why it crosses `register` beside the shapes. Read off the value instead, a framed endpoint described itself as answering one value until something had already called it. |
| `GET /__abide/schema` | — | The same document over the wire. Open: every address in it is already in the client bundle. |
| `openapi` | `(options?: OpenApiOptions) => OpenApiDocument` | The same catalogue as an OpenAPI 3.1 document. `title` / `version` default to `APP_NAME` / `APP_VERSION`. |
| `GET /__abide/openapi.json` | — | The document over the wire, open like the schema. `.json` because the consumer is somebody else's generator. |
| `POST /__abide/mcp` | — | The MCP surface, revision **`2026-07-28`** and that one only: JSON-RPC 2.0 carrying `server/discover`, `tools/list` and `tools/call`, ONE request per POST. CLOSED to a cross-origin caller — an ordinary MCP client is a process and sends no `Origin`, and the only caller a declared origin would admit is the browser the DNS-rebinding mitigation exists to keep out. `GET` and `DELETE` answer 405. See "The MCP revision" below. |
| `dispatch` | `(request: Request, server?: Server) => Response \| Promise<Response> \| undefined` | The endpoints and nothing else. `undefined`, synchronously, for a path outside `/__abide/`. Opens one `serve(request, …)` around every lane, and latches `server()`. |
| `websocket` | Bun websocket handlers | Handed straight to `Bun.serve({ websocket })`. |
| `register` | `(kind: Kind, pairs: [string, string][], exports: object, shapes?) => void` | What the compiler appends to a transport module: the addresses and the exports behind them. |
| `registered` | `(kind: Kind) => string[]` | Every address registered under one law. |

An MCP tool is `{ name: id, description, inputSchema: input }`; an OpenAPI operation is the same
three facts under other names. Neither projection DERIVES anything — the shape is already JSON
Schema, which is why 3.1 is what is emitted: its schema object IS JSON Schema, where 3.0 would need
translating on the way out. What they add is only what the catalogue has no reason to know:

| Fact | Where it shows |
| --- | --- |
| a read spends its args one query parameter EACH | `parameters` on the operation; a non-object goes through the `__abide_args` hatch |
| a mutation's args are a body | `requestBody`, as JSON — or `multipart/form-data` when a member is `format: 'binary'` |
| a handler that yields answers ndjson | `application/x-ndjson` on the 200, with `output` as the CHUNK |
| a socket is not a call | two HTTP arms rather than an operation — see below |
| an address is not a legal tool name | MCP sanitises `users/getUser` to `users_getUser` and keeps the address as `title` |
| a schema refusal is actionable | an MCP RESULT with `isError`, not a JSON-RPC error: an agent can act on "q: expected string" and cannot act on `-32602` |

### The MCP revision

`2026-07-28` made MCP **stateless**, and that is what decides the size of this surface: there is no
`initialize` handshake, no session, no `ping` and no batch, so there is no connection state to
establish, carry or expire. Every request states its own version and capabilities and is checked on
its own, which is why the door is three methods and a validator rather than a lifecycle.

| What a request carries | Where |
| --- | --- |
| `io.modelcontextprotocol/protocolVersion` | `params._meta`, required — mirrored in the `MCP-Protocol-Version` header |
| `io.modelcontextprotocol/clientCapabilities` | `params._meta`, required |
| the method | mirrored in the `Mcp-Method` header |
| the tool name | mirrored in the `Mcp-Name` header on a `tools/call`, Base64-wrapped as `=?base64?…?=` when it will not survive as ASCII |

The mirroring is what lets an intermediary route without parsing the body, and the server MUST check
that the two agree — a load balancer routing on the header while the server executes on the body is
the vulnerability the mirroring would otherwise introduce. Every refusal carries the status the
revision fixes for it, because that status is how a client tells a modern server from a legacy one
before it reads the body:

| Refusal | Code | Status |
| --- | --- | --- |
| a header disagrees with the body, or a required one is missing | `-32020` `HeaderMismatch` | 400 |
| a revision abide does not speak — answered with `data.supported` | `-32022` `UnsupportedProtocolVersion` | 400 |
| `_meta` is missing a required field | `-32602` | 400 |
| a method that does not exist | `-32601` | 404 |
| a batch, which no revision since `2025-06-18` has | `-32600` | 400 |

Every result carries `resultType: 'complete'` and `_meta['io.modelcontextprotocol/serverInfo']`;
`tools/list` and `server/discover` also carry `ttlMs` and `cacheScope`, which are the only thing
telling a client to look again — the list GROWS as lanes register, and there is no
`subscriptions/listen` here to announce it. `Mcp-Session-Id` and `Last-Event-ID` are ignored rather
than echoed.

`tools/call` does not reach a handler. It builds a request to the app's own `/__abide/` door and
re-enters `dispatch`, so every policy, middleware rung, cross-origin rule and schema gate applies
exactly once — a second path to a handler would be a second security posture. Cookies and
`authorization` are carried onto the re-entered call, so an app's auth middleware sees the caller it
would have seen.

`clients` on either declaration is the opt-out, per surface: `{ mcp: false }` keeps an endpoint out
of the tool list, `{ openapi: false }` out of the document, and silence means both. Two flags rather
than one `publish`, because an OpenAPI operation is a description a human reads and an MCP tool is a
call an agent may make on its own.

### A socket over ordinary HTTP

One address, three doors — `GET` with `Upgrade: websocket` is the connection, and the other two are
what a generated client, a `curl` and a tool call can actually reach.

| Door | What it is |
| --- | --- |
| `GET /__abide/socket/<id>?<room>` | The transcript, then everything after it, as `application/jsonl`. |
| `POST /__abide/socket/<id>?<room>` | One JSON message into the room, through `clientPublish`, the declared message schema and the socket's middleware. Answers `202 {"accepted":true}` — what happens to the message is `clientPublish`'s to decide. A socket that declared none answers 405. |
| `__abide_tail=n` / `__abide_wait=ms` | How much is enough, and how long to wait for it. Absent, the response never ends, which is right for a browser and a hang for anything that must return: a count ALONE never completes on a room nobody has published into. Both are handed to `channel.tail({ limit, idle })` rather than wrapped around it, because a generator parked awaiting its next message does not process a `return()` until one arrives — a bound applied from outside would leave the subscription alive on exactly the quiet rooms it is for. |

A refusal here is a STATUS where the frame path drops silently, and that is not a second policy: a
websocket frame has no response to carry a refusal in. The ROOM is decoded with the socket's declared
room shape at every door, so a query resolves to ONE room — decoded as `"7"` by one and `7` by another
would be a publish landing where nobody is listening.

## The caller scope

| Name | Type Signature | Description |
| --- | --- | --- |
| `isolate` | `<T>(fn: () => T) => T` | On no entry point — `$shared/internal/scopes.ts`; it is what a TEST uses to prove two callers do not share a cache. Runs `fn` with its own caches and ambients, dropped when it settles. One variable set and put back, so a second while an async one is in flight THROWS. |
| `serve` | `<T>(request: Request, fn: () => T) => T` | The same for one request, and what makes the ambients answerable. Async-local, so it has no such limit. |
| `isServing` | `() => boolean` | Whether there is a request scope to ask at all, so a shared path can branch instead of catching a throw. |
| `heldStream` | `(body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>` | A body that keeps its caller's scope alive until its last chunk. Idempotent, and a no-op outside a request. |

Per-caller is the default; `{ global }` is how something belonging to the process says so. On a
client there is one caller forever, so neither is needed.

The scope lasts as long as the RESPONSE, not as long as the handler. A handler answering with a
stream returns before a byte of the body is written, so every streaming body abide builds — `toStream`,
`documentToStream` and `fragmentToStream`, `jsonl` and `sse`, and a streaming rpc — holds the scope
until its last chunk.
Otherwise a `memo` the handler read and the body reads again finds a cache torn down under it and
builds the same answer a second time: the right value, twice the work, and nothing to say so. The
ambients need no such help: they ride the async context an `await` already carries.

`heldStream` is that hold on its own, for a body abide did not build. `page` calls it; `jsonl`, `sse`
and a streaming rpc call `heldFrames`, which is the same hold with the framing INSIDE the pump rather
than in a second `ReadableStream` wrapped around it. So a body answered through any of them is held
whoever wrote it; a
hand-written `new Response(stream)` calls it itself, because nothing abide owns sits between that
stream and the socket. It is IDEMPOTENT — a body that already holds comes back untouched — so it is
a fact about the stream rather than a rule about which layer is allowed to ask.

## Ambient values

| Name | Type Signature | Description |
| --- | --- | --- |
| `route` | `() => Route` | The route being served: `.name`, `.kind`, `.params`, `.url`, `.navigating`, each its own read. REACTIVE. |
| `online` | `() => boolean` | Whether the caller currently has connectivity. REACTIVE. A server is always online — the question is whether the caller can reach the thing it is talking to. |
| `identity` | `(options?: WireOptions) => Promise<Identity>` | The principal the server resolved for this caller, never null. Composed where the caller is being SERVED, fetched anywhere else. |
| `health` | `(options?: WireOptions) => Promise<Health>` | The app's own account of whether it is working. Composed in the process that is serving, fetched anywhere else. |
| `request` | `() => Request` | The request being served. Throws outside a `serve`. |
| `cookies` | `() => Map<string, string>` | The cookies of the request being served, live and mutable. |
| `bag` | `() => Map<string, unknown>` | A bag of values carried for the life of one request. |
| `trace` | `() => string` | The trace id tying this work to its operation: the inbound `traceparent`'s, or a fresh one. W3C Trace Context. Nothing to do with `log.debug`. |
| `nonce` | `() => string` | This request's CSP nonce, built on first ask and the same for every later one. 16 bytes of `crypto.getRandomValues`, base64url. What `csp()` names in the header and what the render stamps on abide's own inline output. |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The Bun server that is listening. A PROCESS fact; throws before anything has served. |
| `appDataDir` | `() => string` | The per-user directory this app may write to, as a PATH. A process fact, needing no `serve`, and not created here. |
| `appName` / `appVersion` | `() => string` | The app's name and version, off `ABIDE_APP_NAME` / the nearest package.json above the working directory. |
| `config` | `<Extra>() => Config & Extra` | What the process was TOLD. A process fact, resolved once and read synchronously. |

### `trace`

| Name | Type Signature | Description |
| --- | --- | --- |
| `trace()` | `() => string` | The trace id — the OPERATION this work belongs to. Built on first ask and held for the request. |
| `trace.span` | `() => string` | THIS hop's span id, minted per request. abide mints exactly one span per hop and models no span tree. |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. A trace that STARTS here is `03`. |
| `trace.state` | `() => Map<string, string>` | `tracestate`, live and mutable. Untouched, the inbound text propagates byte for byte. |
| `trace.headers` | `() => Record<string, string>` | What an outbound REQUEST carries: `traceparent` naming our span as parent, plus `tracestate`. Attached automatically by `remote`; an explicit one is not overruled. |
| `trace.responseHeaders` | `() => Record<string, string>` | What a RESPONSE carries: `traceresponse` with our span as parent-id. Set on every response abide builds. |

### `server`

| Name | Type Signature | Description |
| --- | --- | --- |
| `server()` | `<WebSocketData>() => Server<WebSocketData>` | The listening server — `requestIP`, `publish`, `pendingWebSockets`, `stop`. Throws before anything has served. |
| `server.peek` | `<WebSocketData>() => Server<WebSocketData> \| null` | Observes; never throws. |
| `server.set` | `<WebSocketData>(instance) => Server<WebSocketData>` | Hand it over, returning what it was given: `server.set(Bun.serve({ … }))`. `dispatch(request, self)` latches it automatically. |

## The health document

| Name | Type Signature | Description |
| --- | --- | --- |
| `health` | `(options?: WireOptions) => Promise<Health>` | The account of the app this call is IN. Always a promise, on both sides. |
| `WireOptions` | `{ base?: string; fetch?: (input, init) => Promise<Response> }` | The same two options `remote` and `identity` take. Naming a wire means asking over it, even in a process that could answer itself. |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter: fields merged OVER the baseline. Returns the way off again. |
| `GET /__abide/health` | — | The same document over the wire. Open, so a health check needs no secret configured into it. |

| Baseline field | Type | What it says |
| --- | --- | --- |
| `reachable` | `boolean` | Whether the account arrived at all. The ONLY field a caller that reached nothing writes down. |
| `version` | `string` | The app's version, off the same package.json its name comes from. Empty rather than absent. |
| `startedAt` | `string` | When the process started, ISO-8601. |
| `uptime` | `number` | ms since it did, off `performance.timeOrigin` + `performance.now()`, so it is monotonic. |
| `error` | `WireError` | The reporter throwing. The account keeps the baseline; the endpoint's status comes off this field. |

An app's fields win every collision, `version` included. A reporter that throws does not take the
document with it, and is warned on `abide:health`; one returning something with no fields to merge is
warned on the same channel and the baseline stands.

## The principal

| Name | Type Signature | Description |
| --- | --- | --- |
| `identity` | `(options?: WireOptions) => Promise<Identity>` | The document. Never null: an anonymous visitor is `{ authenticated: false }`. A named wire is asked every time. |
| `identity.set` | `(claims: unknown) => Promise<void>` | Authenticate this caller: `claims` are sealed into the `abide-identity` cookie and every response this request builds carries it. Throws synchronously in a browser. |
| `identity.clear` | `() => void` | Sign this caller out, for the rest of THIS request as well as the next one. Server-side, like `set`. |
| `identity.invalidate` | `() => void` | Forget what was resolved so the next ask does it again — what a browser calls after the rpc that signed it in. |
| `onIdentity` | `(resolve: (claims: unknown) => unknown) => () => void` | The app's resolver: what the claims that arrived MEAN. Receives `null` for a caller with no valid seal. Returns the way off again. |
| `GET /__abide/identity` | — | The same document over the wire, which is how the browser half asks. Open — the answer is composed from the caller's own cookie — and `no-store`. |

| Baseline field | Type | What it says |
| --- | --- | --- |
| `authenticated` | `boolean` | Whether this caller presented something the server accepted. |
| `expiresAt` | `string` | When the seal lapses, ISO-8601. Absent on an anonymous caller. |
| `error` | `WireError` | The app's resolver failing. A document carrying one is never authenticated. |

| Rule | Detail |
| --- | --- |
| the seal | An HMAC over the claims and their expiry. Not encryption: a browser can read what it was given and cannot forge a different one |
| the cookie | `HttpOnly`, `SameSite=Lax`, and `Secure` in production only |
| a bad seal | A bad signature, a lapsed seal and a malformed cookie are ONE answer: this caller is anonymous |
| without `onIdentity` | The sealed claims ARE the principal |
| a resolver's fields | Win every collision, `authenticated` included |
| a resolver that throws | Fails CLOSED: anonymous, with the failure under `error`, warned on `abide:identity` |
| resolution | At most once per request; what is held is the document or the promise, so two asks share one resolve |
| rolling | The seal is refreshed once half spent, so an idle session still lapses on schedule |

## The configuration

ONE SPELLING: a field's name IS the variable's name. Two layers — the app's defaults, then what the
operator declared — so the environment wins, which is what makes the app's layer a default.

| Name | Type Signature | Description |
| --- | --- | --- |
| `config` | `<Extra extends object>() => Config & Extra` | The document. Every field of `Env` is present. THROWS what `onConfig` threw and what its schema refused. |
| `config.invalidate` | `() => void` | Forget it, so the next ask resolves again — what a rotated environment needs. |
| `onConfig` | `<Extra>(fn: ConfigDefaults \| null, options?: ConfigOptions<Extra>) => () => void` | The app's DEFAULTS: `fn(env)` returns fields merged UNDER what was declared. Takes effect on the PATH, not just the document. |
| `ConfigDefaults` | `(env: Env) => unknown` | Synchronous by contract. Whatever it names becomes overridable by a variable of THAT NAME. |
| `options.schema` | `Schema<Extra>` | The same `Schema` a transport declaration takes, checked LAST over the whole document. It normalises as well as refuses. |

| Rule | Detail |
| --- | --- |
| coercion | A value out of the environment is coerced to the type of the default it overrides; a value that will not coerce keeps the default. Anything richer stays the raw string for a schema to convert |
| the native JSON Schema form | Deliberately does not coerce — it refuses rather than guessing |
| a Standard Schema | Refused by name here: this is the one place abide cannot await a `validate` |
| variables, plus THREE conclusions | A conclusion drawn from a variable is not normally a field. `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` are the exception, and the only one: an app asks what it is called far more often than it asks which variable said so. What makes the pair safe is that there is one ANSWER — each is computed inside `resolve()` from the same function that used to be the accessor, so a document publishing one value while the app honoured another is unreachable rather than discouraged. Resolved TWICE, before the `onConfig` hook so a default may be computed from `APP_NAME`, and again after it so a hook that defaults `ABIDE_APP_NAME` moves the name. The accessors (`appName()`, `appVersion()`, `appDataDir()`) are on `abide/server/internal`: they are what the fields are computed from, and an app reads the field. `NODE_ENV` → `isProduction()` is NOT one of the three — it stays internal, `config()` publishes `NODE_ENV` verbatim, and an app draws that conclusion itself |
| called ONCE | A second `onConfig` REPLACES the first, schema included, and warns on `abide:config` |
| a hook that throws | Fails HARD: the read carries the throw, and `boot` asks before it binds |
| memoised | Resolved once for the process; a variable changed after something already asked needs `config.invalidate()` |
| open | A document is left OPEN, so a schema naming one field lets the rest of `Env` through |
| no wire face | There is no `GET /__abide/config`. An app publishing a subset does so through an rpc |
| the SOURCE | Every knob abide reads is answered from this document, over the `useConfigSource` seam, so an app's default takes effect. An rpc's `timeout` and `maxBodySize` resolve at the DOOR |
| the exception | `DEBUG` and `ABIDE_LOG_FORMAT` are read from the document for what was DECLARED, composed with what only a lane knows (a browser's `localStorage`, a TTY); inside a resolve they fall back to the plain environment |

## Logging

| Name | Type Signature | Description |
| --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message on the default channel, `<app name>`. Always writes — an app's own output needs no env var. |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | The four levels. `warning` and `error` always write on every channel, and go to stderr in every format. |
| the FIRST argument | `unknown` | Composes the line, because a line is what a channel prefix, a level, a trace id and a `+Nms` delta attach to. A string is used as it stands and anything else goes through `String`, so `log.error(err)` reads as `Error: no such row` — and the error itself still travels, which is the point: it is rendered into the line AND passed on. |
| the REST | `unknown[]` | Handed to the console AFTER the composed line, untouched. For an `Error`, which is the case that needs it: `String(err)` is `name: message`, so a stack survives only as the object. NOT console's signature — nothing here substitutes, because `%c` takes a CSS string a terminal cannot use and `%o` renders an inspector widget in one lane and `util.inspect` output in the other, and that is the one part of this surface that could not be isomorphic. Nothing is stripped either, so a specifier reaches the console and behaves however that console behaves. |
| `log.channel` | `(name: string) => Logger` | A named channel, prefixed `<app name>:`. Calling it again appends another segment; the same name hands back the same logger. |
| `log.enabled` | `() => boolean` | Whether a gated line on this channel would be written. For a call site whose MESSAGE costs something — an argument is built before the gate can refuse it. The app's own channel answers `true`. |
| `DEBUG` | `string` | Gates named channels in debug-npm grammar (`abide:*`, `docs:cards,docs:db`, `*`, `*,-abide:*`). Read from the environment on a server and `localStorage.debug` in a browser. |

A message is one line and one line is one record: the five fields — time, level, channel, message,
trace — are the whole shape in every format, with tabs and newlines escaped. The trace is the
operation the line was written in, `null` on a client and outside a request, and always present.
A line's `rest` folds into that record's `message` rather than adding a sixth field — an `Error`
contributing its `stack` and anything else its `String` — because a collector is where a stack is
worth the most and is also the one reader that cannot expand an object.

| Shape | When |
| --- | --- |
| readable | `<channel> <level> <message> <trace8> +<n>ms`, colored at a TTY. The delta is since the last line on THAT channel; the trace is the first eight hex. Always this in a browser console, never with ANSI |
| `tsv` | Five tab-separated fields — what a pipe gets. Five ALWAYS, empty where there is no trace |
| `json` | The same five, named |

`ABIDE_LOG_FORMAT` declares one outright. Unset, the shape follows the TTY, with `NO_COLOR` forcing
`tsv` and `FORCE_COLOR` forcing the readable form off one.

### abide's own channels

Rooted at `abide` however the app is named, so `DEBUG=abide:*` turns on the framework and nothing
else. The first three are the operation lines — one per request, one per call, one per accepted
frame — and each is written inside the request scope, so the line carries the `trace` the work
belongs to and an rpc line and its request line correlate by id.

| Channel | Level | What it says |
| --- | --- | --- |
| `abide:request` | `debug` | `<method> <path> <status> <n>ms`, once per request through `handle`. A socket upgrade says `upgraded` — Bun answers the handshake itself, so there is no status. An app that mounted `dispatch` by hand is outside this funnel |
| `abide:rpc` | `debug` | `<address> <outcome> <n>ms`, once per call through `respond` — wire and `fn.raw` alike. The outcome is `ok`, `streaming`, or the error's own name and status. A stream is timed to the FIRST response, not the last chunk |
| `abide:socket` | `debug` | An inbound frame accepted, and one dropped. A socket that declared no `clientPublish` returns before either — the frame was never a publish |
| `abide:lifecycle` | `debug` `warning` `error` | The stopping signal; a hook that returned without binding; a route or an `onError` that threw |
| `abide:identity` | `debug` `warning` | A cookie that did not verify or could not be rolled; an `onIdentity` that threw or answered a non-object |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object |
| `abide:config` | `warning` | A second `onConfig` replacing the first |
| `abide:stream` | `warning` | A transcript dropped for passing `ABIDE_MAX_STREAM_BUFFER_SIZE` |
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane: a mismatched slot rebuilt, a fragment that did not arrive |
| `abide:load` | `error` | A failed load a READ touched, in either lane, once per distinct reason, with the reason passed to the console as the object so its stack survives. Both arms of a failure are reads: the one that asks (`{:else if x.error()}`) and the one that reads the value and has it thrown at it. An `await` is not a read — whoever awaited catches it, or raises an unhandled rejection already carrying the stack — and neither is an rpc answering a declared `error.typed`, which is on `abide:rpc` with its outcome |

The three operation channels ask the gate before doing any work of their own: closed, none of them
reads the clock, parses a URL or builds a message. That is what `enabled()` is for, and it is asserted
as WORK in the logging suite rather than as output — a request answers the same status either way.

### The remote feed

| Name | Description |
| --- | --- |
| `GET /__abide/logs` | Every record the ring holds, then every one that arrives next, as one jsonl body that never ends. Served by `dispatch`. |
| `ABIDE_LOGS` | Opts it IN. Closed is the default, and a closed feed answers 404. |
| `ABIDE_LOG_BUFFER` | The ring's size in RECORDS (default `500`). |
| `abide logs` | The client. A RECORD crosses rather than a rendered line, so the reader prints it by the rules its OWN stdout answers to. |

The feed is `channel({ tail })` and `ch.tail()`, so there is no second retention policy. It carries
what was WRITTEN — the `DEBUG` gate decides that here exactly as at the console. A closed channel
costs a gate read and a compare; in a browser that read is held for the synchronous run and dropped
on the next microtask.

## Reads and writes inside a `.abide` file

A cell is read and written by NAME. The explicit `x()` / `x.set(v)` spelling always compiles — this
is sugar over it, not a replacement.

| Form | Meaning |
| --- | --- |
| `{source}` | The identifier IS the whole VALUE → the **cell** is handed over. A slot renders its value; a prop or a `bind:` receives the cell. A wrapper that cannot change WHICH cell it is comes off first — balanced parens, a trailing `!`, an `as T` / `satisfies T` tail — so `{count}`, `{count /* note */}`, `{(count)}`, `{count!}` and `{count as T}` all hand over the same cell. Composing it is still a read, wrapper or not: `{(count) + 1}` and `{f(count)}` read |
| `{m(args)}`, `{m(args).pages}` | A **keyed** memo is read by its CALL the way a cell is read by its name — the handle IS the cell, so no trailing `()` |
| `{source + 1}`, `{source.length}` | Used as part of an expression → a **read**. In a `<script>`'s own statements it is `peek()` instead — see below |
| `source = v` | A write |
| `source += v`, `source++`, `source = source + v` | Read through `peek` then write — a write must not subscribe, so an effect is never woken by its own write. All three spellings agree, and only the TARGET peeks: `a = a + b` still subscribes to `b`. `++`/`--` are statement position only |
| `source()`, `source.set(v)`, `.peek`, `.pending`, … | Untouched. The shared surface is **reserved**; every other property belongs to the value. This is also how a write that DOES mean to subscribe is written — `x = x() + 1` — so there is no `untrack` to reach for. Punctuation between the name and the access comes with it: `source?.()`, `source!()` and `source!.set(v)` are the author's own spelling too |
| `source(a, b)` | A read takes NO arguments, so a call carrying some is a call of what the cell **holds**: `source()(a, b)`. This is what lets a callback prop work in a lane where no type said it was a callback. A **keyed** memo is the exception and is answered before this — `m(args)` selects a slot |
| `{await p}` | The hole's thunk is emitted **`async`**, so it hands back a promise — and a promise in a hole renders what it resolves to. Every position whose thunk lands in a consumer that resolves one: a child slot, an attribute (quoted or not), a spread, a `class:`/`style:` toggle, a component prop, and the three block HEADS. **Refused** in the three that have no such consumer, because there an async thunk would trade a compile error for a silently wrong value — `bind:` hands over the CELL and emits no thunk at all; a `by` key is emitted inside the row callback and is an IDENTITY compared per row, which a fresh promise never matches; and a `{#try}` body is evaluated as ONE unit so `{:catch}` can see a throw, which a rejection is not. Whose `await` it is decides nothing: one belonging to a nested `async` arrow is ordinary code that compiles either way, and it only buys an `async` the expression did not need. `obj.await` is a property, not an await. The thunk is re-run per pass, so it does not cache — a load that should run once goes in a cell. Sources it reads must be read BEFORE the `await`, which is the rule every async body has — see "Known limits" |
| shadowing | A `const`/`let`/parameter/`{#for}` binding of the same name shadows, so a loop variable is never read as a cell |
| narrowing | A `{#if}`/`{:else if}`/`{#switch}` condition reads ONCE into a local and its branch narrows off that. The body's other reads keep their own thunks. A HELD position takes the local too, and what decides it is what the expression NAMES rather than where it sits: a prop naming the cell alone hands the CELL over — a child given a value has nothing left to subscribe to — while a prop reaching a member has already read the cell to get there, so the local is the same value, one subscription instead of two, and the thing the branch narrowed. `bind:` and `&ref` take no local at all, because a bind WRITES back through the path it was handed |
| position | A read among a `<script>`'s STATEMENTS emits `peek()`, and is typed `T \| undefined` for it. A read inside a FUNCTION body there emits `()` |

What counts as a cell is decided **syntactically**: `const x = state(…)` or `state.shared(key, …)` in
a `<script>`, or ANY prop bound from `props<T>()` — a component's props are cells, because the
position showing it holds the instance and writes each one. The two exceptions are read off `T`: a
FUNCTION member is a callback, and a `KeyedMemo`/`KeyedChannel` is a handle a cell cannot stand in
for. The binding is what carries it, so `{ note: text }` makes `text` the cell and leaves `note`
nobody.
Whether the NAME or the CALL is the source comes from the declaration — `memo(() => …)` vs
`memo(({ id }) => …)`, `channel<T>()` vs `channel<T, Args>()`. An **imported** source has no
declaration to read, so it keeps the explicit spelling — with one exception, which is an import
statement that says as much as a declaration would: a named import from **`src/server/rpc/**`** is a
keyed memo, because that is what the directory means and `rpc` = `memo` + transport leaves nothing
else it could be. So `{orders({ id }).total}` reads, and `{#if orders({ id }).pending()}` defers,
exactly as a local keyed memo does. `server/sockets/**` is NOT included: a socket is keyed only in
the room form, and an import cannot say which one it is.

## Template expressions

| Form | Meaning |
| --- | --- |
| `{expr}` | Reactive text (escaped) |
| `{raw(...)}` | Raw HTML |
| `name={expr}` | Reactive attribute or property (whole-value expression) |
| `on<event>={fn}` | Native listener on an ELEMENT. On a **component** the same syntax is an ordinary prop named `onclick` |
| `name="…{expr}…"` | Quoted values interpolate too, also on component props; a literal brace is `{'{'}`. A hole folds back into the literal only when it is ONE string and nothing else — `{'a' + b + 'c'}` opens and closes with a quote without being one, and is an expression |
| `bind:value` | Two-way bind — read the property, write back on input/change. On a **component** it hands over the cell ITSELF rather than a copy, which is what lets the child write back; declaring the prop as a `State<…>` is what says it may |
| `bind:checked` | Boolean bind on an `<input>` — a boolean DOM property mirrored as a boolean attribute, never stringified. Writes back on `change` |
| `bind:open` | The same, on a `<details>`, written back from `toggle`. The attribute half is what makes a row that is open on the server open in the markup it sends |
| where each is legal | A TABLE, not a habit: `value` on `<input>` / `<textarea>` / `<select>`, `checked` and `group` on `<input>`, `open` on `<details>`, `element` anywhere. A bind is a read AND a write, so a pairing with no event to write back from — `bind:selected` on an `<option>`, `bind:open` on a `<div>` — is a compile error naming the elements that do answer it, rather than a listener that never fires |
| a `<select>` | `bind:value` on the SELECT, with a plain `value="…"` on each `<option>`. `bind:selected` is the refusal above, and its message names this spelling |
| `bind:group` | Radio/checkbox membership, compared against the input's own `value`; never emitted as a `group` attribute |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair, for when the thing on screen is not the thing you keep. Written inline as above, or HOISTED into a name and bound as `bind:value={pair}` — which of the two a name holds is read off its declaration, the same syntactic rule that decides what is a cell |
| `bind:element={state \| fn}` | Node ref (state) or per-instance handler with the node as argument. Client-only |
| `class:name={cond}` | Toggle a class. **ELEMENTS ONLY** — a compile error on a component |
| `style:prop={value}` | Set one style property. **ELEMENTS ONLY**, same rule |
| `{...expr}` | Spread props (component) / attributes (element) |

## Control flow

| Block | Branches / notes |
| --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` |
| `{#if x.pending()}` | The compact deferring form, and no longer a special one: ANY region that probes an unlanded load defers, so a ternary or a `memo` over a probe reads the same way — see "a deferred block". What this chain still gets of its own is the three-arm shape: the whole chain is one arm handed over three times, so the probe picks what shows on each pass and a settle that lands on the same shape is a no-op rather than a rebuild. The probe is also what starts the load, so a LAZY handle — a keyed memo slot, which starts nothing until something asks — is in flight by the time the arm is chosen. **A FAILURE NEEDS ITS OWN ARM**: `pending()` is false once a load rejects, so a chain with only an `{:else}` falls into a READ, and the read throws the failure it was called to report. `{:else if x.error()}` is what asks. Without it the region is empty and the reason is a console throw, never markup — `{#try}` cannot stand in, since the boundary is synchronous and the failure arrives from a settle |
| `{#for item, i of list by key}` | Keyless → positional (dev-warns if the body is stateful) |
| `{#for await item of source}` | Streaming list; `{:catch}`. REACTIVE: a `refresh()`/`invalidate()` or a changed dep re-streams it. Rows go to the same list part, so a key still MOVES a row |
| `{#switch expr}` | `{:case v}`, `{:default}` |
| `{#try}` | `{:catch e}`, `{:finally}` — a render BOUNDARY over the region, not a `try` around one call. The body is one unit rather than one thunk per expression, so a dep inside re-runs the whole body; and the region owns a buffer, so a throw from anywhere under it — a nested component's setup, a markup thunk two templates down, a `<slot/>`'s contents — discards what the body had written and renders `{:catch}` in its place. It has to replace rather than append, because an arm can only stand where nothing has been sent yet. **Not a pending read**: that signal passes straight through, or a suspending region would paint the arm — an unlanded load wants `{:else if x.error()}`. A throw in a page's own `<script>` setup is outside every boundary in that file, since the view is called before its layouts wrap it. The cost is that the region lands whole rather than chunking, which is already true of any region with something slow in it and is capped by `spill` at `HOLD_LIMIT` |
| `{#component Name(pattern)}` | **Inline component** — a reusable builder. TitleCase required. Invoked as `<Name/>`, passable as a value. The parameter is the pattern written in the parens; children arrive through `<slot/>`, which is why one written with no parameter still binds `args`. Nested inside `<Foo>…</Foo>` it becomes Foo's `X` prop |
| formatting whitespace | Two rules, and neither keeps a text node that renders nothing. A run of pure NEWLINES — no space and no tab in it — is dropped wherever it stands, so `<b>a</b>` and `<b>b</b>` on their own lines at column 0 render `ab`. A run that renders nothing but carries a newline AND indentation is dropped at the two ENDS of every block body and of the file's own top-level template, since it would otherwise be a permanent member of the instance's movable range. An indented run in the MIDDLE of a body survives, which is what keeps the ordinary shape spaced. The case this changes: two blocks back to back with no whitespace between them — `{/if}{#if b}` — whose bodies each held an inline node, where `x y` now renders `xy` |

## Components

| Feature | Notes |
| --- | --- |
| `<Name/>` | Capitalised tag = component invocation, CARRIED to the position that shows it rather than called where it stands — see below |
| `<slot/>` | Renders default children |
| `<Tag>…</Tag>` | Children passed to the component's `<slot/>` |
| nested `{#component X()}` | Named component prop (render-prop) |
| `const C = memo(…)` → `<C/>` | A state- or memo-named tag is a **reactive** component (re-mounts on change) |
| an inline `{#component}` | Called where it stands. It has no `<script>`, so there is no setup to run once and nothing to keep — and its parameter type is written by hand, so its props stay values |

### Instances

`<Card n={r.n}/>` emits `component(Card, { n: r.n })`, not `Card({ n: r.n })`. The call is a marker
the position interprets, exactly as a deferring block and `{#try}` are: the part that shows the component
holds the instance, calls the view ONCE, and writes every later pass's props into the cells that call
was given. So **setup runs once** — the child's own `state` survives anything the parent re-renders
for, and a prop that did not move wakes nobody.

That is what the parent re-rendering used to cost. A component call made inside the slot thunk was
re-made whenever that thunk woke, which is whenever anything the parent reads changes — so a keyed
list gaining one row rebuilt every instance in it and discarded whatever had been typed into any of
them. Appending one row to a list of 1000 was 1001 view calls; it is 1.

The instance leaves when the position stops showing it: a slot that paints something else, or a part
that is disposed, drops the record and its cells. Coming back is a new instance. A keyed row that
MOVES carries the part, so its state travels with it.

The SERVER makes the cells too and then simply calls the view: a snapshot has no later pass to carry,
but a component is written once and runs in both places, so what it receives is the same shape either
way.

### Props

```html
<script>
import { props, type State } from 'abide'

type Card = { class?: string; note: State<string>; count?: number }

const { class: className = '', note, count = 0 } = props<Card>()
</script>
```

`props()` is imported and **compiler-erased**: the call becomes the emitted function's parameter and
the type argument becomes `Props<T>` — the same type with every prop that is data behind a cell. The
destructure beside it is ordinary TypeScript, and renaming, a default and a rest element all mean what
they mean anywhere else; a default is lifted out of the pattern and applied to the cell instead, since
a prop the caller omitted would otherwise satisfy it with a plain value. There is no `args` object,
which is the point: every name a `<script>` uses was imported or bound by the author.

The author writes what a prop IS — `count?: number` — and reads it the way every other name in a
template is read. In a `<script>` BODY the explicit spelling applies as it does to any cell: `count()`.
A caller still passes the value, so `<Card count={3}/>` and `<Card count={n}/>` are both checked
against `number`.

| Rule | |
| --- | --- |
| where | `<script>` only. In a `<script module>` it is a compile error — module scope has no instance |
| not imported | A compile error. The call is erased, so an unimported one would otherwise work silently |
| no `props()` call | The component accepts no props of its own, and a caller passing one is an error |
| `props()` with no type | `Record<string, unknown>` — the opt-out, and what `const { ...rest } = props()` is for |
| `children` | Always accepted, never a name: `<slot/>` renders what is between the tags, and nothing has to declare it |
| every prop | A cell. `Props<T>` is the mapping, and the pattern is what names them — see above |
| a `State<…>` prop | Passed through rather than wrapped twice, so the child holds the very cell the parent does. That is what `bind:` needs, and the only thing the declared type still decides |
| a function prop | Handed over as written: a callback is called, not read. Recognised from the member's own text — `onpick: (t: string) => void`. One reached through a NAME cannot be, and stays the one hole this spelling has, alongside an imported props type |
| a derived prop | `doubled={n * 2}` reads a cell, so the enclosing slot wakes on change — and what that costs now is a write into the child's `doubled` cell, not a rebuilt child |
| a `...spread` | The key set is fixed at setup: the child bound its locals then, so a key the spread ADDS later has no cell to be written into and is reported rather than dropped silently |

A type declared in a `<script>` is lifted to module scope, because the signature that names it is
written outside the body it was declared in.

## Script / style blocks

| Block | Scope |
| --- | --- |
| `<script>` | Per-instance (component setup). `export` is a compile error — the body is inlined into the setup |
| `<script module>` | Module scope, so `export` belongs here. A CELL declared here is one per CALLER — one per request on a server, one per page in a browser — shared by every instance inside that one. See below |
| nested `<script>` | Branch-local (per-ITEM in a `{#for}`). Must be the FIRST node of a block body, carries no `import`, and resolves off the level's scope. A `{#for}` splices it into the row closure; every other body pays one call |
| `<style>` | Component-scoped: every element carries `data-a<hash>` and every selector requires it on its rightmost compound. Registered once at module scope |
| nested `<style>` | Subtree-scoped — an element carries every scope in force, so an outer rule reaches in and an inner one cannot reach out |

### A cell in a `<script module>`

Module scope is per CALLER, not per process. The compiler wraps the binding — `const count = state(0)`
emits as `state.scoped(() => state(0))`, a `channel` as `channel.scoped(…)` — and the facade resolves
it on every member: the request scope on a server, and on a client a scope that never exists, so the
one cell is built on first access and kept for the page.

| | |
| --- | --- |
| what varies | The NODE, never the binding — which is why the wrap is needed at all. `state.shared` scopes the lookup instead, so a declaration that runs once still holds the cell its first evaluation built, and it is wrapped here like anything else |
| a thunk, not a value | The initial is built per caller. Sharing the `0` in `state(0)` is harmless; sharing the generator in `state(ticking())` is the same bug one level in |
| built lazily | The declaration alone builds nothing. An eager fallback would start a promise or a stream at module load — on a server, once for the process, before any request exists |
| what is NOT wrapped | A factory (`const make = () => state(0)`) builds one per call already. A keyed or argless `memo` is per caller through its own cache and `scopedArgless`. A constant, a helper and a type are the same for every visitor, which is what module scope is for |
| a `<script>` cell | Untouched: per instance, already inside whatever scope the caller has |
| where it is applied | AFTER the desugar, never before — the sugar decides cell reads over the same text, and a wrapper spliced in first stops `query.toUpperCase()` becoming `query().toUpperCase()` |
| a `watch` statement | Also per caller, and it cannot be lazy the way a cell is — an effect has no read to wait behind. It is wrapped as `scopedEffect(() => watch(…))` and KICKED from the setup of the component that declared it, so the first instance in a caller runs the body and the rest find it already running. **A component nobody renders in a request runs no effect in it** — it used to run once at import, which is once for the process. The disposer goes with the caller. A `const stop = watch(…)` binds the disposer and is left alone |

An `<!-- html comment -->` in the markup is for whoever opens the file and is NOT emitted: a
component ships one copy of its own commentary per INSTANCE, and a file's header comment is the
biggest one it has. Whitespace around a dropped comment is left alone, so nothing that was inline
stops being inline — except at a block body's two ends, where the comment and the indentation
holding it go together (see the formatting-whitespace row under Control flow). A comment that has to
reach the browser is `{raw('<!-- … -->')}`.

## Rendering

| Name | Type Signature | Description |
| --- | --- | --- |
| `renderToString` | `(node: Renderable, options?: RenderOptions) => Promise<string>` | The whole render as one string. Synchronous internally: a tree with nothing to await produces the document without a promise. |
| `render` | `(node: Renderable, options?: RenderOptions) => AsyncGenerator<string>` | The same walk as an async iterable of chunks, and the ONE renderer on the public surface. With a `shell` it is the document faces below, reached by the name an app already knows. |
| `toStream` | `(node: Renderable, options?: RenderOptions) => ReadableStream<Uint8Array>` | The same walk as a `ReadableStream`, so the response back-pressures. |
| `renderDocument` | `(document: string \| Shell, body: () => Renderable, options?) => AsyncGenerator<string>` | A whole document: shell, body in order, then out-of-order patches as they resolve. A `string` is the `<head>`, wrapped in abide's own document. |
| `documentToStream` | `(document: string \| Shell, body: () => Renderable, options?) => ReadableStream<Uint8Array>` | The same document as a `ReadableStream`. What `abide start` answers a page with. |
| `renderDocumentToString` | `(body: Renderable, document?: string \| Shell, options?) => Promise<string>` | The same document as one string, with every deferring block awaited in place — for a reader that runs no scripts, so a deferred subtree in a `<template>` would never arrive. An email, a PDF renderer, a fixture. The document trails and defaults to abide's own; the body is a node, because a plain async function has nothing to delay. |
| `renderFragment` | `(body: () => Renderable, options?) => AsyncGenerator<string>` | A `renderDocument` without the shell: the body in order, then its out-of-order patches. What a navigation is answered with — see below. |
| `fragmentToStream` | `(body: () => Renderable, options?) => ReadableStream<Uint8Array>` | The same fragment as a `ReadableStream`. What `abide start` answers a navigation with. |
| `shell` | `(html: string) => Shell` | An app's own html as a document with a hole in it. THROWS when it has no `<slot></slot>`. |
| `Shell` | `{ head: string; open: string; close: string; tail: string }` | Concatenated as `head` + the scoped styles + `open` + the page + `close` + the patches + the seed block + `tail`. Everything between `open` and `close` is what a hydrating client ADOPTS, which is why the last three are outside it. Cut once, because a document cannot change under a running process. |
| a deferred block | — | ASKING IS THE DECISION. A region that PROBED a load and found it unlanded has markup to send now — that is what asking about a load means — so a `renderDocument` emits what it produced as the placeholder and calls it again when the load settles, patching the result in. No spelling is recognised for this: a `{#if}` chain, a ternary, a negated probe and a `memo` over one all reach it identically, and the walk reads the fact off the probe rather than off the source. Reading the cell without asking about it first has no markup to send, so the walk AWAITS the load and it is complete when it arrives — which is what a reader running no scripts needs, since a patch travels in a `<template>` behind a script. A render with nowhere to patch awaits inline either way. A failure arm renders on the deferred path too; without one — and equally when the arm itself THROWS, which the compiled chain does on a rejected load unless it asks `{:else if x.error()}` — a failed deferred subtree is a comment and an `abide:render` error, because by then the shell is already on the wire and there is nothing left to fail into. Every path out returns markup: a subtree whose markup never settles is one the drain waits on forever, so the response would never end. |
| `options.shell` | `boolean \| string` | The document to write around the markup. **Off by default** — markup alone is what a fragment, a mail body and a cached partial want. `true` is the APP's own: its `app.html`, cut at the `<slot></slot>`, with the build's stylesheets and every scoped `<style>` block at the end of the head — the same document `abide start` serves a page in, published once by boot, and abide's own for an app that wrote none, so the ask cannot fail. A STRING is one of the caller's own and is a whole html file with a `<slot></slot>` in it — not a fragment and not a `<head>` — through the same `shell()`, so a document with nowhere to render is refused BY THE CALL rather than on the first chunk. Cut once while the same string keeps arriving, so a module-level document is parsed once and one built per request pays the scan it asked for. |
| `options.hydrate` | `boolean` | Write this render for a client to take over: the markers `hydrate()` adopts by, and — with a `shell` — the `<script type="module">` that boots the client into it. **Off by default**, and the lane is why: the client mounts the PAGES route table at the outlet, so on a path no page owns it renders that table's answer over what the route just served. A page asks for both; a route answering with a document of its own usually asks for neither. |
| `mount` | `(container: Element, view: () => TemplateResult) => Mounted` | Build live DOM and keep it live. Returns `{ dispose }`, which tears the tree down and — for a renderer that was handed `outlet` itself — hands the navigation sink back, so a second `mount` is the live one. |
| `hydrate` | `(container: Element, view: () => TemplateResult) => Mounted` | The same over markup a hydratable render wrote — every part adopts its range. A divergence rebuilds that subtree and warns. |

The two-line patch script goes out with the FIRST deferred subtree rather than in the shell, so a page
that defers nothing ships no script at all.

Every patch — the `<template>` and the `<script>` that swaps it in — is written AFTER the hydration
root closes. Everything inside that root is what the client adopts, and a patch is not something its
own render produces: written inside, it is an extra child on the end of the root, and the part
claiming that range mismatches and rebuilds the whole page it was handed correct markup for. Nothing
needs them inside, because `$p` finds its placeholder by id from anywhere in the document.

### When a load starts

A cell begins its load on the first READ, and in a server render that read is the WALK ARRIVING at the
slot. Left alone that makes document order the start order: three sections holding three independent
loads would cost their SUM rather than their longest, and a page would pay 185ms for three 60ms loads
with nothing in the source saying so.

**The walk does not arrive and wait.** A region that has to wait takes a HOLE — it is written into a
buffer of its own and spliced back at the position it left — so the walk carries straight on to the
next slot and starts what THAT reads. Nothing is analysed and nothing is spelled: a component subtree,
a guarded slot, a `{#for}` row's own load and an attribute value are all covered by the same fork,
and each of those is a shape a compile-time pass could not enter. The three sections render in 62ms.

This replaced a compiler pass — `start([…])`, emitted above a template naming its unconditional plain
slots — which reached only the flattest of those shapes and, across the whole app, resolved to sync
derivations with no load in them at all.

A probe starts what it asks about, so a deferring region needs nothing either: `{#if x.pending()}`
sends its arm and the walk moves on, with the load already in flight. Three deferred panels measure
63ms, and 186ms with nothing kicking them.

Nothing about what a page renders changes — only when its loads begin — which is why every demo here
asserts the PEAK NUMBER IN FLIGHT rather than a clock.

**A streamed render holds bytes, up to a cap, and then SPILLS.** The consumer is given everything up
to the first open hole, so document order survives however the holes settle. Past eight chunks' worth
of held bytes, every open hole that CAN be given up becomes an empty placeholder and a patch — see
below — which bounds the buffer without putting the loads back in series. It is announced on abide's
own `render` channel, because a patched region needs JAVASCRIPT to appear and the size it happens at
is not visible in an author's source. A STRING render never reaches it: its buffer is its output, so
`renderToString` and `renderDocumentToString` always produce complete markup.

**An ATTRIBUTE's hole may not SPILL.** A spill stands a placeholder ELEMENT where the region was and
patches the markup in later, which works because what a hole holds is normally a region — markup that
stands on its own between two nodes. What `class=${…}` holds is not: its position is inside a start
tag that is still open, so a placeholder there reads `<div<slot-s></slot-s>>`, which is not markup and
offers the patch no element to land in. An attribute or spread slot still takes a hole — the walk
carries on past it, which is the point — but the cap is never offered that one, so a render behind an
unsettled attribute blocks where a region would have been patched.

**A SOURCE may not take a hole.** `{#for await}` and a bare async iterable hand over a row at a time,
while a hole hands over a region when it is COMPLETE — eight rows became three chunks, and a channel,
which never completes, hung the render outright. They stay in the walk wherever there is a consumer.

**A deferred subtree may defer again.** It renders with the document carried through, so a deferring
block inside one registers a patch of its own rather than holding its parent's until the inner load
lands too. The order needs no arranging: a nested load cannot start until its parent's has settled, so
its patch cannot precede the one that puts its placeholder in the document.

**A probed STREAM patches its FIRST CHUNK.** It is the one source where "there is something to show"
and "the load is over" are different moments — `pending` stands down at the first chunk while the
settle waits for the last — and a probe asked the first question. Waiting for the settle held the
page for the whole length of the stream, and held it for markup nobody keeps: a client mounting over
a streamed region drops those rows and restarts from the top, because what is under them is a
different point in the same stream and no later chunk makes it match. So the patch carries the first
chunk and the client carries the rest. The lane with NOWHERE to patch is the exception and drains as
it always did — `renderToString` and `renderDocumentToString` serve a reader running no scripts, and
half a transcript is what that reader would keep forever.

Only a CHILD slot carries markers: an opening comment before its value and the anchor after it. Other
slot kinds are found positionally and a list row delimits itself. A chunk boundary is a SUSPENSION,
not a string segment — everything written so far goes out before the walk waits, and a long
synchronous run is handed over once it passes a high-water mark. Every streaming face is bounded by
`ABIDE_SSR_STREAM_BUDGET` as one clock over the whole render.

## The compiled form

A `.abide` file compiles to an `html` tagged template. Every expression gets its own thunk, so a
`{#if}` subscribes to its condition alone.

| Slot spelling | Emitted for |
| --- | --- |
| `name=${v}` | `name={expr}` and `name="…{expr}…"` |
| `@event=${fn}` | `on<event>={fn}` on an element |
| `.prop=${v}` | The read half of a `bind:` |
| `&ref=${x}` | `bind:element` — the NODE itself, so nothing is emitted during SSR |
| `...=${obj}` | `{...expr}` on an element |

A slot inside a tag is one of four sigils or it is an attribute: `.prop` a DOM property, `@event` a
listener, `&ref` the node itself, `...` a spread.

A CHILD slot renders whatever it is handed, and both substrates agree on all of it: a
`TemplateResult`, a string or number as text, `null`/`undefined` as nothing, a promise as what it
resolves to, and an ARRAY as its items in order. An array may hold any of those — it does not have
to be a list of templates, and a nested one flattens. A `keyed()` row is how a reconcile is told an
item's identity; an unkeyed item is matched by position. A row that is not a template is wrapped
into one so the reconcile has something to compare, which is invisible except that such a row
patches its text on a later pass rather than being rebuilt.

An ATTRIBUTE slot and a SPREAD slot resolve a promise the same way, which is what lets `{await …}`
be emitted in either — a thunk made `async` hands one back, and the position it lands in has to take
it. The server awaits in place and resumes the walk after; the client leaves the attribute absent
until it settles, then writes it. Both discard a load SUPERSEDED before it lands rather than letting
it paint over the newer value — which for a spread means it does not take back names the newer one
has already written. A `.prop` and a `&ref` slot do NOT resolve one — neither position can express a
promise — so a promise reaching either is written through as the value it is, which is why the
`bind:` that emits them refuses an `await` rather than emitting one.

## The template runtime — `abide/runtime`

The WHOLE set a compiled `.abide` file imports on its own behalf. Mostly not authoring vocabulary:
an emitted name is what the compiler writes for a SPELLING — `by` on a `{#for}` becomes `keyed`, a
`class:` toggle becomes `classes` — so none of those is a name a source file says. `html` and `raw`
are the exceptions and are imported from `abide`, because a hand-written `.ts` component writes the
same tag and reaches the same hatch; that is also what keeps the emitted header free of a
cross-module dedupe, since the author's own import of either merges into the same statement.

| Name | Type Signature | Emitted for | Description |
| --- | --- | --- | --- |
| `html` | `(strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult` | every template | The one tagged template both substrates consume. ESCAPES every slot. Renders nothing by itself. |
| `raw` | `(html: string) => Raw` | `{raw(…)}` | Marks a string as already-HTML so the escape is skipped. Imported from `abide`, not `abide/runtime`: it is the escape hatch, and a hatch is greppable by one name in both kinds of file. |
| `keyed` | `(key: unknown, template: TemplateResult) => Keyed` | `{#for … by key}` | Tags a row with its identity, so a reconcile MOVES it instead of rebuilding it. |
| `classes` | `(base: string, names: readonly string[], ...conditions: unknown[]) => string \| null` | `class:name={c}` | Merges a static class list and any number of toggles into one value. `null` when nothing survives. The names are static, so the compiler lifts that array to module scope and only the conditions travel per wake. |
| `styles` | `(base: string, names: readonly string[], ...values: unknown[]) => string \| null` | `style:prop={v}` | The same, one style property at a time, into one `style` attribute. Names lifted the same way. |
| `awaited` | `<T>(value: PromiseLike<T> \| T, branches: Branches<T>) => Awaited` | — | The cell plus the arms to call once it settles. NOT emitted for any spelling any more: a `{#if x.pending()}` chain is a plain thunk and the walk defers it off the probe. What still builds one is a hand-written `.ts` component, and both renderers read it back. |
| `boundary` | `(body: () => unknown, branches: Branches) => Boundary` | `{#try}` | A synchronous error boundary around a body thunk. |
| `streamed` | `<T>(source, row, catch?) => Streamed` | `{#for await}` | A list fed by an async source, torn down and re-streamed when a reactive dependency of the source changes. |
| `start` | `(sources: readonly (() => unknown)[]) => void` | the memos an unconditional plain slot reads | Reads each one, so its load is in flight before the walk arrives at the slot that renders it. Written for a POSITION rather than a spelling — see "When a load starts". A throw is swallowed: the read that renders reports it, as it always did. |

| `adopt` | `(scope: string, css: string) => void` | `<style>` | Registers one scoped block by its scope name at MODULE scope. Idempotent. |

| Name | Type Signature | Description |
| --- | --- | --- |
| `escape` | `(value: string) => string` | The text escape both substrates use. Probes before it replaces. |
| `styleTags` | `(nonce?: string \| null) => string` | On **`abide/server/internal`**, not here: writing a stylesheet as markup is something only a server render does, and the client lane adopts into the document instead. Every registered block as its own `<style data-abide="…">`, in registration order — what a server render puts in `<head>` and what `adopt` recognises. Under a nonce the answer is not memoized and an empty `<style nonce data-abide="">` carrier is prepended, which is what `adopt` reads the nonce off — see "Styles under a policy". |
| `classifySlots` | `(strings: readonly string[]) => SlotKind[]` | THE one slot classifier, shared by both substrates. One of `child`, `attr`, `event`, `property`, `ref`, `spread` per hole. |
| `isTemplate` / `isKeyed` | `(v: unknown) => boolean` | The brands, for a renderer deciding what it was handed. `KEY`, the symbol behind the second, is not exported: `keyed()` writes it and `isKeyed()` reads it. |

## The compiler — `abide/compiler`

One pure function and what a caller needs to REPORT what it did. No filesystem, no resolver, no cache.

| Name | Type Signature | Description |
| --- | --- | --- |
| `compile` | `(source: string, options?: { filename?: string }) => Compiled` | The `.abide` text as `{ code, map, segments }`. `filename` names the default export and every diagnostic. |
| `.code` | `string` | The emitted module — the `html` template you would have written by hand. |
| `.map` | `string` | A v3 source map with the `.abide` file inlined. |
| `.segments` | `Segment[]` | The same mapping unencoded, which is what moves a diagnostic back to the source. |
| `originalPosition` | `(segments: Segment[], generatedLine: number, generatedColumn: number) => { line: number; column: number } \| null` | A zero-based position in emitted code back to its position in the `.abide` file. `null` when that line maps to nothing. |
| `locate` | `(source: string, position: number) => { line: number; column: number }` | That position as one-based line and column. |
| `describe` | `(source: string, filename: string, error: unknown) => string` | A thrown compile failure as one `file:line:col message` string. Anything else stringifies unchanged. |
| `ParseError` / `ElisionError` | `class` | The two classes, so a caller can tell a compile failure from any other throw. |
| `elide` | `(source: string, options: ElideOptions) => Elided \| null` | A transport module for one lane: `{ code, kind, endpoints }`, or `null` for a file under neither directory. One pass produces BOTH lanes. |
| `options.resolve` | `TypeSource` | Hands over the text of a module a TYPE is imported from. Consulted lazily, cached per module, and withheld from the browser lane. |
| `options.shapes` | `Record<string, Shapes>` | What the real checker derived, by endpoint address. They only ever UPGRADE: an endpoint absent here keeps what the tokens said. |
| `endpointId` | `(path: string, name: string) => string` | The address, as a fact about the path. |
| `kindOf` | `(path: string) => Kind \| null` | Which law a module declares, as a fact about the path. |

Relative specifiers resolve beside the importer and anything else goes through Bun's resolver, so a
`paths` alias misses; a specifier that does not resolve costs a shape rather than a build.

| Name | Type Signature | Description |
| --- | --- | --- |
| `emitFor` | `(path: string) => Promise<EmitResult>` | Writes the module, its declaration and its map into `<package>/.abide/types/`, mirroring the file's path from the nearest `package.json`. The package and not the repo, because a compiled `<script module>` imports `abide` by its public specifier and a bare specifier resolves by walking up for a `node_modules`. The `tsconfig` names the pair in `rootDirs`, which is what makes `./page.abide` resolve to a declaration that is not beside it. |
| `emitAll` | `(roots: string[]) => Promise<EmitResult[]>` | The same over every `.abide` under the roots. |
| `remap` | `(line: string, byModule: Map<string, EmitResult>) => string` | Moves a `tsc` diagnostic back onto the `.abide` line. A diagnostic inside a `<script>` is marked `[generated]`, since imports are hoisted and there is nothing to map it by. |
| `diagnose` | `(roots: string[]) => Promise<string[]>` | The two of them over a project — what `abide check` runs. |

### Typing behaves the way the same TypeScript would

The desugar rewrites EXPRESSIONS only: a cell named inside a type is left exactly as written — a
`type` alias, an `interface` body, an annotation, `as`/`satisfies`, a type-parameter or type-argument
list alike. The `<` ambiguity is resolved by speculative parse.

`as`, `satisfies` and `implements` are CONTEXTUAL keywords, so which of them opens a type is decided
by the token in front: something an operand can end with, or `>` for `class C<T> implements I`.
`{ as: 1 }`, `row.as` and `const as = 1` are ordinary JavaScript and stay expressions — matched on
the word alone, each of them made the rest of the expression a type region, and a cell read inside
one is then left as the CELL with nothing reporting it.

| Form | Checked as |
| --- | --- |
| narrowing | A `{#if}`/`{#switch}` condition reads once into a `const`, so the branch narrows off a real type — and only the switched cell narrows |
| imported types | Resolved by the checker across the module boundary, exactly as in a `.ts` |
| generics | A type argument reaches the read; a type-argument list in an expression is a type |
| component props | The type argument to `props<T>()` in a `<script>` types them, through `Props<T>` — the same members with every one that is data behind a cell — and a type declared there is lifted to module scope so the signature can name it. The call site is checked against the AUTHORED type, since `component()` inverts the mapping back. Without the call the component accepts none of its own |
| writes | `count = v` keeps the cell's type through the `set` it desugars to |

## The harness — `harness`

A separate package, and split by DEPENDENCY rather than by topic:

| Entry | Holds | Imports |
| --- | --- | --- |
| `harness` | The `Case` / `Suite` shape, `suite()`, the assertions, `runHeadless`, `collector`, `reader`, `container`, `until` / `sleep`, `loopback()` | `abide` |
| `harness/measure` | Timing (`timeArms`, `nsPerOp`, `duration`, `ratioText`, `shareText`, `verdict`, `NOISE`), the waits (`quiesce` / `settled` / `frame` / `tick` / `microtasks`), the DOM work counters, and `keep` | **nothing** |
| `harness/spawn` | The binary as a child process: `abide()`, `spawn`, `started`, the line readers | bun |
| `harness/engine` | What BLINK did: `engine(page)`, `EngineWork`, `shares()` | playwright |
| `harness/server` | What a server render cost: `serverWork()`, `serverWorkOver()` | bun |

`harness/measure` importing nothing is the invariant the split exists for. Every performance claim
here is a RATIO against hand-written code in the same substrate, so the vanilla arm has to be timed by
the same clock, batch sizing and quiesce as the abide arm — and an `abide` import from that layer would
put the framework in the graph of the arm that exists to have none. It is also what makes the layer
importable by a browser page and by the cross-repo comparison harness, both of which time arms that
are not abide's. The two probes it needs (`isThenable`, `messageOf`) are its own six lines for the same
reason. Assertions are on `harness` rather than in `measure`: an assertion is how a case states a
claim, not how a number is taken.

A bench row's diff column carries TWO axes, and which one an arm gets is decided by its label. A
RIVAL is divided against the subject — `ratioText` gives `3.03×`, `verdict` says which side of `NOISE`
it landed on, and the page colours it. A SLICE is a piece of the subject rather than a competitor to
it, named `…of which …`, and it gets `shareText` — `11.7% of abide` — with no verdict and no colour,
because there is no race for it to have lost. Divided as a rival it read `8.53×` in the red the page
uses for a loss, which is abide beaten by one of its own stages. `handWritten` is found by the same
kind of label convention (`vanilla — …`); both are asserted against the app's real labels in
`dogfood/test/site.test.ts`, since a mis-typed `…` marks nothing while every number stays correct.

### Measuring work — three lanes, because three substrates answer different questions

`harness/measure` counts the DOM CALLS a piece of work made, by patching the document from inside. It
is the only lane available in both substrates, which is why the `work` bench kind lives there. It
cannot see what the engine did with those calls: style, layout and paint happen after the script
yields, and no page API reports them.

| Ask | Lane | How |
| --- | --- | --- |
| Did it move rows or rebuild them? | `harness/measure` | `measure(fn)` → `Counts`: 14 DOM call counters. Both substrates |
| What did the engine DO? | `harness/engine` | CDP. Chromium only, driven from the playwright side |
| What did a server render cost? | `harness/server` | `bun:jsc` + a microtask counter |

`harness/engine` has TWO TIERS because they cost differently:

| Tier | Fills in | Cost |
| --- | --- | --- |
| default | `recalcStyle` `layout` `nodes` `layoutObjects` `listeners`, the durations (`scriptMs` `recalcStyleMs` `layoutMs` `taskMs`), `heapBytes` | one `Performance.getMetrics` round trip |
| `{ paint: true }` | `paint`, `forcedLayout` | a TRACE. The only way to count paints — `LayerTree.layerPainted` never fires for ordinary content |
| `{ collect: true }` | turns `nodes` / `heapBytes` from not-yet-swept into RETAINED | a forced collection per reading |

Absent rather than zero: `paint` and `forcedLayout` are `undefined` on the default tier, so "not
measured" and "measured, none" are different answers.

Two facts the API documents rather than hides. `nodes` counts LIVE nodes, so a removal reads 0 until
something collects — `{ collect: true }` is what makes the same removal read −1,164, and the
difference between the two IS the leak. And `taskMs` is the whole window including the driver's own
round trips, so a share from `shares()` is a floor on what a layer cost and never a ceiling.

`shares(work)` divides the durations by `taskMs` into `script` / `recalcStyle` / `layout` / `other`,
summing to 1. This is "NAME THE SHARE BEFORE CHANGING THE LAYER" made one call: an optimisation is
capped by the fraction of the op it touches, and two rewrites of the reactive core landed as no-ops
for want of that number. `page.evaluate` work is NOT attributed to `ScriptDuration` — the same 20M
loop reads 0.005 ms under `evaluate` and 16.9 ms under a real click — so drive the work the way a user
does or the answer is all `other`.

| `harness/server` field | Contaminant | Which is why `serverWorkOver` takes |
| --- | --- | --- |
| `bytes` | none — a property of the markup | the first, and THROWS if two runs disagree |
| `ms` | every interruption makes it longer | the MIN |
| `microtasks` | nothing can inflate it; a timer cannot interleave microtask awaits | the MAX |
| `allocated` | a collection between readings, downwards only | the MAX per type |

A CASE has four faces. The LADDER used to be one, on the suite, and is not: `/docs` is keyed by
callable, so the rungs are read from `fixtures/<suite>/ladder.ts` by whatever needs them. `server` and
`interact` are mirror images — each carries assertions the OTHER substrate cannot make, so which one a
body needs is declared by which face it is written as rather than by a flag on `run`:

| Face | Type Signature | Where it runs |
| --- | --- | --- |
| `run` | `(ctx: Ctx) => void \| Promise<void>` | Headless AND in the browser row. Carries the assertions. |
| `server` | `(ctx: Ctx) => void \| Promise<void>` | Server only — a request scope is an `AsyncLocalStorage`, which a browser has none of. Asserted under `bun test`; the browser row reports `server`. |
| `interact` | `(ctx: Ctx) => void` | Browser only — buttons and inputs. Skipped by the runner. |
| `bench` | `Bench` | Measurement arms. Smoke-run headless to prove they still run. |

| Name | Type Signature | Description |
| --- | --- | --- |
| `suite` | `(spec: { name, title, blurb, cases }) => Suite` | Identity, and the one place a suite naming nothing is caught. `name` is the route segment and test-file name. A suite does NOT carry its ladder: `/docs` is keyed by callable, so the rungs are read from `fixtures/<suite>/ladder.ts` by whatever needs them. |
| `Example` | `{ adds: string; of: readonly string[]; source: string; client?: string; view?: (args) => TemplateResult }` | One RUNG: the one thing it introduces that the rung before it did not, the PUBLIC NAMES it introduces (which is what `/docs/<callable>` is keyed by — almost always one, more only when the names are one idea spelled several ways), the file's own text (through `?source`, so it is what an author wrote in every lane), and what to mount. A rung that CROSSES THE SEAM is two files: `source` is a real endpoint under `src/server/rpc/**` and `client` is the browser half that calls it, which is what `view` was compiled from and what the page shows in a second pane. Every rung on a page renders — `dogfood/test/docs.test.ts` holds the one exception in both directions — and a view whose result comes from the server is driven by a BUTTON, because `demos/proofs.ts` renders each one on both substrates and compares them. Order is the content: each rung is the one before it plus one new thing. |
| `ctx.host` | `HTMLElement` | The live area — a detached element headless, the row's own in the browser. |
| `ctx.is` | `<T>(label: string, actual: T, expected: T) => void` | Structural equality. Records the line either way; throws on a mismatch. |
| `ctx.throws` | `(label: string, fn: () => unknown, match?: string \| RegExp) => void` | Asserts the call throws, matching the message by substring or pattern. |
| `ctx.rejects` | `(label: string, value: PromiseLike<unknown>, match?) => Promise<void>` | The same for a rejection. |
| `ctx.log` | `(label: string, value?: unknown) => void` | A recorded line, stringified the way a console would show it. |
| `ctx.log.live` | `(label: string, value: unknown) => void` | REPLACES the last line with the same label, for a counter that ticks. |
| `runHeadless` | `(case: Case) => Promise<LogLine[]>` | Runs a case the way `bun test` does and returns its lines. |
| `collector` | `() => { sink: Sink; lines: LogLine[] }` | A sink that collects instead of rendering — what the headless runner writes into. |
| `loopback` | `(base?: string) => Loopback` | `dispatch` and the websocket half called IN-PROCESS: a `fetch` and an `open` for `remote`/`remoteSocket`, plus `requests`, `connected` and `close()`. |

A bench becomes ONE ROW on `/bench`: what was measured, what abide cost, what the hand-written arm
cost, and the difference. The hand-written arm is found by its `vanilla — ` label — by convention,
because every bench in the repo already names its arms that way and the alternative is a field ninety
labels would repeat — and is `null` where a bench compares two abide spellings and no comparison was
ever made. Every other arm, the case's prose and the per-item numbers are behind the row: they are the
evidence for the claim rather than the claim, and forty cases at six arms each is a page read by
hunting rather than by scanning.

| Bench kind | The claim |
| --- | --- |
| `time` | How long an operation takes, as a RATIO against a hand-written arm in the same substrate. The first arm is always abide; `floor: 'flush'` puts the effect flush inside the number. A row reports the WHOLE op — the thing somebody waits on, and the only number a frame budget can be read against — with `per` naming what one op is made of (`{ n: 200, label: 'row' }`) and adding the divided-down number beside it |
| `work` | How much DOM work it does. Counted, never timed |
| `wake` | How many times a reader RE-RAN. In a reactive system this is the contract, and values cannot show it |
| `budget` | What the emitted code costs: DOM nodes per list item, microtask turns per row |

JS allocations per template node is deliberately absent — no engine this runs on exposes one.

| Name | Type Signature | Description |
| --- | --- | --- |
| `install` | `() => void` | Patches the DOM so the counters see every mutation. |
| `measure` | `(fn: () => void) => Counts` | The `Counts` a synchronous region caused. `measureFlush` includes the effect flush. |
| `nodesMade` | `(counts: Counts) => number` | Every node the region made — the per-item budget in one number. |
| `total` | `(counts: Counts) => number` | How much the region CHANGED the document, as opposed to what it merely built. |
| `nonZero` | `(counts: Counts) => string` | Only the counters that moved, as `label: n` pairs. |
| `exposeBench` | `(rows: BenchRow[]) => void` | Hangs the rows on `globalThis.abideBench` as `list()` and `run(title, arm, ops)`, for an out-of-process profiler. A GLOBAL because the driver is a `page.evaluate` on the far side of a bundle and can reach nothing else; the same rows the page draws, so a profiler is never measuring a different program. `BenchRow.profile` is what it calls — one arm, alone, untimed, because `run()`'s interleaving is load-bearing and a forced collection between its passes would wreck it. Driven by `bun run profile`. |
| `timeArms` / `duration` / `ratioText` / `verdict` | — | The timing half: run the arms, and say whether a ratio is real or inside the noise (`NOISE`, `NOISY_SPREAD`, `clockResolution`). A `Timing` is quoted at its `p50` — the median of the passes is what an op costs, where the minimum is one lucky window that more passes only push further down — and carries `min`, `max` and `ops` beside it: the ends of the distribution the headline cannot show, and the sample size all three are averages of. `ratioText` is abide ÷ arm as a bare multiple — `4.55×`, `0.22×` where abide is ahead — because a sentence is unreadable in a column of forty; `verdict` is the same division bucketed for colour. A batch is re-sized between passes when a pass lands well off `BATCH_TARGET_MS`, so an arm whose cost changed after it was sized cannot spend nine passes at the old size. |
| `nsPerOp` | `(arms: Arm[], settle?) => Promise<number[]>` | ns per op for each arm, calibrated and interleaved — for a `run` that asserts a ratio without a bench card. A fixed loop cannot: a 1 ms clock clamp reads a fast op as 0. The median of three, so a `run` and the bench row beside it quote the same metric. |
| `quiesce` / `settled` / `frame` / `tick` | `() => Promise<void>` | Waiting primitives, so a bench measures the work rather than the harness. |
| `microtasks` | `(work: () => Promise<unknown>) => Promise<number>` | How many microtask TURNS a piece of work takes — the second of the three numbers emitted code is budgeted in. Subtract `floorTicks()`. |

The small tools a `run` reaches for. `reader` is the first one to know: it is how a case asserts
WAKE-UPS rather than values, which is the one thing a correctness test cannot show about a reactive
system — a reader that woke when nothing it reads changed still reads the right value.

| Name | Type Signature | Description |
| --- | --- | --- |
| `reader` | `<T>(read: () => T) => Reader` | Watches `read` and records every re-run in `seen`, so a case asserts HOW MANY times a reader woke. `dispose()` when done. |
| `until` | `(ready: () => boolean, what?: string, timeoutMs?: number) => Promise<void>` | Wait for a condition rather than a span. Throws naming `what` on timeout, so a hang reads as a claim that failed. |
| `container` | `() => HTMLElement` | A div in the document for a case to mount into, tracked so the runner takes it down. |
| `sweepContainers` | `() => void` | Removes every one of them. Called by `runHeadless`; a browser card calls it between runs. |
| `countCalls` | `<T>(target: T, method: keyof T) => { calls: number; restore(): void }` | Counts calls to one method, so "does less work" is assertable rather than merely timed. |
| `keep` | `(value: unknown) => void` | Consume a bench arm's result. An arm whose answer is provably unused is one the optimiser may delete. |
| `floorTicks` | `() => Promise<number>` | What an empty async function costs in microtask turns, so a `budget` case says what it OWES rather than what it was charged. |
| `show` | `(value: unknown) => string` | How a value is written into a log line, on both lanes — what `is` renders a mismatch with. |
| `sleep` | `(ms: number) => Promise<void>` | A real span, for the cases that genuinely need one. Prefer `until`. |

## Pages / routing

`route()`, `navigate()` and `url()` are on `abide` — where am I, take me there, build me a link, which
is the whole of what an app asks. `routes`, `outlet` and `ready` INSTALL and RENDER the table and are
on **`abide/runtime`**: `abide build` writes the client entry that calls all three, so an app names
none of them. The TYPES stay on `abide`, because `pages()` hands back a `RouteEntry[]`.

| Name | Type Signature | Description |
| --- | --- | --- |
| `routes` | `(table: RouteEntry[]) => void` | Install the app's routes: `{ path, page, layouts? }`, where a page is reached through a LOADER so its code is absent until someone asks. |
| `routes` | `() => RouteEntry[]` | What is installed right now, as it was declared. The table is PROCESS-WIDE — a server installs one at boot and serves every request from it — so a caller that installs one of its own is speaking for the whole process, and this is what lets it hand back what it displaced. |
| `pages` | `(dir: string \| URL) => Promise<RouteEntry[]>` | A pages directory as a route table. The one part of routing that is not isomorphic — a browser has no directory to scan — so the CLIENT half is generated instead: `abide build` writes the same table into `.abide/client.entry.ts` as a static `import()` per row, at build time, where the tree still is. What either hands back is the table `routes()` takes. |
| `route` | `() => Route` | `.url`, `.params`, `.name`, `.kind`, `.navigating` — each its own read, over four small cells rather than one record. |
| `url` | `(path: string, params?, query?) => string` | Build an in-app href. Takes every TARGET `navigate` takes, and agrees with it — see below. A root-absolute pattern is NORMALISED: a trailing slash goes. A missing required segment, or a param the pattern has no segment for, THROWS. Under a mount the result carries the base — see below. |
| `navigate` | `(target: string, options?: { replace?, keepScroll? }) => Promise<void>` | Move to one. In a document a move to another route is a REQUEST for the target url, so the app's middleware runs — see below. A move that stays on the route already showing is painted HERE instead, which is what keeps an open `<details>`, a scroll offset and the focus ring across it. Accepts a target in either space under a mount — see below. |
| `outlet` | `() => TemplateResult` | The current route's page wrapped in its layouts. Reads the route's NAME, and whether a range has been ADOPTED off the wire — two different facts, since a served navigation can land on the route already showing. Nothing else, so a param-only move re-runs it once and no more. A server answering a navigation renders it from a DEPTH — see "answered from the first layout that changed" — which is the same function and not a second one. |
| `ready` | `() => Promise<void>` | Resolve the current route's modules, so the render that follows is a snapshot. What a server render calls before `renderToString` and what a client awaits before `hydrate` — a page adopted before its chunk arrives is a tree the server did not write. `navigate` awaits it for you. |

| Pattern | Meaning |
| --- | --- |
| `<dir>/**/page.abide` | A route, under the directory handed to `pages(dir)` — `abide start` hands it `src/ui/pages/` itself |
| `<dir>/**/layout.abide` | A layout; renders its child page through `<slot/>` |
| `<dir>/**/error.abide` | What answers when nothing under this directory did. NOT a route — nothing may navigate to it — so it is scanned into the same table under `kind: 'error'` with its `path` naming the directory it COVERS, and left out of the matchable one. Rendered through the same shell and the same layouts a page there would get, so a 404 under `/docs` still wears the docs sidebar; the nearest one above the path wins, and an app that writes none keeps abide's JSON refusal. Receives `{ status, name, message }` — the status is the whole of what tells a 404 from a 500. **BEFORE THE FIRST BYTE is what it covers**: nothing matched, a middleware rung threw, a page's module failed to load. Once a document's shell is on the wire no other page can replace it, so a page that throws mid-render is `{#try}`'s to catch, not this. Only `GET`/`HEAD` — an error page is a page, and a page is a read, so a `POST` that matched nothing keeps the JSON |
| `[name]` | Required dynamic segment → `route().params.name` |
| `[[name]]` | Optional segment (absent → param omitted) |
| `[...name]` | Rest / catch-all (terminal) → the `/`-joined remaining segments |
| precedence | literal > required > optional > rest. Sorted once, at install, so a match stops at the first hit |
| `/__abide/**` | Every endpoint abide controls |

`navigating` is set only where there is an in-flight window: a route is committed once its page has
arrived, and a navigation to a route already loaded has none. In a DOCUMENT there is always one — the
request below is the window — so it reports every navigation there.

### `url` and `navigate` take the same target

One set of shapes, one meaning, so `navigate(url(x))` and `navigate(x)` are the same move for every
`x`. `url` builds the href and `navigate` goes there; neither is a special spelling of the other.

| Target | Means | `url()` under a mount at `/v2`, from `/v2/users/42` |
| --- | --- | --- |
| `/users/[id]` | root-absolute PATTERN — the shape an app writes | `/v2/users/42` |
| `bar`, `./bar`, `../bar` | relative to where the caller IS | `/v2/users/bar`, `/v2/users/bar`, `/v2/bar` |
| `?tab=x` | this page, another query | `/v2/users/42?tab=x` |
| `''` | where the caller is | `/v2/users/42` |
| `https://foo.bar/x` | another origin | `https://foo.bar/x` — **no base**, it is not this app |
| `https://this.app/x` | this origin | `https://this.app/v2/x` |
| `//host/x` | protocol-relative — an ORIGIN, not a doubled slash | `//host/x` |
| `mailto:…`, `tel:…` | opaque | unchanged |

Params substitute in every shape (`url('https://api/u/[id]', { id: 7 })`), and the refusals are the
same everywhere — a missing required segment and a param with no segment both throw wherever the
pattern came from. A `query` third argument MERGES with a query the target already carried.

A relative target is resolved against `route().url`, so `url('bar')` is a REACTIVE read: a relative
href in a template moves when the route does. The root-absolute pattern reads nothing and is the fast
path, which is the shape called per row.

### Mounted under a sub-path

`APP_URL`'s PATH is the app's mount base: `APP_URL=https://abide.com/v2` serves the whole app under
`/v2`, and there is no second knob — an operator who said where the app is served has already said
this. Everything moves together: the pages, `/__abide/**`, and the client bundle. Nothing is left
answering at the origin root, so an app behind a proxy does not go on exposing its schema and log feed
beside its mounted copy.

Two spaces, and which one a path is in is decided by which side of the wire it is on.

| Space | What is written in it | Carries the base |
| --- | --- | --- |
| APP | the route table, a pattern, `route().name`, an rpc id, a pages directory | no |
| BROWSER | an `href`, the address bar, a `fetch`, `route().url` | yes |

A page under a mount is not a page that was renamed, so nothing an app calls things BY moves. `url()`
is the only thing that mints a browser-space path, which is what makes a mount a deploy-time value:
an app that builds its hrefs there needs no source change to move. **A hand-written `href="/users/42"`
in a template does not move** — it is a literal, not a call, and abide does not rewrite one.

`navigate()` accepts either space and the crossing is idempotent — `navigate('/users/42')` and
`navigate(url('/users/[id]', { id: 42 }))` land on the same page. The one thing it cannot tell apart
is an app whose own route starts with the base's first segment: mounted at `/v2`, `navigate('/v2/x')`
goes to the app's `/x`. Naming a route after the mount is the fix.

The CLIENT is told the base by the document, in a `<meta name="abide-mount">` the shell writes. It
cannot be in the bundle — a mount is chosen after the build — and it is not derived from where the
bundle was fetched from, which would name the CDN when there is one.

### A navigation is a request

In a document, `navigate` asks the server for any page the client cannot already paint. That is what
puts a client-side navigation through the app's `middleware`, and it is why auth on a PAGE is
middleware: the alternative is a route that is authorized on the first load and reachable without a
rung for every navigation after it.

The exception is the route ALREADY SHOWING, with its module already resolved — a different `[id]`, a
different query. There the client has everything, and asking would buy markup it can draw. See "a
same-route move is painted here" below.

| Rule | Detail |
| --- | --- |
| the address | The TARGET url, marked with `x-abide-navigation`. Not an endpoint under `/__abide/**`, which would run the onion at an address that is not the one being navigated to — every rung deciding by path would answer about the wrong page. Same path, same cookies, same request scope a full page load has, so there is one chain and no authorization written twice |
| what comes back | The outlet alone, in the same hydratable markup the document was served in — no second head, no shell, no `<script>` the browser has already run. Less than the outlet when the caller already has some of it, which is the next section. Marked with `x-abide-navigation` and `Vary`-ing on that AND on `x-abide-navigation-from`, since two request headers now change the body |
| a refusal | A rung short-circuiting with a `Response` — a redirect, a 403 — hands the url to the BROWSER, so the server's own answer is what renders. There is no second refusal protocol, and nothing for an app to spell twice |
| the paint | The part showing the outlet ADOPTS the fragment, so a navigation costs the same near-nothing hydration does. The page's own module is then what makes it interactive rather than what makes it visible |
| the commit | On the MODULE, not on the markup: committing earlier re-runs `outlet()` against a view that has not arrived, which renders nothing over markup that was already right. The address bar moves with the screen, so `route()` catches up within the window `navigating` already reports |
| an overtaken one | Only the NEWEST navigation commits, and only it clears `navigating` — an older one that lands second returns before `commit` rather than writing its params over the newer page. Its response is still read to the end rather than cancelled, so the stream's own bookkeeping is not left half-done |
| what claims the newest | EVERY navigation, served or local. A local move lands in the same tick, which is exactly why it takes a claim: it is the one a reader reaches for while a served answer is still on the wire, and that answer used to commit on top of it seconds later |
| what it is asked at | The MUTATION. A served answer is told whether it is still the live navigation before it stands anything in the range, because the check around the call comes after an await and by then the overtaken page has already been painted over the chosen one. Correct markup for a page the reader left is a failure nothing downstream can see |
| who installs it | `abide/ui`, when `mount`/`hydrate` is handed `outlet` ITSELF. A renderer showing something else is not the part a navigation repaints, and an app that never puts the outlet on screen installs nothing. `dispose()` UNINSTALLS it, so the renderer driving the screen is the one driving navigation |
| where it does not apply | A caller with a SCOPE — a request being served, a test driving a route inside an `isolate`. Neither has a screen to repaint or an onion to pass through. And the route already showing — see below |

### A navigation is answered from the first layout that CHANGED

Two routes under one layout are two pages with the same chrome. The reader has that chrome on screen
already, so the answer leaves it off and the client puts what arrives INSIDE it.

| Rule | Detail |
| --- | --- |
| the ask | `x-abide-navigation-from`, carrying the route NAME the client is leaving. A HINT: the answer is a smaller body, so a client that lies gets markup missing the layouts it claimed to have, and nothing else. Every rung still runs, at the target url |
| claiming nothing | The header is EMPTY while a served range is standing that no commit has claimed. That range replaced the layouts the committed route names, so naming it would leave off chrome the reader is no longer looking at and the descent would hunt for parts disposed when the range was reclaimed. Empty reads as a caller that cannot place a fragment, so the whole outlet comes back — right however deep the two routes happen to agree, at the price of re-sending chrome to a reader who clicked mid-flight |
| the depth | The server compares the two routes' `layouts` by LOADER IDENTITY and takes the common prefix. Two entries naming one layout file share a thunk; two thunks that merely look alike are two layouts. The prefix stops at the first difference and never resumes — a shared layout below a changed one is inside a subtree being replaced anyway |
| the answer | `outletFrom(depth)` — the page wrapped in the layouts from `depth` down — and `x-abide-navigation-depth` saying how many were left off. The server says it rather than the client computing it, so the rule has one implementation |
| where it lands | The `<slot/>` of the innermost layout the reader already has. The client walks down one level per depth, asking each instance for the child part holding what that layout was handed as children — an identity lookup on a `TemplateResult`'s `values`, which is freshly allocated per evaluation and so names exactly one slot |
| a miss | The url goes to the BROWSER. The body has already had those layouts left out of it, so there is no arrangement in which the outlet's own range is the right place for it — standing it there paints a page with its chrome missing, which is worse than the rebuild this avoids |
| what it is worth | On the dogfood app: 717-927 B per navigation, and the `<header>` node, its links and the focus ring all SURVIVE. The bytes are the small half — chrome is 0.5% of a fragment — and the DOM state is the point. Both grow with the layout |

### A navigation may cross-fade

Nothing to call. An app that wrote view-transition CSS gets view transitions; one that did not is
unchanged.

| Rule | Detail |
| --- | --- |
| how it is decided | The document's own stylesheets are asked whether any rule names `::view-transition*` or sets `view-transition-name`. That IS the app saying it — the standard puts the entire control surface in CSS, so a boolean elsewhere would be the same intent spelled twice. Same shape as `installNavigation`, chosen by `view === outlet` rather than by an option |
| what it costs | One walk over the document's rules, PER NAVIGATION and not cached. 50 µs on this repo's own app — 2 sheets, 60 top-level rules, and the worst case, since an app declaring nothing is walked to the end — against a navigation costing 2.3-7.3 ms. A cache keyed on `document.styleSheets.length` saved under 2% of the op and answered stale whenever a sheet was SWAPPED rather than added, which is what a dev CSS reload does. Selectors and declarations are read directly rather than through `cssText`, which serialises every rule |
| what it cannot see | A CROSS-ORIGIN stylesheet, whose `cssRules` throws by design. Transition CSS served from a CDN is invisible here, and such an app has to name its transition from a same-origin sheet as well |
| what is wrapped | The piece that STANDS in the range — the visible change, and only it. Deferred panels patch in afterwards, outside the transition, so a slow panel does not hold the animation open |
| the ordering | The first piece is read to completion BEFORE the transition starts. `startViewTransition` snapshots the old state when it is called and holds rendering until its callback resolves, so a callback that awaited the body would freeze the page for the whole download. The reclaim is inside the callback for the mirror of that reason: a page emptied first snapshots as empty and crossfades from nothing |
| how long it waits | `updateCallbackDone`, not `finished`. The page is on screen when the DOM is written; waiting for the animation to END would hold the address bar and the commit behind it |
| a browser without it | Navigates exactly as it does now, so an app feature-detects nothing |

### A same-route move is painted here

`navigate` takes the LOCAL path — the one a server render and every headless case already run on —
when the target is the route already showing and that route's module has resolved. No request, no
fragment, no refill.

This is a claim about NODES, not about speed. A served navigation refills the outlet's whole range,
and a refill is a rebuild however identical the markup: every open `<details>` shuts, every carousel
returns to offset zero, and focus lands back on `<body>`. Measured on a suite page before this
existed: a query-only move replaced all 28 `<details>` on it, none still open. `outlet()` reads the
route's NAME and not its params, so it does not even re-run — the page's own reads move and its nodes
keep their identity.

| Rule | Detail |
| --- | --- |
| when | The matched route's pattern is the one committed, AND its `view` has resolved. A route whose async loader has not landed cannot be drawn here, so the server answers that one |
| when NOT, however matched | While a served range is standing that no commit has claimed. "The page is on screen so the render patches" is this path's whole premise, and it is false there: the nodes that page rendered into were reclaimed to make room for the range. The params would move, the page's own reads would wake, and they would patch nothing — the address bar on one page and the markup on another, with no throw and no console line |
| what still runs | The page's own reads. A different `[id]` wakes a reader of `params`, and the `rpc` behind it is answered by the server exactly as before — this changes what renders the page, not where its data comes from |
| the TRADE | The app's `middleware` does NOT run for this move. It is not an authorization hole: every `rpc` is still answered server-side, and a client cannot render data it was never given. What is lost is a rung REDIRECTING on the new params — a login redirect reaches the reader as failed calls instead |
| crossing a route | Unchanged. A different pattern is a page the client may not have, so it goes through the onion and comes back as a fragment |
| borrowing the table | `routes()` rebuilds every record, so a caller that borrows the table and gives it back resets every resolved view — and nothing asks again, since `outlet` reads the route's NAME and a restore does not move it. A borrower `ready()`s after restoring; without that, every same-route move on its page goes back to the server |

### A navigation streams out of order

`renderFragment` is `renderDocument` without the shell, and a navigation is answered with it — so a
A pending-armed block DEFERS on this path exactly as it does on a page load, rather than being awaited in
document order. Without it, a fast panel below a slow one waits for the slow one, and so does every
static byte beneath it; measured on `/streaming` at a 600ms/50ms split, that was 654ms for
content ready at 50ms, and 654ms for a paragraph that was never waiting on anything.

| Rule | Detail |
| --- | --- |
| the pieces | HTML cannot be parsed halfway — no browser API feeds a partial tree, `document.write` is deprecated and needs an ACTIVE parser, and re-running `innerHTML` over a growing buffer re-parses what is already on screen. So the unit is a piece that is complete on its own: the in-order pass, then one per deferred subtree |
| the framing | `<!--abide:piece-->` after each. A comment, so it survives concatenation into markup and is inert if one ever reaches a parser |
| no patch script | A document's `<script>$p(N)</script>` cannot cross: the client parses a fragment itself, and script elements inserted that way are non-executable by spec. A bare `<template id="tN">` arrives and the client swaps `<slot-s id="sN">` for it |
| what resolves when | `enter` resolves on the FIRST piece — a page on screen — and carries `complete` for the rest. The address bar moves with the paint; the route commits on `complete` plus the module, because adopting mid-stream hands a part nodes a later patch will replace |
| a truncated stream | Whatever pieces arrived stay on screen and the range is still handed over, so a cut response degrades to a partial page rather than a blank one |

The cost is one round trip per navigation, and it is not free: a warm route with no data to fetch
paid none before. That is the price of the rule above having no exceptions — a route that is exempt
because somebody forgot to mark it is the one that matters.

## Ceilings

One law: a cap on what is REMEMBERED must not become a cost per write. Unset is the default for all
three, and costs one property read at the one moment each could matter.

| Name | Type | Description |
| --- | --- | --- |
| `ABIDE_MAX_GLOBAL_CACHE_SIZE` | `number` | An LRU byte ceiling over the GLOBAL and default-context memo cache, as one number for the whole process. Charged per SETTLE; recency comes off the SELECT. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | A per-stream transcript ceiling, charged O(1) per chunk. Passing it DROPS the transcript for the rest of that stream. |
| `ABIDE_SSR_STREAM_BUDGET` | `number` | The wall budget in ms for one streaming render. Passing it abandons the walk and ends the response as an `AbideTimeoutError`. |

| Rule | Detail |
| --- | --- |
| where they are asked | Once per stream, once per settle, once per render that waits — never latched at import, so an app may declare one from its own entry point |
| what answers | `config()`, over the `useConfigSource` seam, because `$shared` may not import `$server` |
| turning one off | The registry lets go of what it was tracking on the next settle. What was cached while unbounded is untracked, so a ceiling set afterwards evicts only what is admitted under it |
| a charged byte | A slot's charge runs once behind a load, so it may walk the value. A chunk's is O(1): a string costs its length, a binary chunk its `byteLength`, anything else a flat overhead |
| the cache ceiling's reach | The global and default-context maps only. A per-caller cache is already bounded by the request that owns it |
| an eviction | The CACHE forgetting: whoever holds the handle keeps a working cell, and the tag leaves the registry with the slot |
| a dropped transcript | The version moves once so a reader wakes for the drop and then sleeps; the cell goes on holding every chunk and the stream still finishes. Said once on `abide:stream` |
| the render budget | WALL time over the whole render, not per slot. One clock per RENDER, armed on the first phase that actually waits, raced by both the in-order walk and the out-of-order drain |

## Environment variables

`config()` is this table as CODE: every row below typed under the SAME NAME, with a floor under it
and the app's own `onConfig` defaults beneath that. An app's own fields join on the same terms.

| Name | Type | Description |
| --- | --- | --- |
| `PORT` | `number` | Listen port (default `3000`). `--port` on a command overrides it by DECLARING it, so `config().PORT` is the port. Resolved as an integer `0`–`65535` whether a variable or an `onConfig` default named it — anything else is the floor, so no reader checks the range again. `0` is the kernel's "whatever is free" and is the one number here that may be zero. |
| `APP_URL` | `string \| null` | The app's public URL. Its ORIGIN is what both gates compare against (WS CSWSH, CSRF) — undeclared, they fall back to the REQUEST's own, which is the weaker answer, since a caller controls its own `Host`, and the wrong one behind TLS termination, where that origin is the proxy's. Its PATH is the app's mount base: `https://abide.com/v2` serves every page, endpoint and asset under `/v2`. See "Mounted under a sub-path". |
| `NODE_ENV` | `string \| null` | Verbatim. `isProduction()` is the conclusion drawn from it, and is not a field. |
| `ABIDE_APP_NAME` | `string \| null` | The app's name, and therefore `log`'s default channel. Falls back to the nearest package.json `name`, then `abide`. |
| `ABIDE_DATA_DIR` | `string \| null` | Overrides the per-user directory. `APP_DATA_DIR` is this resolved against the platform's convention when it is unset. |
| `APP_NAME` | `string` | **A conclusion, not a variable.** `ABIDE_APP_NAME`, else the nearest package.json's `name`, else `abide`. |
| `APP_VERSION` | `string` | The `version` beside that `name`, or empty. Empty rather than absent, so no consumer branches on the field existing. |
| `APP_DATA_DIR` | `string` | `ABIDE_DATA_DIR`, else the platform's per-user data directory under `APP_NAME`. A path — nothing is created. |
| `ABIDE_IDENTITY_SECRET` | `string \| null` | Seals the `abide-identity` cookie. Required in production for `identity.set()`; a dev process mints a random key and says so on `abide:identity`. |
| `ABIDE_IDENTITY_TTL` | `number` | Identity cookie life in ms (default 30d), rolling — re-sealed on the first resolve past half of it. |
| `ABIDE_APP_TOKEN` | `string \| null` | Bearer the remote CLI sends, for whatever an operator put in FRONT of the app. |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. Asked before `APP_URL`, and its PATH is carried: `abide logs` resolves `/__abide/logs` UNDER whatever the target named rather than at its origin. Nothing it addresses is traced — a CLI is not inside a request, so `traceHeaders()` is `null` there and the commands build their own headers. |
| `ABIDE_RPC_TIMEOUT` | `number` | Default ms a call may go without progress (default `300000`); a declaration's `timeout` is the real knob. Per chunk on a handler that yields. |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | Default ceiling on a mutation's body in bytes (`Infinity` unset). An over-size declared `content-length` is 413 before buffering. |
| `ABIDE_MAX_GLOBAL_CACHE_SIZE` | `number` | Byte ceiling over the global + default-context memo cache. See Ceilings. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | Per-stream transcript cap in bytes. See Ceilings. |
| `ABIDE_SSR_STREAM_BUDGET` | `number` | Total wall budget in ms for one SSR stream. See Ceilings. |
| `ABIDE_LOGS` | `boolean` | Opts IN to `GET /__abide/logs`. Default closed → 404. |
| `ABIDE_LOG_BUFFER` | `number` | Ring size in records for that feed (default `500`). |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | Machine log format. `null` means the shape follows the TTY. |
| `DEBUG` | `string \| null` | Log-channel gating in debug-npm grammar. A browser's `localStorage.debug` answers under this, never over it. |
| `NO_COLOR` | `string \| null` | Set to anything: no ANSI anywhere, and `tsv` log output. Beats `FORCE_COLOR`. |
| `FORCE_COLOR` | `string \| null` | Set to anything: color/pretty output even with no TTY. |

## The lifecycle

Three of the four hooks are ONIONS rather than before/after pairs: the interesting hook is the one
that runs on both sides of the thing it wraps.

| Name | Type Signature | Description |
| --- | --- | --- |
| `boot` | `<T>(bind: () => T \| Promise<T>) => Promise<T \| null>` | Resolve `config()`, run `onStart` around `bind`, and hand back what `bind` made. The socket binds INSIDE the hook. `null` means the hook returned without calling `start()`. |
| `shutdown` | `() => Promise<void>` | Run `onStop` around the socket closing. Idempotent while in flight, so two signals are one teardown both callers await. |
| `handle` | `(route: Route) => (request: Request, server: Server) => Promise<Response>` | The app's onion around everything it answers — `/__abide/**` first, then the app's own route. Opens the request scope, runs the chain, carries a throw to a status. A route answering `undefined` is a 404. |
| `middleware` | `(...rungs: Middleware[]) => () => void` | Register rungs, outermost first. APPENDS where the other three replace. Returns the way off, removing exactly what that call added. |
| `onStart` | `(hook: StartHook) => () => void` | `(start) => …` — WRAPS the real boot. Awaited; a second registration replaces the first. |
| `onStop` | `(hook: StopHook) => () => void` | `(stop) => …` — mirrors `onStart` for teardown. Backstopped, so teardown still happens if the hook skips it. |
| `onError` | `(hook: ErrorHook) => () => void` | `(error) => unknown` — sees only what ESCAPED. Returning a `Response` is the answer sent; anything else falls through to the ordinary 500. |

| Rule | Detail |
| --- | --- |
| config first | Resolved before the hook that might ask for it, so an `onConfig` that throws is a boot that rejects rather than a 500 later |
| signals | `boot` installs SIGINT, SIGTERM, `uncaughtException` and `unhandledRejection`, and only when `bind` produced something closeable |
| the onion's reach | EVERYTHING `handle` answers, `/__abide/**` included — so an auth rung covers the rpcs, the sockets, the schema, the OpenAPI document and the MCP surface, not only the pages. It was around the app's routes alone, and that was a hole rather than a saving: nothing about writing the rung said the endpoints were exempt. A rung that never calls `next()` refuses them all |
| what stays in front | FILES — the client bundle and `ui/public`, mounted by the command rather than by `handle`. A page waiting on an auth rung for its own JavaScript is a page that cannot log in, and a favicon has no caller to be about |
| a websocket upgrade | Goes through the chain too, so a rung can REFUSE one. A successful upgrade has no response — Bun answers the handshake — so it travels the onion as a sentinel `101` and becomes `undefined` again at the top. A rung that passes `next()`'s answer through is unaffected; one that builds a NEW response around it breaks the upgrade |
| the sharper tool | `GET(fn, { middleware })` and `socket({ middleware })` are unchanged and still see the args and the room, which an onion over the raw request never could. The onion is the coarse one |
| the cost of no exceptions | An auth rung that refuses anonymous callers now also refuses `GET /__abide/health`, so a load balancer's check fails until the rung skips it. That is the app's call to make explicitly rather than abide's to make silently |
| an `HttpError` | A deliberate outcome, so it answers with what it says and never reaches `onError`. Either way the failure is written to `abide:lifecycle` |
| `onStart` vs `onStop` | A hook that skips `start()` has SAID something and is believed. A hook that skips `stop()` has said nothing, so the close happens anyway — including when it throws mid-drain |

### What an app IS

`src/`, split three ways by SUBSTRATE, plus what neither side serves. Every directory below is a
convention — abide reads it, nothing declares it — and there is no wiring. Nothing in them imports a
server, calls `Bun.serve`, mounts `dispatch`, opens a request scope, installs a signal handler,
matches a route or builds a document: every one of those is the same code in every app, so the
booting binary is where it lives, once, for both `abide start` and `abide dev`.

```
src/server/   app.ts, rpc/**, sockets/**, and the app's own server code
src/ui/       app.html, app.css, pages/**, public/**, and the app's own components
src/shared/   what both sides run
src/tests/    what neither serves
```

The same four are the app's SEAMS — `#server`, `#ui`, `#shared`, `#tests` — declared once in its own
`package.json` and resolved by Bun, `tsc` and `Bun.build` alike:

```json
"imports": {
    "#server/*": ["./src/server/*", "./.abide/types/src/server/*"],
    "#ui/*":     ["./src/ui/*",     "./.abide/types/src/ui/*"],
    "#shared/*": ["./src/shared/*", "./.abide/types/src/shared/*"],
    "#tests/*":  ["./src/tests/*",  "./.abide/types/src/tests/*"]
}
```

Subpath imports rather than tsconfig `paths`, and the difference is not cosmetic: `paths` is
PROGRAM-global, so `#server` could only ever mean one package's server — and an app whose program
compiles abide's own source (a workspace link resolves to `.ts`) would have to declare the
framework's aliases to type-check its own pages. `imports` is scoped to the package the importing
FILE is in, so the same four names mean the framework's seams inside the framework and this app's
seams inside this app. The second entry in each pair is the `.abide` mirror: a declaration for
`#ui/lib/Answer.abide` is generated under `.abide/types/`, and `rootDirs` only redirects RELATIVE
resolution. It costs nothing at run time — the real file is found first.

The rest of an app's config is one line, because everything a `.abide` program needs the checker to
know is shipped: `{ "extends": "abide/tsconfig.json", "include": ["**/*.ts", ".abide/types/**/*.ts"] }`.

| Convention | What it is |
| --- | --- |
| `src/server/app.ts` | What this app IS: the registrations below, and a route only if it wants one. `app.tsx` / `app.js` alike. Every one of them is optional, so the FILE is — an app of pages and endpoints needs none. What makes a directory an app is having something to serve: no pages, no handlers and no module is the one shape refused |
| `src/ui/app.html` | The document its pages are served in. `<slot></slot>` is where the page renders, and the file names nothing of abide's: the client script and the css the client graph imported are both APPENDED to the head from the build, so a document carries no address a build decides. Absent → abide's own minimal shell |
| `src/ui/pages/` | What it serves. The directory IS the route table, installed for you — `pages(dir)` + `routes(...)`, and `route()` already answers off the request |
| `src/ui/public/` | What it hands over UNCHANGED. The tree is the address space: `public/favicon.ico` answers at `/favicon.ico`. Read once at boot into a map, so a request is a key lookup and no caller's string is ever joined onto a path. Served in front of the request pipeline, like the bundle and for the same reason — a favicon has no caller to be about — but SECOND, so it cannot shadow anything under the reserved prefix. Cached for an hour rather than forever: the name does not change when the bytes do |
| `src/server/rpc/**` · `src/server/sockets/**` | What it answers. Imported by the boot before a line of `app.ts` runs, so nothing imports a handler for its side effect |
| `.abide/client.entry.ts` | The lane the browser gets, and what `abide build` is pointed at. **Generated from `src/ui/pages/`, always** — the same route table, written as a static `import()` per row so every page is still its own chunk, plus `ready()`, `hydrate()` and link interception. There is no app-written client entry: client-side code of your own goes in `src/ui/pages/layout.abide`, which is above every route and already isomorphic. An app that still has a `client.ts` is told it is built by nothing |

### What a booting binary reads

ONE export, and it is the route: `export default`. IMPORTING THE MODULE IS WHAT REGISTERS everything
else — the hooks below are calls the module makes at its own scope, so each is checked against its own
type by the app's typecheck rather than by a shape check at boot, and a hook that throws on the way in
is the same refusal as a module that would not load. Every one of them is optional, and every one
hands back the way off. Nothing here waits for a build either: a hand-written entry point that makes
the same calls means exactly what `app.ts` making them does.

| Registration | Signature | Purpose |
| --- | --- | --- |
| `export default` | `(request, server) => Response \| undefined \| Promise<…>`, or `{ fetch }` | A route of the app's own, asked FIRST. `undefined` hands the path to the pages, and then to `handle`'s 404. Absent is the ordinary case: pages need no route written for them. An EXPORT because a route is the one of these with no call to make |
| `middleware(...rungs)` | `(next: () => Promise<Response>) => Response \| Promise<Response>` | The per-REQUEST auth/observability rung. Short-circuited by a throw or a `Response`. Auth is middleware. The one that APPENDS: two calls are two rungs in call order, and its disposer takes off only its own |
| `onStart(hook)` | `(start: () => Promise<void>) => void \| Promise<void>` | WRAPS the real boot: do setup, then `await start()`. Awaited |
| `onStop(hook)` | `(stop: () => Promise<void>) => void \| Promise<void>` | Mirrors it for teardown: drain, then `await stop()`. Runs on SIGINT/SIGTERM/crash. Awaited |
| `onError(hook)` | `(error: unknown) => unknown` | Request-scoped; runs when a request throws an UNEXPECTED error |
| `onConfig(hook, { schema })` | `(env: Env) => unknown` | The app's config DEFAULTS, merged UNDER the environment. Called once, synchronous, and the only one that fails hard. The schema is the second ARGUMENT, which is what a call has and an export did not |
| `onHealth(hook)` | `() => unknown \| Promise<unknown>` | Fields merged OVER `{ reachable, version, startedAt, uptime }`, on every server-side `health()` |
| `onIdentity(hook)` | `(claims: unknown) => unknown \| Promise<unknown>` | Turns what a caller presented into a principal, merged OVER `{ authenticated, expiresAt }`. Receives `null` for no valid seal. Fails CLOSED |

The six singular ones REPLACE — one process has one boot, one teardown, one account of a failure, one
config, one account of health and one answer to who a caller is, so a second registration is a
correction. `middleware` is the plural one, which is why it keeps a name from outside the family: an
`onRequest` would read as one answer at one instant, and a rung is neither.

## Response helpers

What an app's OWN route answers with. Each returns a plain `Response` and takes a `ResponseInit` the
caller's headers ride in.

| Name | Type Signature | Description |
| --- | --- | --- |
| `page` | `(body: string \| ReadableStream<Uint8Array>, init?: ResponseInit) => Response` | A rendered document as `text/html`. Takes what a render PRODUCED rather than doing the render. |
| `json` | `(data: unknown, init?: ResponseInit) => Response` | Serialize and tag `application/json`. `undefined` sends `null`, not the text `undefined`. |
| `jsonl` | `<T>(values: Values<T>, init?: ResponseInit) => Framed<T>` | One JSON value per line from a sync or async iterable; `application/jsonl`. Written per `pull`, so back-pressure reaches the source. The SOURCE is claimed once, by whichever lane asks first: an rpc takes the values and the body is then empty, a route reads the body and the values are its own. |
| `sse` | `<T>(values: Values<T>, init?: ResponseInit) => Framed<T>` | The same machine framed as `data: <json>\n\n`; `text/event-stream`, `no-cache`, `X-Accel-Buffering: no`. |
| `redirect` | `(to: string, status?: RedirectStatus, init?: ResponseInit) => Response` | NAVIGATE. The status is restricted to `301`/`302`/`303`/`307`/`308` (default `302`), and there is an `init`, which is where a login's cookie goes. |
| `error` | `(status: number, message?: string, options?: FailureOptions) => never` | THROWS an `HttpError` (`status`, `name`, `data`). A handler writes `return error(404)` beside its other returns; `never` disappears from the union, so the returned form costs the type nothing and the throw stays abide's business. Declared `never` so a bare call also stands as a guard. The message defaults to the registry's phrase, so `error(404)` is a whole refusal. `options.data` rides along undeclared — an `error.typed` schema is what gives one a type on the other side. |
| `error.typed` | `(kind: string, status?: number, message?: string, options?: { schema }) => Failure` | A reusable factory for a named, narrowable failure, its message optional the same way. The status defaults to 500 — a fault is ours until an app says whose it is — and the phrase is resolved at the DECLARATION. With a `schema` the factory takes the data first, checked synchronously, and returns `Failed<Name, Data>` instead of `never` so a `return` can carry the declaration into the handler's type. |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; data: Data }` | A declared failure as it is CAUGHT, the same four members in-process and over a wire. Structural, because what a caller catches is an `HttpError` on either side rather than a class it imported. |
| a failure's `kind` | `string` | Carried as the error's `name` — what crosses the wire and what `isError(e, name)` matches. |
| `return myError(data)` | `Failed<Name, Data>` | One spelling for every refusal: a handler RETURNS them, and the throw is inside. What differs is what the return type is left holding — a bare `error` is `never` and vanishes, a declared one is `Failed<Name, Data>` and lands in `Rpc`'s third parameter, which is what a caller narrows against. A `throw` is erased from the type, so it refuses identically and only loses the caller's ability to name it. A failure with no schema stays `never`, so a bare `notFound()` is still a guard — TypeScript only reads the line after it as unreachable when the declaration carries an explicit `Failure<'NotFound'>` annotation, which is its rule for every never-returning call and not abide's. |

Every response built through one of these carries `traceresponse`, the rpc wire and `dispatch`'s
refusals included; outside a request the header is absent and a caller that set its own is not
overruled. A source that throws mid-`jsonl`/`sse` ERRORS the body — the status line is already out.

Both are read back by a caller's own stub with nothing written to decode them: `isChunked` asks the
RESPONSE what it is, so `application/jsonl` and `text/event-stream` are consumed as chunks exactly as
the rpc wire's own `application/x-ndjson` is, and one line reader walks all three — an event stream is
line-delimited too, and what differs is only that `data: ` comes off the front and the other fields
(`event:`, `id:`, a keep-alive comment) carry no value. So `for await (const row of catalogue({}))` is
the whole of the client, and the framing is a question about who ELSE has to read the address.

`Framed<T>` is what carries `T` across that: a `Response` says nothing about its own body, so the
element type lives in a phantom member. It is REQUIRED, which is what keeps a plain `new Response(…)`
out of it — a handler answering with an ordinary response still declares `Response`. The compiler
marks such an endpoint `stream: true` from the same syntax it reads everything else off: a handler
that CALLS `jsonl(` or `sse(` frames a sequence, exactly as one that yields does.
The rpc lane's `application/x-ndjson` stream is the same machine with one extra frame, so it says the
failure in a line.

## abide cli

| Command | Purpose |
| --- | --- |
| `abide scaffold <name>` | Write a starter project, then `git init` + `bun install` + `abide dev` — each skippable (`--no-git` / `--no-install` / `--no-dev`). |
| `abide repl` | A prompt with the isomorphic surface in scope and the `.abide` loader registered. A bare expression prints its value, and a source prints what it HOLDS — read through `peek`. Piped input is the same evaluation without the terminal. |
| `abide run <file> [args…]` | Run a script under the abide runtime. Everything after `<file>` belongs to the SCRIPT, so it is SPAWNED: it reads its own `argv` and keeps its own exit code. |
| `abide check [dir…]` | Type-check `.abide` script bodies, reporting every diagnostic on the `.abide` line. The list is stdout; the exit code says it failed. |
| `abide dev [--port <n>]` | Watch the project and keep the app up: the client bundled into MEMORY, the server restarted on every change, and full live-reload over the socket mux. `--port` (default `3000`) HOPS to the next open port if taken, then PINS what it bound so no restart moves the app. `PORT` and `APP_URL` are written back from the socket and `config()` invalidated, so what the document reports is where it is actually listening and `abide logs` resolves an app a hop moved. |
| `abide build [entry…]` | Code-split client → content-hashed chunks + `manifest.json` under `.abide/client/`, minified and precompressed. With no entry named it builds the lane generated from `src/ui/pages/`. |
| `abide start [--port <n>]` | Boot the app's `src/server/app.ts` if it wrote one, and serve its `src/ui/pages/` in its `src/ui/app.html`, with the bundle in front and `/__abide/**` behind that. `--port` binds DIRECTLY and fails hard on `EADDRINUSE`, so `APP_URL` cannot drift. |
| `abide logs` | Tail `GET /__abide/logs`: the ring replayed, then every line as written. Printed by the rules THIS process's stdout answers to, with `+Nms` rebuilt from the record times. |
| `abide console [<action\|endpoint> [--arg=…]]` | The APP's own console, not this binary's. One word is one command and an exit code; no words is a PROMPT. The app's endpoints are the surface, read from `GET /__abide/schema`; `connect` / `disconnect` / `serve` / `health` / `identity` / `logs` / `help` / `exit` are the console's own. `help` is where the endpoints are listed, because a second command printing the same list is the copy that goes stale. A flag IS a query parameter, so the endpoint's declared shape decides what one means; a socket is tailed with `--tail=<n>` / `--wait=<ms>`, which stand for `__abide_tail` / `__abide_wait` EXCEPT where the room declares a member by that name, in which case the name is the app's. |
| `abide compile [--out <path>] [--target <t>]` | ONE standalone executable, via `bun build --compile`: the runtime, the framework, the app, its pages, its bundle and its public files, with that console as its front door. Builds the client first, every time. `--target` cross-compiles, and naming it more than once makes `--out` a DIRECTORY. |
| `abide bundle` | A desktop launcher for the host platform: embedded assets and a first-run setup screen. Native windowing is best-effort — a system webview binary, or the default browser. |
| `abide lsp` | The `.abide` language server, over stdio: diagnostics, completion and hover. Takes no arguments — which files to look at is the editor's to say, on the wire. |
| `abide` · `-h` · `--help` | Usage, GENERATED from `COMMANDS`. Asking for help is a success (stdout, `0`); an unknown subcommand is not (stderr, `2`). `abide <command> --help` is the same success, answering with that command's own row — read from the FIRST argument only, so `abide run <file> --help` still belongs to the script. |

Arguments are the command's own, and the rules are one set rather than one per command. A flag no row declares is REFUSED (stderr, `2`) rather than dropped — a `--minify` that was quietly ignored is a build that did not do what was asked and said nothing — and the usage line printed with a refusal is the `args` from the same table the help screen reads, so the two cannot disagree about how a command is spelled.

| Name | Type Signature | Description |
| --- | --- | --- |
| `cli` | `(argv: string[]) => Promise<number>` | The binary's own module face. The `abide` bin IS this file. |
| `COMMANDS` | `Command[]` | `{ name, args, blurb, load }` — the table both the dispatch and the usage screen read, so there is no second list. Each body is loaded only when its name arrives. |
| `commandNamed` | `(name: string) => Command \| undefined` | The row, or nothing — which is what makes an unknown subcommand exit `2`. |
| `usage` | `() => string` | The screen, aligned from the same rows. |
| `exitForStatus` | `(status: number) => CliExitCode` | An HTTP answer as the code the shell sees. A 2xx and a 3xx are both `ok`. |

Exit codes (`CLI_EXIT_CODES`, the one table both the dispatch and `exitForStatus` read): `0` ok · `1`
failed/unreachable · `2` usage · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx · `8` other 4xx.

`abide start` and `abide dev` assemble the same four layers from the same code, and differ in three
decisions: where the bundle came from, what a taken port means, and whether Bun's `development` is on.
`abide dev` is ONE process: the main thread watches and owns the lifecycle, and a WORKER holds the
app. Replacing that worker is the reload. What has to be thrown away is a module graph, not an
operating system process — a graph is cached by resolved path and cannot be evicted, so re-importing
`app.ts` behind a cache-busting query would reload that one file while every module it imports stayed
as it was, leaving the app half of two versions with nothing saying so. An isolate is the smallest
thing that contains a whole graph, so terminating one is the reload. There is no dependency graph
deciding that a css edit "only" needs the client rebuilt.

Everything a child process would have cost is therefore absent rather than handled: no stdout to
relay and no colour lost to relaying it, no IPC to carry the port back, no exit code to forward, no
signal to pass down, and no way to leave a server running that outlived its supervisor — killing the
pid takes the socket with it, because it is the same pid. The one thing a worker does not get is
SIGNALS: `boot` installs its handlers in there and they never fire, so the main thread asks the worker
to `stop` and the app's `onStop` runs because of that message.

The dev bundle is `Bun.build` into memory: unminified, and entry-named by its SOURCE (`client.js`, not
`client-<hash>.js`) so a breakpoint and a stack frame survive a rebuild — which is what `no-store` on
every dev asset pays for. Nothing is written to `.abide/client`, so `abide dev` cannot leave a
half-built directory for `abide start` to serve. A client build that FAILS is not a process that
refuses: the pages still render, and the reload client is served by the dev worker itself — from
`/__abide/reload.js`, never out of the bundle — precisely so the page can reconnect once the build is
fixed. A file rather than an inline `<script>` because a document is served under the app's own
policy: `csp()` allows no unstamped inline script, and a shell head cut once at boot has no
per-request nonce to carry, where a script on this origin is already `'self'`. Reload is that socket
and no message on it — a "reload now" frame could only be written by a process that is about to stop
being the one serving the page. So the connection is the TRIGGER and not the answer: reopening it
makes the page re-fetch `/__abide/reload.js?boot` and compare the boot id it gets back against the
one the document was served with. A laptop that slept, a proxy that timed out and a browser
reclaiming an idle socket all reopen against a server that never moved, and a page whose boot id is
unchanged is left alone. The tag is `async`, not `defer`: a document severed mid-body never finishes
parsing, and a `defer` script in one never runs at all. The watcher ignores dotted directories — which is what tells `.abide/`
apart from `counter.abide`, and covers the bundle and the generated type tree alike — plus
`node_modules/`, and the worker force-closes its socket before draining, since a socket
never ends and `shutdown()`'s graceful close would otherwise wait out every open tab on every restart.

`abide logs` asks `ABIDE_APP_URL`, then `APP_URL`, then `config().PORT` on localhost, and sends `ABIDE_APP_TOKEN`
as a bearer for whatever is in front of the app; the feed's own gate is `ABIDE_LOGS`, and a closed one
answers 404 → exit `5`. Nothing answering at all has no status to map → exit `1`.

`abide console` is the same app from the other side, and it is the APP's console rather than this
binary's — `index.ts`'s `cli(argv)` answers `dev` / `build` / `compile`, and this answers whatever the
app declares. A session is at one ADDRESS and there are two of
them: the app this process carries, bound on a socket, or one somebody else is running (`connect`).
An endpoint is callable in-process and this deliberately does not — the wire is where the
middleware onion runs, where the request scope with its cookies and identity is installed, and where a
method, a body ceiling and the declared argument shape are enforced, so a console that skipped it
would answer a different question from the one being asked. Without a target a call binds an
EPHEMERAL port for the life of the process, which is what makes `./app getUser --id=1` work with
nothing running; `serve` is the same bind on a port somebody named, and `disconnect` lets go of
whichever of the two it was holding. The last state is remembered in `<appDataDir>/console.json`, so a
bare `./app` resumes — attaching to a remembered `serve` if that app is still up rather than trying to
bind the port it is holding.

Arguments are flags and NOTHING here decides what one means: `--id=1` is the query parameter
`?id=1`, so a read hands its flags over as typed and the far side decodes them against the shape the
endpoint declared. A repeated `--tag=a --tag=b` is a list because a repeated query parameter already
is one, and `--name=42` on a declared `name: string` stays a string for the same reason. A mutation is
the one door where this side has to decide, because JSON has types and a query does not — `decodeQuery`
runs here too, against the same schema off the same catalogue. A POSITIONAL is refused: an endpoint
takes one args object, so a bare word has no name to travel under. A bare last segment resolves when
exactly one endpoint ends with it (`getUser` for `users/getUser`) and is refused with the candidates
when several do. A socket is TAILED, spelled by its room, and bounded by this console's own
`--tail`/`--wait` — a stream that never ends is not a command. Answers print as `Bun.inspect` at a
terminal and as ONE LINE of JSON through a pipe, which is what makes `./app getUser --id=1 | jq` work
and a streamed answer a jsonl file.

`abide compile` is that console with the app inside it. Every question a boot asks a DIRECTORY is
asked once at compile time instead — the transport modules by the same scan `handlers` uses, the pages
by the same walk, `app.html` as text, and every built asset and public file `with { type: 'file' }` —
and the answers are written into `.abide/binary.entry.ts` as static imports (`internal/binary.ts`,
`entry.ts`'s twin for a substrate that cannot read a tree). Past `assemble` nothing can tell the two
apart: an `AppImage` carries the same shapes the scans produce, so a binary serves its pages through
the code `abide start` serves them with rather than through a second renderer that agrees with it
today. The client build runs first and is not a flag — a binary whose bundle came from whatever was on
the disk would ship one version of the pages and another of the lane they hydrate with.

The REPL is a `node:vm` script rather than an `eval`: a global lexical binding made by `eval` does not
survive the call in JavaScriptCore, and `runInThisContext` hands back the completion value.
`Bun.Transpiler` decides both whether a line is runnable TypeScript and whether it has FINISHED, with
dead-code elimination off. A top-level `await` is the FALLBACK — the line fails to compile, nothing
has run, and the retry goes through an async wrapper. Ghost text is a dim completion of the word
being typed, taken with Tab or a right arrow at the end of the line, and off wherever color is; the
line editor takes its terminal as HOOKS, so a test drives it with a string of keystrokes.

`abide lsp` answers at TWO SPEEDS, and the split is the whole design. The syntax speed is `compile()`
— pure, no filesystem, sub-millisecond — and it publishes a parse failure as a range over the marker
that failed, completes `{#`/`{:`/`{/` and `bind:`, and hovers any of them. It works on a file that
does not parse, which is not a bonus but the case: an editor asks what may follow `{:` at exactly the
moment there is an unclosed block, so the block a marker sits in is read out of the TEXT rather than
off a parse tree. The type speed is the real checker: the buffer is emitted into the same
`.abide/types` mirror `abide check` writes, and a `tsgo` program is held OPEN across the session — a
project costs ~240 ms once and every ask after it ~3 ms, against seconds for a fresh `tsc`. Both
publish separately, syntax first, and a type answer that arrives after the buffer moved on is
dropped. A server whose checker will not start (no `node`) keeps every syntax answer and simply
never contradicts the author about a type.

The BUFFER and not the file: an editor's text is one save ahead of the disk, and a checker reading
the disk reports the previous version's errors with total confidence. The mirror is generated and
gitignored, so writing unsaved text into it costs nothing `abide check` was not already rewriting.
What it does not read is anybody ELSE's unsaved buffer — a `.ts` file is read from disk, because
`.ts` is the TypeScript extension's business and the seam is the file extension an editor already
draws. The completion and hover answers are derived from `BRANCHES` and `BINDABLE` rather than from
prose beside them, so an editor cannot offer a block the compiler does not have or miss one it does.
Sync is FULL — the whole buffer per edit — and a type error's COLUMN carries the same drift
`abide check` has: exact at the start of an expression, and within one off by however much the
desugar inserted before that point. stdin and stdout ARE the protocol, so nothing this process has to
say goes anywhere but stderr. An editor is pointed at it by running `abide lsp` for `.abide` files;
there is no configuration, because there is nothing to configure.

## The client bundle

| Name | Type Signature | Description |
| --- | --- | --- |
| `CLIENT_DIR` | `'.abide/client'` | Where `abide build` writes. CLEANED rather than merged, since a content hash means a build never overwrites the last one's files. |
| `MANIFEST_FILE` | `'.abide/client/manifest.json'` | The one file in there without a hash, because it is what tells you the others'. |
| `CLIENT_ROUTE` | `'/__abide/client/'` | Where `abide start` serves that directory FROM — under the reserved prefix, so an operator proxies or caches the bundle with the one pattern they already have. What a page's `<script src>` is built from. |
| `ClientManifest` | `{ entries: Record<string, string>; assets: Record<string, ClientAsset>; graph?: ClientGraph }` | Entry source path → the file it produced, and every file written keyed by its path relative to `CLIENT_DIR`. `graph` is what a per-route preload is built from; absent means nothing is preloaded. |
| `ClientGraph` | `{ modules: Record<string, string>; imports: Record<string, string[]> }` | Source path → the output file holding it, and output name → the names it imports, so a preload reaches a whole subtree rather than a face of it. Neither half is derivable from the filenames. |
| `ClientAsset` | `{ kind: 'entry' \| 'chunk' \| 'asset'; size: number; type: string; encodings: Sidecar[] }` | The identity form's size and content type, plus what was written beside it. |
| `Sidecar` | `{ encoding: 'br' \| 'gzip'; file: string; size: number }` | A precompressed form written BESIDE the identity bytes, never instead. Listed SMALLEST first, so "best available" costs no comparison at request time. |
| entry | — | The files named on the command line, or — with none named — the lane generated from `src/ui/pages/` at `.abide/client.entry.ts`. Every entry is keyed in the manifest by where it sits, the generated lane included: `abide start` looks that key up to append the `<script>`, so no document names one. |
| naming | `[name]-[hash].[ext]` | The hash is in the name rather than a query, so a chunk is immutable at its address and the directory is cacheable forever. |

| Rule | Detail |
| --- | --- |
| the lane | `target: 'browser'`, which is what `abide/compiler/plugin` reads to elide a `src/server/rpc/**` module to its address. A page importing `getUser` gets `remote("users/getUser")` and none of the driver |
| plugins | The app's own, read from `[serve.static] plugins` in its `bunfig.toml` — Bun's existing spelling for "what bundles this app's client", so a Tailwind stylesheet is compiled by the app's dependency rather than by one abide would have to acquire. Resolved from the app root; a plugin that is named and cannot be loaded FAILS the build, because a stylesheet that quietly did not compile is a build that succeeds and ships an unstyled page |
| splitting | Every `import()` the bundler can SEE is a chunk, which is what makes a route reached through a loader absent from the first load |
| the graph | `manifest.graph` — which chunk holds a source module, and what each chunk statically imports. Read off Bun's `metafile`, where a code-split chunk's `entryPoint` names the file it was split out of, so nothing here reproduces `[name]-[hash]` |
| preloading | A route's page and layout chunks are `modulepreload`ed in its OWN head, computed per route at boot. Otherwise the browser cannot discover a chunk until the entry has downloaded, parsed and RUN to the `import()` — two serial round trips before the page is interactive. Static edges only: following `dynamic-import` would pull the whole route table into the first load, which is the splitting above undone |
| a sidecar | Written only when SMALLER than the bytes it stands in for, at maximum compression. `zstd` is absent: no browser sends `Accept-Encoding: zstd` unasked |
| a stylesheet | `import './app.css'` from a `.abide` `<script module>` or a `.ts` — an ordinary import in both lanes, a no-op on the server and an asset here. It is linked into the shell from what was BUILT, so a document names no stylesheet and a renamed one cannot go stale |
| the environment | NOT inlined. A browser asks `GET /__abide/identity` for what it may know, and there is no `GET /__abide/config` |
| what is served | The manifest is the ALLOWLIST: a name is served because the build recorded it, so there is no path to normalise and `..` is simply a name nothing has. A name it does not carry is 404, and a method that is not `GET`/`HEAD` is 405 |
| how it is served | `immutable` for a year, the identity form's content type on every encoding, and the first `Sidecar` the caller accepts — `br;q=0` is a refusal, and `*` is not read as an invitation. `Vary: accept-encoding` on every form, the plain one included |
| where it sits | In FRONT of the request pipeline: outside the app's middleware, so a page never waits on an auth rung for its own JavaScript, and outside the request scope, because a file has no caller to be about. It is also in front of the `text/html` compressor below, because these bytes were compressed once at build time and a second pass would spend cpu per request to make them bigger |

Everything the pipeline answers with `text/html` — a document, a navigation's fragment, an app's own
route — is gzipped on the way out when the caller accepts it, with `Vary: accept-encoding` either
way. It is `gzip` alone, sync-flushed at every write: the out-of-order protocol exists so a browser's
parser gets the head before the last panel settles, and a compressor that buffered to the end would
undo it. Brotli is the asset route's, where a sidecar is compressed once rather than per response.

A big `application/json` answer is gzipped too, WHOLE, since the size is the decision and a buffered
answer has no parser waiting on its first byte. The list is an ALLOW-LIST of MEDIA TYPES, matched
exactly rather than by prefix: every framing — `application/x-ndjson`, `application/jsonl`,
`text/event-stream` — is read as it arrives, so buffering one to measure it undoes what it is for.
`application/jsonl` starts with `application/json`, and a prefix test admitted it.

### Headers abide generates

`headersFor` is the one funnel — every shape above passes through it, so a response abide builds
carries these without its author asking. A caller's own header WINS over any default; the two
unconditional ones are the two no caller wants otherwise.

| Header | On | Why |
| --- | --- | --- |
| `x-content-type-options: nosniff` | everything, unconditional | Every abide response declares its own type, so a browser guessing a different one is only ever the vulnerability — a JSON refusal sniffed as HTML is script on this origin. Spelled a second time on the asset route, which is served in FRONT of the pipeline and never reaches the funnel |
| `traceresponse` | everything, unconditional | The response you most want to correlate is a failure, so the 404 carries it too |
| `cache-control: private, no-store` | a page, a navigation fragment, an rpc answer, any refusal | A page renders per request and `identity()` is a first-class thing to render off; a handler answers as whoever called it. Absent is NOT neutral — it licenses a shared cache to invent a freshness lifetime for an answer that names who asked. It does not fight `abide-ttl`, which is the caller's own memo lifetime rather than an HTTP directive |
| `cache-control: no-store` | `/__abide/health`, `/__abide/identity` | Both describe this process or this caller at this moment. A cached health check is a load balancer being told a drained instance is healthy |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk is addressed by its own content hash, so it cannot go stale |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default written down, for the older agent that still defaults to `no-referrer-when-downgrade` and leaks an authenticated path to every cross-origin image |
| `content-security-policy: object-src 'none'; base-uri 'self'` | a page | The half of a policy that can blank nothing, because neither directive names a SOURCE. It ships whether or not an app installs `csp()`, whose baseline is a superset of it |
| `vary` | wherever an answer depends on a request header | `accept-encoding` on anything compressed or compressible, `x-abide-navigation` where one url has two bodies, `origin` on a cross-origin rpc |

No `strict-transport-security` or `x-frame-options` by default: each is a policy only the app can
state, and each has a real way to break one that abide cannot see. An app writes them in middleware.
`content-security-policy` is the exception, because half of it is abide's — see below.

### A content security policy

Every page abide builds already carries one, with nothing installed and nothing asked for:

```
content-security-policy: object-src 'none'; base-uri 'self'
```

Those two and no more, because neither names a SOURCE and so neither can blank an app abide cannot
see: `object-src 'none'` refuses plugin content, which no abide app has, and `base-uri 'self'` refuses
a `<base>` that would silently repoint every relative URL on the page — a rewrite of the app rather
than a part of it. It is a DEFAULT and not a rule, so a route that states its own keeps it, exactly as
`cache-control` does one table up. Everything else waits to be opted into:

```ts
export const middleware = [csp()]
export const middleware = [csp({ 'connect-src': ["'self'", 'https://api.stripe.com'] })]
export const middleware = [csp({ 'style-src-attr': [] })]
```

| | |
| --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | One rung. Sets `content-security-policy` on `text/html` answers only — a policy on a JSON refusal is a header nothing reads. |

OPT-IN, because every directive can break an app that had a reason abide cannot see. What it does that
an app cannot do for itself: `nonce()` is stamped onto abide's OWN inline output — `patchScript`, the
`$p(<id>)` call per deferred subtree, and every scoped `<style>` — inside the render walk, where no
middleware can reach. A hash cannot stand in: `$p(<id>)` differs per subtree, so a hash policy could
not be written until the render finished, and running WHILE the document streams is that script's job.

`sources` REPLACES a directive rather than adding to it, so what you pass is what it says; an empty
array drops it; a name the baseline lacks is added. The nonce is appended to `script-src` and
`style-src` after your sources either way — a policy without it does not run abide's own patch script,
and a page that defers a subtree would never swap a panel in. An app wanting something else entirely sets the
header itself, which wins as any caller's own header does.

The baseline: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`,
`font-src 'self'`, `connect-src 'self'`, `style-src-attr 'unsafe-inline'`, `object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` — a superset of the two above, so
installing this takes nothing away. The other two it calls free are NOT in the always-on half, and
this repo's own app is the counterexample for one: a `visit` case frames a real route of its own app,
so `frame-ancestors 'none'` would break abide's own dogfood, which is why it passes `'self'`.
`form-action 'self'` is the same shape one step out — an app posting to a payment processor is
ordinary, and abide cannot see that either.

`script-src` carries no `'unsafe-inline'` — it does not need one, and a browser honouring a nonce
ignores `'unsafe-inline'` anyway, which is the mechanism that makes an injected `<script>` fail while
abide's own runs. `style-src-attr` is the one weakened line and is weakened deliberately: a `style=`
attribute cannot carry a nonce, and a `style=` is where a value COMPUTED AT RUNTIME belongs. An app
with none passes `'style-src-attr': []`.

A document under a policy always carries one empty `<style nonce data-abide="">` in its head. That is
what the client's `adopt` takes a nonce from, via the `nonce` IDL property — a browser enforcing a
policy hides the ATTRIBUTE from script. Without the carrier, a route whose scoped component arrives
through `import()` after hydration had nowhere to read one, and its rules were refused.

An app that drops to `new Response(...)` gets exactly what it wrote — these are what abide's own
helpers put on, not a rule imposed on what a route returns.
