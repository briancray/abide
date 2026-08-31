# Reactive primitives

## `state` — the owned value

| Name | Type Signature | Description |
| --- | --- | --- |
| `Reactive` | `Reactive<Stored = undefined, Failures = never>` | A reactive value, and the ONLY face any of the four hands back. `Failures` is the union of `Failed<Name, Data>` its producer declared, inferred rather than written: an rpc handler's return type, a memo body's, a refusing `transform`. A union of VALUES rather than of names, so the data type rides along and `isError` narrows to it with no registry to consult. It defaults to `never`, so `state<number>(0)` is one parameter as it reads and `s.isError` is correctly unusable where nothing declared a failure. |
| `Input` | `unknown` | What `set` accepts, BEFORE `Transformer` runs. |
| `Stored` | `unknown` | What is held and what a read returns, AFTER `Transformer` runs. Identical to `Input` where there is no transform, so `state<number>(0)` is still one type. |
| `Transformer` | `<Input, Stored, Failures = never>(value: Awaited<Input>) => Stored \| Failures` | Normalises the value untracked before storing, and MAY REFUSE IT by returning a `Failed`. Runs on the SETTLED value, never on the promise and never per chunk — the same rule `identity` follows. A refusal fills the `Reactive`'s `Failures`, so the write is rejected at the boundary rather than stored and checked later. |
| `state` | `<Input, Stored = Awaited<Input>, Failures = never>(initial: Input, options?: StateOptions<Awaited<Input>, Stored, Failures>) => Reactive<Stored, Failures>` | `Reactive` factory. `Stored` is `Awaited<Input>` because a state holding something UNSETTLED serves the value, never the promise — `state(fetchUser())` is a `Reactive<User>`, not a `Reactive<Promise<User>>`. |
| `Shared` | `interface Shared {}` | The app's own DECLARATION-MERGED registry of shared keys. Empty here and widened by the app, which is what types `state.share`'s key and what stops two modules disagreeing about `Stored` under one name. |
| `state.share` | `<Key extends keyof Shared>(key: Key, create: () => Reactive<Shared[Key]>) => Reactive<Shared[Key]>` | GET-OR-CREATE a reactive value in the current scope by `key`: the one already shared, or `build()` shared under it. ONE call rather than a share/read pair, so there is no ordering hazard and no miss to define. `Shared` is an app's own declaration-merged registry, which is what types the key and what stops two modules disagreeing about `Stored` under one name. |

### `StateOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `transform` | `Transformer<Input, Stored, Failures>` | Normalise on the way in, or REFUSE — returning a `Failed` rejects the write and fills `Failures`, which is what a `bind:` field validates through. An OPTION rather than a positional parameter, because `ttl` and `tail` are the common case and a positional `transform` made every one of them write `undefined` first. |
| `tail` | `number` | How many past productions are RETAINED for a later reader to replay. Default 1 — latest only, which is a snapshot and nothing more. A memory ceiling on the `Reactive` and nothing else, and the DEFAULT a bare `s.tail()` replays. THE UNIT IS WHAT THE PRODUCER YIELDED, which is one rule reading three ways: a `set` yields a value, a `publish` yields a message, a stream body yields a chunk. So `room.tail(100)` is a hundred messages and `stream.tail(100)` is a hundred chunks, while a `tail` on a `Reactive<Row[]>` is a hundred ARRAYS — because pushing into an array is not a production, it is a mutation of one value. Where a tail over items is what is wanted, the item is what gets produced. |
| `ttl` | `number` | ms a HELD value stays servable. Default: infinity. Past it, a `Reactive` with a producer recomputes on the next read; one without drops the entry. That is the whole difference between a state's `ttl` and a memo's — one definition, two reactive values. |

### Expectations

* `Stored` can be anything in javascript
* THE PROBES ARE `Reactive`'s, NOT `memo`'s. A state handed something unsettled already reports `pending()`, `refreshing()` and `error()`, already opens a sink, and already has `tail` and `await`. Nothing has to be memoized to have a face — what a `memo` adds on top is IDENTITY PER ARGS, which is what coalescing, `ttl` and `invalidate` are all built on.
* Readers are only notified when read identity changes
* A read of a SETTLED value returns it. A read of one still in flight returns `undefined` and opens a SINK — it never awaits — `{await s}` and `{#await s then v}` block, `{#await s}{:then v}` renders its pending branch instead. `pending()` is what tells `undefined`-because-in-flight from a value that resolved to `undefined`.
* A read of a FAILED value THROWS, which is how a failure reaches the nearest `{#try}` or `error.abide` and what `s.peek` means by throwing what a read throws. `error()` and the other probes never throw, so `s.success() ? s() : fallback` is how a caller declines to escalate.
* Retention is APPEND-ONLY: a ring of `tail` entries, a version bump for readers, and the snapshot materialised on the read that follows. Raising `tail` must not make a write dearer.
* `ttl` EXPIRY WAKES NOBODY. Entries past it are dropped on the read that follows — no timer per entry, no version bump — because a timer that moved the version would put the cost of retention back on the write, which is the one thing the ring exists to avoid. A live cursor delivers ARRIVALS, so it never sees an expiry and is right not to; `tail` is a bound on what a LATER subscriber can replay, and a later subscriber is the only reader an expiry is visible to.
* A ROOM IS NOT A STREAM, and the difference is what the PRODUCER declared rather than anything a
runtime sniffs. A `channel` declares `Message`, so every publish is a whole one. A `memo` or rpc body
that is an async generator declares chunks of one `Value`, so no chunk is a whole anything.

| | the producer yields | `pending()` until | a bare read `s()` | `tail(n)` |
| --- | --- | --- | --- | --- |
| room — `channel` / `socket` | a complete `Message` | the FIRST message | the latest message | the last n messages |
| stream — async-generator `memo` / rpc | a CHUNK of one `Value` | it CLOSES | the accumulated chunks | the last n chunks |

* So `{room}` is the latest message and `{await room}` blocks until the first one, both meaningful;
`done()` stays false while a room is live, so `{:finally}` does not mount on one, a room not being a
thing that finishes. What holds forever is an async generator that never returns, and that is the
author's to resolve rather than abide's to special-case.
* A STREAMING PRODUCER'S `Stored` IS THE ACCUMULATED CHUNKS, materialised ONCE on close. That is the
whole reason `pending()` runs to the close rather than to the first chunk: with no complete value to
serve before then, there is nothing to rebuild per chunk, so the accumulation is O(n) and not the
`concat`-per-chunk O(n²) the retention rules exist to refuse. Chunks land in the ring, the version
moves for cursor readers, and the snapshot is built on the read that follows the close.
* `transform` IS THE JOIN, which is what keeps one `Reactive` serving both shapes:

```ts
const answer = memo(() => complete({ prompt }), { transform: (chunks) => chunks.join('') })
// {#for await token of answer}   → tokens as they arrive
// {await answer}                 → the whole string, once the stream closes
```

* `state.share` IS SCOPED THE WAY A MEMO'S DEFAULT SCOPE IS — REQUEST-local on a server, process-local in a browser, where there is one caller and no request. Same callable, same name, same intent: on both sides the scope is ONE CALLER, and what differs is only what a caller IS there. So caller-specific is exactly what belongs in one, which is the opposite of a `global` memo's warning, and it is bounded by its scope rather than by a policy — dropped with the request that built it.
* On a server that makes it what a page render uses to share a `Reactive` between two components without threading a prop through every level between them.
* A shared state is NEVER EVICTED WITHIN ITS SCOPE — it goes when the scope does and not before. A `global` memo entry may be dropped early because it can be rebuilt, which is a cache miss; a shared state cannot be, and dropping one would orphan live readers that go on reading a value nobody can refresh. It needs no runtime bound: `Key extends keyof Shared` makes the key set the declaration-merged registry itself, so the count is fixed by the SOURCE and there is nothing to refuse. That is also why a dynamic key cannot typecheck — a per-room `Reactive` is what a `channel`'s args are for.

### Reads

| Name | Type Signature | Description |
| --- | --- | --- |
| `s` | `() => Stored` | Read current value. |
| `s.set` | `(value: Input) => void \| Failures` | Set current value. Takes what the transform takes and hands back only its REFUSAL — an `Input` that is unsettled has no `Stored` to return yet, and `s()` is the read. Where no transform refuses, `Failures` is `never` and this is `void`. The refusal reaches the writer the way `publish`'s does, and fills the `Reactive` for readers either way. |
| `s.peek` | `() => Stored` | Read WITHOUT joining the flow. Otherwise identical to `s()` — it starts work and throws what a read throws. `watch(sources, …)` is the whitelist for the same problem; this is the blacklist, and it is what a `memo` has instead, having no `sources` form. "Held, but do not load" is `s.success() ? s.peek() : fallback`, since a probe never starts work. |
| `Tail<Stored>` | `Iterable<Stored> & AsyncIterable<Stored>` | What `s.tail` hands back: the snapshot pulled synchronously, the live cursor pulled asynchronously, and nothing allocated until one of the two is. |
| `s.tail` | `(n?: number) => Tail<Stored>` | ALWAYS CALLED. A cursor over what was produced — values, messages or chunks, per `tail`'s unit rule — `Iterable` and `AsyncIterable`: `[...s.tail()]` is the snapshot, `for await (… of s.tail())` replays that snapshot and then goes live from the point it ended, so a reader sees no gap and no duplicate. `n` IS REPLAY DEPTH AND NOTHING ELSE — `min(n, retained)`, defaulting to `retained` — so it says how far back a reader STARTS and says nothing about what a block goes on to accumulate. `tail(0)` replays nothing and goes live. NOT an array: patching `Symbol.asyncIterator` onto one is a shape mutation per call, and a cursor allocates nothing until the sync iterator is pulled. |
| `for await (… of s)` | `AsyncIterable<Stored>` | The live cursor face of a read. |
| `await s` | `Promise<Stored>` | The settled value. |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Stored>` | Subscribes and receives new values. Defined as `tail()` — the live cursor is not a second mechanism, and the bare form cannot mean something a spelled-out `tail()` does not. `tail(0)` is how a reader asks for live-only. |

### Probes

Probes never throw and never start work. Reading one subscribes to THAT probe: a value change does not wake a `refreshing()` reader, and a `refreshing()` flip does not wake a value reader. The signal is per-probe and built on first read, so probes nobody asks for cost no allocation — the contract is the wake-up, not the representation, and it is asserted by counting effect re-runs rather than by reading values.

| Name | Type Signature | Description |
| --- | --- | --- |
| `s.pending` | `() => boolean` | A first load is in flight and there is nothing to show. A STREAM REPORTS THIS UNTIL IT CLOSES, not until its first chunk: chunks are parts of one value, so there is nothing complete to show until the last one. A ROOM reports it only until its FIRST MESSAGE, a message being whole on arrival — see "A ROOM IS NOT A STREAM". That is what leaves no state in which none of `{#await}`'s branches is mounted, and what keeps the accumulation O(n) — the whole is materialised once, on close, rather than concatenated per chunk. `streaming()` is what a progress indicator inside the pending body reads. |
| `s.refreshing` | `() => boolean` | A reload is in flight over a value still being served. |
| `s.done` | `() => boolean` | It has finished, however it finished — and STAYS true through a `refresh()`, the load that finished having still finished. That is what keeps `{:finally}` mounted where `refreshing()` is what moves. |
| `s.success` | `() => boolean` | It landed, it did not fail, and nothing is still arriving. STAYS TRUE THROUGH A `refresh()`, as `done()` does and for the same reason — the load that landed still landed, and a reload over a value being served is what `refreshing()` is for. "Still arriving" is about a stream that has not finished, never about a refresh. |
| `s.streaming` | `() => boolean` | It is currently producing chunks. |
| `s.error` | `() => unknown` | The failure it ended with, if it failed. |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. A PREDICATE: matching narrows `error.data` to what that failure declared, because `Failures` carries the `Failed<Name, Data>` rather than the name alone. |

### Effects

| Name | Type Signature | Description |
| --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | Runs effects on value change; returns the way to stop it. See `watch` documentation below. |

## `memo` — the loaded value

| Name | Type Signature | Description |
| --- | --- | --- |
| `Memo` | `<Stored, Args, Failures>(args?: Args) => Reactive<Stored, Failures>` | A derived value, and WRITABLE. `Failures` is inferred from the body AND from a refusing `transform`, the same way an rpc's is from its handler — a body may `return myError(data)` and a reader narrows it with `isError`. UNKEYED — no `Args` — it is TRACKED: it recomputes whenever anything it read changes. KEYED — `Args` declared — it is UNTRACKED: one entry per args key, and its only ways back are `ttl`, an explicit `invalidate` / `refresh`, and eviction. |
| `Args` | `Record<string, JsonValue> \| undefined` | The key. Serializable by contract, because the key IS the wire form. |
| `memo` | `<Computed, Stored = AdoptedValue<Computed>, Args = undefined, Failures = never>(body: (args?: Args) => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures>) => Memo<Stored, Args, AdoptedFailures<Computed> | Failures>` | Memo factory. `Stored` defaults to the ADOPTED value rather than to `Computed`, so a body returning a `Reactive` types as its payload; the transform takes the same, running after adoption. See "Adoption". |

### Triggers

| Name | Type Signature | Description |
| --- | --- | --- |
| `m.invalidate` | `(pattern?: Partial<Args>) => void` | DEFINED AS `invalidate(m)` narrowed by args — see "Selections" — not a second mechanism. Marks it stale: the next read is FETCHED FRESH rather than served from what is held. It does not itself hold rendering — whether a template waits is the template's own choice of form (`{await m}` and `{#await m then v}` wait, `{#await m}{:then}` does not). |
| `m.refresh` | `(pattern?: Partial<Args>) => void` | DEFINED AS `refresh(m)` narrowed by args, the same way. Stale while revalidate: what is held keeps being served, and `m.refreshing()` is true, until the new value lands. |

### Writes

* A memo is WRITABLE, and a write stands until the next recompute clobbers it. On an unkeyed memo that means it survives until something the body read moves — which is what makes `memo(() => structuredClone(upstream))` a local draft re-seeded from its source, one primitive rather than a second one beside it.
* There is NO WARNING on the write. `memo(() => structuredClone(upstream))` and `memo(() => a + b)` are indistinguishable to a compiler, neither having an lvalue, so a warning would fire hardest on the good pattern. Unlike an unbound prop there is no caller to name and no second fix to offer.
* `set` is on the INVOKED result, never the factory, so a keyed memo is unambiguous: `m(args).set(v)` is one entry. An unkeyed memo is its own args-less invocation, so `m.set(v)` is the same rule.
* A write is not a load: it leaves `success()` true and `refreshing()` false, and moves no probe.

### Adoption

* A `Reactive` returned from a memo body is ADOPTED, not stored: `memo(() => getData(args))` forwards reads, probes and triggers to what the body returned, and re-adopts when the body recomputes. Without it the outer memo is a `Reactive<Reactive<Value>>` and `data.name` reaches the wrapper rather than the payload.
* The unwrap is IN THE TYPE, not only in the prose. Three names, each one thing, rather than one
conditional threading an accumulator:

```ts
type AdoptedValue<T>    = T extends Reactive<infer Inner, any>     ? AdoptedValue<Inner>        : T
type AdoptedFailures<T> = T extends Reactive<infer Inner, infer F> ? F | AdoptedFailures<Inner> : never
type Adopted<T>         = Reactive<AdoptedValue<T>, AdoptedFailures<T>>
```

  `Failures` accumulates down the same recursion the value unwraps on, so `memo(() => getData(args))` is `Reactive<Value, Failures>` and `data.isError(error, 'DataAccessDenied')` narrows through the wrapper. Recursive, which is what makes a memo of a memo of a state collapse in one loop on both sides at once — the runtime loop and the conditional bottom out on the same condition.
* THE `transform` OPTION IS WHAT ADOPTION LEAVES ROOM FOR, and is why `Computed` and `Stored` are two
parameters rather than one. It runs AFTER adoption, on the settled payload, which an inline expression
cannot do — reading the `Reactive` to transform it is exactly what loses the adoption:

```ts
memo(() => new Set(getUsers(args).map(u => u.id)))             // reads the `Reactive` → adoption LOST
memo(() => getUsers(args), { transform: (u) => new Set(u.map(…)) })  // adopts, then transforms it
```

* The outer memo is what makes the call REACTIVE TO ITS ARGS — a `<script>` setup body is untracked, so the rpc call alone would register nothing — which is why the wrapper is load-bearing rather than ceremony.
* Adoption is also the identity cutoff: a recompute landing on the SAME inner `Reactive`, the same args key hitting the same entry, wakes nobody. This is the one place the freshly-built-wrapper failure would otherwise bite, and it is asserted by counting wake-ups rather than by reading values.
* On a swap the outer read reports `pending()` only when the newly adopted `Reactive` has NOTHING TO SERVE. An args key that hits a live entry adopts synchronously and no reader sees pending — not for a microtask — so re-filtering to a key already held, and back/forward, never flash.

### Keys

* An `Args` object becomes a key by its CANONICAL WIRE FORM — the same serialization the transport uses, keys sorted, `undefined` members dropped, `Date` written ISO. One canonicalization rather than two: args that cannot be keyed are exactly args that cannot be sent, so both fail in the same place — which is TRUE rather than nearly true because `GET`/`DELETE` args are narrowed to what a URL can carry (see "rpc").
* A key is therefore STRUCTURAL, which is what lets `memo(() => ({ id }))` build a fresh object every run and still land on the same entry.
* `Args` is always plain `Args`. A reactive value in an argument position READS; recomputation is the enclosing unkeyed memo's job, which is what `memo(() => getData(dataArgs))` is doing.

### Scope

* A memo without `global` is REQUEST-local on a server, and process-local in a browser, where there is one caller and no request. It is built and dropped with its scope, so `ttl: Infinity` means to the end of THAT SCOPE rather than forever, it cannot grow without bound, and one caller's answer can never be served to another.
* `global: true` opts into a process-wide cache that outlives every request. `principal` does not bound it, so anything caller-specific belongs in its `Args`.
* A `global` memo IS BOUNDED BY ITS OWN `ttl` AND THE APP'S `invalidate`, and by nothing abide supplies. There is no byte ceiling and no eviction policy: measuring an arbitrary `Stored` costs the O(size) walk `identity` already refuses to pay by default, and an LRU count would evict an entry a reader is mid-flight on. So `global: true` with `ttl: Infinity` is an unbounded cache, and it is unbounded because the app asked for it — the bound is a number the app knows and abide does not.
* Coalescing is WITHIN a scope: two calls inside one request share one load; two concurrent requests are two scopes and load twice. `global: true` is therefore the only thing that makes two callers one load, which is what it is for where the load is expensive — an inference, a warehouse scan.
* A `global` MEMO OVER A STREAM FANS ONE PRODUCER OUT, and the one thing it needs is `tail: Infinity` — retention is ASKED FOR, the default being 1 like every other `Reactive` rather than a hidden branch on whether the body produced a stream. With it the entry holds the whole transcript and a reader arriving mid-stream is a bare `tail()` — replay what landed, then live from where the replay ended, no gap and no duplicate. That is the cursor's existing contract, so N readers at N positions is one producer and one `tail`. WITHOUT it a late reader replays one chunk and goes live — a truncated answer rather than an error, which is the cost named under `MemoOptions`. A reader leaving is `signal`'s existing rule: it detaches that reader and the producer runs on for the others, which is what stops one closed tab cancelling everyone's inference.

### `MemoOptions`

`MemoOptions<Input, Stored, Failures> extends StateOptions<Input, Stored, Failures>`, so `transform`,
`tail` and `ttl` are
the state's own and mean there what they
mean everywhere. `ttl` past its window recomputes rather than drops, a memo being the `Reactive` that
has a producer. `tail` defaults to 1 like every other `Reactive`: a `global` memo fanning one stream
out to late readers spells `tail: Infinity`, rather than getting it from a hidden branch on whether
the body produced a stream. THE SEED BUFFER IS NOT THE MEMO'S `tail` — hydration is answered from the
buffered transcript whatever the memo retained, so the default costs the ordinary render/hydrate path
nothing. What it costs is a LATE subscriber on a default memo, which replays one chunk and goes live —
a truncated answer, and the same failure a chat room's default retention of 1 has.

| Name | Type Signature | Description |
| --- | --- | --- |
| `global` | `boolean` | Opts out of the default scope into one `memo` shared by every caller in the process. |
| `tags` | `string[] \| ((args: Args) => string[])` | What a `Selection` matches on, which is the only thing that reaches ACROSS memos — `invalidate({ tags: ['invoice'] })` marks every entry carrying one, wherever it was declared. The function form receives the memo's `args`, so a tag can name the row rather than the query. |
| `throttle` | `number` | Revalidation of a `memo` fires immediately, then at most once per window — HOWEVER TRIGGERED, an unkeyed memo's dependency-driven recompute as well as an explicit `invalidate` / `refresh`. Inside the window the held value is served and `refreshing()` is true, which is the `refresh()` contract already and no new probe behaviour. |
| `debounce` | `number` | Revalidation of a `memo` waits until the triggers stop, however triggered. Set with `throttle`, this wins. |
| `identity` | `(value: Stored) => unknown` | WHAT MAKES IT THE SAME VALUE, named after the invariant it controls — readers wake when this moves, not when the reference does. Default `(value) => value`, which is the reference. `canonical` is exported for the common opt-in — an args object, a derived record, a URL — and is the same builder a memo key uses. It is NOT the default for objects: canonicalising is O(size) per recompute, so a five-thousand-row result would be serialised on every run to decide whether to wake anyone, which is a cost per write buying a cheaper read. Runs on the SETTLED value, never per chunk. |

## `channel` — the subscribed value

| Name | Type Signature | Description |
| --- | --- | --- |
| `Channel` | `<Message, Args, Failures>(args?: Args) => Room<Message, Failures>` | A room keyed by `args`, that anyone may publish to and anyone may read. |
| `Room` | `Reactive<Message, Failures> & { publish: (message: Message) => number \| Failed<Name, Data> }` | WHAT A ROOM IS: a `Reactive` whose value is the latest message, plus `publish`, the one member a room has that a plain value does not. So a bare read is the latest, `room.tail(n)` is the cursor, the probes answer, and there is no second `Reactive` type to learn — `{room}` and `{#for await m of room.tail(100)}` are the same two spellings every other `Reactive` has. `publish` hands back the `seq` it minted, or the `Failed` `transform` refused it with — the same two on both sides, `transform` running wherever the publish came from. |
| `Args` | `Record<string, JsonValue> \| undefined` | The room. Keyed by the same canonical wire form a memo's args are. |
| `Message` | `unknown` | Message type |
| `channel` | `<Message, Args, Failures>(options?: ChannelOptions<Message, Failures>) => Channel<Message, Args, Failures>` | Channel factory. `Failures` is inferred from what `transform` may return, the same way every other `Reactive`'s is. |

### `ChannelOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `tail` | `number` | How many past messages the room retains. Default 1 — latest only. 0 is passthrough and drop. It is how far back a RECONNECT can resume — a cursor older than the tail is answered with the whole tail, never with a gap — and what a bare `room.tail()` replays. |
| `ttl` | `number` | ms a message is kept in tail. Default: infinity |
| `clientPublish` | `boolean` | Whether a caller OUTSIDE the process may publish at all. Default false. It lives on the CHANNEL rather than the socket because a room is reachable two ways — a socket and a `POST` — and a gate declared per transport is a gate with a way around it. |
| `transform` | `Transformer<Message, Message, Failures>` | The same option `state` and `memo` take, on the third `Reactive`: normalise on the way in, or refuse. WHAT A VALID MESSAGE IS: it may rewrite the message or REFUSE it by returning a `Failed`. Runs on EVERY publish, the server's own included, because normalising is not a question about who is asking — the two were one option and the trim silently skipped itself in-process. A refusal is what fills `Reactive`'s `Failures`, so a publisher narrows it with `isError`; a SUBSCRIBER's failures are abide's own and reach `{#for await}`'s `{:catch}` instead. `publish` therefore returns `number \| Failed<…>` on both sides. |

### Expectations

* A ROOM IS CREATED BY A PUBLISH, NEVER BY A SUBSCRIBE. Subscribing to a room nothing has published to
is legal, allocates no entry, and reads as `pending()` — so the room count is bounded by publish
AUTHORITY, which `clientPublish` already gates, rather than by how many argument keys a caller can
think of. That is the whole bound, and it is why there is no room-count ceiling to configure: a
`clientPublish: false` channel can only be grown by the app's own code.
* A ROOM IS DISCARDED WHEN ITS SUBSCRIBER COUNT REACHES 0 AND STAYS THERE FOR `ttl`. The same `ttl`
that bounds a message's life in the tail bounds the room's own idle life, there being nothing left to
keep once the last subscriber has gone and the last message has expired. A resubscribe inside the
window finds the room and its tail intact, which is what makes a page navigation away and back free.
* Rooms are PROCESS-WIDE, unlike a `memo`'s default scope: a room every caller can reach is what a
room IS, and `Args` is how one caller's room is told from another's.

## `watch` — the effect

| Name | Type Signature | Description |
| --- | --- | --- |
| `Disposer` | `() => void` | Tears down the previous run: before each rerun, and once at teardown. |
| `Effect` | `() => void \| Disposer` | Runs immediately and whenever reactive values that are read change. NOT `Handler`: a handler is a `Reactive` with an address on it (see `# Transports`), and `watch` is already called THE EFFECT here and in `### Effects`. |
| `watch` | `(effect: Effect) => () => void` | Begins the watch; returns the way to stop it. |
| `watch` | `<Stored>(sources: Reactive<Stored> \| Reactive<Stored>[], effect: Effect) => () => void` | The NARROWED form — it runs only when `sources` change. Two overloads, not a union: the first argument discriminates them. |

### Expectations

* reruns `Disposer` each time the `Effect` runs again
* runs `Disposer` once more at TEARDOWN — component unmount for a `<script>` watch, item removal for a branch-local one in a `{#for}` body, process end for `<script module>`
* a watch registered inside a component is owned by it; one registered from a plain `.ts` module has no owner, which is what the returned disposer is for
* when `sources` are the first argument, it only runs when those sources change
* ON A SERVER A WATCH RUNS ONCE. There is no rerender, so a tracked read registers no subscriber and
there is nothing to wake it a second time; the `Disposer` still runs at scope teardown. That is
isomorphism of INTENT rather than of schedule — same callable, same name, and what differs is that one
side has a flow to feed and the other does not — and it is stated here rather than inferred from
"Tracking", because an effect written for its side effects reads as though it will run again.
* AN ERROR IN AN EFFECT IS NEVER SILENT. A `Disposer` that throws, an effect that throws, and a read of
a FAILED `Reactive` inside one — which throws, as every read of a failure does — all reach `onError`,
with the trace attached, and warn on `abide:watch`. In a browser it is additionally re-thrown as an
unhandled rejection so an error reporter sees it.
* AN EFFECT THAT THREW STOPS ITS WATCH. An effect that throws once usually throws every run, and a
watch that re-runs into the same throw is a loop with a log line per iteration; the warning names the
watch and the app re-establishes it if the failure was transient.

## Selections — over many entries

A probe answers about ONE `Reactive`; a selection answers about a set of them. The gap is that a
`Memo` FACTORY is not a `Reactive` — it is `(args?) => Reactive`, so the probes are on
`getInvoice({ id })` and there is no `getInvoice.pending()` — while `m.invalidate` and `m.refresh`
already act over every args key. Triggers could reach a set and probes could not, and neither could
reach ACROSS memos, which is what `tags` is declared for.

So the four are free functions rather than members, and the member spellings are DEFINED as them.

| Name | Type Signature | Description |
| --- | --- | --- |
| `Selection` | `Memo<unknown, Args, unknown> \| { tags: string[] }` | WHAT IS BEING ASKED ABOUT: one memo — every args key of it — or every entry carrying any of these `tags`, across memos. Narrowing WITHIN a memo is the member's own `pattern`, so there is one place args-granularity is spelled and it is the place that has the `Args` type. |
| `pending` | `(selection?: Selection) => boolean` | Whether ANY entry in the selection is pending. Bare, it is anything in flight in this scope, which is what an app-wide progress strip reads. |
| `refreshing` | `(selection?: Selection) => boolean` | The same over `refreshing()` — a reload in flight over values still being served. |
| `refresh` | `(selection?: Selection) => void` | Stale while revalidate, over the selection. `m.refresh(pattern)` IS `refresh(m)` narrowed by args, not a second mechanism. |
| `invalidate` | `(selection?: Selection) => void` | Marks the selection stale, over the same set. `m.invalidate(pattern)` IS `invalidate(m)` narrowed the same way. |

### Expectations

* ONE SIGNAL PER SELECTION, NEVER ONE PER ENTRY. A probe read subscribes to that probe alone (see
"Probes"), so an aggregate built by subscribing to each member wakes a page-level spinner once per
entry — with the output right the whole time, which is why this is asserted rather than tested. A
selection holds one signal and bumps it when the COUNT of matching in-flight entries crosses zero:
n entries reloading together is 2 effect re-runs, not 2n.
* ANY, NOT ALL. "Is anything loading" is the only question that aggregates without a second rule, and
it is why only these two probes have a free form. `done()` and `success()` over a set are genuinely
ambiguous between any and all, and an aggregate `error()` would have to decide WHICH failure to hand
back — so a caller wanting either asks the entries.
* THE TRIGGERS REACH ONLY WHAT HAS A PRODUCER, where the bare probes reach every `Reactive`. A
`state(0)` cleared by an app-wide `invalidate()` is silent data loss, and a room has nothing to
re-run, so `Selection` is memos and tags. A room is reached by name.
* `invalidate` IS LAZY AND `refresh` IS EAGER, and at this width that stops being a nuance: an
`invalidate()` over a scope holding two hundred entries marks two hundred and LOADS only what
something reads, where `refresh()` loads all two hundred. So `invalidate()` is the reconnect
default — `watch(() => { if (online) invalidate() })` — and `refresh()` is for warming data before
anyone asks.
* A SELECTION IS SCOPE-BOUNDED, as a memo is: this scope's entries plus `global` ones (see "Scope").
A tag READS process-wide and is not, so one request can never invalidate another's. ON A SERVER THAT
MAKES A BARE `invalidate()` REACH EVERY `global` MEMO IN THE PROCESS — its own request-scoped entries
die with the request anyway, so the global ones are the whole effect. That is what an operator's
flush endpoint wants and is never what a handler being defensive wants.
* THE BOUND IS ALREADY DECLARED. `throttle` and `debounce` apply HOWEVER TRIGGERED (see
`MemoOptions`), so a memo that must not join a stampede says so on itself — where the knowledge is,
rather than at a call site that cannot know what else the tag matched.
* THERE IS NO BARE `refresh()` OVER A SELECTION AN APP DID NOT NAME beyond the scope: `refresh()`
with no argument is the scope, and the scope is the widest thing there is. The asymmetry with a bare
probe is that a probe REPORTS and a trigger ACTS, so the widest read is free and the widest write is
the one an app should have to mean.

## Tracking

A value is tracked only where it is part of the RENDER FLOW — where something downstream will be
rebuilt from it. That is the whole criterion, and an event handler falls out of it rather than being
excepted: it runs in response to a person, after the output exists, so a subscription taken there has
no consumer.

| Context | Tracks | Why |
| --- | --- | --- |
| template expression | yes | the flow |
| branch-local `<script>` in a block body | no | setup, once per item — there is no rerun to feed |
| `memo` body, unkeyed | yes | pushes its OWN subscriber |
| `memo` body, keyed | no | untracked by handler |
| a block body's BINDING — `{:then value}`, `{#for item}`, `{#for await event}` | yes | a live read, like a prop. It binds the VALUE the block produced, never a `Reactive`, so the rule that an identifier binding HOLDS does not reach one |
| `watch` effect | yes | pushes its own, unless `sources` narrows it |
| component `<script>` setup | no | runs once; there is no rerun to feed |
| event handler, `bind:` write-back | no | not the flow |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | no | not the flow |

### Expectations

* A reactive node pushes its OWN subscriber when it evaluates, whoever reached it. Tracking cannot
depend on the caller: a memo first read from an event handler would otherwise compute with no
dependencies registered and be stale for the rest of the process.
* The render flow decides whether an AMBIENT subscriber exists; a node supplies its own on top of it.
* On a SERVER there is no rerender, so a tracked read registers no SUBSCRIBER. It does register a
SINK where what it read is still in flight — a continuation, not a graph node, firing once for a
settling value and appending in order for a stream. The bookkeeping a rerender would need is skipped
rather than built and dropped, and a `set` after a value was already written changes nothing already
flushed.
* Tracking is SYNCHRONOUS. A body suspends at its first `await` and the subscriber is restored, so a
read in the continuation registers against nothing — reliably nothing, since a microtask resumes
between synchronous blocks and never inside another node's scope. The cost of this is one variable
set and restore; propagating the subscriber across `await` instead would put its cost on every
promise in the process, and would make OVER-subscription the easy mistake — the failure that leaves
the output right and is only visible by counting wake-ups.
* So the compiler WARNS on a reactive read that an `await` dominates inside a tracked body, naming the
read. It is fixed by hoisting the read above the await, or by saying `peek()` where the read was
meant to be untracked. Hoisting is also the faster shape, and the one "start all asynchronous work up
front" already asks for. The check reaches a body written inline at `memo(…)` / `watch(…)`, which is
nearly all of them; a body defined as a named function elsewhere escapes it.

## Refusals

A refusal is a declared VALUE, not a status code and not a transport concern. It fills the
`Failures` of the `Reactive` that produced it — an rpc handler's return, a memo body's, a
refusing `transform` — and it is narrowed with `s.isError` wherever it is read. Declaring one
resolves ON BOTH SIDES, which is what lets a `#shared` module own an app's failure names and a
`transform` in `#ui` refuse a write the same way a handler refuses a request. `# Transports`
does not define refusals; it says how they cross a wire.

| Name | Type Signature | Description |
| --- | --- | --- |
| `refuse.typed` | `<Name extends string, Data extends JsonValue = undefined>(name: Name, status?: number, message?: string, options?: { schema }) => (data?: Data) => Failed<Name, Data>` | A reusable factory for a named, narrowable failure, its message optional the same way. The status defaults to 500 — a fault is ours until an app says whose it is — and the phrase is resolved at the DECLARATION. With a `schema` the data is checked synchronously at construction. CONSTRUCTION IS INERT: `myError(data)` BUILDS a `Failed` and does not throw, which is what lets a `clientPublish` gate RETURN one and what puts the failure in the handler's return type honestly rather than by `never` vanishing from a union. |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }`, `Failed<Name extends string = string, Data = undefined>` | THE ONE REFUSAL TYPE, in-process and over a wire alike — there is no second http-shaped one, and `HttpError` names the UNDECLARED instance rather than a class of its own (see `refuse`). Structural, because what a caller catches is a shape rather than a class it imported. |
| `return myError(data)` | `Failed<Name, Data>` | One spelling for every refusal: a handler RETURNS them. RETURNING is what refuses — the value is inert until it reaches a return, so the refusal is at the boundary and visible in the type, where `Rpc`'s third parameter picks it up. A `throw myError(data)` refuses identically and only loses the caller's ability to name it. `refuse(status)` is the other spelling and still THROWS, returning `never`, so a bare `refuse(404)` remains a guard. |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away is a refusal that did not happen. Because construction is inert, `if (!user.member) notMember({ group: 'staff' })` would fall through silently — so an expression statement whose type is `Failed` is REFUSED, naming the two repairs: `return` it, or `throw` it. Detectable in syntax, and it is why the guard form does not have to be given up to make construction inert. |

# Transports

A HANDLER is what ANSWERS — a `memo`, a `channel`, or a plain function — and it is the GENUS. `GET` /
`POST` / `PUT` / `PATCH` / `DELETE` give one an ADDRESS over http and `socket` gives one an address
over the mux, both mounted by file path and export name (see "Mount paths"). "An rpc" is the http SPECIES and a socket is the other, so the two
words are not interchangeable — a mapping written over rpcs silently omits every room, which is the
mistake `# Generated surfaces` would make if it said rpc where it says handler.

DECLARE IS THE VERB AND HANDLER IS THE NOUN. "A declaration" was tried as the noun and abandoned: in
JavaScript a function declaration is `function f() {}`, where every handler here is a `const` bound to
an EXPRESSION, so the word named the one shape these are not. The verb has no such collision — you
DECLARE a handler with `GET`. The genus needs a word of its own at all because `rpc` is spoken for
three times already: `Rpc` the type a caller gets back, `rpc.url` / `rpc.isError` / `rpc.method` the
members on one, and `#server/rpc/**` the directory.

NEITHER END OF IT IS A NAMED TYPE, AND NEITHER NEEDS TO BE. What a handler may be declared over is
spelled in `GET`'s own signature: a `Declarable` alias was tried and named nothing a reader could not
read there, one type position being too few to earn the indirection. The handler itself has no type
either — `GET` takes a `handler` and hands back an `Rpc`, and what sits between them is a route-table
entry, a build artifact no app ever holds. `Handler` as a type name was freed for it: `watch`'s callback is
an `Effect`, which is what `## watch — the effect` had called it all along.

## `rpc` — `memo` + transport

| Name | Type Signature | Description |
| --- | --- | --- |
| `Rpc` | `<Value, Args, Failures>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Failures>` | `Rpc` puts an http transport in front of what the handler ADDRESSES, or proxies it on the server. `signal` aborts the reader. `Failures` is the union of declared `Failed<Name, Data>`, inferred from the handler's return type — values rather than names, so `rpc.isError` narrows to the data with no registry to consult. A caller always gets a `Reactive` back, whichever of the three was declared — the parameter it fills is `Reactive`'s own, and nothing about an rpc is a second kind of `Reactive`. |
| `Value` | `unknown` | What the addressed `Reactive` yields — serialized for http transport, returned raw on the server. |
| `Args` | `Record<string, JsonValue> \| undefined` | Arguments, in the request body on `POST`/`PUT`/`PATCH`. Serializable by contract — the wire form is also the memo key. NARROWED TO FLAT on `GET`/`DELETE`, where the wire form is URL parameters. |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of an onion. `next` is the NEXT rung and hands back whatever that rung returns; where there is no next rung, `next` runs the operation itself and the onion is complete. Returning without calling `next` short-circuits. A throw escapes the whole onion rather than unwinding through it. `Ctx` is a RECORD naming what that lane actually has: the APP lane is `Middleware<{ request: Request }, Response>` and runs PRE-ROUTING, so it has no route and no args; the RPC lane is `Middleware<{ request: Request; args: () => Args }, Response>`, typed to that one handler; the socket lane is `Middleware<SocketEvent, void>`, where a throw is the only refusal. |
| `GET` | `<Value, Args, Failures>(handler: Memo<Value, Args, Failures> \| Channel<Value, Args, Failures> \| ((args?: Args) => Value), options?: RpcOptions<Value, Args>) => Rpc<Value, Args, Failures>` | Declares a READ any surface may call, addressed by its arguments. WHAT IT MAY BE DECLARED OVER is the union above: a `Reactive`, and there are two of them. A `memo` is identity per args — coalescing, `ttl`, `invalidate` — and is what you generally write. A `channel` is a room. A PLAIN FUNCTION is the third arm and is SUGAR, not a third kind: `GET(fn)` is `GET(memo(fn))`, the same way `{#for await x of s}` is `s.tail()` — a bare form that IS the spelled-out one rather than a shortcut past it. So there is no un-memoized endpoint to reason about, and nothing has to tell the arms apart: already a `Reactive`, use it; a function, wrap it. Over a channel it is the read-only view of a room — jsonl by default, sse on `Accept` — where the socket is the two-way one. A read has no side effects — `SameSite=Lax` volunteers the principal cookie on a top-level GET navigation, so a `GET` that changes something is reachable from an `<a href>` on another origin. |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declare a mutation, which retains nothing by default: a memo handed to one has its `ttl` DEFAULTED TO 0 unless it named one, so coalescing covers the in-flight window and nothing after it. That is the whole per-method difference, and it is what makes a memoized mutation safe — a double-click inside one flight is one write, two sequential clicks are two, and `ttl` is how an app says "never more than once". A `POST` is also a legitimate READ, for a query too big for a URL, so caching one is a thing to be able to ask for rather than a mistake to prevent. A `POST` over a channel is a PUBLISH into the room, gated by that channel's `clientPublish` — the same gate the socket reads, which is why it is declared on the channel and not per transport. |
| `rpc.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | The rpc's `isError`, NARROWED by what the handler declared: matching the name gives back `.data` with the schema's type on it, `.status` and `.name`. |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response instead of a decoded value. |
| `rpc.method` | `string` | HTTP method |
| `rpc.url` | `string` | HTTP url, DERIVED not baked: the generated wrapper carries the mount-relative address, and `url` resolves it against `<meta name="abide-mount">` in a browser and `config().APP_URL` on a server. A mount is chosen after the build, so a build artifact cannot hold the absolute form. |
| `rpc.description` | `string \| undefined` | Human description |

### `RpcOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. |
| `schemas` | `{ input?: Schema<Args>; output?: Schema<Value> }` | The declared shape in each direction, enforced at every load. Derived from the args and return value when nothing is declared. |
| `middleware` | `Middleware<{ request: Request; args: () => Args }, Response>[]` | Middleware run per request, INSIDE the app's own and after routing. `ctx.args()` parses on first call and caches for the request — search params on `GET`/`DELETE`, the body otherwise — so a rung that never asks pays nothing and a 401 still precedes any parse failure. What it hands back is PARSED, COERCED AND VALIDATED, so a rung authorising on a resource id compares a number against a number whichever method carried it — the string/number split by method is the silent one, an authorisation check passing on a type mismatch. Validation is LAZY, on that first call, which is what keeps the ordering: a 401 rung that never asks for args still precedes every parse and every schema, so an unauthenticated caller does not read the schema back out of a 422. A malformed body is 400 and a schema refusal is 422, both raised where the first rung asks. Throws escape the onion. |
| `timeout` | `number` | ms the call may stay open before it fails. |
| `clients` | `Clients` | Which surfaces carry this handler — `ui`, `mcp`, `cli`, `openapi`. Optional, every key optional, every default true; see `# Generated surfaces`. NOT access control: it decides what is generated and listed, never who may call. |
| `crossOrigin` | `boolean \| string[]` | Whether other origins can call it; `true` is any origin, a `string[]` is the allow-list. Default: false. Where it is declared, abide answers the `OPTIONS` preflight itself. |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. |

### Response helpers

What a handler answers WITH. A refusal is declared in `## Refusals` and merely travels
through here — `refuse.typed` and `Failed` are not response helpers.

| Name | Type Signature | Description |
| --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. ONE input type across the four, so `page(render(C))` needs no adapter and a source that is already a stream is not converted to become one. |
| `page` | `(body: string \| Values<Uint8Array \| string>, init?: ResponseInit) => Response` | A rendered document as `text/html`. Takes what a render PRODUCED rather than doing the render, which is why it takes the generator `render` yields rather than a stream built from it. |
| `json` | `(data: unknown, init?: ResponseInit) => Response` | Serialize and tag `application/json`. `undefined` sends `null`, not the text `undefined`. |
| `jsonl` | `<T>(values: Values<T>, init?: ResponseInit) => Response` | One JSON value per line from a sync or async iterable; `application/jsonl`. Written per `pull`, so back-pressure reaches the source. |
| `sse` | `<T>(values: Values<T>, init?: ResponseInit) => Response` | The same machine framed as `data: <json>\n\n`; `text/event-stream`, `no-cache`, `X-Accel-Buffering: no`. |
| `redirect` | `(to: string, status?: RedirectStatus, init?: ResponseInit) => Response` | NAVIGATE. The status is restricted to `301`/`302`/`303`/`307`/`308` (default `302`), and there is an `init`, which is where a login's cookie goes. |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry, so a typo is a compile error rather than a browser ignoring it. |
| `refuse` | `(status: number, message?: string) => never` | THROWS IN A BROWSER, the way `config` does — a status is a response's business. On a server it THROWS the UNDECLARED `Failed`: `name` is `'HttpError'`, and there is no data. A handler writes `return refuse(404)` beside its other returns; `never` disappears from the union, so the returned form costs the type nothing and the throw stays abide's business. Declared `never` so a bare call also stands as a guard. The message defaults to the registry's phrase, so `refuse(404)` is a whole refusal. It carries NO data, and there is no options bag to put any in: data undeclared has no type on the other side, so `refuse.typed` with a schema is the only place it can mean anything. THE NAME IS HTTP-SHAPED BECAUSE THIS INSTANCE ONLY EVER SURFACES WHERE HTTP IS THE VOCABULARY — an OpenAPI default response, a wire body, an MCP error entry. A refusal reached in-process has a name, `refuse.typed` being how one is declared. |

### Expectations

* A HANDLER THAT CAN BE ADDRESSED OVER HTTP. What it addresses decides what it brings — see `GET` — so "it is a memo" is true of the form you generally write and not of the mechanism
* HTTP path is determined by filepath + export name.
* Return type dictates Content-Type
* Browser only sees a wrapped `fetch(rpc.url, { method: rpc.method })` not the whole server module. That wrapper is a module the build GENERATES — one export per handler, carrying `method`, the mount-relative ADDRESS and `description` and nothing else — rather than the server module shaken down to it, so "no server code shipped" is a property of the build and not an outcome of an optimizer. A module-level side effect in an rpc file cannot reach a browser, because the browser's module was never derived from that file.
* Importing a name from `#server/**` that is NOT an rpc or socket handler is a COMPILE ERROR from the client graph, never a silent stub; only `#server/rpc/**` and `#server/sockets/**` resolve from `#ui` and `.abide` at all.
* Validation is SERVER-authoritative, since a `schemas` entry may be a runtime object built from server imports. A schema an app puts in its own `#shared` module is importable from both sides, which is how a client-side check is written when one is wanted.
* An rpc returning a binary — `Uint8Array`, `ArrayBuffer`, `Blob`, `DataView` — transports it as `application/octet-stream`, or as a `Blob`'s own `type` where it has one. The client decodes it back to a `Uint8Array`.
* An rpc returning a raw value transports as application/json
* An rpc returning undefined returns as 204
* An rpc returning an AsyncGenerator is streamed as jsonl, which is the DEFAULT and not the only
framing: a handler returning `sse()` says so outright, and a caller sending `Accept: text/event-stream`
gets the same address framed that way. One url with two bodies, so it carries `vary: accept`.
* THE SEED BUFFER HOLDS THE JSONL, whichever framing the caller asked for. SSE is that transcript with
`data: ` in front of each line and a blank line after it, so the reframe happens at replay and the
buffer stays a byte count rather than a list of decoded values it would have to walk to measure.
* RETENTION AND STALENESS BELONG TO THE `Reactive`, NEVER THE TRANSPORT. `RpcOptions` is `description`,
`schemas`, `middleware`, `timeout`, `crossOrigin`, `maxBodySize` — an address and how it is spoken to.
`ttl`, `invalidate` and `refresh` came in on the `memo` that was passed; `tail` and `clientPublish` came
in on the `channel`. So a handler over a memo and one over a channel take the SAME options and
differ only in what the `Reactive` brought.
* `GET` / `DELETE` args are passed as URLSearchParameters, not as json, and are therefore typed FLAT — `Record<string, string | number | boolean | null | Array<string | number | boolean>>`, an array being the repeated key a `URLSearchParams` already has a form for. That is what makes "args that cannot be keyed are exactly args that cannot be sent" TRUE rather than nearly true: a nested object is keyable and is not sendable, so it is refused at compile time, naming the method. The fix is to make the call a `POST`, which is `JsonValue` — and which gives up the browser cache, so the error says that too.
* `POST` / `PUT` / `PATCH` accept JSON or `multipart/form-data` or `application/x-www-form-urlencoded`
* THE SEED IS THE CLIENT'S OWN REQUEST, never a copy in the document. A render's loads are buffered,
and the client's call to the same address is answered from where the document reached — so what seeds
the client is a real rpc response: inspectable in a network panel, and carrying whatever
`cache-control` the handler set. ONE MANIFEST ISSUES THEM ALL: the head carries `(method, address,
args)` — what to fetch, never the data — and the byte-invariant bootstrap issues every seeded call
before the bundle loads, GET and POST alike. There is no `<link rel="preload" as="fetch">`, and not
having one is what makes the browser cache work: the RENDER ID TRAVELS AS A REQUEST HEADER,
`abide-render`, so the URL stays the plain one. A custom request header does not fragment the HTTP
cache — only a `Vary`-listed one does, and no abide response ever varies on this header — so a
handler that answered `public, max-age` populates the cache under the plain URL, and a REFRESH sends a
different render id to the same cache key, hits, and never reaches the server. The new render's seed
entry then expires unclaimed, which is what the timer is for. A preload could not have done this: it
carries no headers, so putting the render id in the URL instead would have fragmented the cache per
document and a refresh would never have hit.
* THE MANIFEST IS NOT A DEGRADED PRELOAD, AND THE SPEC IS WHERE THAT IS CHECKED. A preload's whole
advantage is EARLY DISCOVERY, and the HTML spec's own guidance is that the advantage grows with how
LATE a resource would otherwise be found — a font named inside CSS, a module a script imports. A
resource named in the same chunk of head HTML as the thing that would fetch it gains nearly nothing,
and that is exactly this case: the manifest and the bootstrap are the same two head elements. What the
preload arm carries instead is two hazards this one does not have. `as="fetch"` REQUIRES `crossorigin`,
and it must match the eventual request's CORS and credentials mode EVEN SAME-ORIGIN — a seeded call
carries the `abide-caller` cookie, so a wrong or missing attribute is a second request and a dead
preload, silently. And a preload sets its own `Accept`, where an rpc answer carries `vary: accept` for
the jsonl/sse split — a second axis for the same silent mismatch. The one thing preload keeps is that
it does not block the parser, where a classic inline script does; the bootstrap is byte-invariant and
issues N fetches, so that pause is what should be MEASURED rather than assumed away.
* `cache-control` on an rpc answer is a DEFAULT, not a rule: every response helper takes a
`ResponseInit`, so a handler that knows its answer is shareable overrides it. What the method decides is
the CEILING. A `GET` answer can be MADE browser-cacheable; a `POST` answer cannot be, whatever it sets,
no browser usefully caching one — so its only cache is ever the memo's own `ttl`. That is the reason to
prefer `GET` for a read whose args fit a URL, beyond what the methods mean.
* EVERY CALLER HAS AN ID, authenticated or not: 16 bytes of `crypto.getRandomValues`, base64url, in an
`abide-caller` cookie minted on the first response that arrives without one. The buffer is keyed
`SHA-256(callerId ‖ sealDigest ‖ renderId ‖ address ‖ canonical args)` — the seal's digest empty where
the caller is anonymous, and the render id minted per DOCUMENT and carried in the head manifest the
bootstrap already ships. THE KEY IS NEVER TRANSMITTED: the client sends its ordinary cookie and the
render id it was served with, in an `abide-render` header, and the server derives the same key — so
presenting another caller's key means holding their cookie, which is being them. The header rather
than the URL is what keeps the address cacheable; nothing ever varies on it.
* THE RENDER ID IS WHAT MAKES SINGLE-USE TRUE. Without it two tabs of one caller on one page derive one
key, and the hazard is not a leak — same caller, same address, same args, same answer — it is POSITION:
a document is not held for an unfinished stream, so an entry holds a PARTIAL transcript at wherever
that render reached, and a tab adopting the other's entry resumes from a cursor it never rendered,
replaying rows it painted or skipping rows it did not. It costs the accounting too, one key written
twice being what "an entry being single-use" was the reason not to bound. It does NOT change how many
times anything LOADS: that is decided by SCOPE — two requests are two scopes and load twice, one
request coalesces — and the buffer never de-duplicates a load, it only hands a rendered transcript back
to the client that rendered it. Two tabs against an expensive stream are two loads with or without this
key; `global: true` is the only thing that makes them one.
* An id for EVERYONE removes the sharing decision rather than answering it. Keyed on the principal's
seal alone, an anonymous caller had nothing to key on, and deciding per handler whether an answer
was caller-invariant was a judgement abide could not check — `server().requestIP()`, a module-level
mutable and a clock all vary per caller without touching an ambient abide owns. With an id there is no
cross-caller path left to get wrong, and the handler, the veto and the gate guarding it are
deleted rather than kept beside it.
* THE KEY CARRIES THE CHANGE OF AUTHORITY, NOT THE HANDLE. Signing in moves the seal digest, so an
entry buffered while anonymous cannot be picked up after it — and a planted `abide-caller` value buys
nothing, its holder still lacking the seal the key is derived from. Rotating the handle instead would
defend against session FIXATION, which needs the handle to confer authority; this one confers none,
authority being the seal's alone. That is the invariant worth asserting, the failure being silent: the
answer is well-formed whichever caller receives it.
* THE SEED BUFFER HAS NO COUNT AND NO TTL TO CONFIGURE, and that is the decision rather than the
omission. An entry is single-use and lives seconds, so the exposure is request rate multiplied by
transcript size, and the size is the only dimension that can run away — which is what
`ABIDE_MAX_STREAM_BUFFER_SIZE` already caps. A count ceiling would evict an entry a document in flight
is about to claim, which is the one failure the buffer exists to avoid.
* IT IS ALSO PROCESS-LOCAL, as a `global` memo's cache and a room's `seq`/epoch are. A deployment of
more than one instance degrades rather than breaks: the client's follow-up landing elsewhere is a
buffer miss and an ordinary load, a `global` memo's `invalidate` reaches its own process, and a
reconnect to another instance is the announced epoch reset. abide supplies no cross-process mechanism
for any of the three.
* A caller refusing cookies gets an id for the REQUEST only. It never matches across two, the buffer
is never picked up, and the client's call is an ordinary load — correct, slower, and the right
degradation, a crawler that will not take a cookie not running the client either.
* The cookie is a SESSION cookie carrying nothing but the id, `HttpOnly`, `SameSite=Lax`, `Secure` in
production. It is not a place to hang rate limiting, analytics or a server-side session: each is a
reason for it to live longer and say more, and a correlation handle that acquires those has become
the tracking identifier a strictly-necessary exemption stops covering.
* On an rpc route the body belongs to `ctx.args()`. A body reads once, so `request().json()` is not the way in — a rung that took it would break every rung after it and the handler.
* A `signal` is READER-LOCAL: it detaches this reader and rejects this read. The shared load runs to completion for the others, and still populates the entry when every reader has left, so the next reader gets it free. An aborted read never becomes the memo's `error()`.
* A MEMO BELONGS TO EXACTLY ONE HANDLER, and handing the same one to two is a BUILD ERROR naming
both. A mutation defaults its memo's `ttl` to 0, so `GET(user)` and `POST(user)` over one memo either
have the `POST` silently stop the `GET` caching, or share one entry table under two freshness rules —
where a `POST` populating an entry the `GET`'s 60s keeps fresh means the second click is served the
first click's response and THE WRITE NEVER HAPPENS. Neither is a default worth having, and the repair
is what the shapes wanted anyway: a read memo and a write memo have different `Args`.
* COALESCING IS THE MEMO'S, not the transport's. Where one was passed, multiple calls in ONE scope share a
response and two concurrent requests are two scopes that load twice (see memo Scope). A PLAIN FUNCTION
is memoized on the way in, so it coalesces the same way — there is no arm of this that does not.
* A `ttl` of 0 coalesces until the response closes and no longer; a positive `ttl` starts when it
closes. That is why a MUTATION defaults its memo to 0: the in-flight window is the part that wants
sharing — a double-click is one write — and everything after it does not.
* THE SEED BUFFER HOLDS ONE ENTRY PER KEY, and the key names the render (see "THE KEY IS NEVER
TRANSMITTED"). Every handler addresses a memo, so three components asking for the same args in one
render are ONE call on both sides and one entry — which is what makes the buffer's single-use rule
enough of a bound.
* Planned or not, a refusal serializes as `{ name, message, data }` and hydrates as a `Failed` — `{ name, status, message, data }`, the status coming from the response. An UNDECLARED one carries `name: 'HttpError'` and no data; a declared one carries the name `refuse.typed` gave it.
* a schema validation returns 422 with ``Failed<'ValidationError', readonly Issue[]>``
* A mutation — `POST` / `PUT` / `PATCH` / `DELETE` — compares its `Origin` against `APP_URL`'s origin before the handler runs, and a mismatch is 403. `Origin` is sent on every cross-origin request, form posts included, and cannot be set by script, so the gate holds independently of cookie policy; a declared `crossOrigin` allow-list replaces the same-origin comparison for that handler. `GET` needs no gate because it is a read, and `DELETE` is unreachable by navigation because a navigation is always GET. A mutation arriving with NO `Origin` at all is ALLOWED: CSRF needs a browser's ambient authority and a browser always sends one, so an absent header is a non-browser caller with no ambient cookie to abuse. Refusing those callers is an app's rung, which is what middleware is for
* A MUTATION ANSWERS A FORM NAVIGATION AS A NAVIGATION. `<form action={rpc.url} method="post">` posts
to an address like any other caller, and where the request PREFERS `text/html` — which is what a
browser form sends and what abide's own client wrapper never sends — the result is converted rather
than serialized: a returned `redirect()` passes through, a returned value becomes `303 See Other` back
to the `Referer`, and a failure renders `error.abide` at its own status. Without it a scriptless submit
navigates the browser to a JSON document, and `{await expr}` would be the whole of what works without
script — reads only. With script the client intercepts `submit` and it is an ordinary rpc call, so the
conversion is reached only by the caller that needs it.
* Only `GET` and `POST` are form-reachable, a `<form>` sending no other method. A mutation meant to be
submitted without script is declared `POST`; there is no `_method` override, an app that wants
`PUT`/`PATCH`/`DELETE` semantics having a `POST` to say it with.
* WHERE `crossOrigin` IS DECLARED, ABIDE ANSWERS THE PREFLIGHT. A cross-origin JSON `POST` always
sends `OPTIONS` first, so an allow-list with nothing answering it is an allow-list that never works. The
preflight is answered OUTSIDE the middleware, for the reason `/__abide/health` is: it carries no credentials,
so there is nothing for a rung to authorise. It emits `access-control-allow-origin` echoed from the
allow-list (or the request's own where `crossOrigin` is `true`), `access-control-allow-methods` naming
this handler's method, `access-control-allow-headers` echoed from `access-control-request-headers`,
`access-control-allow-credentials: true`, `access-control-max-age`, and `vary: origin,
access-control-request-headers`. An address with no `crossOrigin` answers `OPTIONS` with 404, the same
as any other unmounted method.
* `SameSite=Lax` means a cross-site top-level POST arrives WITHOUT the principal cookie, so it is seen as anonymous rather than refused

## `socket` — `channel` + transport

| Name | Type Signature | Description |
| --- | --- | --- |
| `Socket` | `<Message, Args, Failures>(args?: Args) => Room<Message, Failures>` | A `channel` over a web socket, and the SAME `Room` a channel invokes to — a socket over a channel is a channel over a socket, so there is nothing about the shape that says which transport carried it. |
| `Args` | `Record<string, JsonValue> \| undefined` | The room, keyed as a memo's args are. |
| `Message` | `unknown` | Message type |
| `socket` | `<Message, Args, Failures>(channel?: Channel<Message, Args, Failures>, options?: SocketOptions<Message>) => Socket<Message, Args, Failures>` | Socket factory. `SocketOptions` is the UPGRADE and nothing else — who may connect, and what a frame must look like; whether a caller may publish came in on the channel. |

### `SocketOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Message>` | The declared shape of a message. Derived from type when not provided. |
| `middleware` | `Middleware<SocketEvent, void>[]` | The same middleware as the http lane, instantiated over `SocketEvent` — `{ kind: 'subscribe' \| 'publish', room, message, request }`. `next(event)` hands back what the next rung returns; the innermost one performs the subscribe or the publish. There is no `Response` to return, so a THROW is the only refusal. |
| `SocketEvent` | `{ kind: 'subscribe' \| 'publish'; room: Args; message?: Message; request: Request }` | What the socket lane's onion carries. `message` is absent on a subscribe, there being nothing published yet. |
| `crossOrigin` | `boolean \| string[]` | Which origins may upgrade| `crossOrigin` | `boolean \| string[]` | Which origins may upgrade, closed unless declared. `true` is any origin, as on the http lane. |
| `clients` | `Omit<Clients, 'openapi'>` | The same record the http lane takes, minus the key a room has no meaning for. `ui: false` withholds the generated subscriber; `mcp: false` withholds the resource AND the publish tool, those being one handler's two halves. |

### Expectations

* channels are carried over a single web socket mux
* upgrade goes through `middleware`
* Clients are read-only by default, the server may publish and read, and `clientPublish` on the CHANNEL is what opens the other direction — for this socket and for a `POST` at the same room alike, there being one gate rather than one per transport.
* Every message carries a `seq`, monotonic per room and minted at publish, and a room carries an EPOCH — its incarnation, since a counter held in memory goes back to zero when the process does. Both are INTERNAL. An app never writes either: `room.tail(n)` already replays its snapshot and goes live from where it ended with no gap and no duplicate, so the reconnect carries the last `seq` it rendered and compares epochs underneath, and a moved epoch means the client takes the tail MARKED AS A RESET rather than being told there is nothing new. The reset is announced because it has to be: a server that changed incarnation cannot know what the client painted, so replaying the tail silently would duplicate rows a `{#for await}` had already appended. On a reset the block CLEARS its accumulated rows and repaints from the tail — the one place it is not append-only, and rare enough that correctness beats the reflow. That is what makes the three handoffs ONE mechanism rather than three — the seed buffer, a socket that dropped and reopened, a tab too slow to adopt — with `room.tail(n)` the only spelling any of them has.
* A cursor an app PERSISTED across sessions is the one thing this would not serve, and it could not be served anyway: the tail is a memory ring bounded by `tail` and `ttl`, so a cursor older than that is always past it. Catching up over that horizon is app data behind an ordinary rpc, not a room.
* `seq` is `{#for await}`'s DEFAULT key where the source is a room, so a streamed list off a channel is keyed without an app declaring one. A stream that is not a room — a jsonl rpc — has no `seq` and is positional unless the block spells `by`.

## Mount paths

| File | Export | Served at |
| --- | --- | --- |
| `server/rpc/name.ts` | `default` | `/__abide/rpc/name` |
| `server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |
| `server/sockets/chat.ts` | `default` | `/__abide/socket/chat` |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

A path is owned by exactly one handler, and a collision is a BUILD ERROR naming both files —
`server/rpc/users.ts` exporting `getUser` and `server/rpc/users/getUser.ts` exporting `default` mount
at the same address. The route table is a build artifact, so it is found there rather than at the
first request that reaches whichever one won.

## Schemas

| Name | Type Signature | Description |
| --- | --- | --- |
| `Schema<T>` | `((value: unknown) => boolean) \| StandardSchemaV1<T> \| JsonSchema` | The three forms. A schema RETURNS what it accepts, so it normalises as well as refuses. |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. The bound exists because the canonical wire form of an args object is also its cache key. |
| `Issue` | `{ path: string; message: string }` | One thing wrong, and where. `path` is `''` for the value itself, and for the plain-function form, which throws a sentence and has no path to give. |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the NATIVE form — what a handler means, and the only one publishable to a tool definition or an OpenAPI operation. |
| `validateJson` | `(schema: JsonSchema, value: unknown) => Issue[] \| null` | The native validator, `null` when it matches. |

### Expectations

* `JsonSchema` is the native form — what a handler MEANS, and the only one publishable to a tool definition or OpenAPI operation.
* a plain function `(value: unknown) => boolean` returns what it accepts and THROWS what it refuses.
* a Standard Schema `StandardSchemaV1<T>` is the interop spec zod/valibot/arktype answer to.
* `rpc.isError(e, 'ValidationError')` narrows `e.data` to the issues with nothing declared. |
* schemas coerce the args from strings when they're url params, at the `ctx.args()` that first asks for them — so every rung after that one, and the handler, see the coerced value
* When no schema is specified, its derived by type annotation, or arg defaults. `GET(({ id }: { id: number }) => …)` and `GET(({ id = 1 }) => …)` both build schemas for `{ id: number }`

## Headers abide generates

| Header | On | Why |
| --- | --- | --- |
| `x-content-type-options: nosniff` | everything, unconditional | Every abide response declares its own type, so a browser guessing a different one is only ever the vulnerability — a JSON refusal sniffed as HTML is script on this origin. Spelled a second time on the asset route, which is served in FRONT of the pipeline and never reaches the funnel |
| `traceresponse` | everything, unconditional | The response you most want to correlate is a failure, so the 404 carries it too |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal — as a DEFAULT the handler's own `ResponseInit` overrides | A page renders per request and `principal` is a first-class thing to render off; a handler answers as whoever called it. Absent is NOT neutral — it licenses a shared cache to invent a freshness lifetime for an answer that names who asked. |
| `cache-control: no-store` | `/__abide/health`, `/__abide/principal` | Both describe this process or this caller at this moment. A cached health check is a load balancer being told a drained instance is healthy |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk is addressed by its own content hash, so it cannot go stale |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default written down, for the older agent that still defaults to `no-referrer-when-downgrade` and leaks an authenticated path to every cross-origin image |
| `vary` | wherever an answer depends on a request header | `accept-encoding` on anything compressed or compressible, `accept` on a stream that can be framed two ways, `origin` on a cross-origin rpc |

# Generated surfaces

A handler already carries an address, a method, an argument schema, a result schema and a
description. A MACHINE SURFACE is that same handler spoken in another vocabulary — an OpenAPI
operation, a tool definition, a command — and every one is DERIVED FROM THE ROUTE TABLE rather than
authored beside it. There is no second artifact to keep in step, which is the whole of the claim:
exposing an app to something that is not its own page costs a handler nobody wrote twice.

WHAT THEY SHARE IS THE DERIVATION, NOT AN AUDIENCE, AND NO ONE OF THEM HAS A SINGLE AUDIENCE. An
OpenAPI document is read by a code generator and by a person in a browser. The CLI is a person at a
prompt AND a script in CI AND an agent that can run a command but cannot speak MCP — which is why its
framing follows the TTY rather than being declared: human-readable to a terminal, JSON to a pipe, the
same address either way. Grouping the three by who reads them would therefore be wrong about all
three; they are here because they are GENERATED, which is `description`'s own phrase for what carries
one. The CLI's own surface lives in `# CLI` because abide's commands belong in one place, not because
it is the human one; what belongs here is `Clients`, which governs all four.

| Name | Type Signature | Description |
| --- | --- | --- |
| `Clients` | `{ ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }` | WHICH SURFACES CARRY A HANDLER. THE RECORD IS OPTIONAL AND SO IS EVERY KEY, and every default is TRUE: a handler is reachable from everything until it says otherwise, so the record is only ever written to WITHHOLD. An app that never writes one is fully exposed and fully correct, which is the adoption cost this surface is allowed to have — and a fifth surface is a fifth key rather than a fifth field on the option bag. |
| `clients` | `Clients` | `RpcOptions`. `SocketOptions` takes `Omit<Clients, 'openapi'>`, a room not being an http operation — the key is absent rather than accepted and ignored, so there is nothing dead to read past. |

### Defaults

| Key | Default | Because |
| --- | --- | --- |
| ui | true | An rpc exists to be called by the app's own pages, that being the case it was declared for |
| openapi | true | An operation describes an address an http caller could have found by trying it, so describing it reveals no reachability that was not already there |
| mcp | true | A model is a caller like the others, and a surface an app has to opt into is a surface most apps never get. What keeps this safe is not a default but the LIST BEING PER-CALLER: a model is shown the tools that caller may reach, so an unauthenticated one is shown nothing it could have called |
| cli | true | The CLI authenticates as the operator, with `ABIDE_APP_TOKEN`, who can already reach every address directly |

### Expectations

* NONE OF THIS IS ACCESS CONTROL, and reading it as any is the dangerous mistake. `openapi: false`
makes an address UNDOCUMENTED, not unreachable. `mcp: false` and `cli: false` withhold a LISTING, and
the http address answers exactly as it did before. What decides who MAY call is middleware — the same
rung that decides it for a browser — so `clients` decides what is GENERATED and what is LISTED, and a
handler that must refuse a caller refuses it in a rung.
* `ui` IS THE ONE WITH TEETH, being the only key resolved at COMPILE time. `ui: false` generates no
client wrapper, so importing that name from `#ui` or a `.abide` file is the same compile error a
non-handler already is — a server-to-server or agent-only handler the app's own pages PROVABLY
cannot call. The other three are listings assembled at runtime from the route table, and a listing is
not a boundary.
* THE FOUR ARE ONE QUESTION AND SO THEY ARE ONE RECORD. Four sibling booleans on `RpcOptions` would be
four places to look for the same answer and four things to remember when a fifth surface lands.

## OpenAPI

| Name | Type Signature | Description |
| --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The document, served from a `memo` over the route table and `config()` — abide's own primitive rather than a second cache with its own staleness to reason about. It takes no `ttl`: the route table is a BUILD artifact and cannot move under a running process, and `abide dev` throws the memo away with the module graph it replaces. `config.invalidate()` is the one thing that does move it — a port a dev hop pinned, a rotated secret — and it needs no wiring, because reading `config().APP_URL` IS the subscription. So `servers[0].url` follows a mount chosen after the build, which is the same reason `rpc.url` is derived rather than baked. Gated by `ABIDE_OPENAPI`, a closed one answering 404 the way `abide logs` does. Inside the app's own middleware like every `/__abide/**` address, so an auth rung gates it with no second mechanism. |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, because 3.1's schema dialect IS JSON Schema — the same `JsonSchema` a handler already means, published with no translation layer to drift. |
| `abide openapi [--out <file>] [--url <origin>]` | CLI | The same document on disk, for a repo that commits one or a client generator that reads one. `--url` supplies the mount the served form takes from `APP_URL`; without it `servers` is `[{ url: '/' }]` and the document is mount-relative, which is honest rather than wrong. |

### What one handler contributes

| Piece | Comes from |
| --- | --- |
| Path | the mount path — see "Mount paths" |
| Method | which handler was used |
| Operation id | the export name, qualified by its file where two files export the same one. A path is owned by exactly one handler and a collision is a build error, so the id is unique BY CONSTRUCTION rather than by a counter |
| Summary and description | `description` |
| Tags | the rpc file's directory under `#server/rpc`, which is where the address comes from too — so operations group the way the files already do, and a handler at the top level carries none |
| Parameters | `GET` / `DELETE` only: one `in: query` per top-level key of `Args`, which are FLAT by type. An array is `style: form, explode: true` — the repeated key a `URLSearchParams` already has a form for |
| Request body | `POST` / `PUT` / `PATCH` only, and all three of `application/json`, `multipart/form-data` and `application/x-www-form-urlencoded`, because all three are accepted |
| Success | the result schema at the content type the return type decides — `application/json` for a raw value, the Blob's own type or `application/octet-stream` for a binary |
| No content | a `204` where the handler's return type admits `undefined` |
| Refusals | ONE RESPONSE PER `Failed<Name, Data>` in `Failures`, at its own status, carrying the data schema. `Failures` is inferred from the handler's return type, so the error responses are derived from the same place the caller's `isError` narrowing is |
| Default | the undeclared `Failed`, `name: 'HttpError'`. `refuse(status)` carries no data and has none to declare |

### Expectations

* WHAT PUBLISHES IS THE SCHEMA'S OWN JSON SCHEMA WHERE IT HAS ONE. `JsonSchema` publishes as itself,
being the native form. A Standard Schema mostly can too — zod, arktype and valibot each expose a JSON
Schema export — so abide probes ONE spelling, a zero-argument `toJsonSchema()` on the schema object,
and an app whose library spells it otherwise adapts it in the one line. A registry of vendors inside
the framework is the arm not taken: it needs a fourth entry the week a fourth library exists, and
`~standard.vendor` is already there to NAME what was found rather than to dispatch on. Failing both,
the type-derived `JsonSchema` publishes — schemas derive from annotations where none is declared, so
there is always one to fall back to.
* PUBLICATION IS A SUPERSET IN ONE DIRECTION ONLY, and that is what makes it safe rather than
approximate. A constraint with no JSON Schema expression — a `.refine(fn)`, a plain-function schema —
is unpublishable by anyone, so the document admits what the handler still refuses with 422. It never
errs the other way, which is the direction a generated client would break on. What the fallback
changes is HOW MUCH is lost, never which way it is lost.
* WHICH PATH WAS TAKEN IS SAID OUT LOUD, on `abide:openapi`, naming the handler and the vendor. A
silent fallback is an app believing its precise shape published when a type-derived superset did, and
nothing about the document's own validity would ever reveal it.
* THE SCHEME IS DERIVABLE; THE REQUIREMENT IS NOT, and OpenAPI already separates the two. abide owns
the principal transport — a sealed `abide-principal` cookie — so `components.securitySchemes` is
derived: `apiKey`, `in: cookie`, that name. What is NOT derived is `security`, which says an operation
REQUIRES it. Authorization is a middleware rung and a rung is code: nothing about `GET(getInvoice)`
says who may call it, and an app that registered `onPrincipal` still serves public addresses. So the
document says HOW a caller authenticates and never that one MUST — a generated client can send
credentials and is not told they are mandatory. Claiming otherwise would publish that a call is public
because the check was one function call away from where the generator looked.
* THERE IS NO DOCUMENT HOOK, and that is the design rather than an omission. A `(document) => document`
escape hatch IS the second artifact this surface exists to remove: an app able to rewrite the document
can make it disagree with the route table, and "derived, cannot drift" stops being a property the
moment one can. Everything such a hook would have carried is derived — `info` from `APP_NAME` and
`APP_VERSION`, `servers` from `APP_URL`, `tags` from the rpc file's own directory, `securitySchemes`
from the principal seam — and the one residue, an operation's own auth requirement, belongs on the
HANDLER where it cannot contradict the table, never on the document where it can.
* `crossOrigin` IS NOT SECURITY and does not become `security`. It decides which origins a BROWSER may
call from, enforced by the browser, and publishes as nothing at all.
* A `GET` OVER A CHANNEL IS AN OPERATION; A SOCKET IS NOT. OpenAPI describes request and response over
http, which a socket is neither of, so a socket address is ABSENT from the document rather than
described badly — the tool-definition surface is where a room is described. The channel read is an
ordinary http read, jsonl by default and sse on `Accept`, so it publishes as one operation with two
response content types and `vary: accept`.
* A STREAM PUBLISHES THE SHAPE OF ONE ITEM, not of the whole. OpenAPI has no framing vocabulary for
jsonl or sse, so the content type is what says there are many and the schema names what one of them
is. An array schema would describe a body that is never sent whole.
* THE DOCUMENT IS ASSEMBLED FROM THE ROUTE TABLE, the same build artifact that makes a mount collision
a build error. So it cannot describe a handler that does not exist and cannot miss one that does,
and there is no registration step to forget — which is the property an authored spec cannot have.
* `info.title` and `info.version` are `APP_NAME` and `APP_VERSION`, derived config fields that already
exist, so the document has no version of its own to bump. `onOpenApi` overrides them where an API's
version is not the app's.
* PUBLISHING IS A DEPLOYMENT DECISION, WHICH IS WHY THE GATE IS AN ENVIRONMENT VARIABLE. The same
document is right in staging and wrong on a public edge, and a flag in code would have to be rebuilt
to change. `ABIDE_OPENAPI` mirrors `ABIDE_LOGS`; `abide openapi` writes the document whatever the gate
says, because a file on disk is not an exposed surface.
* THE COMPLETENESS CHECK IS A GENERATED CLIENT. The document is complete when a client generated from
it can express everything abide's own generated client can — the name, the args, the result and every
declared refusal. A generator that cannot reach a refusal by name is reading a document that
under-describes, and that is the gap to fix rather than a limit of the generator.

## MCP

The same route table as `## OpenAPI`, spoken to a model instead of to an http client. What differs is
not the derivation but WHAT THE PROTOCOL HAS TO SAY WITH: MCP separates a TOOL the model chooses to
call from a RESOURCE the host attaches without asking, and abide already knows which a handler is
— the two `Reactive` arms `GET` takes are exactly that distinction, so nothing here needs a flag to tell them
apart.

| Name | Type Signature | Description |
| --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint, served from the same `memo` shape `/__abide/openapi.json` is: the tool list is the route table, which is a build artifact. Gated by `ABIDE_MCP`, a closed one answering 404. Inside the app's own middleware like every `/__abide/**` address, so the rung that authorises a caller authorises a model with no second mechanism and no second notion of who is asking. |
| `abide mcp [--url <origin>]` | CLI | The same server over STDIO, for a model client that spawns a process rather than opening a socket. It is a BRIDGE, not a second implementation — it forwards to `/__abide/mcp` on a running app, sending `ABIDE_APP_TOKEN` as a bearer the way `abide logs` does, so there is one tool list and one auth path however the model arrived. |

### What one handler becomes

| The handler | Becomes |
| --- | --- |
| a `memo`, described | a TOOL — the model chooses to call it, and the result is one value |
| a `channel`'s read view | a RESOURCE with subscription. A room does not end, so a tool call that drained it would hang; `notifications/resources/updated` is the shape the protocol already has for a value that goes on arriving |
| a `channel`'s publish view | a TOOL, gated by that channel's `clientPublish` — the same gate the socket reads, so a model publishes on exactly the terms a browser does |
| a `GET` with flat args | ADDITIONALLY a resource template, `abide://rpc/<address>{?args}`. A `GET`'s args are FLAT by type, which is what a URI template can express and a `POST` body cannot, so the split falls out of the existing rule rather than being decided here |

A `GET` is both because the two surfaces are read by different things: a host attaches a RESOURCE to
build context nobody asked for, and a model calls a TOOL because it decided to. Publishing a read as
only one of them makes it unreachable to whichever half of the client the app needed.

### What a tool carries

| Piece | Comes from |
| --- | --- |
| Name | the mount path's segments and the export name, joined by `_`. A path is owned by exactly one handler and a collision is a build error, so a tool name is unique BY CONSTRUCTION |
| Description | `description`, and it is also the GATE — see below |
| Input schema | the argument schema, by the rules in `## OpenAPI` — the schema's own JSON Schema export where it has one, the type-derived form otherwise |
| Output schema | the result schema, so a model gets `structuredContent` rather than prose it has to parse back |
| Annotations | the method, which already means this: `GET` is `readOnlyHint`, `DELETE` is `destructiveHint` and `idempotentHint`, `PUT` is `idempotentHint`, `POST` and `PATCH` are neither, being neither safe nor repeatable. `openWorldHint` is NOT derived, nothing about a handler saying whether the thing behind it is a closed system |
| Errors | one per `Failed<Name, Data>` in `Failures`, carrying the NAME and the data. A model that can tell `NotFound` from `Forbidden` retries differently; one reading a sentence guesses |

### Expectations

* `description` IS NOT A GATE, and was briefly specified as one. Withholding an undescribed
handler would have made the absence INVISIBLE — a tool list is read for what is in it — and it
would have coupled two unrelated decisions, so an app could not document an operation for OpenAPI
without also handing it to a model. `clients.mcp` says the one thing and `description` says the other.
* AN UNDESCRIBED TOOL IS PUBLISHED THIN AND SAYS SO, warning on `abide:mcp` and naming the
handler. `description` is what a model reads to decide whether this is the call it wants, so a
tool without one is reachable and hard to choose — which is a quality problem an app should be told
about, not a reason to hide the tool and tell nobody.
* WHAT IS WITHHELD IS SAID OUT LOUD, on `abide:mcp`, naming the handler. A tool list is defined by
what is ABSENT from it as much as by what is in it, and an app wondering why a model never calls
something is otherwise reading a short list for a clue that is not in it.
* A STREAMING TOOL IS BOUNDED BY `timeout`, which already exists and already means this. An rpc over a
`memo` returning an `AsyncGenerator` drains into one result, and the bound on how long that may take
is the handler's own — so the hang has a limit that was declared rather than one invented here. A
`channel` is the unbounded case and is never a tool for reading, which is why the arms are split by what the
handler was declared OVER and not by the return type.
* THE MODEL IS AN ORDINARY CALLER. `/__abide/mcp` sits inside the app's middleware, so `principal` is
resolved for a tool call exactly as for a page, `ctx.args()` is parsed, coerced and validated exactly
as for a fetch, and a refusal is the same `Failed` the browser would have got. There is no model-shaped
authorisation path, which is the property worth having: a rung an app wrote once cannot be reachable
by a browser and missed by an agent.
* THE SCHEME IS DERIVABLE; THE REQUIREMENT IS NOT, as in `## OpenAPI`, and here it needs saying less
often because the transport carries it — a model reaching `/__abide/mcp` presented whatever the app's
rung demands before any tool was listed. So the tool list a caller receives is the list that CALLER
may see, and an unauthenticated model is not shown tools it would be refused.
* THERE IS NO SECOND TOOL LIST. `abide mcp` forwards rather than assembling, so a stdio client and an
http client cannot disagree about what exists — and a tool that appeared in one and not the other
would be exactly the drift this whole section exists to make impossible.
* IT IS NOT FOLDED INTO `abide start`, AND THE FIRST REASON IS STDIO ITSELF. MCP over stdio requires
that nothing but a protocol message reach stdout, where an interactive caller's whole job is writing
there — a banner, a prompt, a result, a log line. One stream cannot carry both, and the human end is
the one that cannot move off it.
* THE SECOND REASON OUTLIVES THE FIRST: WHOEVER SPAWNS A STDIO SERVER OWNS ITS LIFECYCLE. A model
client starts one per conversation and kills it at the end, so `abide start` in that position means
closing a chat window stops the app, two clients race for one port, and a reconnect restarts a server
nobody asked to restart — under `abide dev`, on top of the worker replacement that is already the
reload. The bridge is cheap and disposable PRECISELY SO THE APP DOES NOT HAVE TO BE. `abide start`
SERVES; the interactive caller and the model are both CALLERS of something already running, and
neither is the app.
* THE INTERACTIVE CALLER AND THIS ARE ONE MECHANISM, differing only in what is on the other end of the
pipe — a person, or a JSON-RPC client. Same route table, same middleware, same `principal`, same
refusals; only the framing changes, the way one rpc address carries jsonl and sse. Implementing them
twice is the drift this section exists to make impossible, so the CLI surface is where the framing is
CHOSEN and not where a second client is written.

# Ambient values

## `nonce`

| Name | Type Signature | Description |
| --- | --- | --- |
| `nonce` | `() => string` | This request's CSP nonce, built on first ask and the same for every later one. 16 bytes of `crypto.getRandomValues`, base64url. What `csp()` names in the header and what the render stamps on abide's own inline output. |

## `bag`

| Name | Type Signature | Description |
| --- | --- | --- |
| `bag` | `() => Map<string, unknown>` | A bag of values carried for the life of one request. |

## `cookies`

| Name | Type Signature | Description |
| --- | --- | --- |
| `cookies` | `() => CookieMap` | The cookies of the request being served, live and mutable — Bun's own `CookieMap`, so `set` takes attributes and there is no abide API to learn. |

### Expectations

* ISOMORPHIC. On a server it is `Bun.CookieMap` and writes are collected onto the response
(`toSetCookieHeaders()`); in a browser it is the same interface over `document.cookie` and each write
is immediate. Setting a cookie on the client sets a cookie. Unlike `principal.set` there is no
headers-are-out failure in a browser, there being no header to be out of.

```ts
cookies().set('theme', 'dark')                                  // both sides — path=/, sameSite=lax
cookies().set({ name: 'cart', value: id, maxAge: 604800 })
cookies().delete('cart', { path: '/' })
```

* `secure` DEFAULTS FROM `NODE_ENV`, not from Bun's `false`. An app's own cookie should not be quietly
weaker than the two abide sets, and a default that differs between the framework's cookies and the
app's is the kind of asymmetry nobody reads the docs to discover. `path` and `sameSite` are Bun's
(`/`, `lax`).
* TWO ASYMMETRIES, both stated rather than smoothed over, because a map whose contents differ by side
is something an app will otherwise branch on. `HttpOnly` cookies are INVISIBLE to the client map —
`cookies().get('abide-principal')` is the sealed text on a server and `undefined` in a browser, which
is the flag working rather than a gap. And `document.cookie` cannot set `httpOnly`, so a client-side
`set({ httpOnly: true })` THROWS: silently dropping the flag reads to the caller as a cookie script
cannot touch, which is the same silent-success failure `principal.set` throws to avoid.

## `request`

| Name | Type Signature | Description |
| --- | --- | --- |
| `request` | `() => Request` | The request being served. |

### `Expectations

* Throws outside a `request`

## `route`

| Name | Type Signature | Description |
| --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are. ONE `URL` instance per navigation, built when the route resolves rather than per read, so its identity only moves when the location does. |
| `route.params` | `Reactive<Params>` | `Params` defaults to `Record<string, string>` — a segment is text — and is generic so a generated per-route type has somewhere to land. `[[optional]]` omits its key. |
| `Params` | `Record<string, string>` | What a matched route's segments are, a segment being text. The default for `route.params`'s parameter, so a generated per-route type has somewhere to land. |
| `route.name` | `Reactive<string>` | The resolution path, eg `/admin/[tab]`. |
| `route.navigating` | `Reactive<boolean>` | Whether one is in flight. |

### Expectations

* `route` is NOT a reactive value whose value is a Route — its MEMBERS are reactive values. They change at different rates and are read separately, so a composite would wake every reader of the url twice per navigation for a spinner's sake, and rebuild an object nobody asked to be rebuilt. The rule generalises: split a composite into member states when its members move at different rates and readers read them apart; a thing read whole and written whole stays whole.

* PAGE routes are resolved under `src/ui/pages/` — `route` itself spans pages, rpcs and sockets alike
* A route is created where a `page.abide` file lies under that path
* The file path determines its url, so `src/ui/pages/admin/[tab]` would resolve `${APP_URL}/admin/foo`
* Params passed through `[param]` `[[optional]]` and `[...rest]`.
* `Route.name` is the resolution path eg `/admin/[tab]`.

## `online`

| Name | Type Signature | Description |
| --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the client currently has connectivity. |

### Expectations

* Uses browser api to verify on the client
* Always true on server, so a document rendered for an offline client says `true` and the first client read corrects it. That correction is an ordinary state change, not a hydration mismatch

## `trace`

| Name | Type Signature | Description |
| --- | --- | --- |
| `trace` | `() => string` | The trace id — the OPERATION this work belongs to. Built on first ask and held for the request. |
| `trace.span` | `() => string` | THIS hop's span id, minted per request. abide mints exactly one span per hop and models no span tree. |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. A trace that STARTS here is `03`. |
| `trace.state` | `() => Map<string, string>` | `tracestate`, live and mutable. Untouched, the inbound text propagates byte for byte. |
| `trace.headers` | `() => Record<string, string>` | What an outbound REQUEST carries: `traceparent` naming our span as parent, plus `tracestate`. Attached automatically by `remote`; an explicit one is not overruled. |
| `trace.responseHeaders` | `() => Record<string, string>` | What a RESPONSE carries: `traceresponse` with our span as parent-id. Set on every response abide builds. |

## `server`

| Name | Type Signature | Description |
| --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server — `requestIP`, `publish`, `pendingWebSockets`, `stop`. Throws before anything has served. |

## `health`

| Name | Type Signature | Description |
| --- | --- | --- |
| `health` | `Reactive<Health>` | The account of the app this call is IN. A `Reactive` like `route`'s and `principal`'s members, so `{health.uptime}` reads in a template under the short-circuit rule and `await health` still gives the settled document. Seeded like an rpc. |
| `Health` | `{ reachable: boolean; version: string; startedAt: string; uptime: number }` | The account itself — the baseline below, with whatever `onHealth` merged over it. |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter: fields merged OVER the baseline. Returns the way off again. |

### Baseline fields 

| Name | Type | What it says |
| --- | --- | --- |
| `reachable` | `boolean` | Whether the account arrived at all. The ONLY field a caller that reached nothing writes down. |
| `version` | `string` | The app's version, off the same package.json its name comes from. Empty rather than absent. |
| `startedAt` | `string` | When the process started, ISO-8601. |
| `uptime` | `number` | ms since `startedAt`. Derivable, and present so no consumer has to do the subtraction. |

### Expectations

* `GET /__abide/health` returns `Health` over HTTP. Answered OUTSIDE the middleware, because the load balancer asking presents no credentials — so it is unauthenticated, and whatever `onHealth` merges is public.
* Seeded like an rpc, as `principal` is: a page that reads `health()` leaves it in the seed buffer for the client's own `GET /__abide/health`, one that does not ships nothing.
* An app's fields win every collision, `version` included.

## `principal`

| Name | Type Signature | Description |
| --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses, ISO-8601. Absent on an anonymous caller. |
| `principal.error` | `Reactive<Failed \| undefined>` | The app's resolver failing. A caller carrying one is never authenticated. |
| `principal.resolved` | `Reactive<unknown>` | What `onPrincipal` RETURNED, merged over the baseline. Named for the output rather than the input: `claims` are the proof in the cookie and are what `onPrincipal` RECEIVES, so a member holding what it handed back cannot be called that too — see "THREE THINGS". ONE state rather than members, because what an app resolves is arbitrary and there is nothing static to split. |
| `principal.caller` | `Reactive<string>` | WHICH BROWSER, as against who they are: the `abide-caller` handle, present whether or not this caller authenticated. SERVER-ONLY — it is not in `Principal`, and it throws in a browser, since the one client-side use for a stable per-visitor id is the fingerprinting the handle must not become. It sits beside `claims` because both are facts about the party asking, differing only in whether that party proved anything. |
| `principal.set` | `(claims: unknown) => Promise<void>` | Authenticate this caller: `claims` are sealed into the `abide-principal` cookie and every response this request builds carries it. THROWS when the sealed cookie would exceed the ceiling, naming the byte count, and THROWS ONCE THE HEADERS ARE OUT — a page that has begun streaming has no `set-cookie` left to write. Both are the same failure: silently not setting one reads to the caller as signed out with nothing written down. Throws in a browser. NOT REACHABLE FROM A PAGE: the head flushes as early as it can, so a component's setup is already past the point a `set-cookie` can be written. Authentication happens in the app's `middleware`, in the app's own route, or in an rpc handler, and the page that follows is a `redirect()` — which is the redirect-after-login shape anyway. |
| `principal.clear` | `() => void` | Sign this caller out, for the rest of THIS request as well as the next one, and ROTATE the `abide-caller` handle — signing out hands the browser back. Server-side, like `set`. |
| `Principal` | `{ authenticated, expiresAt?, error?, …claims }` | The WIRE document, which is what `GET /__abide/principal` answers with. It is not how the API is read. |

### Baseline fields

What abide supplies whoever the caller is and whatever `onPrincipal` returns. Three, and an app adds
to them rather than replacing them.

| Name | Type | What it says |
| --- | --- | --- |
| `authenticated` | `boolean` | Whether this caller presented a seal the server accepted. Never absent, `false` for a visitor with no cookie. |
| `expiresAt` | `string \| undefined` | When the seal lapses, ISO-8601. Absent on an anonymous caller, there being no seal to lapse. |
| `error` | `Failed \| undefined` | The app's resolver having failed. Present only then, and a caller carrying one is never `authenticated`. |

What `onPrincipal` resolved is the app's half, and the wire document is the baseline with it spread
alongside — so `principal.resolved()` reads that and nothing of the baseline.

### Expectations

* MEMBERS ARE STATES, as `route`'s are, and for the same reason: `expiresAt` moves on every rolling re-seal while `authenticated` does not, so a nav bar reading whether someone is signed in should not wake twice a fortnight for a seal it never looks at.
* The four IDENTITY members share ONE resolve per request — the resolution is the document's, not each member's — so they settle together and two asks never cost two resolves. `caller` is not among them: it is read off its own cookie or minted, needs no resolution, and is available on a request that never asks who anyone is.
* `caller` SURVIVES SIGN-IN, which is what makes an anonymous cart keyed on it become the account's cart with no merge step. It does not survive sign-out, nor the browser session, so it is a handle for THIS browser for THIS session and never a durable user key: anything meant to outlive either is keyed on what the claims identify instead.
* THREE THINGS, not one. CLAIMS are the proof, and the only thing in the cookie: an IDENTIFIER for whoever this is, and a VERSION to check it against — a couple of hundred bytes sealed, and nothing that grows ever goes in. abide does not name either field; claims are `unknown` by contract and the app picks the spelling, `onPrincipal` being what reads them. The PRINCIPAL is what `onPrincipal` resolves that proof into, and is PUBLIC BY DEFINITION — it is what `GET /__abide/principal` answers and what the seed buffer hands a client — so anything server-only the resolver derived belongs in `bag()` instead. SESSION is app data addressed by that identifier, behind an ordinary rpc, and belongs in neither. The cookie stays small because nothing that grows is in it, and the version is what buys revocation sooner than `ABIDE_PRINCIPAL_TTL`: `onPrincipal` compares the sealed one against what it has stored and fails closed on a mismatch, so bumping the stored value invalidates every live cookie for that caller on its next request — no session store and no revocation list, at one lookup per request.
* SEEDED LIKE AN RPC, not embedded unconditionally. A page that never reads `principal` ships none of it and a later client read is an ordinary `GET /__abide/principal`; a page that reads it goes through the same seed buffer any rpc uses, so the client's first read costs no round trip. One entry for the whole document, the four members already sharing one resolve.
* THE BASELINE WINS EVERY COLLISION, which is the opposite of `health` and for a reason worth naming:
`health` is an app describing itself, so its own account of its `version` beats a derived one, but
`authenticated` is abide's DETERMINATION about a seal it verified, and an app that could overwrite it
by returning a field of that name would authenticate a caller by accident. A claim colliding with a
baseline name is dropped and warned on `abide:principal`.
* Never null. An anonymous visitor is `authenticated` false, not an absent document.
* `GET /__abide/principal` returns `Principal` over HTTP. Open — the answer is composed from the caller's own cookie — and `no-store`.
* Sealed by an HMAC over the claims and their expiry. Signed, not encrypted — the claims are readable by whoever holds the cookie, and `HttpOnly` keeps script out, not the person.
* STATELESS: abide keeps no server-side store and no revocation list of its own, so a ban takes effect within `ABIDE_PRINCIPAL_TTL` unless the claims carry the version described above for `onPrincipal` to check. The one lookup per request that costs is the app's to pay — abide does not pay it for them.
* Cookie is set with `HttpOnly`, `SameSite=Lax`, and `Secure` in production only
* A bad signature, a lapsed seal and a malformed cookie are ONE answer: this caller is anonymous
* Resolved at most once per request; what is held is the document or the promise, so two asks share one resolve
* ROLLING: the seal is refreshed once half spent, so an idle session still lapses on schedule
* `clear` ROTATES the `abide-caller` id and `set` does NOT, and the asymmetry is what each operation
means rather than a blanket practice: signing in is continuity — the same browser, now named — while
signing out hands the browser back, and the next person at a shared machine should not inherit what
the app keyed on the old handle. The two cookies stay separate: `abide-principal` is a claim about
WHO, `abide-caller` is a handle for WHICH BROWSER, and it says nothing and outlives nothing

## `config`

| Name | Type Signature | Description |
| --- | --- | --- |
| `config` | `<Extra extends object>() => Config & Extra` | Every field of `Env` is present. THROWS what `onConfig` threw and what its schema refused, and THROWS IN A BROWSER — `Env` holds `ABIDE_PRINCIPAL_SECRET` and `ABIDE_APP_TOKEN`, so nothing about it reaches a client implicitly. An app that wants some of it public declares a `GET` that returns those fields. |
| `Config` | `{ …Env }` | The resolved document: every field of `Env`, plus whatever `onConfig` defaulted and the schema normalised. |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion — what `ConfigDefaults` receives. |
| `config.invalidate` | `() => void` | Re-reads the environment and re-runs `onConfig`, for a value that moved under a running process — a rotated secret, a port a dev hop pinned. Unlike boot, a refused schema does NOT fail hard here: the server is already serving, so the previous document stands and it warns on `abide:config`. |
| `onConfig` | `<Extra>(fn: ConfigDefaults \| null, options?: ConfigOptions<Extra>) => () => void` | The app's DEFAULTS: `fn(env)` returns fields merged UNDER what was declared. Takes effect on the PATH, not just the document. |
| `ConfigDefaults` | `(env: Env) => unknown` | Synchronous by contract. Whatever it names becomes overridable by a variable of THAT NAME. |

### `ConfigOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Extra>` | The same `Schema` a transport handler takes, checked LAST over the whole document. It normalises as well as refuses. |

### Expectations

* Precedence: derived (`APP_NAME`, `APP_VERSION`, `APP_DATA_DIR`) < `config` from user < env
* A value out of the environment is coerced to the type of the default it overrides; a value that will not coerce keeps the default. Anything richer stays the raw string for a schema to convert
* `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` are derived if not in the config.
* A second `onConfig` REPLACES the first, schema included, and warns on `abide:config` — one of the two hooks that replace rather than compose, see "Lifecycle hooks"
* a hook that throws fails HARD and server isnt started

# Helpers

## `log`

A LOG IS A `channel`, and the resemblance is why. Both publish, both retain a bounded ring, both are
subscribed to, and both replay what they retained and then go live — `abide logs` was already
specified as "the ring replayed, then every line as written", which is the cursor contract at
`s.tail` word for word. Two implementations of one mechanism is what that costs, so `log` is DEFINED
over the primitive: every line is a `publish`, the retention is that room's `tail`, and
`GET /__abide/logs` is the read view a `GET` over a channel already is.

What this is NOT is a performance change. The share is a ring push and a version bump against a call
whose cost is dominated by the write to stdout, so the claim is machinery — one mechanism rather than
two — and the per-line ratio is owed before anything faster is said.

| Name | Type Signature | Description |
| --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message on the default channel, `<app name>`. Always writes — an app's own output needs no env var. |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | The four levels. `warning` and `error` always write on every channel, and go to stderr in every format. |
| `log.channel` | `(name: string) => Logger` | A named channel, prefixed `<app name>:`. Calling it again appends another segment; the same name hands back the same logger. |
| `Logger` | `typeof log` | What `log.channel` hands back: the same four levels and the same `enabled`, writing on that channel. The default channel is one of these, so there is no second shape to learn. |
| `log.enabled` | `() => boolean` | Whether a gated line on this channel would be written. For a call site whose MESSAGE costs something — an argument is built before the gate can refuse it. It takes no LEVEL because `DEBUG` gates channels and not levels; `warning` and `error` writing on every channel is a separate rule and not one this reports on. The app's own channel answers `true`. |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; channel: string; message: string; trace: string \| null }` | ONE LINE, and the `Message` the room carries. The same five fields the formats already agree on, so a record is not a second shape beside the line — `channel` is a FIELD, which is why a named channel is a stamp on the record rather than a room of its own. |
| `log.records` | `Room<LogRecord>` | THE ROOM every line is published to, and an ordinary one: `[...log.records.tail()]` is what is retained, `{#for await line of log.records}` is a viewer inside the app, and `log.records.tail(100)` replays a hundred and goes live. There is nothing to reach for the feed through — a page that wants a log pane subscribes to the same room `GET /__abide/logs` serves. |

### abide's own log channels

| Channel | Level | What it says |
| --- | --- | --- |
| `abide:request` | `debug` | `<method> <path> <status> <n>ms`, once per request. |
| `abide:socket` | `debug` | `socket <path> <published \| rejected \| subscribed \| unsubscribed> <n> subscribed`, once per message. |
| `abide:lifecycle` | `debug` `error` | `<lifecycle> <success \| failed> <n>ms` when a lifecycle is run. |
| `abide:principal` | `debug` `warning` | `principal <authenticated> <success \| failed>` when the principal is set or cleared; a claim colliding with a baseline name; a second `onPrincipal` replacing the first |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object |
| `abide:mcp` | `debug` `warning` | A handler withheld by `clients.mcp`, and a tool published with no `description` for a model to choose it by |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export, so the type-derived superset published instead — naming the handler and the schema's vendor |
| `abide:config` | `warning` | A second `onConfig` replacing the first |
| `abide:render` | `warning` | An `error.abide` that itself failed, so the boundary escalated past it — abide's own minimal document is what answered |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw, and the watch it stopped |
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane: a mismatched sink rebuilt, a route whose chunk did not arrive |

### Expectations

* `DEBUG` in `config` Gates named channels in debug-npm grammar (`abide:*`, `docs:cards,docs:db`, `*`, `*,-abide:*`). Read from the environment on a server and `localStorage.debug` in a browser.
* A message is one line and one line is one `LogRecord`: the five fields are the whole shape in every
format, with tabs and newlines escaped. The trace is the operation the line was written in, `null` on
a client and outside a request, and always present.
* `ABIDE_LOG_FORMAT` decides logging format: `tsv` or `json`. Unset, the shape follows the TTY, with `NO_COLOR` forcing
`tsv` and `FORCE_COLOR` forcing the readable form off one.
* THE GATE PRECEDES THE PUBLISH, not just the write. `log.enabled` closed means no record is built and
none is published, so a closed channel costs a call and a boolean rather than a ring push per line —
and the feed carries exactly what `DEBUG` opened, which is what the bespoke ring did too. `warning`
and `error` are enabled on every channel, so they publish and they reach stderr.
* THE SINK IS PER SIDE AND IS NOT THE ROOM'S BUSINESS. A published record is also written — stdout or
stderr on a server, the console in a browser — and that write is what `ABIDE_LOG_FORMAT`, `NO_COLOR`
and the TTY decide. The room holds records; the sink renders them.
* THE ROOM IS BUILT ON FIRST PUBLISH, as every room is, so `log` WORKS BEFORE CONFIG RESOLVES. A line
written inside `onConfig` or `onStart` is an ordinary publish, and the `<app name>` prefix is applied
by the SINK rather than at publish time — a record carries the channel segment it was written on, so
nothing about a line depends on a document that may still be throwing.
* `GET /__abide/logs` IS A `GET` OVER THAT CHANNEL, not an endpoint of its own — so it is jsonl by
default and sse on `Accept`, carries `vary: accept`, and goes through the app's `middleware` like
every other `/__abide/**` address. `ABIDE_LOGS` decides whether it is DECLARED; closed, the address
is unmounted and answers 404 as any other unmounted method does.
* A DROPPED FEED RESUMES WITH NO GAP AND NO DUPLICATE, which the bespoke ring could not do. Every
record carries the room's `seq` and the room carries an epoch, so a reconnecting `abide logs` hands
back its last `seq` and takes the tail from there — and a restarted app is a moved epoch, announced
as a reset rather than replayed silently as new lines.
* IN A BROWSER IT IS THE SAME ROOM, the process being the tab. What is absent there is the http read
view and `abide logs`, there being no server to serve them; the console is the sink. Same callable,
same name, same room — what differs is where a record is written and who can ask for one.

## `csp`

| Name | Type Signature | Description |
| --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | One rung. Sets `content-security-policy` on `text/html` answers only — a policy on a JSON refusal is a header nothing reads. |

### Expectations

* OPT-IN, because every directive can break an app that had a reason abide cannot see.
* abide's own inline output is covered by BUILD-TIME HASHES rather than by a nonce. There are exactly
two executable inline strings — the bootstrap defining the sink filler, and the filler call — and both
are byte-invariant once per-sink data lives in template ATTRIBUTES, so `script-src` carries a
`'sha256-…'` for each. The one inline DATA block is the SEED MANIFEST — `(method, address, args)`
triples, never response data — and a `<script type="application/json">` never reaches "prepare the
script", so `script-src` does not govern it at all.
* So NOTHING IN THE HEAD CONSUMES A NONCE, which is what lets the shell head stay cut once at boot. The
nonce lives in the header `csp()` builds per response; an app's own inline script — reachable only
through `{raw()}`, a `<script>` in a `.abide` file being setup rather than output — stamps it in the
BODY, which renders per request anyway.
* `sources` REPLACES a directive rather than adding to it, so what you pass is what it says; an empty
array drops it; a name the baseline lacks is added.
* The baseline: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`,
`font-src 'self'`, `connect-src 'self'`, `style-src-attr 'unsafe-inline'`, `object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
* `script-src` carries no `'unsafe-inline'` — it does not need one, and a browser honouring a hash or a
nonce ignores `'unsafe-inline'` anyway, which is the mechanism that makes an injected `<script>` fail
while abide's own runs. `style-src-attr` is the one weakened line and is weakened deliberately: a `style=`
attribute cannot carry a nonce, and a `style=` is where a value COMPUTED AT RUNTIME belongs. An app
with none passes `'style-src-attr': []`.
* There is NO `<style>` in the head at all, nonced or otherwise — a component's styles are a
content-hashed sheet the head LINKS, which `style-src 'self'` covers without a nonce and without a
hash list. See "Script / style blocks".

### Example

```ts
csp()
csp({ 'connect-src': ["'self'", 'https://api.stripe.com'] })  
csp({ 'style-src-attr': [] })
```

## `url`

| Name | Type Signature | Description |
| --- | --- | --- |
| `url` | `<P extends string>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query] : [queryParams?: Query]) => URL` | Builds a URL. ONE signature: the arity is DERIVED FROM THE LITERAL rather than discriminated at the call, so `ParamsOf<'/admin/[tab]'>` is `{ tab: string \| number }` and a missing `tab` is a compile error. A path that is only `string` at compile time degrades to `(url, queryParams?)` and is discriminated at runtime by whether the pattern contains `[`. |
| `HasParams<P>` | `boolean` | Whether the literal `P` carries a `[segment]`, which is what decides `url`'s arity at the call rather than at a discriminated overload. |
| `ParamNames<P>` | `string` | The union of segment names in `P` — `ParamNames<'/admin/[tab]'>` is `'tab'`. |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half, always last. |
| `ParamsOf<P>` | `Record<ParamNames<P>, string \| number>` | A segment is stringified, so a param is text or a number — never an object, which would arrive as `[object Object]`. |

### Expectations

* `queryParams` arity arg is omitted if the path doesnt have a param `[tab]` `[[optional]]` or `[...rest]`
* `/users/[id]` root-absolute PATTERN — the shape an app writes
* `bar`, `./bar`, `../bar` means relative to where the caller IS
* `?tab=x` this page, another query
* `''` where the caller is | `/v2/users/42`
* `https://foo.bar/x` another origin `https://foo.bar/x` **no base**, it is not this app
* `https://this.app/x` this origin
* `//host/x` protocol-relative — an ORIGIN, not a doubled slash
* `mailto:…`, `tel:…` opaque unchanged

## `navigate`

| Name | Type Signature | Description |
| --- | --- | --- |
| `navigate` | `(url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }) => Promise<void>` | Navigates
 to a URL. |

### Expectations

* Follows same url resolution expectations as `url` helper

# .abide files

## Example

```html
<script module>
import { state } from 'abide'
// module-level setup
const loadsPerId = state<Record<string, number>>({})
</script>

<script>
// instance level setup
import { state, memo, props, route, url } from 'abide'
import { getData, getLongData, getDataStatusEvents } from '#server/rpc/data'
import { chat } from '#server/sockets/chat'
const { id: dataId, start = 0 } = props<{ id: string, start?: number }>()
let count = state(start)
let message = state('')
let clicker = state<HTMLButtonElement>()
const currentUrl = memo(() => route.url)      // return position holds → ADOPTS route.url
const doubled = memo(() => count * 2)
const dataArgs = memo(() => ({ id: dataId }))
const data = memo(() => getData(dataArgs))
const longData = memo(() => getLongData(dataArgs))
const events = memo(() => getDataStatusEvents(dataArgs), { tail: 50 })
const name = memo(() => data.name)            // member off a `Reactive` reads → TRACKS
const room = chat(dataArgs)

count.watch((value) => void loadsPerId[dataId] = value)

function click(event: MouseEvent) {
  count += 1
} 

function disableWhenClicked(element: HTMLButtonElement) {
  element.disabled = true
  return () => element.disabled = false
}

function say() {
  room.publish({ message })
}
</script>

<style>
/* component scoped css */
h1 {
    font-weight: bold;
}
</style>

{#component Event<{ time: string, message: string }>({ time, message })}
    <dt><slot>{time} ago</slot></dt><dd>{message}</dd>
{/component}

<h1>{name} {data.refreshing() ? 'Refreshing...' : ''}</h1>
{#if data.full}
    {#await longData}
        Loading full data...
    {:then result}
        <script>
            // branch-local <script>
            const json = memo(() => JSON.stringify(result, null, 2))
        </script>
        <style>
            /* branch local style */
            pre {
                font-face: monospace;
            }
        </style>
        <pre>{json}</pre>
    {:catch error}
        {#if data.isError(error, 'DataAccessDenied')}
            <p>Access denied to data. Must be in group {String(error.data.group)}.</p>
        {/if}
    {:finally}
        <p>Long data replied</p>
    {/await}
{:else if data.summary}
    <p>{data.summary}</p>
{:else}
    <p>No information is available right now.</p>
{/if}
<h2>Stats</h2>
<ul>
    {#for stat of data.stats by stat.name}
        <li>{stat.amount + 1}</li>
    {/for}
</ul>
<h2>Events</h2>
<p>Latest event: {events}</p>
{#for await event of events.tail(50)}
    <Event {...event}><b>{`${event.time}ms`}</b></Event>
{/for}
<button onclick={click} bind:element={clicker}>counts {count}={doubled / 2}</button>
<button onclick={() => data.refresh()} bind:element={disableWhenClicked}>Refresh data</button>
<button onclick={() => data.invalidate()}>Mark data stale</button>
<h2>Chat</h2>
<p>Latest message: {room}</p> 
<ul>
    {#for await { message } of room.tail(100)}
        <li>{message}</li>
    {/for}
</ul>
<a href={url('/data/[id]', { id: dataId }, { from: route.url })}>See more</a>
```

## Reading and writing by name

Inside a `.abide` file a reactive value is read and written by NAME: `foo` where a `.ts` file writes `foo()`,
and `foo = bar` where it writes `foo.set(bar)`. The sugar is OVER the explicit form, never instead of
it — both spellings compile, in every script in the file.

A name denotes two things, and ONE RULE says which. A reactive value is the `Reactive` in two positions — an
IDENTIFIER BINDING, and any position whose contextual type is `Reactive<…>` or ABSENT. It is READ
everywhere else: operands, text, attribute values, a COMPONENT TAG'S HEAD, destructuring patterns, and
arguments to anything typed as the value. A CALL is outside the sugar and evaluates to whatever it returns, which
is why `memo(() => getData(args))` adopts with nothing added.

It reaches a reactive value behind a NAMESPACE the same way, which is what makes the ambient values ordinary:
`route.url`, `route.navigating`, `principal.authenticated` and `online` are reactive values, so
`{route.navigating ? 'Loading…' : ''}` READS in the operand and `memo(() => route.url)` HOLDS in the
return. `route` and `principal` are not reactive values themselves, so `principal.set(…)` is the
namespace's own method and never collides with a member of the value.

The rule is chosen so that HOISTING IS A NO-OP. `memo(() => route.url)` and `memo(() => { const u =
route.url; return u })` are the same memo, because a binding holds and a return holds; under a rule
where the binding READ, lifting a subexpression into a local would silently turn adoption into
tracking and cost the caller its probe forwarding, with the output still plausible. That failure is
the one the whole design is arranged against, so it decides the rule.

| Form | Means |
| --- | --- |
| `foo` in an operand, text, attribute or value-typed argument | A live reactive READ |
| `const x = foo` / `return foo` / a `Reactive<…>`-typed argument | The `Reactive` — no `$` needed. This is what makes adoption free |
| `foo = bar` where `bar` is a `Reactive` | A COMPILE ERROR naming both repairs: `memo(() => …)` where the name should follow a different `Reactive` over time, `foo = bar()` to copy the value once |
| `foo = bar` | A write |
| `foo.bar = v` | A write THROUGH A PATH: copy-on-write down the path, then `set`, so identity moves and readers wake |
| `foo.push(v)` | The same, where the TYPE resolves the call to a known mutator |
| `foo.bar` | The VALUE's `bar`. Not called, so never the `Reactive` API — `data.error` and `data.success` and `data.status` are the payload's, today and after anything is added |
| `foo.bar(…)` | The `Reactive` API where `bar` is one of its members, otherwise the value's method |
| `foo.$` | The `Reactive` itself, and the ONE reserved name. Not a handover — a binding, a return and a `Reactive<…>`-typed position all do that. What is left is the COLLISION escape: `data.$.error()` is the probe where the payload has its own `error` field, and that one use is what pays for reserving the name, since it is what makes the row above it safe to promise |
| `foo()` / `foo.set(v)` | The explicit forms, which keep compiling. `foo()` takes NO arguments |

### Expectations

* EVERY `Reactive` MEMBER IS CALLABLE — `set`, `peek`, `tail`, the probes, `invalidate`, `refresh`,
`watch`. That invariant is what keeps bare `foo.bar` unconditionally the
value, so adding a member later cannot silently reinterpret an app's payload field. A member that
would have to be read as a property does not get added; it becomes a call.
* What is left is a payload whose field is a FUNCTION named as a member is. Both directions are
spellable: `data.$.error()` is the probe, `data().error` is the field. Where types exist the compiler
makes the collision an error rather than a choice.
* `state.share` HANDS BACK THE ONE THAT WON, which may not be the one your `create` made, so the return value is the only name to use: `const message = state.share('chat', () => state(''))`. Building the `Reactive` OUTSIDE the call and passing it in is what makes that go wrong silently — the local name goes on being read by the module that made it while every other module reads the shared one — and the thunk is what keeps the loser's `Reactive` from being built at all.
* `foo.$` on something that is not a `Reactive` is a compile error, not `undefined`. `$` is a getter
on the `Reactive` returning itself — not something installed on the payload, which is what makes it
work for a `Reactive<number>` and a `Reactive<null>` and what keeps it out of anything that enumerates or
stringifies the value.
* A template-local binding SHADOWS a reactive value of the same name for the body it is bound in —
`{#for await { message } of room.tail(100)}` inside a file that also has a `message` state.
* MEMBER ACCESS ON A `Reactive` SHORT-CIRCUITS. Where the compiler knows the receiver is one, `foo.bar` lowers to `foo()?.bar` — so an in-flight read is `undefined` rather than a TypeError, and the whole chain after it short-circuits with it, `foo.items.map(f)` included. That is what makes the `??` forms read the same everywhere: `{data.name ?? 'Loading'}` in a slot, `{#for stat of data.stats ?? []}` over a block. An `{#for}` over `undefined` iterates zero times rather than throwing, which is the same rule seen from the block side. `pending()` is still what separates in-flight from a value that RESOLVED to `undefined`.
* AWAIT OVER AN EXPRESSION IS THAT SAME LOWERING WITH ONE TERM REPLACED: inside an `await` operand a read emits `(await foo)` where it would otherwise emit `foo()`, so `{await invoice.total}` is `(await invoice)?.total` and `{await invoice}` is `await invoice` unchanged. Without it the operand lowers to `await (invoice()?.total)` — `await undefined` while the value is in flight, which renders an empty hole, blocks nothing, and TYPECHECKS, `await` over a non-thenable being legal. That is the failure with nothing to catch it, and it is what decides the rule.
* THE READS ARE STARTED BEFORE THEY ARE AWAITED. `(await a)?.x + (await b)?.y` never touches `b` until `a` settles, so a second load does not begin until the first one ends and two independent loads serialize behind one hole. The read set is syntactic, so the lowering emits it as one `Promise.all` — which is the same "start all asynchronous work up front" the render already owes.
* ONLY A DEFINITELY-EVALUATED READ IS HOISTED INTO THAT SET — not one under `?:`, not the right operand of `&&` / `||` / `??`, not one inside a nested function. `{await (flag ? a.x : b.y)}` hoisted whole would START and BLOCK ON a load the expression would never have performed. Those lower in place and serialize, which is the correct trade: a read that might not happen must not be started.
* A `Reactive` is thenable, so a payload carrying its own `then` breaks `await` on it. That is inherent to
`await s`, not to the sugar.
* A write through a MEMBER PATH — `foo.bar[k] = v` — compiles to a copy down that path plus a `set`,
so identity moves and readers wake. THE COPY IS THE POINT, not an implementation detail to optimise
away: a `tail` past the default is for REPLAYING past values — an undo stack is the shape — and
replaying a value that was mutated underneath you replays nothing. Mutating in place and bumping a
version would be O(1) per write and would leave `tail` holding N references to one object. What it
COSTS is a copy per write, so `for (const row of stream) rows.push(row)` is O(n²) and is the wrong
shape for a stream: `foo().push(v)` is the unlifted O(1) escape — a read hands back the array, and
pushing to it plainly wakes nobody — and a stream of items wants a `Reactive` whose VALUE is the item. So does an in-place mutator the TYPE resolves: `push`, `splice`,
`sort`, `reverse` on an array, `set` / `delete` / `clear` / `add` on a Map or Set. The lift is
TYPE-directed, never name-directed — a name is a summary of the truth, and a payload carrying its own
`push` would be silently copied — so where the type does not resolve the call it is REFUSED rather
than guessed, and `foo().push(v)` is the explicit unlifted escape — a read hands back the array, and
pushing to it plainly is exactly the thing that wakes nobody. This is the machinery `bind:`
already needs, member paths being lvalues there, so it is one mechanism widened rather than a second
one. It reaches an ALIAS, since an identifier binding holds the `Reactive`: `const a = foo` then
`a.push(v)` is the same lift `foo.push(v)` is.
* `foo(...)` is always the READ and takes zero arguments; any argument is a compile error. A reactive value
whose value is a function is `foo()(x)` — the read, then the call — or `foo.peek()(x)` where the
caller does not want to join the flow. A reactive component never meets this, `<C/>` being a tag
rather than a call.
* THREE DIAGNOSTICS, and each guards a failure that leaves the output looking right. DESTRUCTURING a
`Reactive` reads it, so `const { name } = data` is a DEAD snapshot sitting beside a live `data.name` —
detectable in syntax, so it warns. A `Reactive` reaching a wire or `JSON.stringify` out of an
UNANNOTATED literal — `const args = { id, user }` holds `user`, where an `Args`-typed property would
have read it — warns at the crossing rather than at the literal, that being where it is wrong. And
where INFERENCE FAILS the compiler READS: valid TypeScript or JavaScript has to compile, so a lost
adoption is the accepted cost and refusing the file is not.

## Templating

### Expressions

| Form | Meaning |
| --- | --- |
| `{expr}` | Reactive text (escaped) |
| `{await expr}` | await in an expression means block rendering until resolved, and it governs the whole EXPRESSION rather than a name — every reactive read inside it blocks, so `{await invoice}`, `{await invoice.total}` and `{await a.x + b.y}` are one rule and the bare name is its degenerate case. See "await over an expression" under "Reading and writing by name". Over a STREAM that means until the stream CLOSES, the same way it means until a value settles — one rule, and a source that never closes holds forever, which is the author's to resolve rather than abide's to special-case. |
| `{raw(...)}` | Raw HTML |
| `name={expr}` | Reactive attribute or property (whole-value expression) |
| `on<event>={fn}` | Native listener on an ELEMENT. On a **component** the same syntax is an ordinary prop named `onclick` |
| `name="…{expr}…"` | Quoted values interpolate too, also on component props; a literal brace can appear in a string. |
| `bind:value` | Two-way bind — read the property, write back on input/change. |
| `bind:prop={state}` | On a COMPONENT, adds the write path to a prop. `count={total}` already reads live; `bind:count={total}` also writes back. It needs an LVALUE — a state name, a member path, or the `{get, set}` pair — since `bind:count={total * 2}` has nothing to write to |
| `bind:checked` | Boolean bind on an `<input>` — a boolean DOM property mirrored as a boolean attribute, never stringified. Writes back on `change` |
| `bind:open` | The same, on a `<details>`, written back from `toggle`. |
| `bind:group` | Radio/checkbox membership, compared against the input's own `value`; never emitted as a `group` attribute |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer)}` | Node ref (state) or per-instance handler with the node as argument, which may RETURN a disposer run when the node goes. Client-only |
| `class:name={cond}` | Toggle a class on an element. |
| `style:prop={value}` | Set one style property on an element. |
| `{...expr}` | Spread props (component) / attributes (element) |

#### Expectations

* ESCAPING IS BY CONTEXT, and the context is syntax, so the compiler picks it rather than the value's
shape. In TEXT an expression is HTML-escaped. In an ATTRIBUTE VALUE it is attribute-escaped.
* IN A URL-TYPED ATTRIBUTE — `href`, `src`, `action`, `formaction`, `poster`, `data`, `xlink:href` — it is
additionally SCHEME-CHECKED: anything but `http:`, `https:`, `mailto:`, `tel:` or a relative reference
is dropped and warned on `abide:render`. Dropped rather than thrown, since a bad href is not a reason
to take the page down, and warned rather than silent, since it is a refusal. `javascript:` in an
`href` is the injection this exists for, and `csp()` is not the backstop for it — `csp()` is opt-in and
its `script-src` does not govern a URL scheme.
* `srcdoc` and a whole-attribute `style=` take no interpolated string; a computed style is
`style:prop={value}`, which is one property and one value. `on<event>` on an ELEMENT takes a function,
never a string, so there is no attribute-as-code position to escape into.
* `{raw(...)}` is the ONE escape and is the only place any of this is skipped. It is the app saying so.

### Control flow

| Block | Branches | Notes |
| --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | - |
| `{#await promise}` | `{:then}`, `{:catch e}`, `{:finally}` | rendering the body while pending. `value` is a LIVE binding, which is what lets the `{:then}` body be updated rather than rebuilt. EVERY BRANCH IS BOUND TO A PROBE, none to settledness — the pending body to `pending()`, `{:then}` to `success()`, `{:catch}` to `error()`, `{:finally}` to `done()`. `success()` stays true through a `refresh()`, which is what keeps `{:then}` mounted, and a STREAM is `pending()` until it closes — so there is no state in which none of the branches is mounted, and no fifth probe is owed. `{:finally}` therefore renders ALONGSIDE whichever of the other two is mounted rather than replacing it, the way a `finally` runs after both, and a `refresh()` leaves it mounted for the same reason it leaves `{:then}` mounted: the load that finished still finished. Concretely on a `Reactive`: a first load with nothing to show mounts it, a value already in hand never mounts it (not even for a microtask), and a `refresh()` leaves `{:then}` mounted with the old value — `refreshing()` is what a spinner reads, and the `{:then}` body is UPDATED when the new value lands rather than rebuilt. A bare promise has no probe to ask, so it is driven by settlement and is always pending on its first render |
| `{#await promise then value}` | `{:catch e}`, `{:finally}` | await a promise until resolved; over a stream, until it CLOSES, as `{await expr}` does. `value` is a NAME or a DESTRUCTURING PATTERN — `then { total }` — and live either way. |
| `{#for item, index of list by key}` | - | Keyless → positional (dev-warns if the body is stateful). `index` IS LIVE WHERE THE BODY READS IT and does not exist where it does not — the compiler can see which, `index` being syntax. Both halves are load-bearing. Live, because a keyed reorder moves a row without changing it, so a snapshot leaves `{index + 1}` reading `1.` at the bottom of a reversed list. Absent, because reading it is not free: reversing 500 rows changes 500 indexes, so a body that prints one pays 500 text writes against a reconcile that moved far fewer nodes. That makes the two bodies DIFFERENT CASES rather than one case measured twice — a reverse with `{index}` in it is being asked to do more work than a reverse without, and a benchmark that mixes them is comparing the ask, not the implementation. |
| `{#for await item of source}` | `{:catch}` | `source` may NAME its replay depth — `s.tail(n)`, or `s.tail(0)` for live-only — and a bare `{#for await x of s}` is `s.tail()`, which replays what the `Reactive` retained. There is no cap on what the block then ACCUMULATES: a stream painting a hundred thousand rows is the app's to bound, exactly as a `{#for}` over a hundred thousand items is, and conflating the two into one number made a chat room's default retention of 1 render one message. It takes `by` exactly as `{#for}` does — `{#for await event of events.tail(50) by event.id}` — and where the source is a ROOM the default key is the message's own `seq`. Any other stream is positional unless `by` names a key. A `refresh()` or a changed value identity re-streams it from a new cursor, which is where `tail` decides what comes back. `{:catch}` APPENDS after the rows already painted: this block accumulated, where a `{#try}` body rendered as a unit. |
| `{#switch expr}` | `{:case v}` `{:default}` | - |
| `{#try}` | `{:catch e}`, `{:finally}` | Render time boundary, and a REGION — a failure replaces the whole body, that being the unit it rendered as. `error.abide` is the same mechanism at page granularity. See "Sinks". |

#### Expectations

* CONTROL BLOCKS NARROW TYPES, and what makes that true of a read BY NAME is that A BLOCK BINDS EACH REACTIVE READ AND PROBE CALL IN ITS SUBJECT ONCE FOR THE BODY: `{#if invoice}` lowers to `const _invoice = invoice()`, and every `invoice.total` under it resolves to `_invoice.total` rather than to a second `invoice()?.total`. TypeScript narrows REFERENCES, never calls, so without that binding `{#if isFruit(apple)}` is `isFruit(apple())` and narrows nothing, and `{#if invoice}` leaves `invoice.total` optional because the short-circuit is still in the lowering — the block would READ as narrowing while narrowing nothing. With it, a user-defined predicate narrows, `Stored | undefined` narrows to `Stored` with the `?.` correctly gone inside the block, and `{#switch invoice.kind}` narrows a discriminated union by the same mechanism. THE PROBE IS IN THE SET FOR THE SAME REASON THE READ IS: `{#if email.isError(email.error(), 'NotAnEmail')}` binds `const _failure = email.error()`, so the predicate narrows a REFERENCE and `email.error().data.value` in the body resolves to `_failure.data.value` with `.data` typed to what that failure declared. Leave probes out and the pattern cannot typecheck at all — `error()` is `unknown` and the body's call is a second expression — and it is the only spelling a REFUSED WRITE has, a refusing `transform` filling `error()` rather than throwing to a `{:catch}` that would have bound it.
* A TEMPLATE-LOCAL BINDING NEEDS NONE OF THAT, being an ordinary local: `{:catch e}`, `{:then v}` and `{#for item}` narrow the way any TypeScript binding does, which is why `data.isError(error, 'DataAccessDenied')` already narrows `error.data` in the example above.
* The binding is per block EVALUATION, so the body reads ONE consistent snapshot rather than two reads a value could move between, and the block still re-runs when what it read changes. THREE THINGS DO NOT NARROW, and each is right: narrowing dies across a nested function in the body, which is TypeScript's own rule; an explicit re-read — `invoice()`, `invoice.$` — opts out of the binding and so out of the narrowing; and a probe's BOOLEAN says nothing about the value's type, so `{#if invoice.pending()}` narrows the value nothing — what binding a probe buys is that `isError` can narrow the RESULT of `error()`, which is the other question.
* A BINDING TAKES A PATTERN, not only a name — `{#await invoice then { total }}`, `{:then { total }}`, `{#for await { message } of room.tail(100)}` — and THE DESTRUCTURED NAMES STAY LIVE: they lower to path reads off the block's value, never to a `const` snapshot taken when the branch mounted. That is what keeps "the `{:then}` body is UPDATED rather than rebuilt" true for the destructured spelling, which is the one an author reaches for. A snapshot leaves the right value in the `Reactive` and stale text on screen after a `refresh()`, with nothing thrown and nothing wrong in the markup — so it is asserted by re-reading the body after a refresh, not by rendering it once. This is the `props()` exemption seen from the template side: a BINDING POSITION the compiler lowers stays live, and `const { total } = invoice` written in a script is the dead snapshot that warns.

### Components

| Feature | Notes |
| --- | --- |
| `{#component Name(pattern)}` | **Inline component** — a reusable builder. TitleCase required. Nested inside `<Foo>…</Foo>` it becomes Foo's `X` prop, and THAT is the named-slot mechanism — there is no `<slot name>` |
| `<Name/>` | Capitalised tag = component invocation, and the SAME call `render` takes — see `Component` under "render": `<Name a={x}/>` is `Name({ a: x })`, so a page mounted in a template and one handed to `render` go through one mechanism rather than two |
| `<slot/>` | Renders children |
| `<slot>fallback</slot>` | Renders children, or the fallback where none were passed. Whitespace-only is none, since a pure-newline run is already dropped |
| `<Tag>…</Tag>` | Children passed to the component's `<slot/>` |

#### Expectations

* nested `{#component X()}` inside `<Foo>…</Foo>` becomes a named component prop as `X` — a BUILDER, `(props) => Component`, which is what the parent calls where it places the slot
* components can be passed as values
* `const C = memo(…)` or `let C = state(…)` → `<C/>` | A state- or memo-named tag is a **reactive** component (re-mounts on change). A TAG READS ITS HEAD AND THEN CALLS IT: `<C a={x}/>` reads `C` where the head is a `Reactive`, and calls the factory it got with `{ a: x }`. Two steps, which is why the zero-argument rule never reaches a tag — the call belongs to the factory, not to the read. It is also where `identity` earns its keep: a memo rebuilding its component value every recompute re-mounts the subtree every time, which is the freshly-built-wrapper failure wearing a costume — the output is right and the DOM is thrown away
* A COMPONENT IS KEYED BY POSITION; A MEMO IS KEYED BY VALUE. That is why props are reactive and do
not reinstantiate the component when they change — an instance KEEPS its identity and its props update
underneath, where a memo re-keys and lands on a different entry. Two `<Card user={a}/>` at two places
in the tree are two instances with identical props; two `getUser({ id })` calls in one scope are one
entry. The rest follows: props hold functions, reactive values and children, none of which is keyable,
where `Args` is `JsonValue` because the key IS the wire form; and dropping a memo entry is a cache
miss to rebuild, where dropping an instance destroys DOM and runs its disposers.
* `by` is how a list asks for VALUE-keying instead, and it is the one place a component gets it. That
it has to be spelled is the tell that position is the default.

## Props

```html
<script>
import { props } from 'abide'

type Props = { class?: string; note: string; count?: number }

const { class: className = '', note, count = 0 } = props<Props>()
</script>
```

### Expectations

* `<script>` only. In a `<script module>` it is a compile error — module scope has no instance
* no `props()` call means the component accepts no props of its own, and a caller passing one is an error
*  `props()` with no type | `Record<string, unknown>` — the opt-out, and what `const { ...rest } = props()` is for
* A PROP IS NOT A `Reactive`. Declared as a plain `T` it is a LIVE READ of the caller's expression, not a snapshot — `count={total}` tracks `total`, `count={total * 2}` tracks it as a derived read, and neither reinstantiates the component — and there is nothing behind it to write to, which is already why `bind:count={total * 2}` has nothing to bind. So `count.$` on one is a compile error rather than a `Reactive` minus `set`. That is what leaves `Reactive<T>` as the only other face: a child declaring it makes `bind:` at the call site a COMPILE requirement, so every call site is forced to comply and there is no runtime warning to issue. The marker still sits at the CALL SITE — on the side giving write access up, where a reader sees it without opening the child — and the child declaring is what lets the compiler check it, which a child inspecting its own call sites could not do
* DESTRUCTURING `props()` IS NOT DESTRUCTURING A `Reactive`, so the warning that one is a dead snapshot does not reach it: `props()` hands back per-key ACCESSORS rather than a value, which is what keeps each binding live. `const { name } = data` on a `Reactive` is the dead one.
* THE LOWERING IS TYPE-DIRECTED, as the lifted mutators are. A declared `Props` with no index
signature has a known key set, so every prop is one accessor and the shape is fixed whatever the call
site spelled. A `Props` carrying `Record<string, unknown>` is the component asking for the dynamic
form, and there an opaque `{...expr}` is one live read with its keys enumerated per read — which is
what makes proxying a prop set downward, or spreading it onto an element, sayable at all.
* AN EXPLICIT PROP BEATS A SPREAD, whatever the order. `<Event {...event} onclick={handle}/>` and
`<Event onclick={handle} {...event}/>` both bind `onclick` to `handle`: a named prop is the author
saying which one they mean, and source order would make that depend on where they happened to write
it. Two spreads against each other are still source order, there being nothing else to go on.
* The pattern is FLAT — renames and defaults, plus a rest element. No nested patterns. The rest element is LIVE like every other prop: the caller's prop set is known at the CALL SITE, so it is one accessor per key passed — a fixed shape, no proxy, no snapshot. What makes it the opt-out is the missing TYPE, not a missing subscription, and because the call sites are typed even an undeclared prop usually resolves well enough to lift a write on
* `children` | Always accepted, never a name: `<slot/>` renders what is between the tags, and nothing has to declare it
* formatting whitespace: Two rules, and neither keeps a text node that renders nothing. A run of pure NEWLINES — no space and no tab in it — is dropped wherever it stands, so `<b>a</b>` and `<b>b</b>` on their own lines at column 0 render `ab`. A run that renders nothing but carries a newline AND indentation is dropped at the two ENDS of every block body and of the file's own top-level template, since it would otherwise be a permanent member of the instance's movable range. An indented run in the MIDDLE of a body survives, which is what keeps the ordinary shape spaced. The case this changes: two blocks back to back with no whitespace between them — `{/if}{#if b}` — whose bodies each held an inline node, where `x y` now renders `xy` |

## Script / style blocks

| Block | Scope |
| --- | --- |
| `<script>` | Per-instance (component setup). |
| `<script module>` | Module scope — REQUEST-local on a server, process-wide in a browser. The module BODY still runs once per process; what is scope-keyed is the reactive values it builds, exactly as `state.share` is, so imports are not re-run per request and one request's module state is never served to another. In a browser there is one scope, so a `<script module>` state is built on first import and lives as long as the tab. |
| nested `<script>` | Branch-local (per-ITEM in a `{#for}`). Must be the FIRST node of a block body, carries no `import`, and resolves off the level's scope. Setup, so it runs ONCE per item and does not track — what makes `memo(() => f(result))` in one re-run is the memo tracking `result`, which is a live binding rather than a snapshot. |
| `<style>` | Component-scoped: every root element carries a scope token and every selector requires it on its rightmost compound. Registered once at module scope |
| nested `<style>` | Subtree-scoped — an element carries every scope in force, so an outer rule reaches in and an inner one cannot reach out |
| `import './app.css'` | A stylesheet the component DEPENDS ON, from any `<script>` in the file or any `.ts` it reaches. GLOBAL, not scoped — and the asymmetry with `<style>` is the point: a `<style>` block is written inside the component, so scoping it is what the author meant, while an imported file is authored elsewhere to be SHARED, and scoping it would defeat the one thing it is for. A side-effect import with NO binding; `import styles from './app.css'` is a compile error naming the bare form, because a second mechanism for the same file is what CSS modules are and one is enough. |
| `:global(…)` | The escape, PER SELECTOR: the compound inside it is not required to carry the scope, so `.card :global(.child-thing)` stays scoped on the left and reaches a child component on the right. Without it a scope can never style anything it did not render |

### Expectations

* An `<!-- html comment -->` in the markup is for whoever opens the file and is NOT emitted: a
component ships one copy of its own commentary per INSTANCE, and a file's header comment is the
biggest one it has. Whitespace around a dropped comment is left alone, so nothing that was inline
stops being inline — except at a block body's two ends, where the comment and the indentation
holding it go together (see the formatting-whitespace row under Control flow). A comment that has to
reach the browser is `{raw('<!-- … -->')}`.
* the sugar reaches every script in the file, `<script module>` included — see "Reading and writing by name".
* A `<script module>` STATE IS NOT A PLACE TO ACCUMULATE ACROSS CALLERS on a server. It is scoped to the
request that read it and dropped with it, which is what stops the shape that reads as a cache and is a
cross-request leak. Something genuinely process-wide on a server is a `global` memo, where the scope is
spelled out loud and `Args` is where anything caller-specific goes.
* A scope token is ONE attribute holding a space-separated list — `data-abide="a1f3 b207"`, matched `[data-abide~="a1f3"]` — not one attribute per scope, so nesting depth costs no extra DOM writes per node.
* A `<style>` BLOCK IS A BUILD ARTIFACT, NOT INLINE OUTPUT. Every scope a route can reach is known at compile time, so the compiler writes them into a content-hashed stylesheet and the head carries a `<link rel="stylesheet">` to it. That is what a crawler, a view-source, a scriptless client and an email get, with no adoption anywhere and nothing to feature-detect — and it is why `style-src 'self'` needs neither a nonce nor a hash list: a linked sheet is not inline output at all. It also keeps the shell head byte-invariant, since a hash is chosen at build rather than per response, and gets the sheet `immutable` for free off the same rule the bundle is served under.
* The client reaches for `document.adoptedStyleSheets` only for a scope the document never LINKED: a lazily navigated route's component. A constructed sheet is not a `<style>` element either, so `style-src` does not reach it. There is NO fallback: `adoptedStyleSheets` in its mutable-array form is Chrome 99, Firefox 101 and Safari 16.4, so the newest engine without it predates anything abide targets. A branch that mounts LATER on a route already linked needs nothing — its scope was in the sheet before the branch existed, a scope token costing nothing on an element that never renders.
* AN IMPORTED STYLESHEET IS THE SAME BUILD ARTIFACT A `<style>` BLOCK IS, not a second path: the
compiler collects the `.css` imports out of a route's module graph and folds them into that route's
content-hashed sheet, ahead of the scoped blocks so a component rule can override an app-wide one
without `!important`. Deduped by RESOLVED specifier, so a file ten components import is emitted once,
and ordered by the graph, so the same source builds the same bytes.
* WHERE the import sits does not matter, because the collection is a build fact and not a runtime
walk — `<script>` and `<script module>` are the same here. A nested `<script>` still carries no
`import` at all, so there is nothing to decide about a branch-local stylesheet.
* An import reached ONLY from a lazily navigated route travels with that route, through the same
`adoptedStyleSheets` path its scopes take. Nothing an app writes changes between the two cases.
* This is how an app brings a whole design system in — `import '#ui/app.css'` in `layout.abide` puts
it on every route under that layout, once — and it is the only reason the framework needs to know
what a `.css` file is.
* An email is pure SSR and never touches the adopted path. It is still not email-SAFE — mail clients strip head styles and handle attribute selectors badly — so an email render wants a handler-inlining pass over the same output, not a second rendering path.

# Pages / routing

## File structure

| Pattern | Meaning |
| --- | --- |
| `src/ui/pages/**/page.abide` | A route |
| `src/ui/pages/**/layout.abide` | A layout; renders its child page through `<slot/>` |
| `src/ui/pages/**/error.abide` | The page a refusal renders in, resolved nearest-ancestor like a layout. It takes the failure as a prop, renders inside the layouts ABOVE it so the chrome survives, and answers with the failure's own status. 404 is this file holding a `Failed<'NotFound'>`, not a second convention. Where the thing that FAILED is one of those layouts, the boundary is the nearest `error.abide` strictly ABOVE it — rendering inside the layout that threw would re-run the throw — and because the chain is static the escalation is a compile-time list rather than a walk that could regress. The LAST entry on that list is abide's own minimal document — a status line and the failure's message, no layout and no app code — because app code is what is failing, and a fallback cannot be the thing that broke. Reaching it means an error page itself failed, so it warns on `abide:render`. `{#try}` is the same boundary at template granularity |
| `[name]` | Required dynamic segment → `route.params.name` |
| `[[name]]` | Optional segment (absent → param omitted) |
| `[...name]` | Rest / catch-all (terminal) → the `/`-joined remaining segments |
| precedence | literal > required > optional > rest. Sorted once, at install, so a match stops at the first hit |
| `/__abide/**` | Every endpoint abide controls |

## Expectations

* `APP_URL`'s PATH is the app's mount base: `APP_URL=https://abide.com/v2` serves the whole app under
`/v2`. Everything moves together: the pages, `/__abide/**`, and the client bundle. Nothing is left
answering at the origin root, so an app behind a proxy does not go on exposing its schema and log feed
beside its mounted copy. `route()` and `url` and `navigate` handle the mount root transparently.
* A hand-written `href="/users/42"` in a template does not move — it is a literal, not a call, and abide does not rewrite one.
* The template resolves names in the component's own script scope, and abide's helpers are ORDINARY IMPORTS with no privilege. Shadowing `url` with a local binding shadows it in the markup too.
* The CLIENT is told the base by the document, in a `<meta name="abide-mount">` the shell writes. It
cannot be in the bundle — a mount is chosen after the build — and it is not derived from where the
bundle was fetched from, which would name the CDN when there is one.
* All requests including routes go through the app's `middleware` even when rendering is handled by the client. `/__abide/**` is no exception, `GET /__abide/logs` included — which is what an app's auth rung gates it with. Three things sit OUTSIDE the onion and each says why: the built assets, served in FRONT of the pipeline; `/__abide/health`, because a load balancer presents no credentials; and `/__abide/principal`, because its answer is composed from the caller's own cookie.
* Two routes under one layout are two pages with the same chrome.

## `<head>`

* A `<head>` element in a `.abide` file contributes its children to the document head. TOP LEVEL only — never inside a control block — the same restriction `<script module>` carries, and what makes the next line possible.
* HOISTED AT COMPILE TIME. The positions are static, so the shell knows the whole set before it flushes; only interpolated VALUES are dynamic, which is what keeps "flush the head ASAP" true for a page three layouts deep.
* Merged BY KEY, deepest contributor wins: `title`, `meta[name]`, `meta[property]`, `link[rel][href]`, `html[lang]`. Everything else appends in tree order, so a page's `<title>` replaces its layout's while two `<link rel=preload>` for different hrefs both survive.
* NOTHING HOLDS THE FLUSH BY DEFAULT, the head included. `<title>{name}</title>` is an ordinary read: unsettled, it renders what it has and is corrected when the value lands. Holding is OPT-IN and spelled the same way it is spelled anywhere else — `<title>{await name}</title>` — so the author decides whether a correct title is worth the delay to first byte, rather than the position deciding for them. The cost of not opting in is a visible flash in the tab, and a scriptless client keeps the uncorrected title, since there is no script to run the fill.
* On a client navigation the incoming page's keyed contributions replace the outgoing page's by key. A layout's do not move, matching layouts never being rebuilt.

## View transitions

* Whether any rule names `::view-transition*` or sets `view-transition-name` is what turns them on. That IS the app saying it — the standard puts the entire control surface in CSS, so a boolean elsewhere would be the same intent spelled twice.
* It is a BUILD FACT, not a runtime walk: abide compiles every `<style>` block, so the answer is a manifest boolean and there is no cache to invalidate. A runtime walk could not see it anyway — a lazily navigated scope arrives through `document.adoptedStyleSheets`, and a constructed sheet is not in `document.styleSheets`, so the check would have been blind to exactly the scopes a walk was needed for.
* `updateCallbackDone`, not `finished`. The page is on screen when the DOM is written; waiting for the animation to END would hold the address bar and the commit behind it
* a browser without it Navigates exactly as it does now, so an app feature-detects nothing

## `render`

| Name | Type Signature | Description |
| --- | --- | --- |
| `Component` | `Component` | A component BOUND to its props — what `Page({ id })` hands back, what `<Page id={x}/>` is, and what a `<slot/>` renders. A `.abide` file default-exports the FACTORY, `(props: P) => Component`, so supplying props is CALLING it and `render` needs neither a props parameter nor a generic. Binding is inert: the call fixes the props and runs no setup, which is what keeps `render` the only thing that touches the ambient request scope. |
| `render` | `(component: Component, shell?: Shell) => AsyncGenerator<Uint8Array>` | What PRODUCES a document, and what `page()` takes. Yields bytes rather than strings: the body is bytes either way, and encoding at the source keeps a `TextEncoder` out of the funnel per chunk. |
| `Shell` | `string \| URL \| undefined` | The document it renders into. `src/ui/app.html` is the default; naming another is what makes an email body or an embed possible. |

### Expectations

* Reads the ambient request scope — `request()`, `principal`, `cookies()`, `nonce()` — so those are not parameters. `render` ITSELF works without one, which is what static generation needs; the accessors still throw, so a component reading one is simply not statically renderable. The list comes from RUNNING the render with no scope and collecting what threw, naming the component and the accessor — not from reading the module graph, which would be an interprocedural analysis nothing else in the build does.
* One generator serves every producer of a document: an app's own route, the page pipeline, static generation and the harness. Nothing is shaped for the handler case alone.
* A refusal thrown BEFORE the first flush answers with `error.abide` and the failure's status. After the first flush the status line is already out, so the stream errors and the client swaps `error.abide` in place — which is the one thing a rendered-to-string consumer, an email, cannot do.

## Sinks

A SINK is an addressable HOLE in the output stream that a value still in flight fills later. It is
about MARKUP — a read that had nothing yet, a stream's rows, a boundary that has to be swapped — and
it is NOT how data reaches the client. That is the SEED BUFFER answering the client's own request
(see "rpc"), and the two are separate mechanisms with separate lifetimes: a document carries no copy
of any answer. A value landing before the document closes fills its sink in place; one that does not
leaves the sink empty, and the client renders that part when its own request answers.

* A read of an unsettled `Reactive` renders `''` and opens a sink. `{expr ?? 'Loading'}` works because
the value is genuinely `undefined`; `pending()` is what separates that from a value that RESOLVED to
`undefined`.
* BOUNDARIES ARE STATIC, so a sink knows its enclosing `{#try}` / `error.abide` chain at compile time
and unwinds nothing at fill time.
* A fill has two modes. FILL writes the value into the sink. REPLACE swaps the enclosing boundary's
REGION, which is what a failure needs: a `{#try}` body cannot be repaired by filling one sink inside
it, the markup around that sink having already flushed. `error.abide` is the outermost boundary and
its region is the page body inside the layouts — the same swap `render` describes after a first
flush, rather than a second convention.
* `{#for await}`'s own `{:catch}` APPENDS instead, that block having accumulated rather than rendered
as a unit. The discriminator is the BLOCK, never the retention: `tail` is replay depth on subscribe
and says nothing about what is on screen, so a `tail(0)` cursor with 500 rows painted keeps all 500.
* Replacement content is emitted AT FILL TIME, at the sink's position, and moved — never pre-rendered
into an inert `<template>` beside every boundary. A boundary that does not fail costs nothing.
* What the boundary does cost is retention: a `{#try}` body cannot be released while a sink inside it
is still open.
* A scriptless client cannot be repaired after the first flush. That is inherent to streaming, and it
is why `{await expr}` — which blocks — is what a page that must work without script uses.
* The wire form is a `<template>` carrying id, mode and target in ATTRIBUTES, followed by a
byte-identical `<script>` that reads the template beside it. Identical bytes are what let one
build-time hash cover every sink in every document, which is what keeps a nonce out of the head.

## Rendering

* Goal is to get fastest time to first byte and have total time be max(asyncronous work wall time), and stream as much as possible during that time.
* User perception of speed is of the most highest importance. Flush the head ASAP.
* The rendering logic should share as much between client and server as possible.
* Start all asyncronous work up front, including rpcs, in parallel.
* RPCs streams are split to feed document generation as well as buffered until it can be picked up by a request made in the client. If a stream has not finished when the document is done with every blocking sink, the document is NOT held for it: what it produced is already inline, and the client's own request picks the rest up from the seed buffer.
* Render is an async generator
* If a structure is waiting on asyncronous completion it creates a sink and continues to generate past that until the document is done. If any of those sinks block render (or ssr) based on template signals (`{await foo}` or `{#await foo then bar}`) then flush waits until those sinks are done but never block document generation.
* Data is seeded to client via the adopted RPC responses in the client.
* Sockets follow the same adoption logic as RPCs. The seed buffer answers HOW THE CLIENT JOINS; `seq` answers WHAT HAPPENS WHEN THE BUFFER IS NOT THERE — a socket that dropped and reopened, a tab too slow to adopt, a room the server restarted. Between them nothing is dropped and nothing is delivered twice WITHIN ONE INCARNATION, and the buffer can be released on a timer rather than held in hope. Across incarnations — a restart, or a reconnect landing on another instance — the epoch moves and the reset is announced rather than papered over.
* HYDRATION RE-EXECUTES SETUP. The client runs every `<script>`, every `state(…)` and every `memo` body
again rather than adopting a serialized setup result — one runtime and one code path on both sides, and
nothing to keep in step. It is affordable for exactly one reason: THE SEED BUFFER ANSWERS THE CALLS THE
RE-RUN MAKES. Setup issues the same rpcs off the same args, they are answered from what the render
buffered, and no round trip is paid — for a handler over a MEMO, which is one call on both sides;
which is why the buffer answers the client's own REQUEST rather
than embedding data in the document, and makes that choice load-bearing rather than tidy. What is paid
twice is a memo body that is expensive and is NOT a load, there being nothing to seed; that is the cost
of the decision and the reason a heavy pure computation belongs behind an rpc.
* SSR EMITS MARKERS, NOT A TREE TO DIFF. Sink and block boundaries are static, so the client walks the
marker list the document carried rather than the DOM, binds listeners and subscribes readers against
nodes it never rebuilds, and a mismatch rebuilds THE ENCLOSING BLOCK rather than the page — which is
what `abide:hydrate`'s "a mismatched sink rebuilt" is reporting.
* After first hydration the client does all rendering after the document request's middleware returns ok. Do what rendering can be done while waiting for document request onion. If there is no middleware, document request does not need to run.
* As little as possible of the page should be rebuilt between navigations. Shared layouts are never rebuilt.
* DOM operations are very expensive so DOM changes must be minimized.

# Configuration

## Environment variables

| Name | Type | Description |
| --- | --- | --- |
| `PORT` | `number` | Listen port (default `3000`). `--port` on a command overrides it by DECLARING it, so `config().PORT` is the port. Resolved as an integer `0`–`65535` whether a variable or an `onConfig` default named it — anything else is the floor, so no reader checks the range again. `0` is the kernel's "whatever is free" and is the one number here that may be zero. |
| `APP_URL` | `string \| null` | The app's public URL. Its ORIGIN is what both gates compare against (WS CSWSH, CSRF) — undeclared, they fall back to the REQUEST's own, which is the weaker answer, since a caller controls its own `Host`, and the wrong one behind TLS termination, where that origin is the proxy's. Its PATH is the app's mount base: `https://abide.com/v2` serves every page, endpoint and asset under `/v2`. |
| `NODE_ENV` | `string` | Verbatim, and DEFAULTED FROM THE COMMAND when unset: `abide start` is `production`, `abide dev` is `development`. An explicit value always wins, completely — `NODE_ENV=production abide dev` minifies, requires `ABIDE_PRINCIPAL_SECRET`, sets `Secure` and ships no reload client. There is no second production flag: `config().NODE_ENV === 'production'` is the one comparison, and the command only supplies its default. |
| `APP_NAME` | `string` | The app's name, and therefore `log`'s default channel. Falls back to the nearest package.json `name`, then `abide`. |
| `APP_VERSION` | `string` | The `version` beside that `name`, or empty. Empty rather than absent, so no consumer branches on the field existing. |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory under `APP_NAME`. A path — nothing is created. |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | Seals the `abide-principal` cookie — a COMMA-SEPARATED LIST, signing with the first and verifying against any. That is what makes rotation non-destructive: prepend the new key, deploy, wait one half-TTL for the rolling re-seal to move everyone, drop the old. A single value swapped in place signs out every live session at that instant. Required in production for `principal.set()`; a dev process mints a random key and says so on `abide:principal`. |
| `ABIDE_PRINCIPAL_TTL` | `number` | Principal cookie life in ms (default 30d), rolling — re-sealed on the first resolve past half of it. |
| `ABIDE_APP_TOKEN` | `string \| null` | Bearer the remote CLI sends, for whatever an operator put in FRONT of the app. |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. Asked before `APP_URL`; also marks a cross-origin proxy, which declines to volunteer `traceparent`. |
| `ABIDE_RPC_TIMEOUT` | `number` | Default ms a call may go without progress (default `Infinity`); a handler's `timeout` is the real knob. Per chunk on a handler that yields. |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | Default ceiling on a mutation's body in bytes (`Infinity` unset). An over-size declared `content-length` is 413 before buffering. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | Cap in bytes on a stream TRANSCRIPT held in memory, whichever thing holds it — a seed buffer entry, or a `global` memo's entry fanning one producer out to late readers. One number for one shape, rather than a second variable meaning the same thing somewhere else. Default: `Infinity`. A seed entry needs no other bound, being single-use and living seconds |
| `ABIDE_LOGS` | `boolean` | Opts IN to declaring the `GET` over `log.records`. Default closed → the address is unmounted → 404. Dispatched THROUGH the app's `middleware` like any route, so an app's auth rung governs it. |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | `log.records`'s `tail` — how many records the room retains for a later subscriber to replay (default `500`). |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | Machine log format. `null` means the shape follows the TTY. |
| `DEBUG` | `string \| null` | Log-channel gating in debug-npm grammar. A browser's `localStorage.debug` answers under this, never over it. |
| `NO_COLOR` | `string \| null` | Set to anything: no ANSI anywhere, and `tsv` log output. Beats `FORCE_COLOR`. |

There is no `HOST`. The bind address is Bun's own default, and an app that needs another one reaches
`server()` and Bun's own `Bun.serve` options rather than a variable abide would only pass through.

## Files

| Convention | What it is |
| --- | --- |
| `src/**` | Abide app source files. |
| `src/server/**` | Server-related source. |
| `src/ui/**` | Browser-related source. |
| `src/shared/**` | Source shared by ui and server. |
| `src/server/app.ts` | Lifecycle hooks. Every export is optional, so the FILE is — an app of pages and endpoints needs none. What makes a directory an app is having something to serve: no `pages/` no handlers and no module is the one shape refused |
| `src/ui/app.html` | The document its pages are served in. `<slot></slot>` is where the page renders; a `src`/`href` naming a build ENTRY is rewritten to what the build wrote, and the css the client graph imported is linked from the build. Absent → abide's own minimal shell |
| `src/ui/pages/**/page.abide` | HTML Routes. |
| `src/ui/pages/**/error.abide` | The page a refusal renders in. |
| `src/server/rpc/**/*.ts` | RPCs. |
| `src/server/sockets/**/*.ts` | Sockets. |

## Lifecycle hooks

A HOOK IS CALLED, NEVER EXPORTED. Every one is an ordinary import from `abide` invoked at module
scope, so a hook can be registered from whatever module owns the thing it is about rather than only
from `app.ts`. What makes `app.ts` the right place for the app-wide ones is that it is the file that
always runs at startup — an address, not a shape — and the ONE thing it exports is `default`, the
app's own route.

```ts
// src/server/app.ts
import { middleware, onConfig, onHealth, onPrincipal, onStart, onStop, onError, csp } from 'abide'

middleware(csp(), requireAuth())
onConfig((env) => ({ DATABASE_URL: env.DATABASE_URL ?? 'postgres://localhost/dev' }), { schema })
onHealth(() => ({ database: db.ok }))
onPrincipal(async (claims) => claims && await users.byId(claims.sub))
onStart(async (start) => { await db.migrate(); await start() })
onStop(async (stop) => { await drain(); await stop() })
onError((error) => report(error))

export default (request: Request) =>
  new URL(request.url).pathname === '/robots.txt' ? new Response('User-agent: *') : undefined
```

| Name | Signature | Purpose |
| --- | --- | --- |
| `default` | `(request, server) => Response \| undefined \| Promise<…>`, or `{ fetch }` | The one EXPORT: a route of the app's own, asked FIRST. |
| `middleware` | `(...rungs: Middleware<{ request: Request }, Response>[]) => () => void` | The per-REQUEST auth/observability rung, the same `Middleware` type the transports take, and PRE-ROUTING: it runs before the route resolves and before any rpc's or socket's own middleware, so it has a request and nothing else. Anything resource-aware — authorising by an id in the args — is necessarily a handler's own rung, which is where `ctx.args()` exists. `next(ctx)` hands back what the next rung returns; the innermost one runs the route. Short-circuited by returning without calling `next`, or by a throw. Auth is middleware |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | WRAPS the real boot: do setup, then `await start()`. Awaited |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Mirrors it for teardown: drain, then `await stop()`. Runs on SIGINT/SIGTERM/crash. Awaited |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an UNEXPECTED error in this scope: a request that threw, and a `watch` effect or `Disposer` that threw. Scope-shaped rather than request-shaped, since a watch outlives the read that started it |
| `onConfig` | `<Extra>(fn: ConfigDefaults \| null, options?: ConfigOptions<Extra>) => () => void` | The app's config DEFAULTS, merged UNDER the environment. Synchronous, and the only one that fails hard |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | Fields merged OVER the baseline `{ reachable, version, startedAt, uptime }`, on every server-side `health()` |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns what a caller presented into the principal, merged UNDER the baseline `{ authenticated, expiresAt, error }` — a field colliding with one of those is dropped, since `authenticated` is abide's finding about a seal it verified rather than an app's to assert. Receives `null` for no valid seal. Fails CLOSED |

### Expectations

* EVERY HOOK RETURNS THE WAY OFF AGAIN, so one registered by a module that is torn down can be, and
so the return type is one thing across all of them.
* FIVE COMPOSE AND TWO REPLACE, and which is which is decided by whether the hook CONTRIBUTES or
RESOLVES. `middleware`, `onStart`, `onStop`, `onError` and `onHealth` compose — each call adds, in
registration order, which is what lets a module ship its own health field or its own rung. `onConfig`
and `onPrincipal` REPLACE and warn on `abide:config` / `abide:principal`: there is one config document
and one answer to who this caller is, so a second registration is a disagreement rather than an
addition.
* A hook that throws at REGISTRATION fails hard; `onConfig` throwing when it RUNS also fails hard and
the server is not started (see `config`).

## Response helpers

An app's own route answers with the SAME helpers a transport handler does — `page`, `json`,
`jsonl`, `sse`, `redirect`, `error` — documented once under "rpc". There is no second set. Each
returns a plain `Response` and takes a `ResponseInit` the caller's headers ride in.

Two rules are the app-route lane's own. Every response built through one carries `traceresponse`,
every refusal included; outside a request the header is absent and a caller that set its own is not
overruled. And a source that throws mid-`jsonl`/`sse` ERRORS the body, the status line being already
out — the rpc lane's stream is the same machine with one extra frame, so it says the failure in a
line instead.

# CLI

## Commands

| Command | Purpose |
| --- | --- |
| `abide scaffold <name>` | Write a starter project, then `git init` + `bun install` + `abide dev` — each skippable (`--no-git` / `--no-install` / `--no-dev`). |
| `abide run <file> [args…]` | Run a script under the abide runtime. Everything after `<file>` belongs to the SCRIPT, so it is SPAWNED: it reads its own `argv` and keeps its own exit code. |
| `abide check [dir…]` | Type-check `.abide`, reporting every diagnostic on the `.abide` line. The list is stdout; the exit code says it failed. |
| `abide dev [--port <n>]` | Watch the project and keep the app up: the client bundled into MEMORY, the server restarted on every change, and full live-reload over the socket mux. `--port` (default `3000`) HOPS to the next open port if taken, then PINS what it bound so no restart moves the app. `PORT` and `APP_URL` are written back from the listener and `config()` invalidated, so what the document reports is where it is actually listening and `abide logs` resolves an app a hop moved. |
| `abide build` | Code-split client → content-hashed chunks + `manifest.json`, minified and precompressed. Every `<style>` block compiles into the same set, so a route's scopes arrive as a content-hashed STYLESHEET the head links rather than as inline output. |
| `abide start [--port <n>]` | Boot the app's build from `abide build`, and open the interactive shell where stdout is a TTY. A port already held by an abide app is ATTACHED to under a TTY and is a failure without one — see `## CLI`. |
| `abide connect [url]` | The interactive shell against a running app, booting nothing. No `url` reconnects to the last, remembered under `APP_DATA_DIR`. |
| `abide call <address> [args]` | One call to one handler, no shell — the only spelling, in argv and in the shell alike. Flags come from the argument schema; the exit code comes from the refusal's status. |
| `abide openapi [--out <file>] [--url <origin>]` | The OpenAPI document written to a file rather than served, for a repo that commits one or a client generator that reads one. `--url` names the mount; without it `servers` is `[{ url: '/' }]`. |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio, for a model client that spawns a process. A bridge to `/__abide/mcp` on a running app, not a second implementation. |
| `abide logs` | `abide call` on `log.records`, which is what a room-valued command already does — the tail replayed, then every record as it arrives. What the command adds is FRAMING: printed by the rules THIS process's stdout answers to, with `+Nms` rebuilt from the record times. |
| `abide compile [--target] [--out] [--platforms]` | ONE standalone executable, via `bun build --compile`. `--platforms` cross-compiles a release set for the price of one client build, and makes `--out` name a DIRECTORY. |
| `abide bundle` | A desktop launcher for the host platform: embedded assets and a first-run setup screen. Native windowing is best-effort — a system webview binary, or the default browser. |
| `abide lsp` | The `.abide` language server, over stdio. |
| `abide` · `-h` · `--help` | Usage, GENERATED from `COMMANDS`. Asking for help is a success (stdout, `0`); an unknown subcommand is not (stderr, `2`). `abide <command> --help` is the same success, answering with that command's own row — read from the FIRST argument only, so `abide run <file> --help` still belongs to the script. |

## Handlers as commands

Every handler is a command, derived from the route table the way an OpenAPI operation and an MCP
tool are — see `# Generated surfaces`, and `clients.cli` for withholding one. This is the third
framing of that one client: same route table, same middleware, same `principal`, same refusals, no
second implementation. WHO IS ON THE OTHER END IS NOT FIXED — a person at a prompt, a script in CI, an
agent that can spawn a process but not open an MCP session — which is what the TTY rule below is for,
and why `clients.cli` withholds a handler from a machine as often as from a colleague.

### The shell

#### Built-ins

A namespace of their own, `call` being the whole of the other one. Each is why the shell is not merely
a prompt around `abide call`: they are the things a call cannot be.

| Command | Does |
| --- | --- |
| connect | Point the shell at another app — a local dev server, a staging origin — without restarting it. The target is remembered under `APP_DATA_DIR`, which is what `abide connect` with no argument reads |
| disconnect | Drop the target. Built-ins still answer; handlers do not, there being nothing to ask |
| help | Usage, GENERATED from `COMMANDS` **and the route table** — the built-ins, then every handler this caller may reach, each with its `description` as the one-line summary. A third surface `description` is read on, and the third reason to write one |
| exit | Leave the shell. Where `abide start` opened it, this STOPS THE SERVER it booted, running `onStop` — a shell that outlived the process it started would be a prompt attached to nothing |

#### How a handler becomes a command

| Piece | Comes from |
| --- | --- |
| Name | the mount path's segments and the export name, space-separated. The same address MCP joins with `_`, spelled the way a shell reads |
| Flags | the argument schema. `GET` / `DELETE` args are FLAT by type, so each top-level key is one flag and a repeated flag is the array `URLSearchParams` already has a form for. A `POST` body is `JsonValue` and nests, which flags cannot express, so it takes `--json <body>` or reads the body from STDIN — the split falls out of the existing rule rather than being decided here |
| Output | the result, framed by the TTY the way `ABIDE_LOG_FORMAT` already is: human-readable to a terminal, JSON to a pipe. A streaming handler prints one value per line, which IS jsonl, so a pipe gets the framing the http caller would have got |
| Exit code | the refusal's status through the table this CLI already has — `3` for 422, `4` for 401/403, `5` for 404. A declared `Failed` carries a status, so a named refusal is a shell condition with no mapping written here |

#### Expectations

* `abide start` BINDS AND SERVES, and opens the shell where a person is watching. The shell follows the
TTY the way the log format does: a supervisor, a container and `abide start > log` get no prompt, and
everything the shell offers is reachable as `abide call <address>` regardless, so nothing is only
available interactively.
* A TAKEN PORT IS NOT SILENTLY REUSED. Under a TTY, `abide start` finding an abide app already on the
port ATTACHES to it and says so — the second terminal is the case that matters, and booting a rival
process is never what was wanted. Without a TTY it FAILS, exit `1`: a supervisor told to start a
server and quietly given somebody else's is the incident this refuses to be part of. `abide dev` HOPS
instead, which is the difference between a port that is an address and a port that is a convenience.
* THE SHELL IS A CLIENT OVER HTTP, EVEN ITS OWN. Where `abide start` booted the server, the shell it
opens still speaks to it over localhost rather than reaching into the process — so the shell `abide
start` opens and the shell `abide connect` opens are ONE code path, and an in-process fast path would
be a second client to keep in step for a saving nobody at a keyboard can perceive.
* IT AUTHENTICATES AS THE OPERATOR, sending `ABIDE_APP_TOKEN` as a bearer the way `abide logs` and
`abide mcp` do. So the command list is PER-CALLER like the tool list: `help` shows what this caller may
reach, and `clients.cli` is what withholds a handler from it. Nothing about being at a terminal
skips a rung.
* `call` IS A PREFIX RATHER THAN A FALLBACK, WHICH IS WHAT KEEPS THE NAMESPACE OPEN. A bare
`abide <address>` was specified first and gave the two vocabularies one namespace: a file named
`help.ts` had to be shadowed and reported, and — worse, because it fails later and further away —
abide could never add a built-in again without silently taking a name some app had already declared.
One prefix costs four characters and removes both. There is nothing to report at startup, because
there is nothing that can collide.
* A SOCKET IS A COMMAND THAT DOES NOT RETURN. Naming a room SUBSCRIBES and prints each message as it
arrives; `--publish <message>` publishes instead, gated by that channel's `clientPublish` — the same
gate the socket and the `POST` read, so a terminal publishes on exactly the terms a browser does.
Non-interactively it streams until the room ends or the process is signalled, which is what makes
`abide call <room> | grep` an ordinary thing to write.

## Expectations

* Exit codes `0` ok · `1` failed/unreachable · `2` usage · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx · `8` other 4xx.
* `abide start` and `abide dev` assemble from the same code, and differ in three
decisions: where the bundle came from, what a taken port means, and whether Bun's `development` is on.
* `abide dev` is ONE process: the main thread watches and owns the lifecycle, and a WORKER holds the
app. Replacing that worker is the reload. What has to be thrown away is a module graph, not an
operating system process — a graph is cached by resolved path and cannot be evicted, so re-importing
`app.ts` behind a cache-busting query would reload that one file while every module it imports stayed
as it was, leaving the app half of two versions with nothing saying so. An isolate is the smallest
thing that contains a whole graph, so terminating one is the reload. There is no dependency graph
deciding that a css edit "only" needs the client rebuilt.
* Everything a child process would have cost is therefore absent rather than handled: no stdout to
relay and no colour lost to relaying it, no IPC to carry the port back, no exit code to forward, no
signal to pass down, and no way to leave a server running that outlived its supervisor — killing the
pid takes the socket with it, because it is the same pid.
* The dev bundle is `Bun.build` into memory: unminified, and entry-named by its SOURCE (`client.js`, not
`client-<hash>.js`) so a breakpoint and a stack frame survive a rebuild — which is what `no-store` on
every dev asset pays for. Nothing is written so `abide dev` cannot leave a
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
* `abide logs` asks `ABIDE_APP_URL`, then `APP_URL`, then `config().PORT` on localhost, and sends `ABIDE_APP_TOKEN`
as a bearer for whatever is in front of the app; the feed's own gate is `ABIDE_LOGS`, and a closed one
answers 404 → exit `5`. Nothing answering at all has no status to map → exit `1`.

# Documentation

* A documentation site should be a package under `packages/dogfood`
* Every user-exposed behavior or capability should be documented as real .abide and/or .ts files as EXAMPLES.
* All EXAMPLES should also be benchmarked and a part of end-to-end testing.
* Benchmarking should take into account DOM work, repaint/reflow, wall time ms, render frames, cpu/memory. All benchmarks should be exposed 
* EXAMPLES and prose should be product-focused, not engineering focused. Not what can it do, but what problem does an app author use it to solve.
