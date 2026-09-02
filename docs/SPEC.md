# Reactive primitives

## `state` — the owned value

| Name | Type Signature | Description |
| --- | --- | --- |
| `Reactive` | `Reactive<Stored = undefined, Failures = never, Produced = Stored>` | A reactive value, and the only face any of the four hands back. `Produced` is the unit the producer yielded and what a cursor walks: `Stored` for a state and a room, the chunk for a streaming producer whose `Stored` is the accumulation. `Failures` is the union of `Failed<Name, Data>` its producer declared — inferred from an rpc handler's return type, a memo body's, a refusing `transform`, and `Failed<'ValidationError', Issues<…>>` wherever a `schema` is. A union of values, not of names, so the data type rides along and `isError` narrows to it with no registry to consult. |
| `Accepted` | `unknown` | What `set` and `state` accept, before `schema` and then `transform` run, and settled. Either takes a value or a load — `Accepted \| Promise<Accepted>` — and an unsettled one makes the `Reactive` loaded, at construction and at every write alike. |
| `Stored` | `unknown` | What is held and what a read returns, after `transform`. Identical to `Accepted` without one; a `schema` never moves the two apart, returning what it stores. |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | Shapes the value untracked into what is stored, and may refuse it by returning a `Failed`. Both gates refuse, and which you reach for is what you refuse with: a `schema` refuses as `ValidationError` carrying `Issues<T>`, this refuses under a name the app declared — `notAnEmail({ value })` — which is the only way a refusal reaches `isError` by name with data of its own. IT RUNS ON `Stored`, ONCE PER MATERIALISATION OF ONE: per write on a state, per publish on a room, once at close on a stream, on the accumulated chunks and never per chunk. Never on the promise. A refusal rejects the write — see "A rejected write is not a failed production". |
| `state` | `<Accepted, Stored = Accepted, Failures = never>(initial: Accepted \| Promise<Accepted>, options?: ReactiveOptions<Accepted, Stored, Failures>) => Reactive<Stored, Failures>` | `Reactive` factory. `Accepted` is the settled type: a state holding something unsettled serves the value, never the promise, so `state(fetchUser())` is a `Reactive<User>` and `user.set(edited)` writes a `User`. |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys, and an opt-in tightening: a key it declares is checked against it, one it does not is inferred from the thunk. What it buys is that two modules cannot disagree about `Stored` under one name. |
| `state.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the current scope by `key`. One call rather than a share/read pair, so there is no ordering hazard and no miss to define. A non-literal key is a build error — read off the AST the way a parameter's `= 20` is — which bounds the key set to what the source spells. A per-caller `Reactive` is what a `channel`'s args are for. |

### `ReactiveOptions`

`ReactiveOptions<Accepted, Stored = Accepted, Failures = never>` — what every `Reactive` takes, which
`state` takes outright and `MemoOptions` and `ChannelOptions` extend. Every member is defined over
productions rather than over an owned value: `tail` counts what the producer yielded, `ttl` is the life
of one, `identity` decides whether one happened, and `schema` and `transform` are the two gates each
one passes. A keyed `memo` is the one extender whose input is not the write, so it re-declares `schema`
over its `Args`.

| Name | Type Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Accepted>` | What a valid input is — the gate on the way in, where `transform` is the shaping on the way to storage. It runs first, on the settled value, and what it returns is what `transform` receives. It refuses by throwing, where a `Transformer` refuses by returning; the option name is the discriminant, so there is nothing to disambiguate. A refusal is `Failed<'ValidationError', Issues<Accepted>>`, contributed to `Failures` without being declared, and a throw is caught and converted rather than escaped — a refused write fills `error()` rather than reaching a `{:catch}`, which is what a `bind:` field reads through. It runs where the `Reactive` lives: declared in `#ui` it checks in a browser, in `#server` on a server, in `#shared` wherever it was used. |
| `transform` | `Transformer<Accepted, Stored, Failures>` | What is stored: normalise, reshape, or refuse by returning a `Failed`. `{ transform: (all) => new Set(all.map((r) => r.id)) }` is the shape of it, with no validation in it — which is why it is not the input gate. Without one, `Stored` is `Accepted`. |
| `identity` | `(value: Stored) => unknown` | What makes it the same value. Readers wake when this moves, not when the reference does, and it compares the new `Stored` against the previous one. Where a production is the `Stored`, one whose identity matches DID NOT HAPPEN — not retained, nobody woken — so the ring and the wake-up cannot disagree about what arrived. Default `(value) => value`, the reference, so nothing collapses unless an app asks: two separately built messages are never reference-equal, and a double-sent chat line is still two `seq`s. `canonical` is exported for the common opt-in and is the builder a memo key uses. It is not the default for objects: canonicalising is O(size) per `set`, per recompute, per publish — a cost per write buying a cheaper read. On a streaming producer it gates the value face alone; the chunks were in the ring before there was a `Stored` to compare. ONE TOKEN IS HELD, NEVER A SET — uniqueness is against the previous `Stored`, never against the tail, so it is O(1) memory at any `tail`. |
| `tail` | `number` | How many past productions are retained for a later reader to replay. Default 1 — latest only. A memory ceiling and nothing else, and the default a bare `s.tail()` replays. THE UNIT IS WHAT THE PRODUCER YIELDED: a `set` yields a value, a `publish` a message, a stream body a chunk. So `room.tail(100)` is a hundred messages and a `tail` on a `Reactive<Row[]>` is a hundred arrays — pushing into an array is a mutation of one value, not a production. Where a tail over items is wanted, the item is what gets produced. |
| `ttl` | `number` | The life of a retained production. Default: infinity. At the default `tail` a `Reactive` retains one — the current value — so past its `ttl` a producer recomputes on the next read; a room at `tail: 100` retains a hundred, each on its own clock. On a value with no producer it is inert rather than destructive: it never drops what an app put there. It still reaches a state that was given a load. |

### Expectations

* `Stored` can be anything in javascript.
* The probes are `Reactive`'s, not `memo`'s. A state handed something unsettled already reports
`pending()`, `refreshing()` and `error()`, already opens a sink, and already has `tail` and `settled`.
What a keyed `memo` adds is identity per args, which coalescing, `ttl` and `invalidate` are built on;
an unkeyed one adds a body, which is what makes it recompute.
* Readers are notified only when read identity changes, and `identity` decides it.
* A READ RETURNS WHAT IT HAS AND NEVER AWAITS — the value where one landed, `undefined` where none has.
`{await s}` and `{#await s then v}` block; `{#await s}{:then v}` renders its pending branch instead.
`pending()` is what tells `undefined`-because-in-flight from a value that resolved to `undefined`.
* A SINK IS OPENED BY `pending()`, NOT BY AN ABSENT VALUE. A derived memo HOLDS a value built from an
in-flight source, so keying the sink on absence would flush that placeholder as the answer and never
correct it — "0 invoices" in the document a scriptless client keeps. `refreshing()` opens none: a value
being served is the answer until a better one lands.
* A READ THROWS ONLY WHERE THERE IS NOTHING TO SERVE. A producer whose first load failed has no value,
so the read throws and the failure reaches the nearest `{#try}` or `error.abide`. A rejected write and a
failed revalidation both leave a value standing, so neither throws. Probes never throw, so
`s.success() ? s() : fallback` is how a caller declines to escalate.
* A REJECTED WRITE IS NOT A FAILED PRODUCTION. A `schema` or `transform` that refuses rejects the
write: nothing is stored, no production is minted — so the ring, `tail` and every cursor never hear
about it — and what moves is the standing refusal alone. `error()` fills, `isError` narrows it, and the
value and its readers are untouched, so `<input bind:value={email}>` goes on rendering the last
accepted value beside the message its refusal carried. A failed revalidation is the same shape:
`refresh()` is stale-while-revalidate, so a reload that fails leaves what was being served being
served and leaves `{:then}` mounted.
* AN ACCEPTED WRITE OR PRODUCTION CLEARS THE STANDING REFUSAL, or a form goes on showing a message for
a field the caller already fixed. `success()` and `error()` are therefore orthogonal rather than
opposite — one asks whether there is a landed value, the other whether the last write was refused.
* WHAT THAT COSTS IS THAT A FAILED REVALIDATION NO LONGER ESCALATES: nothing unmounts, nothing reaches
a `{:catch}`, and an app that never reads `error()` serves stale data with no sign of it. It warns on
`abide:reactive`, naming the value.
* Retention is append-only: a ring of `tail` entries, a version bump for readers, and the snapshot
materialised on the read that follows. Raising `tail` must not make a write dearer.
* `ttl` EXPIRY WAKES NOBODY. Entries past it are dropped on the read that follows — no timer per
entry, no version bump, since a timer that moved the version would put retention's cost back on the
write. A live cursor delivers arrivals and never sees an expiry; `tail` bounds what a later subscriber
replays, and a later subscriber is the only reader an expiry is visible to.
* A ROOM IS NOT A STREAM, and the difference is what the producer declared rather than anything a
runtime sniffs. A `channel` declares `Message`, so every publish is a whole one. A `memo` or rpc body
that is an async generator declares chunks of one `Value`, so no chunk is a whole anything.

| | the producer yields | `pending()` until | a bare read `s()` | `tail(n)` |
| --- | --- | --- | --- | --- |
| room — `channel` / `socket` | a complete `Message` | the first message | the latest message | the last n messages |
| stream — async-generator `memo` / rpc | a chunk of one `Value` | it closes | the accumulation, materialised on close — `undefined` before it | the last n chunks |

* So `{room}` is the latest message and `{await room}` blocks until the first one. `done()` stays
false while a room is live, so `{:finally}` does not mount on one. What holds forever is an async
generator that never returns, and that is the author's to resolve.
* A streaming producer's `Stored` is the accumulated chunks, materialised once on close, which is why
`pending()` runs to the close rather than to the first chunk: with nothing complete to serve before
then, the accumulation is O(n) rather than the `concat`-per-chunk O(n²) the retention rules refuse.
* `transform` is the join, which is what keeps one `Reactive` serving both shapes:

```ts
const answer = memo(() => complete({ prompt }), { transform: (chunks) => chunks.join('') })
// {#for await token of answer}   → tokens as they arrive
// {await answer}                 → the whole string, once the stream closes
```

* `state.share` is scoped the way a memo's default scope is — request-local on a server, process-local
in a browser. On both sides the scope is one caller, and what differs is only what a caller is there,
so caller-specific is exactly what belongs in one. On a server that makes it what a page render uses
to share a `Reactive` between two components without threading a prop between them.
* A shared state is never evicted within its scope — it goes when the scope does. A `global` memo entry
may be dropped early because it can be rebuilt; a shared state cannot be, and dropping one would orphan
live readers reading a value nobody can refresh.

### Reads

| Name | Type Signature | Description |
| --- | --- | --- |
| `s` | `() => Stored` | Read current value. |
| `s.set` | `(value: Accepted \| Promise<Accepted>) => void \| Failures` | Set current value, and the only `set` in the design — `m.set(v)` on an unkeyed memo, `m(args).set(v)` on a keyed one and `room.set(message)` are all this member reached three ways. Takes what the transform takes, settled or in flight, and hands back only its refusal; `s()` is the read. Where no transform refuses, `Failures` is `never` and this is `void`. On a memo the returned union is one arm too wide, a write running the transform and never the body — the trade taken rather than a fourth parameter on the most-used type in the design. |
| `s.peek` | `() => Stored` | Read without joining the flow. Otherwise identical to `s()` — it starts work and throws what a read throws. "Held, but do not load" is `s.success() ? s.peek() : fallback`, a probe never starting work. |
| `Tail<Produced>` | `Iterable<Produced> & AsyncIterable<Produced>` | What `s.tail` hands back: the snapshot pulled synchronously, the live cursor pulled asynchronously, nothing allocated until one of the two is. |
| `s.tail` | `(n?: number) => Tail<Produced>` | Always called. A cursor over what was produced, per `tail`'s unit rule: `[...s.tail()]` is the snapshot, `for await (… of s.tail())` replays that snapshot and then goes live from where it ended, so a reader sees no gap and no duplicate. `n` IS REPLAY DEPTH AND NOTHING ELSE — `min(n, retained)`, defaulting to `retained` — so it says how far back a reader starts and nothing about what a block accumulates. `tail(0)` replays nothing and goes live. NOT an array: patching `Symbol.asyncIterator` onto one is a shape mutation per call. |
| `for await (… of s)` | `AsyncIterable<Produced>` | The live cursor face of a read. |
| `s.settled` | `() => Promise<Stored>` | The settled value, and the only way to wait on one. It resolves when `pending()` goes false, so on a derived memo it waits for the sources rather than for the body. A `Reactive` IS NOT THENABLE, which is a decision rather than an omission: `await` assimilates a thenable unconditionally and unobservably, so a `Reactive` reaching ANY promise boundary would come back as its settled value with the adoption, the `Failures`, the `Produced` and a room's `publish` gone — and the output plausible throughout. `{await expr}` is a lowering rather than a JavaScript `await`, and assimilation reaches `then` and nothing else, so the cursor face never moved. |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | Subscribes and receives new values. Defined as `tail()`, so the bare form cannot mean something a spelled-out `tail()` does not. `tail(0)` is how a reader asks for live-only. |

### Probes

Probes never throw and never start work. Reading one subscribes to that probe: a value change does not
wake a `refreshing()` reader, and a `refreshing()` flip does not wake a value reader. The signal is
per-probe and built on first read, so probes nobody asks for cost no allocation — the contract is the
wake-up, not the representation, and it is asserted by counting effect re-runs rather than by reading
values. On an unkeyed memo `pending()` also answers for what the body read — see "Propagation".

| Name | Type Signature | Description |
| --- | --- | --- |
| `s.pending` | `() => boolean` | A first load is in flight and there is nothing to show — its own, or any value its body read. A stream reports this until it closes, chunks being parts of one value; a room only until its first message. That is what leaves no state in which none of `{#await}`'s branches is mounted. `streaming()` is what a progress indicator inside the pending body reads. |
| `s.refreshing` | `() => boolean` | A reload is in flight over a value still being served. its own only — see "Propagation". |
| `s.done` | `() => boolean` | It has finished, however it finished, and stays true through a `refresh()` — the load that finished still finished. That is what keeps `{:finally}` mounted where `refreshing()` moves. |
| `s.success` | `() => boolean` | There is a landed value to serve and nothing is still arriving. Orthogonal to `error()` rather than opposite: a rejected write or a failed revalidation over a landed value leaves this true and fills `error()` too, which keeps a refused `bind:` field on screen. Stays true through a `refresh()`. "Still arriving" is about an unfinished stream, never about a refresh. A value with no producer has landed at construction: `state()` with no initial is `success()` true and `undefined`. |
| `s.streaming` | `() => boolean` | It is currently producing chunks. |
| `s.error` | `() => unknown` | The standing refusal: what the last write or production was refused with, `undefined` where none was. Not only what it ended with — a rejected write and a failed revalidation both fill this over a value still being served, and the next accepted write or production clears it. |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. A predicate: matching narrows `error.data` to what that failure declared. |

### Triggers

Every `Reactive` carries them, not only a memo — `s.refresh()` on a `state(fetchUser())` reloads it for
the same reason `ttl` reaches one. What is bounded to producers is the sweep rather than the member:
see "Selections".

| Name | Type Signature | Description |
| --- | --- | --- |
| `s.invalidate` | `() => void` | Marks it stale: the next read is fetched fresh rather than served from what is held. Inert on a value with no producer. It does not itself hold rendering — whether a template waits is the template's own choice of form. |
| `s.refresh` | `() => void` | Stale while revalidate: what is held keeps being served, and `s.refreshing()` is true, until the new value lands. Inert on a value with no producer. |

### Effects

| Name | Type Signature | Description |
| --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | Runs effects on value change; returns the way to stop it. See `watch` below. |

## `memo` — the loaded value

| Name | Type Signature | Description |
| --- | --- | --- |
| `Memo` | `((args: Args) => Reactive<Stored, Failures>) & { invalidate(pattern?: Partial<Args>): void; refresh(pattern?: Partial<Args>): void }` | What a keyed memo is: a factory with the two triggers on it, the factory being what has an args space to narrow over. An unkeyed memo is not this — it is a `Reactive`, which is what makes `{doubled / 2}` and `data.refreshing()` read by name. THE DISCRIMINANT IS THE BODY'S PARAMETER, which is syntax: `memo(() => …)` is unkeyed and tracked, recomputing whenever anything it read changes; `memo((args: A) => …)` is keyed and untracked, one entry per args key whose only ways back are `ttl`, an explicit `invalidate` / `refresh`, and eviction. Both are writable. `Failures` is inferred from the body AND from a refusing `transform`, the same way an rpc's is from its handler — a body may `return myError(data)` and a reader narrows it with `isError`. |
| `Args` | `Record<string, JsonValue> \| undefined` | The key. Serializable by contract, because the key is the wire form. |
| `memo` | `<Computed, Stored = AdoptedValue<Computed>, Failures = never>(body: () => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures>) => Reactive<Stored, AdoptedFailures<Computed> \| Failures, AdoptedProduced<Computed>>` | Unkeyed. Hands back a `Reactive` and nothing wrapping one, so every probe, trigger and `set` on it is the member `Reactive` already declares. |
| `memo` | `<Computed, Args, Stored = AdoptedValue<Computed>, Failures = never>(body: (args: Args) => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures, Args>) => Memo<Stored, Args, AdoptedFailures<Computed> \| Failures>` | Keyed. Two overloads rather than one signature with an optional parameter: the two hand back genuinely different things, and an `args?` collapses them into a type neither one is. `Stored` defaults to the adopted value rather than to `Computed`, so a body returning a `Reactive` types as its payload; the transform takes the same, running after adoption. `Args` reaches `MemoOptions` here and only here, so `schema` and the function form of `tags` are spellable on this overload and unspellable on the other — the discriminant that is syntax at the body is a type at the options. See "Adoption". |

### Triggers

These are the keyed memo's, on the factory, and they take a pattern because the factory is what has an
args space. An unkeyed memo reaches `Reactive`'s own two, which take none — see "Triggers" under `state`.

| Name | Type Signature | Description |
| --- | --- | --- |
| `m.invalidate` | `(pattern?: Partial<Args>) => void` | Defined as `invalidate(m)` narrowed by args — see "Selections" — not a second mechanism. Marks every matching entry stale: the next read is fetched fresh rather than served from what is held. It does not itself hold rendering — whether a template waits is the template's own choice of form (`{await m(args)}` and `{#await m(args) then v}` wait, `{#await m(args)}{:then}` does not). |
| `m.refresh` | `(pattern?: Partial<Args>) => void` | Defined as `refresh(m)` narrowed by args, the same way. Stale while revalidate: what is held keeps being served, and `m(args).refreshing()` is true, until the new value lands. |

### Writes

* A memo is writable, and a write stands until the next recompute clobbers it. On an unkeyed memo that means it survives until something the body read moves — which is what makes `memo(() => structuredClone(upstream))` a local draft re-seeded from its source, one primitive rather than a second one beside it.
* There is no warning on the write: `memo(() => structuredClone(upstream))` and `memo(() => a + b)` are indistinguishable to a compiler, neither having an lvalue, so a warning would fire hardest on the good pattern.
* There is one `set` and it is `Reactive`'s. A keyed memo is a factory, so the write is on the invoked result — `m(args).set(v)` is one entry — and an unkeyed memo is a `Reactive`, so `m.set(v)` is that same member reached directly.
* A write of a settled value is not a load: it leaves `success()` true and `refreshing()` false, and moves no probe. A write of an unsettled one is a load and moves the probes the way any load does. That is the existing probe definitions applied to a write rather than a second rule, and it is what makes `set` mean the same thing at construction and after it. A recompute landing while such a write is in flight clobbers it, as it clobbers a settled one.

### Adoption

* A `Reactive` returned from a memo body is adopted, not stored. ADOPTION IS A MIRRORING SUBSCRIPTION, not transparent forwarding: the outer memo is always its own `Reactive` — it subscribes to the inner, mirrors its productions into its own ring, runs `transform` on the way in, and forwards its probes and triggers. That is what lets every memo carry every option with each one applying to itself: `tail: 50` on the outer is the outer's retention and needs no adjudication. Without adoption the outer is a `Reactive<Reactive<Value>>` and `data.name` reaches the wrapper rather than the payload.
* What mirroring costs is one slot per retained production and one push plus a version bump per production — a pointer write, not a copy of the payload, the outer's ring holding the same objects the inner's does. `transform` is the one arm that allocates per production and that allocation is the transform's, not adoption's. The ratio is owed per production against reading the inner directly, and asserted by counting WAKE-ups rather than ms: the failure that would falsify it is an outer keeping subscriber bookkeeping where a pointer write was claimed, which leaves every value right.
* Extra members are forwarded by delegation, which is what keeps a room a room: `memo(() => chat({ id }))` is a `Room`, and its `publish` reaches whatever is currently adopted. Mirroring carries productions and delegation carries members, and `publish` is the only member there is to carry.
* On re-adoption the outer clears where the newly adopted `Reactive` has nothing to serve, or mirroring goes on serving the old value across a swap — stale-while-revalidate by accident.
* The unwrap is in the type, not only in the prose — three names, each one thing:

```ts
type AdoptedValue<T>    = T extends Reactive<infer Inner, any, any>    ? AdoptedValue<Inner>
                        : T extends Promise<infer Settled>              ? AdoptedValue<Settled>
                        : T extends AsyncIterable<infer Chunk>          ? Chunk[]
                        : Exclude<T, Failed<any, any>>
type AdoptedProduced<T> = T extends Reactive<any, any, infer Unit>     ? Unit
                        : T extends Promise<infer Settled>              ? AdoptedProduced<Settled>
                        : T extends AsyncIterable<infer Chunk>          ? Chunk
                        : AdoptedValue<T>
type AdoptedFailures<T> = T extends Reactive<infer Inner, infer F, any> ? F | AdoptedFailures<Inner>
                        : T extends Promise<infer Settled>              ? AdoptedFailures<Settled>
                        : Extract<T, Failed<any, any>>
```

  Four arms, each one a rule already stated in prose. The `Reactive` arm is the unwrap. The `Promise` arm is `state`'s own rule reaching the other producers: a body returning something unsettled is a load and what is held is the settled type, so `memo(async () => rollUp(rows))` is a `Reactive<Rollup>`. It RECURSES rather than unwrapping once, which carries an async body returning a stream to `Chunk[]` and one returning a room to a room. The `AsyncIterable` arm gives a streaming body a `Stored` of `Chunk[]` and a `Produced` of `Chunk` — the unit rule in the type rather than beside it. The `Failed` exclusion stops a body that may `return myError(data)` widening `Stored` with the value A READ IS SPECIFIED TO THROW; the refusal belongs in `Failures`, and in `AdoptedFailures` the `Promise` arm is what stops an async body's refusal landing in `Stored` too.

  `Failures` accumulates down the same recursion the value unwraps on, so `memo(() => getData(args))` is `Reactive<Value, Failures>` and `data.isError(error, 'DataAccessDenied')` narrows through the wrapper. Recursive, so a memo of a memo of a state collapses in one loop on both sides at once — the runtime loop and the conditional bottom out on the same condition.
* The `transform` option is what adoption leaves room for, and why `Computed` and `Stored` are two
parameters. It runs after adoption, on the settled payload, which an inline expression cannot do —
READING THE `Reactive` TO TRANSFORM IT IS WHAT LOSES THE ADOPTION:

```ts
memo(() => new Set(getUsers(args).map(u => u.id)))             // reads the `Reactive` → adoption LOST
memo(() => getUsers(args), { transform: (u) => new Set(u.map(…)) })  // adopts, then transforms it
```

* The outer memo is what makes the call reactive to its args: a `<script>` setup body is untracked, so the rpc call alone registers nothing. The wrapper is load-bearing rather than ceremony.
* Adoption is also the identity cutoff: a recompute landing on the same inner `Reactive`, the same args key hitting the same entry, wakes nobody. This is the one place the freshly-built-wrapper failure would otherwise bite, and it is asserted by counting wake-ups rather than by reading values.
* On a swap the outer read reports `pending()` only when the newly adopted `Reactive` has nothing to serve. An args key that hits a live entry adopts synchronously and no reader sees pending — not for a microtask — so re-filtering to a key already held, and back/forward, never flash.

### Propagation

Adoption is the RETURN position and this is the READ position. A body that returns a `Reactive`
adopts it and forwards its probes; a body that reads one and returns something derived from it
forwards nothing without this, leaving a memo that reports `success()` over a value it built out of
`undefined`.

* EXACTLY ONE PROBE PROPAGATES, and it is `pending()`. An unkeyed memo answers it for its own load OR
for any value its body read. Without it a derived memo is silently wrong for the length of every load:
a read of an in-flight `Reactive` returns `undefined` and never awaits, so
`memo(() => (rows() ?? []).filter(…))` runs to completion, hands back `[]`, and reports `success()` — a
page rendering "0 of 0" with nothing pending and nothing failed. The output is plausible the whole
time, which is what makes this a wake-up to assert rather than a value to test.
* It is DERIVED AT RECOMPUTE AND SUBSCRIBED TO NOTHING, which is why it is affordable. `pending()` is
monotone — a source leaves it once, when its first load lands or fails — and either way the source's
VALUE moves, waking this memo through the value subscription it already took. So the count is taken on
the walk the body's reads already make, and the transition that could invalidate it is the event that
recomputes. One branch per read, no signal per source, nothing to tear down. The memo's own `pending` signal is bumped at
recompute where the count crossed zero, so a reader wakes once however many sources moved, and depth is
O(chain) rather than O(transitive sources).
* `refreshing()` does not propagate, and the asymmetry is a cost rather than an oversight. It is not
derivable the way `pending()` is: a reload can start and finish without the value moving, so there is
no recompute to recount on and the only way to learn is a subscription per source, torn down and
rebuilt every recompute. That is N subscribe/unsubscribe pairs per recompute to drive a spinner. So a
derived spinner reads the source's own probe — `rows.refreshing()` — which is the truer spelling
anyway, the thing reloading being `rows` and not the memo mapping over it.
* `error()` needs no clause and gets none. A source with nothing to serve THROWS on the read, so the
body fails with it and the failure is the outer's own — propagation for free out of the read rule,
which is what leaves `pending()` as the one probe that had no path.
* ONLY A VALUE READ JOINS. Reading a PROBE subscribes to that probe and is not a read of the value, so
`memo(() => rows.pending() ? 'loading' : 'ready')` does not make itself pending, which any rule stated
over "what the body touched" would have forced. `peek()` is the other way out: it reads without
joining the flow, so it does not join this either.
* A keyed memo propagates nothing, its body being untracked — there is no set to aggregate over, and its
`pending()` is its own load exactly as it was.
* What it costs is that `pending()` stops meaning "my body has not produced a value" and starts meaning
"nothing I depend on is still in flight". The two differ at the case above — a memo holding a usable
value derived from an absent input — and that difference is the point.
`done()` and `success()` are false while `pending()` is true, which is what keeps `{#await}`'s four
branches covering every state with no fifth probe owed — a body that ran is not a load that finished
when what it read has not arrived. `settled()` resolves on the same condition, so `{await visible}`
waits for the sources rather than for the body.

### Keys

* An `Args` object becomes a key by its canonical wire form — the same serialization the transport uses, keys sorted, `undefined` members dropped, `Date` written ISO. One canonicalization rather than two: args that cannot be keyed are exactly args that cannot be sent, so both fail in the same place — which is true rather than nearly true because `GET`/`DELETE` args are narrowed to what a URL can carry (see "rpc").
* A key is therefore structural, which is what lets `memo(() => ({ id }))` build a fresh object every run and still land on the same entry.
* THE KEY IS TAKEN BEFORE `schema` RUNS, and the order — Coerce, apply syntax defaults, canonicalize, validate, then the body — is forced rather than chosen. A browser holds no copy of `args`, so a key taken after the schema would be computed one way on a server and another in a browser, and every handler with a normalising schema would miss its seed buffer and re-issue the call on hydration. Coercion is in front because it RECONCILES the two sides rather than transforming either: deterministic from the declared `type`, so a caller holding `20` and a server coercing `"20"` land on one canonical form.
* So a schema refuses and does not decide identity. A normalisation in one — `z.string().toLowerCase()` — runs after the entry is already filed, so it changes what the BODY sees and never which entry it is: `{ id: 'ABC' }` and `{ id: 'abc' }` are two entries, and on a `channel` two rooms, whose publishers and subscribers never meet. Nothing warns, both keys being valid. That is the cost of the key being the wire form, and the repair is not a schema: args that must collapse are normalised by the caller, or typed so the variation cannot be spelled.
* A DEFAULT IS THE ONE EXCEPTION, and it is syntax rather than schema. `({ limit = 20 })` publishes `default: 20` (see "Schemas"), the build reads it off the AST as a JSON literal, and it is emitted into the generated client wrapper — one object per handler that has any — so both sides canonicalize `{ ...DEFAULTS, ...args }` and `getInvoices()` and `getInvoices({ limit: 20 })` land on ONE key. Without it the commonest args pattern there is double-loads silently. A `.default(20)` written in the schema instead does not participate, being post-key normalisation — one rule, DEFAULTS ARE SYNTAX — and the build warns where a schema declares a default the parameter does not, that being the shape whose cache silently halves.
* `Args` is always plain `Args`. A reactive value in an argument position READS; recomputation is the enclosing unkeyed memo's job, which is what `memo(() => getData(dataArgs))` is doing.

### Scope

* A memo without `global` is request-local on a server, and process-local in a browser, where there is one caller and no request. It is built and dropped with its scope, so `ttl: Infinity` means to the end of that scope rather than forever, it cannot grow without bound, and one caller's answer can never be served to another.
* `global: true` opts into a process-wide cache that outlives every request. `principal` does not bound it, so anything caller-specific belongs in its `Args`.
* A `global` memo is bounded by its own `ttl` and the app's `invalidate`, and by nothing abide supplies. There is no byte ceiling and no eviction policy: measuring an arbitrary `Stored` costs the O(size) walk `identity` already refuses to pay by default, and an LRU count would evict an entry a reader is mid-flight on. So `global: true` with `ttl: Infinity` is an unbounded cache, and it is unbounded because the app asked for it — the bound is a number the app knows and abide does not.
* `global: true` IS A BUILD ERROR ON A BODY THAT READS THE REQUEST SCOPE — `request()`, `principal`,
`cookies()`, `csp.nonce()`, `route` — and the error names the ambient. A global entry outlives the request
that built it and is served to every caller after, so a request ambient inside one bakes the first
caller's request into an answer everybody else gets: the whole class of "anything caller-specific
belongs in its `Args`" is this, and stating it as advice leaves it to be remembered per call site. It
is the same list, found the same way `render` finds it — run the body with no request scope and collect
what throws — so a body that reaches one dynamically throws where it reads instead of at build. This is what licenses
deriving `cache-control` from a global memo's `ttl`: not a promise the app made and might have broken,
but a shape the build refused to compile.
* Coalescing is within a scope: two calls inside one request share one load; two concurrent requests are two scopes and load twice. `global: true` is therefore the only thing that makes two callers one load, which is what it is for where the load is expensive — an inference, a warehouse scan.
* A `global` Memo over a stream fans one producer out, and the one thing it needs is `tail: Infinity` — retention is asked for, the default being 1 like every other `Reactive` rather than a hidden branch on whether the body produced a stream. With it the entry holds the whole transcript and a reader arriving mid-stream is a bare `tail()` — replay what landed, then live from where the replay ended, no gap and no duplicate. That is the cursor's existing contract, so N readers at N positions is one producer and one `tail`. Without it a late reader replays one chunk and goes live — a truncated answer rather than an error, which is the cost named under `MemoOptions`. A reader leaving is `signal`'s existing rule: it detaches that reader and the producer runs on for the others, which is what stops one closed tab cancelling everyone's inference.

### `MemoOptions`

`MemoOptions<Accepted, Stored, Failures, Args = undefined> extends ReactiveOptions<Accepted, Stored, Failures, Args>`, so `schema`,
`transform`, `identity`, `tail` and `ttl` are
the `Reactive`'s own and mean there what they
mean everywhere — `ttl` being the life of a retained production wherever it is written, and a memo
always having a producer to recompute with when one lapses. `tail` defaults to 1 like every other `Reactive`: a `global` memo fanning one stream
out to late readers spells `tail: Infinity`, rather than getting it from a hidden branch on whether
the body produced a stream. The seed buffer is not the memo's `tail` — hydration is answered from the
buffered transcript whatever the memo retained, so the default costs the ordinary render/hydrate path
nothing. What it costs is a late subscriber on a default memo, which replays one chunk and goes live —
a truncated answer, and the same failure a chat room's default retention of 1 has.

Shape is here for the reason retention is. A memo is what has a BODY, so it is what the build derives
both schemas from — the value's from the return annotation, the args' from the parameter and its
defaults — and declaring the override anywhere else splits the inference site from the repair site.
`schema` gates the input and `transform` shapes the output, both inherited from `ReactiveOptions`, and
RE-DECLARING `schema` over `Args` is the whole of the re-targeting — a memo's input is what its body
takes rather than a written value. An unkeyed memo, consuming nothing, cannot spell it at all. A channel is the one producer whose selector is not its input: the room key picks
which room, and the message is what flows, so it keeps a separate `args` and that asymmetry has a
reason rather than being an oversight. `RpcOptions` and
`SocketOptions` are therefore left with no schema at all, and `RpcOptions` lost its `Value` parameter
with the one that used it — what it carries instead is `RungFailures`, its rungs refusing with the same
`Failed` a handler does. The transport READS these instead — to coerce, to publish an OpenAPI
operation, to build an MCP tool definition — the way it already reads `ttl` and `tail` off what was
passed. `GET(getInvoice)`
and `POST(getInvoice)` therefore state the shape once between them, and an in-process caller gets the
check a wire caller gets.

| Name | Type Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Args>` | `ReactiveOptions`'S own, narrowed to `Args`: a memo's input is its args, the body being what consumes them, so `schema` here checks the args rather than a written value. Unspellable on the unkeyed overload, where `Args` is `undefined` — a memo with no parameter has no input to check, and that is a compile error naming the overload rather than an option that quietly does nothing. A write through `m.set(v)` is gated by `transform`, which is where a memo's value end already was. It refuses and does not normalise the key — the entry is filed before this runs, so a normalisation here changes what the BODY sees and never which entry it is. See "Keys". Derived from the parameter's annotation and its defaults when not given, by the rules in "Schemas". |
| `global` | `boolean` | Opts out of the default scope into one `memo` shared by every caller in the process. |
| `tags` | `string[] \| ((args: Args) => string[])` | What a `Selection` matches on, which is the only thing that reaches across memos — `invalidate({ tags: ['invoice'] })` marks every entry carrying one, wherever it was declared. The function form receives the memo's `args`, so a tag can name the row rather than the query. |
| `throttle` | `number` | Revalidation of a `memo` fires immediately, then at most once per window — However triggered, an unkeyed memo's dependency-driven recompute as well as an explicit `invalidate` / `refresh`. Inside the window the held value is served and `refreshing()` is true, which is the `refresh()` contract already and no new probe behaviour. |
| `debounce` | `number` | Revalidation of a `memo` waits until the triggers stop, however triggered. DECLARING BOTH IS A build error naming the memo: two windows over one revalidation is a disagreement rather than a composition, and picking a winner is a rule every reader has to carry to know what one of the two numbers does. |

## `channel` — the subscribed value

| Name | Type Signature | Description |
| --- | --- | --- |
| `Channel` | `<Message, Args, Failures>(args?: Args) => Room<Message, Failures>` | A room keyed by `args`, that anyone may publish to and anyone may read. |
| `Room` | `Reactive<Message, Failures> & { publish: (message: Message) => number \| Failures }` | WHAT A ROOM IS: a `Reactive` whose value is the latest message, plus `publish`. So a bare read is the latest, `room.tail(n)` is the cursor, the probes answer, and there is no second `Reactive` type to learn — `{room}` and `{#for await m of room.tail(100)}` are the same two spellings every other `Reactive` has. `publish` hands back the `seq` it minted, or the `Failed` `transform` refused it with — the same two on both sides, `transform` running wherever the publish came from. A publish `identity` deems a consecutive duplicate mints nothing and hands back the STANDING `seq`, the production that now represents the message: the caller always holds a `seq`, so a collapsed publish leaves nothing dangling and is not a third return arm to switch on. It is typed `number \| Failures` exactly as `s.set` is `void \| Failures`, a room's publish being its write. |
| `Args` | `Record<string, JsonValue> \| undefined` | The room. Keyed by the same canonical wire form a memo's args are. |
| `Message` | `unknown` | Message type |
| `channel` | `<Message, Args, Failures>(options?: ChannelOptions<Message, Failures, Args>) => Channel<Message, Args, Failures>` | Channel factory. `Failures` is inferred from what `transform` may return, the same way every other `Reactive`'s is. |

### `ChannelOptions`

`ChannelOptions<Message, Failures, Args> extends ReactiveOptions<Message, Message, Failures>`, so `schema`,
`transform`, `identity`, `tail` and `ttl` are the `Reactive`'s own here too and mean what they mean
everywhere. `Accepted` and `Stored` are both `Message`, a publish handing over the value that lands and a room having
no second shape to normalise into. `identity` therefore reads on a room as consecutive duplicates
collapse, by the same one-production rule it follows everywhere: a publish it deems unchanged is not a
production, so it neither enters the tail nor wakes anyone, and the ring and the cursor cannot disagree
about what arrived. THAT IS DEDUPE AGAINST THE PREVIOUS MESSAGE AND NOT AGAINST THE TAIL — a scan of `tail` entries per
publish would make raising retention dearer per write. The default being the reference, a room
collapses nothing until it asks: a presence room spelling `identity: canonical` stops republishing an
unchanged roster, and a chat room left at the default still mints two `seq`s for a double-sent line.

`Accepted` being `Message` makes `schema` A message's shape, which is why the `socket` has none: what a
valid message is is not a question about who is asking, and a schema at the transport would have
skipped itself in-process the way the trim did. And with no `transform` — a room having no second shape
to normalise into — `schema` decides both ends, which falls out of `Stored` being `Accepted` rather
than being a rule.

What is below is what a ROOM adds to a `Reactive` — `args` — and what is left of the four, which is
only the reading a room sharpens.

| Name | Type Signature | Description |
| --- | --- | --- |
| `args` | `Schema<Args>` | WHAT A valid room key is, and the one place a selector is not the input — a memo's args ARE what its body consumes, so a memo spells that `schema`, where a room's key merely picks which room and the message is what flows. Two positions, so two options, and this is the one producer with both. A room's `Args` arrives off the wire as much as a memo's does: URL parameters on a `GET` over the channel, and the room named in a socket's subscribe frame. It refuses only: a room is filed under the key as sent, so a normalisation here will not merge two spellings of one room, and two subscribers who disagree about case are in two rooms with nothing warning either. See "Keys". Derived from `Args` when not given. |
| `tail` | `number` | The `Reactive`'s own, whose unit rule reads here as messages — default 1, latest only, and 0 is passthrough and drop. WHAT A room adds is that it is how far back a reconnect can resume: a cursor older than the tail is answered with the whole tail, never with a gap. |
| `ttl` | `number` | The `Reactive`'s own, whose retained production reads here as a message in the tail. Default: infinity — a room drops nothing by age until it says so. |
| `transform` | `Transformer<Message, Message, Failures>` | The `Reactive`'s own, and rarely wanted here — a room having no second shape to normalise into, `schema` is usually the whole of what a message declares. WHAT A room adds, to it and to `schema` alike, is that both run on every publish, the server's own included: normalising is not a question about who is asking. A refusal fills `Failures` for the publisher, who narrows it with `isError`; a subscriber's failures are abide's own and reach `{#for await}`'s `{:catch}` instead, which is why `publish` returns `number \| Failed<…>` on both sides. |

### Expectations

* A ROOM IS CREATED BY A PUBLISH, NEVER BY A SUBSCRIBE. Subscribing to a room nothing has published to
is legal, allocates no entry, and reads as `pending()` — so the room count is bounded by publish
AUTHORITY rather than by how many argument keys a caller can think of. That is the whole bound, and it
is why there is no room-count ceiling to configure: a bare `channel` has no publisher but the app's own
code, and every way a caller outside the process reaches one is a thing the app declared — a `socket`
with `clientPublish`, or an rpc that publishes.
* A room is discarded when its subscriber count reaches 0 and its retention has drained — a consequence
of `ttl` rather than a second use of it, so there is no idle window to configure. A resubscribe before
then finds the room and its tail intact, which is what makes a page navigation away and back free.
* Rooms are process-wide, unlike a `memo`'s default scope: a room every caller can reach is what a
room IS, and `Args` is how one caller's room is told from another's.

### Editing what was produced

A `publish` appends, and it is the ONLY way a room changes. There is no `revoke` and no `clear`.

Removing a message is an ordinary publish of a tombstone the `{#for}` body renders as removed:

```ts
const chat = channel<{ id: string; body?: string; removed?: true }>({ tail: 200 })
chat().publish({ id, removed: true })
```

```html
{#for await m of chat().tail(200) by m.id}
  {#if m.removed}<li class="removed">removed</li>{:else}<li>{m.body}</li>{/if}
{/for}
```

`by m.id` lands the tombstone on the row the original keyed to, so a live subscriber updates ONE row
and a late one replays both messages and resolves them the same way — no epoch move, no reset frame,
and no repaint.

* A ROOM IS NOT WHERE A REMOVAL IS ENFORCED, and retention is what decides that rather than a policy.
The ring is bounded by `tail` and `ttl` and a process restart drops it wholesale, so "never served
again" is not a guarantee a room has to give. Anything that must genuinely not be served again is
durable — the app's own store behind an rpc, where a delete is a delete.
* So the epoch has one cause, which is a process restart — see `socket`. A room's history version moves
when the process holding it does, and nothing an app calls moves it.

## `watch` — the effect

| Name | Type Signature | Description |
| --- | --- | --- |
| `Disposer` | `() => void` | Tears down the previous run: before each rerun, and once at teardown. |
| `Effect` | `() => void \| Disposer` | Runs immediately and whenever reactive values that are read change. NOT `Handler`: a handler is a `Reactive` with an address on it (see `# Transports`), and `watch` is already called the effect here and in `### Effects`. |
| `watch` | `(effect: Effect) => () => void` | Begins the watch; returns the way to stop it. |
| `watch` | `<Stored>(sources: Reactive<Stored> \| Reactive<Stored>[], effect: Effect) => () => void` | The narrowed form — it runs only when `sources` change. Two overloads, not a union: the first argument discriminates them. |

### Expectations

* reruns `Disposer` each time the `Effect` runs again
* runs `Disposer` once more at teardown — component unmount for a `<script>` watch, item removal for a branch-local one in a `{#for}` body, process end for `<script module>`
* a watch registered inside a component is owned by it; one registered from a plain `.ts` module has no owner, which is what the returned disposer is for
* when `sources` are the first argument, it only runs when those sources change
* ON A SERVER A WATCH RUNS ONCE. There is no rerender, so a tracked read registers no subscriber and
there is nothing to wake it a second time; the `Disposer` still runs at scope teardown. That is
isomorphism of intent rather than of schedule — same callable, same name, and what differs is that one
side has a flow to feed and the other does not — and it is stated here rather than inferred from
"Tracking", because an effect written for its side effects reads as though it will run again.
* AN ERROR IN AN EFFECT IS NEVER SILENT. A `Disposer` that throws, an effect that throws, and a read of
a failed `Reactive` inside one all reach `onError`, with the trace attached, and warn on `abide:watch`. In a browser it is additionally re-thrown as an
unhandled rejection so an error reporter sees it.
* AN EFFECT THAT THREW STOPS ITS WATCH. One that throws once usually throws every run, and a watch
re-running into the same throw is a loop with a log line per iteration; the app re-establishes it if
the failure was transient.

## Selections — over many entries

A probe answers about ONE `Reactive`; a selection answers about a set of them. The gap is that a KEYED
`Memo` is a factory rather than a `Reactive` — it is `(args) => Reactive`, so the probes are on
`getInvoice({ id })` and there is no `getInvoice.pending()` — while `m.invalidate` and `m.refresh`
already act over every args key. An unkeyed memo is a `Reactive`, so `data.pending()` on one is the
ordinary probe spelling — what reaches it is the same ANY question over the set its body read, derived
at recompute rather than held as a signal, which is "Propagation" and needs none of the free functions. Triggers could reach a set and probes could
not, and neither could reach across memos, which is what `tags` is declared for.

So the four are free functions rather than members, and the member spellings are defined as them.

| Name | Type Signature | Description |
| --- | --- | --- |
| `Selection` | `Reactive<any, any, any> \| Memo<any, any, any> \| { tags: string[] }` | What is being asked about: one `Reactive`, one keyed memo — every args key of it — or every entry carrying any of these `tags`, across memos. Narrowing within a memo is the member's own `pattern`, so there is one place args-granularity is spelled and it is the place that has the `Args` type. |
| `pending` | `(selection?: Selection) => boolean` | Whether ANY entry in the selection is pending. Bare, it is anything in flight in this scope, which is what an app-wide progress strip reads. |
| `refreshing` | `(selection?: Selection) => boolean` | The same over `refreshing()` — a reload in flight over values still being served. It pairs with the bare `pending()` to make "is anything happening" one read: `{#if pending() || refreshing()}<Spinner/>{/if}` in a header is the whole of what a page-level activity indicator needs, and neither probe alone answers it — `pending()` misses a revalidation over a value already on screen, `refreshing()` misses a first load. |
| `refresh` | `(selection?: Selection) => void` | Stale while revalidate, over the selection. The members are defined as this: `s.refresh()` IS `refresh(s)` over one `Reactive`, and `m.refresh(pattern)` IS `refresh(m)` narrowed by args. Not a second mechanism at either width. |
| `invalidate` | `(selection?: Selection) => void` | Marks the selection stale, over the same set, and `s.invalidate()` / `m.invalidate(pattern)` are defined as it the same way. |

### Expectations

* ONE SIGNAL PER SELECTION, never one per entry. A probe read subscribes to that probe alone (see
"Probes"), so an aggregate built by subscribing to each member wakes a page-level spinner once per
entry — with the output right the whole time, which is why this is asserted rather than tested. A
selection holds one signal and bumps it when the count of matching in-flight entries crosses zero:
n entries reloading together is 2 effect re-runs, not 2n.
* ANY, NOT ALL. "Is anything loading" is the only question that aggregates without a second rule, and
it is why only these two probes have a free form. `done()` and `success()` over a set are genuinely
ambiguous between any and all, and an aggregate `error()` would have to decide WHICH failure to hand
back — so a caller wanting either asks the entries.
* Naming reaches anything; sweeping reaches producers. A `Reactive` named by hand is the app saying so
about that one value — `s.refresh()` on a `state(fetchUser())` reloads it, `s.invalidate()` on a value
with no producer is inert — which is why the triggers are `Reactive`'s (see "Triggers" under `state`)
rather than a memo's. What is bounded is the sweep: a bare `invalidate()` matches only entries WITH a
producer, because a `state(0)` caught by one is silent data loss and a room has nothing to re-run.
* `invalidate` is lazy and `refresh` is eager, and at this width that stops being a nuance: an
`invalidate()` over a scope holding two hundred entries marks two hundred and loads only what
something reads, where `refresh()` loads all two hundred. So `invalidate()` is the reconnect
default — `watch(() => { if (online) invalidate() })` — and `refresh()` is for warming data before
anyone asks.
* A selection is scope-bounded, as a memo is: this scope's entries plus `global` ones (see "Scope"),
and a tag is scoped the same way — request-local on a server, process-local in a browser, where there is
one caller. So one request can never invalidate another's, and the one signal a selection holds lives in
that scope keyed by the canonical form of its tag set, which is what stops a freshly built
`{ tags: [...] }` from being a second selection with a signal of its own. ON A server that
makes a bare `invalidate()` Reach every `global` Memo in the process — its own request-scoped entries
die with the request anyway, so the global ones are the whole effect. That is what an operator's
flush endpoint wants and is never what a handler being defensive wants.
* The bound is already declared. `throttle` and `debounce` apply however triggered (see
`MemoOptions`), so a memo that must not join a stampede says so on itself — where the knowledge is,
rather than at a call site that cannot know what else the tag matched.
* There is no bare `refresh()` over a selection an app did not name beyond the scope: `refresh()`
with no argument is the scope, and the scope is the widest thing there is. The asymmetry with a bare
probe is that a probe reports and a trigger acts, so the widest read is free and the widest write is
the one an app should have to mean.

## Tracking

A value is tracked only where it is part of the render flow — where something downstream will be
rebuilt from it. That is the whole criterion, and an event handler falls out of it rather than being
excepted: it runs in response to a person, after the output exists, so a subscription taken there has
no consumer.

| Context | Tracks | Why |
| --- | --- | --- |
| template expression | yes | the flow |
| branch-local `<script>` in a block body | no | setup, once per item — there is no rerun to feed |
| `memo` body, unkeyed | yes | pushes its own subscriber. The set it tracks is also what its `pending()` aggregates over — see "Propagation" |
| `memo` body, keyed | no | untracked by handler |
| a block body's binding — `{:then value}`, `{#for item}`, `{#for await event}` | yes | a live read, like a prop. It binds the VALUE the block produced, never a `Reactive`, so the rule that an identifier binding HOLDS does not reach one |
| `watch` effect | yes | pushes its own, unless `sources` narrows it |
| component `<script>` setup | no | runs once; there is no rerun to feed |
| event handler, `bind:` write-back | no | not the flow |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | no | not the flow |

### Expectations

* A reactive node pushes its own subscriber when it evaluates, whoever reached it. Tracking cannot
depend on the caller: a memo first read from an event handler would otherwise compute with no
dependencies registered and be stale for the rest of the process.
* The render flow decides whether an ambient subscriber exists; a node supplies its own on top of it.
* On a SERVER there is no rerender, so a tracked read registers no subscriber. It does register a
SINK where what it read is still in flight — a continuation, not a graph node, firing once for a
settling value and appending in order for a stream. The bookkeeping a rerender would need is skipped
rather than built and dropped, and a `set` after a value was already written changes nothing already
flushed.
* Tracking is synchronous. A body suspends at its first `await` and the subscriber is restored, so a
read in the continuation registers against nothing — reliably nothing, since a microtask resumes
between synchronous blocks and never inside another node's scope. The cost of this is one variable
set and restore; propagating the subscriber across `await` instead would put its cost on every
promise in the process, and would make over-subscription the easy mistake — the failure that leaves
the output right and is only visible by counting wake-ups.
* So the compiler warns on a reactive read that an `await` dominates inside a tracked body, naming the
read. It is fixed by hoisting the read above the await, or by saying `peek()` where the read was
meant to be untracked. Hoisting is also the faster shape, and the one "start all asynchronous work up
front" already asks for. The check reaches a body written inline at `memo(…)` / `watch(…)`, which is
nearly all of them; a body defined as a named function elsewhere escapes it.

## Refusals

A refusal is a declared VALUE, not a status code and not a transport concern. It fills the
`Failures` of the `Reactive` that produced it — an rpc handler's return, a memo body's, a
refusing `transform` — and it is narrowed with `s.isError` wherever it is read. Declaring one
resolves on both sides, which is what lets a `#shared` module own an app's failure names and a
`transform` in `#ui` refuse a write the same way a handler refuses a request. `# Transports`
does not define refusals; it says how they cross a wire.

| Name | Type Signature | Description |
| --- | --- | --- |
| `refuse.typed` | `<Name extends string, Data extends JsonValue = undefined>(name: Name, status?: number, message?: string, options?: { schema }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | A reusable factory for a named, narrowable failure, its message optional the same way. The status defaults to 400: a declared refusal is by construction an expected answer, and 500 is the one status certainly wrong for it — an OpenAPI response a generated client reads as a server fault, a status a model retries instead of re-planning, exit `7` instead of `8`, and a page in front alerting on it. "A fault is ours until an app says whose it is" is `refuse`'s rule and stays there, where abide genuinely does not know; declaring a named refusal is the app saying whose it is. The phrase is resolved where the refusal is declared. The factory carries `is`, which is the only narrowing available where there is no `Reactive` in scope — `error.abide` receives a bare failure as a prop, so `s.isError(e, 'Name')` has nothing to hang off — and it needs no registry, the factory carrying its own type. With a `schema` the data is checked synchronously at construction. Construction is inert: `myError(data)` Builds a `Failed` and does not throw, which is what lets a `clientPublish` gate RETURN one and what puts the failure in the handler's return type honestly rather than by `never` vanishing from a union. |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }`, `Failed<Name extends string = string, Data = undefined>` | The one refusal type, in-process and over a wire alike — there is no second http-shaped one, and `HttpError` names the undeclared instance rather than a class of its own (see `refuse`). Structural, because what a caller catches is a shape rather than a class it imported. |
| `return myError(data)` | `Failed<Name, Data>` | One spelling for every refusal: a handler RETURNS them. Returning is what refuses — the value is inert until it reaches a return, so the refusal is at the boundary and visible in the type, where `Rpc`'s third parameter picks it up. A `throw myError(data)` refuses identically and only loses the caller's ability to name it. `refuse(status)` is the other spelling and still THROWS, returning `never`, so a bare `refuse(404)` remains a guard. |
| `notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', …>` | Abide's own, built with `refuse.typed` like any other. Returned where no route matched and where no handler is mounted at that address and method, so `error.abide` renders a 404 by holding a named refusal rather than by a second convention — and a page narrows it with `notFound.is(failure)` to say which path. |
| `validationError` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | The other one, at 422, returned where a schema refuses. Two named refusals and no more: a name is public surface forever, and the rest of what abide raises — 403 on an origin mismatch, 413 over-size, 504 on a timeout — has no data to narrow TO, so it stays the undeclared `HttpError` at its status, which is what `refuse(status)` already means. |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away is a refusal that did not happen. Because construction is inert, `if (!user.member) notMember({ group: 'staff' })` would fall through silently — so an expression statement whose type is `Failed` is REFUSED, naming the two repairs: `return` it, or `throw` it. Detectable in syntax, and it is why the guard form does not have to be given up to make construction inert. |

# Transports

A HANDLER is what answers — a `memo`, a `channel`, or a plain function — and it is the genus. `GET` /
`POST` / `PUT` / `PATCH` / `DELETE` give one an address over http and `socket` gives one an address
over the mux, both mounted by file path and export name (see "Mount paths"). "An rpc" is the http species and a socket is the other, so the two
words are not interchangeable — a mapping written over rpcs silently omits every room, which is the
mistake `# Generated surfaces` would make if it said rpc where it says handler.

Declare is the verb and handler is the noun — see `docs/BRAND.md`. The genus needs a word of its own
because `rpc` is spoken for three times already: `Rpc` the type a caller gets back, `rpc.url` /
`rpc.isError` / `rpc.method` the members on one, and `#server/rpc/**` the directory.

Neither end of it is a named type. What a handler may be declared over is spelled in `GET`'s own
signature, and what sits between handler and `Rpc` is a route-table entry — a build artifact no app
ever holds.

## `rpc` — `memo` + transport

| Name | Type Signature | Description |
| --- | --- | --- |
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Failures, Produced>` | `Rpc` puts an http transport in front of what the handler addresses, or calls it in process on the server — the same rungs either way, see "A RUNG RUNS ON EVERY CALL". It hands back the same `Reactive` SHAPE the handler had, `Produced` included, so a streaming handler's cursor walks chunks on the caller's side exactly as it did on the server's and `for await` means one thing across the wire. `signal` aborts the reader. There is no retention option here and none is owed: a call is made inside a memo, and that memo's `tail` IS the caller's retention — see "Adoption". `Failures` is the union of declared `Failed<Name, Data>`, inferred from the handler's return type AND FROM ITS RUNGS' — a rung refuses with the same `return myError(data)` a handler does, and a refusal a caller cannot name is what this design exists to remove, so `middleware` carries a type parameter of its own and `GET` unions the two. A caller always gets a `Reactive` back whichever of the three was declared; nothing about an rpc is a second kind of `Reactive`. |
| `Value` | `unknown` | What the addressed `Reactive` HOLDS — the accumulation where the handler streams, the message where it is a room — serialized for http transport, returned raw on the server. |
| `Produced` | `unknown` | What it yields, per the unit rule: a chunk from a streaming handler, a message from a room, and `Value` itself otherwise. |
| `Args` | `Record<string, JsonValue> \| undefined` | Arguments, in the request body on `POST`/`PUT`/`PATCH`. Serializable by contract — the wire form as sent, coerced but not yet validated, is also the memo key. Narrowed to flat on `GET`/`DELETE`, where the wire form is URL parameters. |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of an onion. `next` is the next rung and hands back whatever that rung returns; where there is no next rung, `next` runs the operation itself and the onion is complete. Returning without calling `next` short-circuits. A throw escapes the whole onion rather than unwinding through it. `Ctx` is a record naming what that lane actually has: the APP lane is `Middleware<{ request: Request }, Response>` and runs PRE-routing, so it has no route and no args; the RPC lane is `Middleware<{ request: Request; args: () => Args }, Value \| Failures>`, typed to that one handler and VALUE-shaped rather than `Response`-shaped precisely so an IN-process caller can run it; the socket lane is `Middleware<SocketEvent, void>`, where a throw is the only refusal. |
| `GET` | `<Value, Args, Failures, RungFailures>(handler: Reactive<Value, Failures> \| Memo<Value, Args, Failures> \| Channel<Value, Args, Failures> \| ((args?: Args) => Value), options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures>` | Declares a READ any surface may call, addressed by its arguments. What it may be declared over is the union above. An unkeyed memo is a `Reactive` and a keyed one is a factory, which is why both arms are there: `GET(() => 'foo')` addresses one entry and is called `rpc()`, where `GET(getInvoice)` addresses one per args key. A `memo` is identity per args and is what you generally write; a `channel` is a room. A plain function is sugar, not a third kind — `GET(fn)` is `GET(memo(fn))` — so there is no un-memoized endpoint to reason about. WHICH ARM IS TAKEN IS READ OFF A BRAND, NEVER OFF THE SHAPE: a `Channel` IS a bare `(args?) => Room` and is therefore structurally the plain-function arm, so `memo`, `channel` and `socket` each stamp what they build and `GET` dispatches on that stamp — unbranded, it is a plain function and is memoized on the way in. Without it a channel would be wrapped as a one-shot read rather than served as a room, and `# Generated surfaces` would publish an unbounded room as a TOOL, which is the one thing `## MCP` says a channel must never be. A `Room` handed in directly — `log.records` is the one abide declares — carries the channel's stamp and takes the channel arm. Over a channel it is the read-only view of a room — jsonl by default, sse on `Accept` — where the socket is the two-way one. A read has no side effects — `SameSite=Lax` volunteers the principal cookie on a top-level GET navigation, so a `GET` that changes something is reachable from an `<a href>` on another origin. |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declare a mutation, which retains nothing by default: a memo handed to one has its `ttl` defaulted to 0 unless it named one, so coalescing covers the in-flight window and nothing after it. That is the whole per-method difference, and what makes a memoized mutation safe — a double-click inside one flight is one write, two sequential clicks are two. A `POST` is also a legitimate read, for a query too big for a URL, so caching one is a thing to ask for rather than a mistake to prevent. A `POST` over a channel is a publish into the room, and DECLARING THAT HANDLER IS THE AUTHORISATION: a room is not reachable by `POST` until an app writes the rpc that publishes into it, so the intent is spelled by the declaration rather than by a second flag beside it. That is why `clientPublish` is the socket's and not the channel's — a socket accepts frames at a room an app never named, so it is the transport that needs a gate. |
| `rpc.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | The rpc's `isError`, narrowed by what the handler and its rungs declared — a rung's refusal is the one a caller is likeliest to meet, so leaving it out of the union would leave the commonest failure unnameable. Matching the name gives back `.data` with the schema's type on it, `.status` and `.name`. |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response instead of a decoded value. |
| `rpc.method` | `string` | HTTP method |
| `rpc.url` | `string` | HTTP url, derived not baked: the generated wrapper carries the mount-relative address, and `url` resolves it against `<meta name="abide-mount">` in a browser and `config().APP_URL` on a server. A mount is chosen after the build, so a build artifact cannot hold the absolute form. |
| `rpc.description` | `string \| undefined` | Human description |

### `RpcOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. |
| `middleware` | `Middleware<{ request: Request; args: () => Args }, Value \| Failures>[]` | Middleware run per call — on a request, inside the app's own and after routing, and on an in-process call too, see "A RUNG RUNS ON EVERY CALL". IT IS VALUE-SHAPED: a rung short-circuits by returning what the handler would have returned — `return forbidden({ id })` refuses, `return cached` answers, `return next(ctx)` goes on. Nothing distinguishes a short circuit from a pass at the type level, the caller having asked for a value and got one. What it gives up is a `Response` to decorate; a rung that must set a header is the app lane's. `ctx.args()` parses on first call and caches for the request — search params on `GET`/`DELETE`, the body otherwise — so a rung that never asks pays nothing and a 401 still precedes any parse failure. What it hands back is parsed, coerced and validated against the `schema` THE MEMO declared, this lane having none of its own, so a rung authorising on a resource id compares a number against a number whichever method carried it — AN AUTHORISATION CHECK PASSING ON A TYPE MISMATCH is the silent failure it prevents. Validation is LAZY, on that first call: a 401 rung that never asks for args still precedes every parse and every schema. A malformed body is 400 and a schema refusal is 422, both raised where the first rung asks. Throws escape the onion. |
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
| `page` | `(body: string \| Values<Uint8Array \| string>, init?: ResponseInit) => Response` | A rendered document as `text/html`. Takes what a render produced rather than doing the render, which is why it takes the generator `render` yields rather than a stream built from it. |
| `json` | `(data: unknown, init?: ResponseInit) => Response` | Serialize and tag `application/json`. `undefined` sends `null`, not the text `undefined`. |
| `jsonl` | `<T>(values: Values<T>, init?: ResponseInit) => Response` | One JSON value per line from a sync or async iterable; `application/jsonl`. Written per `pull`, so back-pressure reaches the source. |
| `sse` | `<T>(values: Values<T>, init?: ResponseInit) => Response` | The same machine framed as `data: <json>\n\n`; `text/event-stream`, `no-cache`, `X-Accel-Buffering: no`. |
| `redirect` | `(to: string, status?: RedirectStatus, init?: ResponseInit) => Response` | Navigate. The status is restricted to `301`/`302`/`303`/`307`/`308` (default `302`), and there is an `init`, which is where a login's cookie goes. |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry, so a typo is a compile error rather than a browser ignoring it. |
| `refuse` | `(status: number, message?: string) => never` | Throws in a browser, the way `config` does — a status is a response's business. On a server it THROWS the undeclared `Failed`: `name` is `'HttpError'`, and there is no data. A handler writes `return refuse(404)` beside its other returns; `never` disappears from the union, so the returned form costs the type nothing and the throw stays abide's business. Declared `never` so a bare call also stands as a guard. The message defaults to the registry's phrase, so `refuse(404)` is a whole refusal. It carries NO data, and there is no options bag to put any in: data undeclared has no type on the other side, so `refuse.typed` with a schema is the only place it can mean anything. The name is HTTP-shaped because this instance only ever surfaces where HTTP is the vocabulary — an OpenAPI default response, a wire body, an MCP error entry. A refusal reached in-process has a name, `refuse.typed` being how one is declared. |

### Expectations

* A handler that can be addressed over HTTP. What it addresses decides what it brings — see `GET` — so "it is a memo" is true of the form you generally write and not of the mechanism
* An unkeyed memo is its value; a no-arg rpc is still a call. `Rpc` is uniformly callable in both arms — `GET(() => 'foo')` is reached as `rpc()` — because the CALL is what issues the request, and a `Reactive`-shaped rpc leaves `signal` nowhere to go.
* HTTP path is determined by filepath + export name.
* Return type dictates Content-Type
* Browser only sees a wrapped `fetch(rpc.url, { method: rpc.method })` not the whole server module. That wrapper is a module the build GENERATES — one export per handler, carrying `method`, the mount-relative address and `description` — rather than the server module shaken down to it, so "no server code shipped" is a property of the build rather than an optimizer's outcome. A module-level side effect in an rpc file cannot reach a browser, the browser's module never having been derived from that file.
* Importing a name from `#server/**` that is not an rpc or socket handler is a compile error from the client graph, never a silent stub; only `#server/rpc/**` and `#server/sockets/**` resolve from `#ui` and `.abide` at all.
* THE COST OF THAT IS THAT A PAGE HAS NO DIRECT SERVER READ. A `.abide` file runs on both sides, so every server-side read it makes at render time goes through an rpc — including one the browser will never issue, because the page always had the value. There is no server-only region of a page and no partial mode; what buys it is that the render and the hydration make the same call, which is what the seed buffer answers and what makes re-executing setup affordable at all.
* A RUNG RUNS ON EVERY CALL, in process as much as over the wire. A page renders on both sides, so its
render-time read of a handler is an ordinary caller of that handler, and a rung that authorises on an
id in the args cannot be reachable by a browser and missed by the render — the same failure
"SHAPE BELONGS TO THE `Reactive`" is written against, one rung out, and authorisation is the one thing
with nowhere else to live, `clients` being a listing rather than a boundary. The split is by what the
thing is about rather than by who called. What runs on EVERY call is the rungs in registration order, the `ctx.args()` coerce-then-
validate against the memo's `schema`, and `timeout` — an operation's own bound. What is wire only is
every gate that is about the wire and meaningless without one: the `Origin` gate on a mutation,
`maxBodySize`, the `crossOrigin` preflight, the framing, the `cache-control` and the seed buffer write.
In process there is no body to read, so `ctx.args()` hands back the coerced and validated args directly
and caches them as it does per request — which is the check `MemoOptions` already says an in-process
caller gets.
* THE ONION IS COMPOSED ONCE, at route-table construction, never folded per call. `middleware` is an
array fixed at the declaration and the route table is a build artifact, so the chain cannot move under
a running process. Folding it per call allocates one closure per rung to rebuild the chain it rebuilt
last time — three rungs on a page making three reads is nine closures per render for something that
never changed. WHAT IS CAPTURED IS THE RUNG AND THE NEXT LINK AND NOTHING PER-REQUEST: a chain holding
a request would keep that whole scope alive for the life of the process, and the handler stays
scope-resolved per request because that resolution happens inside the innermost call.
* A handler is request-bound where its rungs or its body read the request scope, and calling one from a
scope that has none is the BUILD ERROR `global: true` already is, found the same way — run it with no
request scope and collect what threw. A handler that reads none
is callable from anywhere in the process, a `global` memo included. So an in-process caller is held to exactly what
the handler declared, and that is what decides where it may be called from.
* SHAPE BELONGS TO THE `Reactive`, never to the transport — the input's is `schema`, which on a handler's keyed memo is its args, and the output's is `transform`. A `channel` addressed by one adds `args` for the room key, its selector not being its input. This is the call `transform` on a `channel` already made against a schema on the `socket`, for the reason given there: a check declared at the transport silently skips itself in-process, so a memo composed inside another memo, or imported directly by a second server module, would be held to a shape only a wire caller was. What the transport does is READ it.
* A schema runs where its `Reactive` Lives, which is the seams doing their job rather than a rule of validation's own: one declared in `#ui` checks in a browser, one in `#server` on a server, one in `#shared` wherever it was used. An rpc's handler is a memo in `#server`, so a browser calling it through the generated wrapper cannot pre-check. An app wanting the same shape checked on both sides puts it in a `#shared` module and declares it in both places — the one duplication this design asks for deliberately.
* An rpc returning a binary — `Uint8Array`, `ArrayBuffer`, `Blob`, `DataView` — transports it as `application/octet-stream`, or as a `Blob`'s own `type` where it has one. The client decodes it back to a `Uint8Array`.
* An rpc returning a raw value transports as application/json
* An rpc returning undefined returns as 204
* An rpc returning an AsyncGenerator is streamed as jsonl, which is the DEFAULT and not the only
framing: a handler returning `sse()` says so outright, and a caller sending `Accept: text/event-stream`
gets the same address framed that way. One url with two bodies, so it carries `vary: accept`.
* The seed buffer holds the JSONL, whichever framing the caller asked for. SSE is that transcript with
`data: ` in front of each line and a blank line after it, so the reframe happens at replay and the
buffer stays a byte count rather than a list of decoded values it would have to walk to measure.
* Retention, staleness and shape belong to the `Reactive`, never the transport. `RpcOptions` is
`description`, `middleware`, `timeout`, `crossOrigin`, `maxBodySize` — an address and how it is spoken
to, and nothing in it describes the value. `ttl`, `invalidate`, `refresh`, `schema` and `transform` came in on the
`memo` that was passed; `tail` and `args` came
in on the `channel`. So a handler over a memo and one over a channel take the same options and
differ only in what the `Reactive` brought.
* CALLER-side retention is the enclosing memo's `tail`, and that is why the transport needs no option
for it. A call is made inside a memo — `memo(() => getData(args), { tail: 50 })` — the memo mirrors what
the rpc produces into its own ring, and that ring is what the caller replays. Two `Reactive`s, two
rings, each bounded where it lives: the handler's `tail` on the server, the memo's on the client. A
`tail` on the call would be a third place to say it with no rule for which won, which is the duplication
this bullet exists to refuse. Under a transparent-forwarding adoption there would have been a gap here,
the outer's `tail` meaning nothing; mirroring is what closes it.
* `GET` / `DELETE` args are passed as URLSearchParameters, not as json, and are therefore typed flat — `Record<string, string | number | boolean | null | Array<string | number | boolean>>`, an array being the repeated key a `URLSearchParams` already has a form for. That is what makes "args that cannot be keyed are exactly args that cannot be sent" true rather than nearly true: a nested object is keyable and is not sendable, so it is refused at compile time, naming the method. The fix is to make the call a `POST`, which is `JsonValue` — and which gives up the browser cache, so the error says that too.
* `POST` / `PUT` / `PATCH` accept JSON or `multipart/form-data` or `application/x-www-form-urlencoded`
* THE SEED IS THE CLIENT'S OWN REQUEST, never a copy in the document. A render's loads are buffered,
and the client's call to the same address is answered from where the document reached — so what seeds
the client is a real rpc response: inspectable in a network panel, and carrying whatever
`cache-control` the handler set. One manifest issues them all: the head carries `(method, address,
args)` — what to fetch, never the data — and the byte-invariant bootstrap issues every seeded call
before the bundle loads, GET and POST alike. The bootstrap hands its calls to the runtime through a registry, which is
what makes "the seed buffer answers the calls the re-run makes" a mechanism rather than an intention:
each issued `Promise<Response>` is stashed under the same canonical `(method, address, args)` form the
memo key uses, and the rpc wrapper consults it before issuing — hit, adopt and delete; miss, an ordinary
fetch. A SEEDED REPLAY OF A NON-SAFE METHOD IS BUFFER-ONLY, and that is what stops a miss re-running a
write. A `POST` is a legitimate READ — a query too big for a URL — so a render makes them and the
bootstrap replays them, but every ordinary way to miss is a way to POST twice: a second instance, an
entry past its timer, a restarted process, a caller refusing cookies, and a client whose re-run computed
different args. So a seeded `POST` / `PUT` / `PATCH` / `DELETE` carries the trace id and is answered
from the buffer or not at all — a miss answers a status that says so, and the runtime surfaces it as a
load the app may retry rather than issuing the mutation a second time. A seeded `GET` misses into an
ordinary fetch as it always did, a read being safe to repeat. SINGLE-use therefore means one thing on each side, and an entry hydration never claims — a branch
the client took differently — is dropped on the same timer the server's is, rather than held for the life
of the tab. There is no `<link rel="preload" as="fetch">`, and not
having one is what makes the browser cache work: the scope handle travels as a request header,
`traceparent`, so the URL stays the plain one. A custom request header does not fragment the HTTP
cache — only a `Vary`-listed one does, and no abide response ever varies on this header — so a
handler that answered `public, max-age` populates the cache under the plain URL, and a refresh sends a
different trace id to the same cache key, hits, and never reaches the server. The new render's seed
entry then expires unclaimed, which is what the timer is for. A preload could not have done this: it
carries no headers, so putting the handle in the URL instead would have fragmented the cache per
document and a refresh would never have hit.
* THE BOOTSTRAP IS A CLASSIC INLINE SCRIPT, so it blocks the parser and that pause is owed a
measurement rather than an assumption. A `<link rel=preload>` is what would not block, and it cannot
carry a seeded call: `as="fetch"` fixes cors and credentials mode up front, against a call that carries
the `abide-caller` cookie, and sets its own `Accept`, against an answer that carries `vary: accept` —
so either mismatch is a dead preload and a second request, silently.
* A `GET` over A `global` Memo derives its `cache-control` from the memo's `ttl`, because those are
the same number and writing it twice is how they come apart — `ttl: 60_000` beside `max-age=60` is
one fact in two units with nothing keeping them in step. `global: true` is already the app saying
this answer is not about who asked: SPEC requires anything caller-specific to be in the `Args`, so
the endpoint is handing identical bytes to every caller before any cache is involved.
  * Public or private is decided by the rung, not by `global`. A handler reachable unauthenticated
  answers `public, max-age=<ttl>`; one behind an authorization rung answers `private, max-age=<ttl>`,
  because a shared cache may serve a stranger and a gated answer was never for one. That is the only
  part a shared cache can get wrong that the endpoint could not already, so it is the only part the
  framework decides for itself.
  * `ttl: Infinity` Derives nothing and keeps the default. A global entry is still reachable by
  `invalidate`, and a cache told `max-age` a year has no way to hear that.
* `cache-control` on an rpc answer is a DEFAULT, not a rule: every response helper takes a
`ResponseInit`, so a handler that knows better than either of the above overrides it. What the method decides is
the ceiling. A `GET` answer can be made browser-cacheable; a `POST` answer cannot be, whatever it sets,
no browser usefully caching one — so its only cache is ever the memo's own `ttl`. That is the reason to
prefer `GET` for a read whose args fit a URL, beyond what the methods mean.
* THE SEED BUFFER IS THE RENDER'S REQUEST SCOPE, kept alive past the response so the client's own
follow-up can join it. Naming it that is what collapses the rules below into consequences of scope
rules that already exist rather than a mechanism arguing for itself: an entry is single-use and lives
seconds because that is the scope's lifetime; the key carries the caller and the seal because you may
only join your own scope, which is what a scope means; three components asking for one address in one
render are one entry because that is the memo's own "two calls in one scope share one load"; and a
seeded mutation is not replayed because a scope does not run one twice.
* THE SCOPE HANDLE IS THE TRACE ID, not an identifier of its own. `trace()` is already minted per
request, already held for it, and already reaches the client in `traceresponse` — so the client
presents it back as an ordinary `traceparent` and there is nothing to invent. It hangs the hydration
fetches off the render's span, which makes the whole page load one trace. It works whether or not `sampled`, sampling
deciding export rather than existence, so the handle never depends on tracing being on. A caller that
sent its own inbound `traceparent` shares its trace id, but such a caller is not rendering a document
with a bootstrap, so the handle is the trace id OF A document render and meets no other case.
* Every caller has an ID, authenticated or not: 16 bytes of `crypto.getRandomValues`, base64url, in an
`abide-caller` cookie minted on the first response that arrives without one. THE KEY IS NEVER
TRANSMITTED: the client sends its ordinary cookie and the trace id it was served with, and the server
derives the same key — so presenting another caller's key means holding their cookie, which is being
them. A request header rather than the URL is what keeps the address cacheable; nothing ever varies
on it.
* TWO ARMS, and which one is decided by the route table rather than by sniffing anything. A handler
whose return type is an async generator streams, which is the same fact that already decides its
framing, and the table is a build artifact — so the server knows before it calls, and the head
manifest carries the trace id per entry. An entry with one is a stream and the client sends the
header; an entry without one is settled and sends nothing.

```
stream:   SHA-256(callerId ‖ sealDigest ‖ traceId ‖ address ‖ canonicalArgs)   single-use
settled:  SHA-256(callerId ‖ sealDigest ‖           address ‖ canonicalArgs)   reusable until expiry
```

* SINGLE-USE IS A STREAM REQUIREMENT, not the buffer's. A document is not held for an unfinished
stream, so a stream entry holds a partial transcript at wherever that render reached, and a second tab
adopting it would resume from a cursor it never rendered — replaying rows it painted or skipping rows
it did not. That is POSITION, not a leak: same caller, same address, same args, same answer. A settled
answer has no position, being the whole answer, so it needs neither the trace id nor single-use — and
dropping both turns a miss into a hit exactly where the old key was weakest: two tabs of one page, a
re-render, a back-navigation. The bound is unchanged, the timer having always been what bounded the
buffer and `ABIDE_MAX_STREAM_BUFFER_SIZE` what caps a transcript.
* WHAT THE BUFFER IS FOR IS EXPENSIVE PER-caller work on a cold visit, and saying which case is which
is what stops an app expecting the wrong saving. It does not change how many times anything loads:
that is decided by SCOPE — two requests are two scopes and load twice, one request coalesces — so
expensive shared work belongs behind `global: true`, which serves every caller warm and cold, where
the buffer saves one duplicate execution for one caller on one document. The vanilla arm this is
priced against is the client simply re-fetching, which is correct and costs one handler execution; the
fraction owed is what share of a cold visit's wall clock that execution is, against the bundle load
"HYDRATION RE-EXECUTES SETUP" says covers it.
* A CALLER HANDLE NEVER GOES IN `Args`. Keying a `global` memo on `principal.caller` would need no
buffer at all, but a `GET`'s args are URL parameters, and a caller handle in a query string is the
tracking identifier `HttpOnly` exists to prevent. Where the answer is not caller-specific there is
nothing to key on anyway, which is what `global: true` already says.
* An id for everyone removes the sharing decision rather than answering it. Keyed on the principal's
seal alone, an anonymous caller had nothing to key on, and deciding per handler whether an answer
was caller-invariant was a judgement abide could not check — `server().requestIP()`, a module-level
mutable and a clock all vary per caller without touching an ambient abide owns. With an id there is no
cross-caller path left to get wrong.
* The key carries the change of authority, not the handle. Signing in moves the seal digest, so an
entry buffered while anonymous cannot be picked up after it — and a planted `abide-caller` value buys
nothing, its holder still lacking the seal the key is derived from. Rotating the handle instead would
defend against session fixation, which needs the handle to confer authority; this one confers none,
authority being the seal's alone. That is the invariant worth asserting, the failure being silent: the
answer is well-formed whichever caller receives it.
* The seed buffer has no count and no TTL to configure, and that is the decision rather than the
omission. An entry is single-use and lives seconds, so the exposure is request rate multiplied by
transcript size, and the size is the only dimension that can run away — which is what
`ABIDE_MAX_STREAM_BUFFER_SIZE` already caps. A count ceiling would evict an entry a document in flight
is about to claim, which is the one failure the buffer exists to avoid.
* It is also process-local, as a `global` memo's cache and a room's `seq`/epoch are. A deployment of
more than one instance degrades rather than breaks: the client's follow-up landing elsewhere is a
buffer miss and an ordinary load, a `global` memo's `invalidate` reaches its own process, and a
reconnect to another instance is the announced epoch reset. abide supplies no cross-process mechanism
for any of the three.
* A caller refusing cookies gets an id for the request only. It never matches across two, the buffer
is never picked up, and the client's call is an ordinary load — correct, slower, and the right
degradation, a crawler that will not take a cookie not running the client either.
* The cookie is a session cookie carrying nothing but the id, `HttpOnly`, `SameSite=Lax`, `Secure` in
production. It is not a place to hang rate limiting, analytics or a server-side session: each is a
reason for it to live longer and say more, and a correlation handle that acquires those has become
the tracking identifier a strictly-necessary exemption stops covering.
* On an rpc route the body belongs to `ctx.args()`. A body reads once, so `request().json()` is not the way in — a rung that took it would break every rung after it and the handler.
* A `signal` is reader-local: it detaches this reader and rejects this read. The shared load runs to completion for the others, and still populates the entry when every reader has left, so the next reader gets it free. An aborted read never becomes the memo's `error()`.
* A MEMO BELONGS TO EXACTLY ONE HANDLER, and handing the same one to two is a BUILD ERROR naming
both. A mutation defaults its memo's `ttl` to 0, so `GET(user)` and `POST(user)` over one memo either
have the `POST` silently stop the `GET` caching, or share one entry table under two freshness rules —
where a `POST` populating an entry the `GET`'s 60s keeps fresh means the second click is served the
first click's response and the write never happens. Neither is a default worth having, and the repair
is what the shapes wanted anyway: a read memo and a write memo have different `Args`.
* Coalescing is the memo's, not the transport's. Where one was passed, multiple calls in ONE scope share a
response and two concurrent requests are two scopes that load twice (see memo Scope). A plain function
is memoized on the way in, so it coalesces the same way — there is no arm of this that does not.
* A `ttl` of 0 coalesces until the response closes and no longer; a positive `ttl` starts when it
closes. That is why a mutation defaults its memo to 0: the in-flight window is the part that wants
sharing — a double-click is one write — and everything after it does not.
* The seed buffer holds one entry per key, and the key names the render (see "THE KEY IS NEVER
TRANSMITTED"). Every handler addresses a memo, so three components asking for the same args in one
render are ONE call on both sides and one entry — which is what makes the buffer's single-use rule
enough of a bound.
* Planned or not, a refusal serializes as `{ name, message, data }` and hydrates as a `Failed` — `{ name, status, message, data }`, the status coming from the response. An undeclared one carries `name: 'HttpError'` and no data; a declared one carries the name `refuse.typed` gave it.
* a schema refusal is ``Failed<'ValidationError', Issues<Args>>`` at 422, and it crosses as a declared failure like any other rather than down a path of its own — a declared `schema` contributes that name to `Failures`, and the status is the one the name is registered at
* A mutation — `POST` / `PUT` / `PATCH` / `DELETE` — compares its `Origin` against `APP_URL`'s origin before the handler runs, and a mismatch is 403. `Origin` is sent on every cross-origin request, form posts included, and cannot be set by script, so the gate holds independently of cookie policy; a declared `crossOrigin` allow-list replaces the same-origin comparison for that handler. `GET` needs no gate because it is a read, and `DELETE` is unreachable by navigation because a navigation is always GET. A mutation arriving with NO `Origin` at all is allowed: CSRF needs a browser's ambient authority and a browser always sends one, so an absent header is a non-browser caller with no ambient cookie to abuse. Refusing those callers is an app's rung, which is what middleware is for
* A mutation answers a form navigation as a navigation. `<form action={rpc.url} method="post">` posts
to an address like any other caller, and where the request prefers `text/html` — which is what a
browser form sends and what abide's own client wrapper never sends — the result is converted rather
than serialized: a returned `redirect()` passes through, a returned value becomes `303 See Other` back
to the `Referer`, and a failure renders `error.abide` at its own status. Without it a scriptless submit
navigates the browser to a JSON document, and `{await expr}` would be the whole of what works without
script — reads only. With script the client intercepts `submit` and it is an ordinary rpc call, so the
conversion is reached only by the caller that needs it.
* Only `GET` and `POST` are form-reachable, a `<form>` sending no other method. A mutation meant to be
submitted without script is declared `POST`; there is no `_method` override, an app that wants
`PUT`/`PATCH`/`DELETE` semantics having a `POST` to say it with.
* WHERE `crossOrigin` is declared, abide answers the preflight. A cross-origin JSON `POST` always
sends `OPTIONS` first, so an allow-list with nothing answering it is an allow-list that never works. The
preflight is answered outside the middleware, for the reason `/__abide/health` is: it carries no credentials,
so there is nothing for a rung to authorise. It emits `access-control-allow-origin` echoed from the
allow-list (or the request's own where `crossOrigin` is `true`), `access-control-allow-methods` naming
this handler's method, `access-control-allow-headers` echoed from `access-control-request-headers`,
`access-control-allow-credentials: true`, `access-control-max-age`, and `vary: origin,
access-control-request-headers`. An address with no `crossOrigin` answers `OPTIONS` with 404, the same
as any other unmounted method.
* `SameSite=Lax` means a cross-site top-level POST arrives without the principal cookie, so it is seen as anonymous rather than refused

## `socket` — `channel` + transport

| Name | Type Signature | Description |
| --- | --- | --- |
| `Socket` | `<Message, Args, Failures>(args?: Args) => Room<Message, Failures>` | A `channel` over a web socket, and the same `Room` a channel invokes to — a socket over a channel is a channel over a socket, so there is nothing about the shape that says which transport carried it. |
| `Args` | `Record<string, JsonValue> \| undefined` | The room, keyed as a memo's args are. |
| `Message` | `unknown` | Message type |
| `socket` | `<Message, Args, Failures>(channel?: Channel<Message, Args, Failures>, options?: SocketOptions<Message, Args>) => Socket<Message, Args, Failures>` | Socket factory. `SocketOptions` is the upgrade and who may come up it — who may connect, and whether a frame may publish at all. WHAT A frame must look like is not here: that is the channel's `transform`, because what a valid message is is not a question about who is asking, and a schema on this side would have skipped itself in-process exactly the way the trim did. What is left is the GATE, and it does belong here: in-process every publisher is the app's own code, so this transport is the only one untrusted frames arrive at. |

### `SocketOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `middleware` | `Middleware<SocketEvent, void>[]` | The same middleware as the http lane, instantiated over `SocketEvent` — `{ kind: 'subscribe' \| 'publish', room, message, request }`. `next(event)` hands back what the next rung returns; the innermost one performs the subscribe or the publish. There is no `Response` to return, so a THROW is the only refusal. |
| `SocketEvent` | `{ kind: 'subscribe' \| 'publish'; room: Args; message?: Message; request: Request }` | What the socket lane's onion carries. `message` is absent on a subscribe, there being nothing published yet. |
| `crossOrigin` | `boolean \| string[]` | Which origins may upgrade, closed unless declared. `true` is any origin, as on the http lane. |
| `clientPublish` | `boolean` | Whether a frame from a caller outside the process may publish at all. Default false, so a socket is read-only until an app says otherwise. It gates this transport and nothing else, which is what makes it a socket option rather than a channel one: a socket accepts frames at a room nobody named, where the other way into a room from outside — a `POST` — exists only because an app declared an rpc that publishes into it, and that declaration is already the intent a flag would be restating. `transform` still runs on the publish this admits, refusing being a question about the message rather than about who asked. |
| `clients` | `Omit<Clients, 'openapi'>` | The same record the http lane takes, minus the key a room has no meaning for. `ui: false` withholds the generated subscriber; `mcp: false` withholds the resource AND the publish tool, those being one handler's two halves. |

### Expectations

* channels are carried over a single web socket mux
* upgrade goes through `middleware`
* Every message carries a `seq`, monotonic per room and minted at publish, and a room carries an epoch — its history version. A process restart moves it, a counter held in memory going back to zero when the process does, and that is its ONE cause — nothing an app calls moves it (see "Editing what was produced" under `channel`). Both are internal. An app never writes either: `room.tail(n)` already replays its snapshot and goes live from where it ended with no gap and no duplicate, so the reconnect carries the last `seq` it rendered and compares epochs underneath, and a moved epoch means the client takes the tail marked as a reset rather than being told there is nothing new. The reset is announced because it has to be: a server that changed incarnation cannot know what the client painted, so replaying the tail silently would duplicate rows a `{#for await}` had already appended. On a reset the block CLEARS its accumulated rows and repaints from the tail — the one place it is not append-only, and rare enough that correctness beats the reflow. That is what makes the three handoffs ONE mechanism rather than three — the seed buffer, a socket that dropped and reopened, a tab too slow to adopt — with `room.tail(n)` the only spelling any of them has.
* A cursor an app persisted across sessions is the one thing this would not serve, and it could not be served anyway: the tail is a memory ring bounded by `tail` and `ttl`, so a cursor older than that is always past it. Catching up over that horizon is app data behind an ordinary rpc, not a room.
* `seq` is `{#for await}`'s DEFAULT key where the source is a room, so a streamed list off a channel is keyed without an app declaring one. A stream that is not a room — a jsonl rpc — has no `seq` and is positional unless the block spells `by`.

## Mount paths

| File | Export | Served at |
| --- | --- | --- |
| `server/rpc/name.ts` | `default` | `/__abide/rpc/name` |
| `server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |
| `server/sockets/chat.ts` | `default` | `/__abide/socket/chat` |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

A path is owned by exactly one handler, and a collision is a build error naming both files —
`server/rpc/users.ts` exporting `getUser` and `server/rpc/users/getUser.ts` exporting `default` mount
at the same address. The route table is a build artifact, so it is found there rather than at the
first request that reaches whichever one won.

## Schemas

| Name | Type Signature | Description |
| --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T> \| JsonSchema` | The three forms. A schema RETURNS what it accepts, so it normalises as well as refuses — which is why the function form is `=> T` and not a predicate. A `boolean` cannot normalise, and a `false` stored as the value is the silent version of a refusal; `(v) => typeof v === 'number'` failing to compile is the error that says "return the value". |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. The bound exists because the canonical wire form of an args object is also its cache key. |
| `Issues<T>` | `T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where — a record on a composite, a bare list on a primitive. IT IS A lookup rather than A LIST because the reader always has the path in hand: a form renders a field's messages as `data['lines.0.qty']`, where a flat list costs `find` Per field per render and a twenty-field form twenty scans. `string[]` and not `string` because one field fails two ways at once — too short AND malformed — and one message per path is a loss with nothing naming it. The root is `''`, which is where a whole-object `refine` lands and where the plain-function form lands, throwing a sentence and having no path to give. Integer-like keys iterate first in JavaScript whatever the insertion order, which is what an array wants and a mixed shape merely has. |
| `Paths<T>` | `string` | The dot-joined leaf paths of `T` — `lines.0.qty`, never `lines[0].qty`. One spelling, and it is the one every Standard Schema already hands back: `path: ['lines', 0, 'qty']` joined, so there is no bracket grammar to specify and nothing to parse back. DEPTH-limited, because a recursive template-literal type is typecheck time paid on every handler and an unbounded one is where that becomes minutes; past the limit the key widens to `string` and the lookup stops being checked rather than the build stopping. |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form — what a handler means, and the only one publishable to a tool definition or an OpenAPI operation. |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator, `null` when it matches. It hands back the same shape a refusal carries, so there is one form of "what was wrong" rather than a list here and a record there with a conversion between them. |

### Expectations

* Deriving a schema from an annotation means the build resolves types, so build time is typecheck time and a schema is only as good as the inference that reached it. Where inference fails the compiler READS rather than refusing the file — valid TypeScript has to compile — so an unresolved annotation degrades to a wider schema SILENTLY. That is the cost of "the shape is never declared twice", and the repair is the one an app already has: declare `schema` — the args' on a keyed memo, the value's on a state or a channel — where the derivation cannot be trusted.
* a plain function `(value: unknown) => T` returns what it accepts and THROWS what it refuses. The throw is caught where the `schema` runs and becomes the `''` entry, so a sentence is a refusal like any other and never escapes as an exception.
* a Standard Schema `StandardSchemaV1<T>` is the interop spec zod/valibot/arktype answer to.
* `rpc.isError(e, 'ValidationError')` narrows `e.data` to `Issues<Args>` with nothing declared, so `e.data['lines.0.qty']` is checked against the argument shape rather than being an untyped string index. |
* COERCION IS THE PIPELINE'S, not the schema's. `validateJson` stays a checker; a `GET` / `DELETE`'s text args are coerced from the JSON Schema's declared `type` BEFORE validation — `"number"` through `Number()`, `"boolean"` from `"true"` / `"false"`, `"array"` from the repeated key — which is total over the flat arg types and is the same table `style: form, explode: true` publishes. It happens at the `ctx.args()` that first asks, so every rung after that one, and the handler, see the coerced value. Putting it in the schema instead would ask every form of `Schema` to coerce, which the native `validateJson` does not do and a Standard Schema does its own way.
* When no schema is specified, it is derived from the type annotation and the argument defaults, and a default makes a member optional at both levels. `GET(({ id }: { id: number }) => …)` builds `{ id: number }` with `id` Required. `GET(({ id = 1 }) => …)` builds `{ id?: number }` carrying `default: 1`. `GET(({ id = 1 } = {}) => …)` makes `Args` Itself optional, so the address is a valid call with a bare URL. One rule — `required` is which destructured members lack defaults, and `Args` is optional where the parameter has one — derivable from syntax alone, and it is why a handler with no parameter at all is called `rpc()`.

## Headers abide generates

| Header | On | Why |
| --- | --- | --- |
| `x-content-type-options: nosniff` | everything, unconditional | Every abide response declares its own type, so a browser guessing a different one is only ever the vulnerability — a JSON refusal sniffed as HTML is script on this origin. Spelled a second time on the asset route, which is served in front of the pipeline and never reaches the funnel |
| `traceresponse` | everything, unconditional | The response you most want to correlate is a failure, so the 404 carries it too |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal — as a DEFAULT the handler's own `ResponseInit` overrides | A page renders per request and `principal` is a first-class thing to render off; a handler answers as whoever called it. Absent is not neutral — it licenses a shared cache to invent a freshness lifetime for an answer that names who asked. |
| `cache-control: no-store` | `/__abide/health`, `/__abide/principal` | Both describe this process or this caller at this moment. A cached health check is a load balancer being told a drained instance is healthy |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk is addressed by its own content hash, so it cannot go stale |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default written down, for the older agent that still defaults to `no-referrer-when-downgrade` and leaks an authenticated path to every cross-origin image |
| `vary` | wherever an answer depends on a request header | `accept-encoding` on anything compressed or compressible, `accept` on a stream that can be framed two ways, `origin` on a cross-origin rpc |

# Generated surfaces

A handler already carries an address, a method, an argument schema, a result schema and a
description. A machine surface is that same handler spoken in another vocabulary — an OpenAPI
operation, a tool definition, a command — and every one is derived from the route table rather than
authored beside it. There is no second artifact to keep in step, which is the whole of the claim:
exposing an app to something that is not its own page costs a handler nobody wrote twice.

What they share is the derivation, not an audience. An OpenAPI document is read by a code generator
and by a person in a browser; the CLI is a person at a prompt, a script in CI, and an agent that can
run a command but cannot speak MCP, which is why its framing follows the TTY — human-readable to a
terminal, JSON to a pipe, the same address either way. So they are grouped by being GENERATED rather
than by who reads them. The CLI's own surface lives in `# CLI`; what belongs here is `Clients`.

| Name | Type Signature | Description |
| --- | --- | --- |
| `Clients` | `{ ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }` | Which surfaces carry A HANDLER. The record is optional and so is every key, and every default is true: a handler is reachable from everything until it says otherwise, so the record is only ever written to withhold. An app that never writes one is fully exposed and fully correct, and a fifth surface is a fifth key rather than a fifth field on the option bag. |
| `clients` | `Clients` | `RpcOptions`. `SocketOptions` takes `Omit<Clients, 'openapi'>`, a room not being an http operation — the key is absent rather than accepted and ignored, so there is nothing dead to read past. |

### Defaults

| Key | Default | Because |
| --- | --- | --- |
| ui | true | An rpc exists to be called by the app's own pages, that being the case it was declared for |
| openapi | true | An operation describes an address an http caller could have found by trying it, so describing it reveals no reachability that was not already there |
| mcp | true | A model is a caller like the others, and a surface an app has to opt into is a surface most apps never get. What keeps it safe is what keeps `openapi` SAFE: a tool describes an address an http caller could have found by trying it, so listing it reveals no reachability that was not already there. The list is filtered by whatever the APP-lane rung already decided — a caller who cannot reach `/__abide/mcp` is shown nothing — but a handler's own rung cannot be speculatively run, one authorising on `ctx.args()` having no args to run it against, so a tool that rung would refuse is still listed and still refused on the call, with the same `Failed` a browser would get. An app for which a handler's existence is sensitive says `mcp: false`, which is a listing decision, which is what `clients` is for |
| cli | true | The CLI authenticates as the operator, with `ABIDE_APP_TOKEN`, who can already reach every address directly |

### Expectations

* NONE OF THIS IS ACCESS CONTROL, and reading it as any is the dangerous mistake. `openapi: false`
makes an address undocumented, not unreachable. `mcp: false` and `cli: false` withhold a listing, and
the http address answers exactly as it did before. What decides who may call is middleware — the same
rung that decides it for a browser — so `clients` decides what is generated and what is listed, and a
handler that must refuse a caller refuses it in a rung.
* `ui` IS THE ONE WITH TEETH, being the only key resolved at compile time. `ui: false` generates no
client wrapper, so importing that name from `#ui` or a `.abide` file is the same compile error a
non-handler already is — a server-to-server or agent-only handler the app's own pages provably
cannot call. The other three are listings assembled at runtime from the route table, and a listing is
not a boundary.
* The four are one question and so they are one record — four sibling booleans on `RpcOptions` would be
four places to look for the same answer.

## OpenAPI

| Name | Type Signature | Description |
| --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The document, served from a `memo` over the route table and `config()` — abide's own primitive rather than a second cache with its own staleness to reason about. It takes no `ttl`: the route table is a BUILD artifact and cannot move under a running process, and `abide dev` throws the memo away with the module graph it replaces. `config.invalidate()` is the one thing that does move it — a port a dev hop pinned, a rotated secret — and it needs no wiring, because reading `config().APP_URL` IS the subscription. So `servers[0].url` follows a mount chosen after the build, which is the same reason `rpc.url` is derived rather than baked. Gated by `ABIDE_OPENAPI`, a closed one answering 404 the way `abide logs` does. Inside the app's own middleware like every `/__abide/**` address, so an auth rung gates it with no second mechanism. |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, because 3.1's schema dialect is JSON Schema — the same `JsonSchema` a handler already means, published with no translation layer to drift. |

### What one handler contributes

| Piece | Comes from |
| --- | --- |
| Path | the mount path — see "Mount paths" |
| Method | which handler was used |
| Operation id | the export name, qualified by its file where two files export the same one. A path is owned by exactly one handler and a collision is a build error, so the id is unique by construction rather than by a counter |
| Summary and description | `description` |
| Tags | the rpc file's directory under `#server/rpc`, which is where the address comes from too — so operations group the way the files already do, and a handler at the top level carries none |
| Parameters | `GET` / `DELETE` only: one `in: query` per top-level key of `Args`, which are flat by type. An array is `style: form, explode: true` — the repeated key a `URLSearchParams` already has a form for |
| Request body | `POST` / `PUT` / `PATCH` only, and all three of `application/json`, `multipart/form-data` and `application/x-www-form-urlencoded`, because all three are accepted |
| Success | the result schema at the content type the return type decides — `application/json` for a raw value, the Blob's own type or `application/octet-stream` for a binary |
| No content | a `204` where the handler's return type admits `undefined` |
| Refusals | One response per `Failed<Name, Data>` in `Failures`, at its own status, carrying the data schema. `Failures` is inferred from the handler's return type, so the error responses are derived from the same place the caller's `isError` narrowing is |
| Default | the undeclared `Failed`, `name: 'HttpError'`. `refuse(status)` carries no data and has none to declare |

### Expectations

* What publishes is the schema's own JSON schema where it has one. `JsonSchema` publishes as itself,
being the native form. A Standard Schema mostly can too — zod, arktype and valibot each expose a JSON
Schema export — so abide probes ONE spelling, a zero-argument `toJsonSchema()` on the schema object,
and an app whose library spells it otherwise adapts it in the one line. A registry of vendors inside
the framework needs a fourth entry the week a fourth library exists, and
`~standard.vendor` is already there to NAME what was found rather than to dispatch on. Failing both,
the type-derived `JsonSchema` publishes — schemas derive from annotations where none is declared, so
there is always one to fall back to.
* PUBLICATION IS A SUPERSET IN ONE DIRECTION ONLY, and that is what makes it safe rather than
approximate. A constraint with no JSON Schema expression — a `.refine(fn)`, a plain-function schema —
is unpublishable by anyone, so the document admits what the handler still refuses with 422. It never
errs the other way, which is the direction a generated client would break on. What the fallback
changes is how much is lost, never which way it is lost.
* Which path was taken is said out loud, on `abide:openapi`, naming the handler and the vendor. A
silent fallback is an app believing its precise shape published when a type-derived superset did, and
nothing about the document's own validity would ever reveal it.
* THE SCHEME IS DERIVABLE; THE REQUIREMENT IS NOT, and OpenAPI already separates the two. abide owns
the principal transport — a sealed `abide-principal` cookie — so `components.securitySchemes` is
derived: `apiKey`, `in: cookie`, that name. What is not derived is `security`, which says an operation
requires it. Authorization is a middleware rung and a rung is code: nothing about `GET(getInvoice)`
says who may call it, and an app that registered `onPrincipal` still serves public addresses. So the
document says how a caller authenticates and never that one must — a generated client can send
credentials and is not told they are mandatory. Claiming otherwise would publish that a call is public
because the check was one function call away from where the generator looked.
* THERE IS NO DOCUMENT HOOK. A `(document) => document` escape hatch is the second artifact this
surface exists to remove: an app able to rewrite the document can make it disagree with the route
table, and "derived, cannot drift" stops being a property the moment one can. Everything such a hook
would have carried is derived, and the one residue — an operation's own auth requirement — belongs on
the HANDLER where it cannot contradict the table.
* `crossOrigin` is not security and does not become `security`. It decides which origins a browser may
call from, enforced by the browser, and publishes as nothing at all.
* A `GET` over a channel is an operation; A socket is not. OpenAPI describes request and response over
http, which a socket is neither of, so a socket address is ABSENT from the document rather than
described badly — the tool-definition surface is where a room is described. The channel read is an
ordinary http read, jsonl by default and sse on `Accept`, so it publishes as one operation with two
response content types and `vary: accept`.
* A stream publishes the shape of one item, not of the whole. OpenAPI has no framing vocabulary for
jsonl or sse, so the content type is what says there are many and the schema names what one of them
is. An array schema would describe a body that is never sent whole.
* The document is assembled from the route table, the same build artifact that makes a mount collision
a build error. So it cannot describe a handler that does not exist and cannot miss one that does,
and there is no registration step to forget — which is the property an authored spec cannot have.
* `info.title` and `info.version` are `APP_NAME` and `APP_VERSION`, derived config fields that already
exist, so the document has no version of its own to bump. `onOpenApi` overrides them where an API's
version is not the app's.
* Publishing is a deployment decision, which is why the gate is an environment variable. The same
document is right in staging and wrong on a public edge, and a flag in code would have to be rebuilt
to change. `ABIDE_OPENAPI` mirrors `ABIDE_LOGS`; `abide openapi` writes the document whatever the gate
says, because a file on disk is not an exposed surface.
* The completeness check is a generated client. The document is complete when a client generated from
it can express everything abide's own generated client can — the name, the args, the result and every
declared refusal. A generator that cannot reach a refusal by name is reading a document that
under-describes, and that is the gap to fix rather than a limit of the generator.

## MCP

The same route table as `## OpenAPI`, spoken to a model instead of to an http client. What differs is
not the derivation but what the protocol has to say with: MCP separates a TOOL the model chooses to
call from a resource the host attaches without asking, and abide already knows which a handler is
— the two `Reactive` arms `GET` takes are exactly that distinction, so nothing here needs a flag to tell them
apart.

| Name | Type Signature | Description |
| --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint, served from the same `memo` shape `/__abide/openapi.json` is: the tool list is the route table, which is a build artifact. Gated by `ABIDE_MCP`, a closed one answering 404. Inside the app's own middleware like every `/__abide/**` address, so the rung that authorises a caller authorises a model with no second mechanism and no second notion of who is asking. |

### What one handler becomes

| The handler | Becomes |
| --- | --- |
| a `memo`, described | a TOOL — the model chooses to call it, and the result is one value |
| a `channel`'s read view | a resource with subscription. A room does not end, so a tool call that drained it would hang; `notifications/resources/updated` is the shape the protocol already has for a value that goes on arriving |
| a `channel`'s publish view | a TOOL, on exactly the terms a browser has one — the socket's `clientPublish` for a room served over a socket, an app's own publishing rpc otherwise. There is no publish tool for a room nothing exposed |
| a `GET` with flat args | Additionally a resource template, `abide://rpc/<address>{?args}`. A `GET`'s args are flat by type, which is what a URI template can express and a `POST` body cannot, so the split falls out of the existing rule rather than being decided here |

A `GET` is both because the two surfaces are read by different things: a host attaches a resource to
build context nobody asked for, and a model calls a TOOL because it decided to. Publishing a read as
only one of them makes it unreachable to whichever half of the client the app needed.

### What a tool carries

| Piece | Comes from |
| --- | --- |
| Name | the mount path's segments and the export name, joined by `_`. A path is owned by exactly one handler and a collision is a build error, so a tool name is unique by construction |
| Description | `description`, and it is also the GATE — see below |
| Input schema | the argument schema, by the rules in `## OpenAPI` — the schema's own JSON Schema export where it has one, the type-derived form otherwise |
| Output schema | the result schema, so a model gets `structuredContent` rather than prose it has to parse back |
| Annotations | the method, which already means this: `GET` is `readOnlyHint`, `DELETE` is `destructiveHint` and `idempotentHint`, `PUT` is `idempotentHint`, `POST` and `PATCH` are neither, being neither safe nor repeatable. `openWorldHint` is not derived, nothing about a handler saying whether the thing behind it is a closed system |
| Errors | one per `Failed<Name, Data>` in `Failures`, carrying the NAME and the data. A model that can tell `NotFound` from `Forbidden` retries differently; one reading a sentence guesses |

### Expectations

* `description` is not a gate. Withholding an undescribed handler makes the absence invisible — a tool
list is read for what is in it — and couples two unrelated decisions. `clients.mcp` says the one thing
and `description` says the other.
* AN UNDESCRIBED TOOL IS PUBLISHED THIN AND SAYS SO, warning on `abide:mcp` and naming the
handler. `description` is what a model reads to decide whether this is the call it wants, so a
tool without one is reachable and hard to choose — which is a quality problem an app should be told
about, not a reason to hide the tool and tell nobody.
* What is withheld is said out loud, on `abide:mcp`, naming the handler. A tool list is defined by
what is ABSENT from it as much as by what is in it, and an app wondering why a model never calls
something is otherwise reading a short list for a clue that is not in it.
* A streaming tool is bounded by `timeout`, which already exists and already means this. An rpc over a
`memo` returning an `AsyncGenerator` drains into one result, and the bound on how long that may take
is the handler's own — so the hang has a limit that was declared rather than one invented here. A
`channel` is the unbounded case and is never a tool for reading, which is why the arms are split by what the
handler was declared over and not by the return type.
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
* It is not folded into `abide start`. MCP over stdio requires that nothing but a protocol message
reach stdout, where an interactive caller's whole job is writing there, and the human end is the one
that cannot move off it.
* WHOEVER SPAWNS A STDIO SERVER OWNS ITS LIFECYCLE. A model
client starts one per conversation and kills it at the end, so `abide start` in that position means
closing a chat window stops the app, two clients race for one port, and a reconnect restarts a server
nobody asked to restart — under `abide dev`, on top of the worker replacement that is already the
reload. The bridge is cheap and disposable precisely so the app does not have to be. `abide start`
Serves; the interactive caller and the model are both callers of something already running, and
neither is the app.
* The interactive caller and this are one mechanism, differing only in what is on the other end of the
pipe — a person, or a JSON-RPC client. Same route table, same middleware, same `principal`, same
refusals; only the framing changes, the way one rpc address carries jsonl and sse. Implementing them
twice is the drift this section exists to make impossible, so the CLI surface is where the framing is
chosen and not where a second client is written.

# Ambient values

## `bag`

| Name | Type Signature | Description |
| --- | --- | --- |
| `bag` | `() => Map<keyof Bag \| string, unknown>` | A bag of values carried for the life of one request, and a plain `Map` on purpose — no reactivity, no get-or-create, nothing to await. `state.share` is the other one and they are not the same job: this is storage, that is a shared reactive node, and putting a `Connection` behind `state(…)` just to read it back with `.settled()` is ceremony bought for nothing. |
| `Bag` | `interface Bag {}` | The app's own declaration-merged types for `bag`'s keys, additive and never required: a declared key reads back as its type, an undeclared one as `unknown`, which is exactly the behaviour of not writing one at all. It is here so the cast at the read site is optional rather than structural. |

## `cookies`

| Name | Type Signature | Description |
| --- | --- | --- |
| `cookies` | `() => CookieMap` | The cookies of the request being served, live and mutable — Bun's own `CookieMap`, so `set` takes attributes and there is no abide API to learn. |

### Expectations

* Isomorphic. On a server it is `Bun.CookieMap` and writes are collected onto the response
(`toSetCookieHeaders()`); in a browser it is the same interface over `document.cookie` and each write
is immediate. Setting a cookie on the client sets a cookie. Unlike `principal.set` there is no
headers-are-out failure in a browser, there being no header to be out of.

```ts
cookies().set('theme', 'dark')                                  // both sides — path=/, sameSite=lax
cookies().set({ name: 'cart', value: id, maxAge: 604800 })
cookies().delete('cart', { path: '/' })
```

* `secure` Defaults from `NODE_ENV`, not from Bun's `false`. An app's own cookie should not be quietly
weaker than the two abide sets, and a default that differs between the framework's cookies and the
app's is the kind of asymmetry nobody reads the docs to discover. `path` and `sameSite` are Bun's
(`/`, `lax`).
* TWO ASYMMETRIES, both stated rather than smoothed over, because a map whose contents differ by side
is something an app will otherwise branch on. `HttpOnly` cookies are invisible to the client map —
`cookies().get('abide-principal')` is the sealed text on a server and `undefined` in a browser, which
is the flag working rather than a gap. And `document.cookie` cannot set `httpOnly`, so a client-side
`set({ httpOnly: true })` THROWS: silently dropping the flag reads to the caller as a cookie script
cannot touch, which is the same silent-success failure `principal.set` throws to avoid.

## `request`

| Name | Type Signature | Description |
| --- | --- | --- |
| `request` | `() => Request` | The request being served. |

### Expectations

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

* `route` is not a reactive value whose value is a Route — its members are reactive values. They change at different rates and are read separately, so a composite would wake every reader of the url twice per navigation for a spinner's sake, and rebuild an object nobody asked to be rebuilt. The rule generalises: split a composite into member states when its members move at different rates and readers read them apart; a thing read whole and written whole stays whole.

* Page routes are resolved under `src/ui/pages/` — `route` itself spans pages, rpcs and sockets alike
* A route is created where a `page.abide` file lies under that path
* The file path determines its url, so `src/ui/pages/admin/[tab]` would resolve `${APP_URL}/admin/foo`
* Params passed through `[param]` `[[optional]]` and `[...rest]`.
* `Route.name` is the resolution path eg `/admin/[tab]`.

## `online`

| Name | Type Signature | Description |
| --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the caller can reach the app. |

### Expectations

* In a browser that is `navigator.onLine` and its events.
* ON A server the arriving request is the answer, so it is `true` — a measurement rather than a
default, the caller having demonstrably reached the app to be served at all. A client that has gone
offline since is corrected by its own first read, which is an ordinary state change and not a
hydration mismatch. That is what keeps one question behind the name on both sides rather than a
browser reading and a server constant.

## `trace`

| Name | Type Signature | Description |
| --- | --- | --- |
| `trace` | `() => string` | The trace id — the operation this work belongs to. Built on first ask and held for the request, whether or not `sampled`: sampling decides export, not existence, which is what lets the seed scope be keyed on it (see "rpc"). |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. A trace that starts here is `03`. It is what `trace.span` reads to decide whether to record, so instrumentation an app declares costs a boolean on an unsampled request. |
| `trace.span` | `<T>(name: string, body: () => T) => T` | Opens a child span around `body` and hands back exactly what `body` returned — sync in, sync out, and the duration measured to settlement only where what came back is thenable, which is the guarded await rather than an unconditional one. Inside it the current span is the child, so `trace.headers()` names it as parent and a downstream hop hangs off the right node. A wrapping form and not a reading one: under one span per hop a bare id names nothing an app can act on, and the id is only ever interesting relative to a span somebody opened. Unsampled, it runs `body` and records nothing. |
| `trace.headers` | `() => Record<string, string>` | What an outbound request carries: `traceparent` naming the current span as parent, plus `tracestate` propagated byte for byte. Attached automatically by `remote`; an explicit one is not overruled. |

### Expectations

* A SPAN IS A `LogRecord`, not a second feed. `message` is the span NAME, `duration` the ms it took,
`parent` the span it was opened inside — so `abide logs` shows a span and every line written inside it
in one feed and in order, and an exporter subscribes to `log.records` and filters `duration !== null`.
A second room would be a second retention, a second read view and a second thing for `abide logs` to
merge, for a record four of whose fields a log line already carries.
* The request's own span is one of these, opened when the request starts and closed when it ends, so
its duration is the request duration and costs nothing to take. `abide:request` IS that record rather
than a line beside it, which is what gives a child span a parent to hang off instead of naming a root
nothing wrote down.
* `startedAt` is ISO-8601 and the duration is monotonic — two clocks, deliberately. The first orders
and displays; the second is a `performance.now()` delta, because a `Date.now()` one is wrong across a
clock adjustment.
* A DURATION IS NOT A BENCHMARK. A span around a sub-millisecond body reports the clock's resolution
rather than the code's cost (see the timing rule in `CLAUDE.md`), which is right for tracing — wall
time of a real operation — and is why no performance claim is ever made off one.

## `server`

| Name | Type Signature | Description |
| --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server — `requestIP`, `publish`, `pendingWebSockets`, `stop`. Throws before anything has served. |

## `health`

| Name | Type Signature | Description |
| --- | --- | --- |
| `health` | `Reactive<Health>` | The account of the app this call is IN. A `Reactive` like `route`'s and `principal`'s members, so `{health.version}` reads in a template under the short-circuit rule and `await health` still gives the settled document. Seeded like an rpc. |
| `Health` | `{ version: string; startedAt: string }` | The account itself — the baseline below, with whatever `onHealth` merged over it. |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter: fields merged over the baseline. Returns the way off again. |

### Baseline fields 

| Name | Type | What it says |
| --- | --- | --- |
| `version` | `string` | The app's version, off the same package.json its name comes from. Empty rather than absent. |
| `startedAt` | `string` | When the process started, ISO-8601. |

### Expectations

* `GET /__abide/health` returns `Health` over HTTP. Answered outside the middleware, because the load balancer asking presents no credentials — so it is unauthenticated, and whatever `onHealth` merges is public.
* Seeded like an rpc, as `principal` is: a page that reads `health()` leaves it in the seed buffer for the client's own `GET /__abide/health`, one that does not ships nothing.
* An app's fields win every collision, `version` included.

## `principal`

| Name | Type Signature | Description |
| --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses, ISO-8601. Absent on an anonymous caller. |
| `principal.error` | `Reactive<Failed \| undefined>` | The app's resolver failing. A caller carrying one is never authenticated. |
| `principal.resolved` | `Reactive<unknown>` | What `onPrincipal` Returned, merged over the baseline. Named for the output rather than the input: `claims` are the proof in the cookie and are what `onPrincipal` Receives, so a member holding what it handed back cannot be called that too — see "THREE THINGS". ONE state rather than members, because what an app resolves is arbitrary and there is nothing static to split. |
| `principal.caller` | `Reactive<string>` | Which browser, as against who they are: the `abide-caller` handle, present whether or not this caller authenticated. SERVER-ONLY — it is not in `Principal`, and it throws in a browser, since the one client-side use for a stable per-visitor id is the fingerprinting the handle must not become. It sits beside `claims` because both are facts about the party asking, differing only in whether that party proved anything. |
| `principal.set` | `(claims: unknown) => Promise<void>` | Authenticate this caller: `claims` are sealed into the `abide-principal` cookie and every response this request builds carries it. THROWS when the sealed cookie would exceed the ceiling, naming the byte count, and throws once the headers are out — a page that has begun streaming has no `set-cookie` left to write. Both are the same failure: silently not setting one reads to the caller as signed out with nothing written down. Throws in a browser. Not reachable from a page: the head flushes as early as it can, so a component's setup is already past the point a `set-cookie` can be written. Authentication happens in the app's `middleware`, in the app's own route, or in an rpc handler, and the page that follows is a `redirect()` — which is the redirect-after-login shape anyway. |
| `principal.clear` | `() => void` | Sign this caller out, for the rest of THIS request as well as the next one, and rotate the `abide-caller` handle — signing out hands the browser back. Server-side, like `set`. |
| `Principal` | `{ authenticated, expiresAt?, error?, …claims }` | The wire document, which is what `GET /__abide/principal` answers with. It is not how the API is read. |

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

* Members are states, as `route`'s are, and for the same reason: `expiresAt` moves on every rolling re-seal while `authenticated` does not, so a nav bar reading whether someone is signed in should not wake twice a fortnight for a seal it never looks at.
* The four identity members share ONE resolve per request — the resolution is the document's, not each member's — so they settle together and two asks never cost two resolves. `caller` is not among them: it is read off its own cookie or minted, needs no resolution, and is available on a request that never asks who anyone is.
* `caller` SURVIVES SIGN-IN, which is what makes an anonymous cart keyed on it become the account's cart with no merge step. It does not survive sign-out, nor the browser session, so it is a handle for THIS browser for THIS session and never a durable user key: anything meant to outlive either is keyed on what the claims identify.
* THREE THINGS, NOT ONE. CLAIMS are the proof and the only thing in the cookie: an identifier for whoever this is, and a version to check it against — a couple of hundred bytes sealed, and nothing that grows ever goes in. abide names neither field; claims are `unknown` by contract and `onPrincipal` is what reads them. The PRINCIPAL is what `onPrincipal` resolves that proof into, and is PUBLIC BY DEFINITION — it is what `GET /__abide/principal` answers and what the seed buffer hands a client — so anything server-only the resolver derived belongs in `bag()`. SESSION is app data addressed by that identifier, behind an ordinary rpc, and belongs in neither. The version is what buys revocation sooner than `ABIDE_PRINCIPAL_TTL`: `onPrincipal` compares the sealed one against what it has stored and fails closed on a mismatch, so bumping the stored value invalidates every live cookie for that caller on its next request — no session store and no revocation list, at one lookup per request.
* Seeded like an RPC, not embedded unconditionally. A page that never reads `principal` ships none of it and a later client read is an ordinary `GET /__abide/principal`; a page that reads it goes through the same seed buffer any rpc uses, so the client's first read costs no resolve — the request is still made, and is free only while the bundle load covers it, see "HYDRATION RE-EXECUTES SETUP". One entry for the whole document, the four members already sharing one resolve.
* THE BASELINE WINS EVERY COLLISION, which is the opposite of `health`: `health` is an app describing
itself, so its own `version` beats a derived one, but `authenticated` is abide's determination about a
seal it verified, and an app that could overwrite it by returning a field of that name would
AUTHENTICATE A CALLER BY ACCIDENT. A claim colliding with a baseline name is dropped and warned on
`abide:principal`.
* Never null. An anonymous visitor is `authenticated` false, not an absent document.
* `GET /__abide/principal` returns `Principal` over HTTP. Open — the answer is composed from the caller's own cookie — and `no-store`.
* Sealed by an HMAC over the claims and their expiry. Signed, not encrypted — the claims are readable by whoever holds the cookie, and `HttpOnly` keeps script out, not the person.
* Stateless: abide keeps no server-side store and no revocation list of its own, so a ban takes effect within `ABIDE_PRINCIPAL_TTL` unless the claims carry the version described above for `onPrincipal` to check. The one lookup per request that costs is the app's to pay — abide does not pay it for them.
* Cookie is set with `HttpOnly`, `SameSite=Lax`, and `Secure` in production only
* A bad signature, a lapsed seal and a malformed cookie are ONE answer: this caller is anonymous
* Resolved at most once per request; what is held is the document or the promise, so two asks share one resolve
* Rolling: the seal is refreshed once half spent, so an idle session still lapses on schedule
* `clear` ROTATES the `abide-caller` id and `set` does not, and the asymmetry is what each operation
means: signing in is continuity — the same browser, now named — while signing out hands the browser
back, and the next person at a shared machine should not inherit what the app keyed on the old handle.
The two cookies stay separate: `abide-principal` is a claim about WHO, `abide-caller` a handle for
WHICH BROWSER.

## `config`

| Name | Type Signature | Description |
| --- | --- | --- |
| `config` | `<Extra extends object>() => Config & Extra` | Every field of `Env` is present. THROWS what `onConfig` threw and what its schema refused, and throws in a browser — `Env` holds `ABIDE_PRINCIPAL_SECRET` and `ABIDE_APP_TOKEN`, so nothing about it reaches a client implicitly. An app that wants some of it public declares a `GET` that returns those fields. |
| `Config` | `{ …Env }` | The resolved document: every field of `Env`, plus whatever `onConfig` defaulted and the schema normalised. |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion — what `ConfigDefaults` receives. |
| `config.invalidate` | `() => void` | Re-reads the environment and re-runs `onConfig`, for a value that moved under a running process — a rotated secret, a port a dev hop pinned. Unlike boot, a refused schema does not fail hard here: the server is already serving, so the previous document stands and it warns on `abide:config`. |
| `onConfig` | `<Extra>(fn: ConfigDefaults \| null, options?: ConfigOptions<Extra>) => () => void` | The app's defaults: `fn(env)` returns fields merged under what was declared. Takes effect on the path, not just the document. |
| `ConfigDefaults` | `(env: Env) => unknown` | Synchronous by contract. Whatever it names becomes overridable by a variable of that name. |

### `ConfigOptions`

| Name | Type Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Extra>` | The same `Schema` a transport handler takes, checked last over the whole document. It normalises as well as refuses. |

### Expectations

* Precedence: derived (`APP_NAME`, `APP_VERSION`, `APP_DATA_DIR`) < `config` from user < env
* A value out of the environment is coerced to the type of the default it overrides; a value that will not coerce keeps the default. Anything richer stays the raw string for a schema to convert
* `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` are derived if not in the config.
* A second `onConfig` replaces the first, schema included, and warns on `abide:config` — one of the two hooks that replace rather than compose, see "Lifecycle hooks"
* a hook that throws fails hard and server isnt started

# Helpers

## `log`

A LOG IS A `channel`. Both publish, both retain a bounded ring, both are subscribed to, and both
replay what they retained and then go live — which is the cursor contract at `s.tail` word for word.
So `log` is defined over the primitive: every line is a `publish`, the retention is that room's
`tail`, and `GET /__abide/logs` is the read view a `GET` over a channel already is.

What this is not is a performance change. The share is a ring push and a version bump against a call
whose cost is dominated by the write to stdout, so the claim is machinery — one mechanism rather than
two — and the per-line ratio is owed before anything faster is said.

| Name | Type Signature | Description |
| --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message on the default channel, `<app name>`. Always writes — an app's own output needs no env var. |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | The four levels. `warning` and `error` always write on every channel, and go to stderr in every format. |
| `log.channel` | `(name: string) => Logger` | A named channel, prefixed `<app name>:`. Calling it again appends another segment; the same name hands back the same logger. |
| `Logger` | `typeof log` | What `log.channel` hands back: the same four levels and the same `enabled`, writing on that channel. The default channel is one of these, so there is no second shape to learn. |
| `log.enabled` | `() => boolean` | Whether a gated line on this channel would be written. For a call site whose message costs something — an argument is built before the gate can refuse it. It takes no level because `DEBUG` gates channels and not levels; `warning` and `error` writing on every channel is a separate rule and not one this reports on. The app's own channel answers `true`. |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; channel: string; message: string; trace: string \| null; span: string \| null; parent: string \| null; duration: number \| null }` | One line, and the `Message` the room carries. EVERY FIELD IS ALWAYS PRESENT — a shape that grows a field conditionally is two shapes — so an ordinary line carries its `span` and a null `duration`, and a span close carries all four of the trailing fields with `message` as the span NAME. That is what puts a span and the lines written inside it in one feed (see `trace.span`), and it is why there is no second room. `channel` is a FIELD, which is why a named channel is a stamp on the record rather than a room of its own. The record's shape is fixed; the serialization need not be, and `json` omits a null rather than writing it. |
| `log.records` | `Room<LogRecord>` | The room every line is published to, and an ordinary one: `[...log.records.tail()]` is what is retained, `{#for await line of log.records}` is a viewer inside the app, and `log.records.tail(100)` replays a hundred and goes live. There is nothing to reach for the feed through — a page that wants a log pane subscribes to the same room `GET /__abide/logs` serves. |

### abide's own log channels

| Channel | Level | What it says |
| --- | --- | --- |
| `abide:request` | `debug` | `<method> <path> <status>`, once per request — the request's own span closing, so the `n`ms is that record's `duration` rather than a timer of this line's own. |
| `abide:socket` | `debug` | `socket <path> <published \| rejected \| subscribed \| unsubscribed> <n> subscribed`, once per message. |
| `abide:lifecycle` | `debug` `error` | `<lifecycle> <success \| failed> <n>ms` when a lifecycle is run. |
| `abide:principal` | `debug` `warning` | `principal <authenticated> <success \| failed>` when the principal is set or cleared; a claim colliding with a baseline name; a second `onPrincipal` replacing the first |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object |
| `abide:mcp` | `debug` `warning` | A handler withheld by `clients.mcp`, and a tool published with no `description` for a model to choose it by |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export, so the type-derived superset published instead — naming the handler and the schema's vendor |
| `abide:config` | `warning` | A second `onConfig` replacing the first |
| `abide:render` | `warning` | An `error.abide` that itself failed, so the boundary escalated past it — abide's own minimal document is what answered |
| `abide:reactive` | `warning` | A failed revalidation over a value still being served — nothing unmounts and no `{:catch}` mounts, so the line is the only sign of it |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw, and the watch it stopped |
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane: a mismatched sink rebuilt, a route whose chunk did not arrive |

### Expectations

* `DEBUG` in `config` gates named channels in debug-npm grammar (`abide:*`, `docs:cards,docs:db`, `*`, `*,-abide:*`). Read from the environment on a server and `localStorage.debug` in a browser.
* A message is one line and one line is one `LogRecord`: the eight fields are the whole shape in every
format, with tabs and newlines escaped. The trace is the operation the line was written in, `null` on
a client and outside a request, and always present.
* `ABIDE_LOG_FORMAT` decides logging format: `tsv` or `json`. Unset, the shape follows the TTY, with `NO_COLOR` forcing
`tsv` and `FORCE_COLOR` forcing the readable form off one.
* THE GATE PRECEDES THE PUBLISH, not just the write. `log.enabled` closed means no record is built and
none is published, so a closed channel costs a call and a boolean rather than a ring push per line —
and the feed carries exactly what `DEBUG` opened. `warning`
and `error` are enabled on every channel, so they publish and they reach stderr.
* The sink is per side and is not the room's business. A published record is also written — stdout or
stderr on a server, the console in a browser — and that write is what `ABIDE_LOG_FORMAT`, `NO_COLOR`
and the TTY decide. The room holds records; the sink renders them.
* The room is built on first publish, as every room is, so `log` WORKS BEFORE CONFIG RESOLVES. A line
written inside `onConfig` or `onStart` is an ordinary publish, and the `<app name>` prefix is applied
by the SINK rather than at publish time — a record carries the channel segment it was written on, so
nothing about a line depends on a document that may still be throwing.
* `GET /__abide/logs` is a `GET` over that channel, not an endpoint of its own — so it is jsonl by
default and sse on `Accept`, carries `vary: accept`, and goes through the app's `middleware` like
every other `/__abide/**` address. `ABIDE_LOGS` decides whether it is declared; closed, the address
is unmounted and answers 404 as any other unmounted method does.
* A dropped feed resumes with no gap and no duplicate. Every
record carries the room's `seq` and the room carries an epoch, so a reconnecting `abide logs` hands
back its last `seq` and takes the tail from there — and a restarted app is a moved epoch, announced
as a reset rather than replayed silently as new lines.
* IN A BROWSER IT IS THE SAME ROOM, the process being the tab. What is absent there is the http read
view and `abide logs`, there being no server to serve them; the console is the sink.

## `csp`

| Name | Type Signature | Description |
| --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | One rung. Sets `content-security-policy` on `text/html` answers only — a policy on a JSON refusal is a header nothing reads. |
| `csp.nonce` | `() => string` | This response's nonce, for an app's own inline `<script>` emitted through `{raw()}`. 16 bytes of `crypto.getRandomValues`, base64url, built on first ask and the same for every later one. A member rather than an ambient because `csp()` is the only thing that mints one and the only thing that names it in a header: as a free `nonce()` it read as available anywhere, and an app that called it without installing the rung stamped a nonce no policy mentioned and shipped a script that ran — until the day the rung was added, when it silently stopped. Here it THROWS where `csp()` is not installed, naming it. Throws in a browser, a nonce being a response's business. abide's own inline output carries BUILD-time hashes instead, so nothing in the head and nothing in a sink consumes this, which is what lets the shell head be cut once at boot. |

### Expectations

* OPT-IN, because every directive can break an app that had a reason abide cannot see.
* abide's own inline output is covered by BUILD-TIME HASHES rather than by a nonce. There are exactly
two executable inline strings — the bootstrap defining the sink filler, and the filler call — and both
are byte-invariant once per-sink data lives in attributes, so `script-src` carries a `'sha256-…'` for
each. The one inline DATA block is the seed manifest — `(method, address, args)` triples, never
response data — and a `<script type="application/json">` never reaches "prepare the script", so
`script-src` does not govern it at all.
* So NOTHING IN THE HEAD CONSUMES A NONCE, which is what lets the shell head stay cut once at boot.
The nonce lives in the header `csp()` builds per response; an app's own inline script stamps it in the
BODY, which renders per request anyway.
* `sources` REPLACES a directive rather than adding to it; an empty array drops it; a name the
baseline lacks is added.
* The baseline: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`,
`font-src 'self'`, `connect-src 'self'`, `style-src-attr 'unsafe-inline'`, `object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
* `script-src 'self'` IS CORRECT BY CONSTRUCTION BECAUSE THE ASSETS ARE UNDER THE MOUNT. `APP_URL`'s
path is the app's base and the built bundle and stylesheets are served under it, so there is no
separate asset origin for the policy to be wrong about. A CDN goes in FRONT of the app as a reverse
proxy rather than beside it as another origin.
* `script-src` carries no `'unsafe-inline'`: a browser honouring a hash or a nonce ignores it anyway,
which is the mechanism that makes an injected `<script>` fail while abide's own runs. `style-src-attr`
is the one weakened line and is weakened deliberately — a `style=` attribute cannot carry a nonce, and
a `style=` is where a value computed at runtime belongs. An app with none passes `'style-src-attr': []`.
* There is no `<style>` in the head at all, nonced or otherwise — a component's styles are a
content-hashed sheet the head links, which `style-src 'self'` covers. See "Script / style blocks".

### Example

```ts
csp()
csp({ 'connect-src': ["'self'", 'https://api.stripe.com'] })  
csp({ 'style-src-attr': [] })
```

## `url`

| Name | Type Signature | Description |
| --- | --- | --- |
| `url` | `<P extends string>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query] : HasSegments<P> extends true ? [params?: ParamsOf<P>, queryParams?: Query] : [queryParams?: Query]) => URL` | Builds a URL. ONE signature: the arity is derived from the literal rather than discriminated at the call, so `ParamsOf<'/admin/[tab]'>` is `{ tab: string \| number }` and a missing `tab` is a compile error. Arity is decided by whether a required segment exists, and each key's own optionality is decided by its kind — a path of only `[[optional]]` and `[...rest]` segments takes the params object optionally rather than forcing an empty one at every call site. A path that is only `string` at compile time degrades to `(url, queryParams?)` and is discriminated at runtime by whether the pattern contains `[`. |
| `HasParams<P>` | `boolean` | Whether the literal `P` carries a required `[segment]`, which is what decides whether the params object is required. |
| `HasSegments<P>` | `boolean` | Whether it carries a segment of ANY kind, which is what decides whether there is a params position at all. |
| `RequiredNames<P>` | `string` | The `[segment]` names. Mapped to a REQUIRED key, a path with one having nowhere to put a missing value. |
| `OptionalNames<P>` | `string` | The `[[optional]]` names. Mapped to an OPTIONAL key, because leaving one out omits its segment rather than emptying it. |
| `RestNames<P>` | `string` | The `[...rest]` names. Mapped to an optional key taking an ARRAY as well as a scalar, a rest segment being the `/`-joined remainder. |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half, always last. |
| `ParamsOf<P>` | `& { [K in RequiredNames<P>]: string \| number } & { [K in OptionalNames<P>]?: string \| number } & { [K in RestNames<P>]?: string \| number \| Array<string \| number> }` | Three segment kinds, three behaviours, which one mapped type over a union of all the names could not express — which is why there is no such union, and why the three name sets are inline here rather than three aliases with one use each: `[[optional]]` Omits its key, so it is optional here; `[...rest]` is the `/`-joined remainder, so it takes an array as well as a scalar and joins it. A segment is stringified, so a param is text or a number — never an object, which would arrive as `[object Object]`. |

### Expectations

* `queryParams` arity arg is omitted if the path doesnt have a param `[tab]` `[[optional]]` or `[...rest]`
* `/users/[id]` root-absolute pattern — the shape an app writes
* `bar`, `./bar`, `../bar` means relative to where the caller IS
* `?tab=x` this page, another query
* `''` where the caller is | `/v2/users/42`
* `https://foo.bar/x` another origin `https://foo.bar/x` **no base**, it is not this app
* `https://this.app/x` this origin
* `//host/x` protocol-relative — an origin, not a doubled slash
* `mailto:…`, `tel:…` opaque unchanged

## `navigate`

| Name | Type Signature | Description |
| --- | --- | --- |
| `navigate` | `(url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }) => Promise<void>` | Navigates to a URL. |

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
const events = memo(() => getDataStatusEvents(dataArgs), { tail: 50 })   // over a `channel` → a Room, so `{events}` is the LATEST
const name = memo(() => data.name)            // member off a `Reactive` reads → TRACKS
const room = memo(() => chat(dataArgs))     // adopts, so the room FOLLOWS `id` — and stays a Room

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
        {#if longData.isError(error, 'DataAccessDenied')}
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
and `foo = bar` where it writes `foo.set(bar)`. The sugar is over the explicit form, never instead of
it — both spellings compile, in every script in the file.

A name denotes two things, and one rule says which. A reactive value is the `Reactive` in two positions — an
identifier binding, and any position whose contextual type is `Reactive<…>` or ABSENT. It is READ
everywhere else: operands, text, attribute values, a component tag's HEAD, destructuring patterns, and
arguments to anything typed as the value. A CALL is outside the sugar and evaluates to whatever it returns, which
is why `memo(() => getData(args))` adopts with nothing added.

It reaches a reactive value behind a namespace the same way, which is what makes the ambient values ordinary:
`route.url`, `route.navigating`, `principal.authenticated` and `online` are reactive values, so
`{route.navigating ? 'Loading…' : ''}` READS in the operand and `memo(() => route.url)` HOLDS in the
return. `route` and `principal` are not reactive values themselves, so `principal.set(…)` is the
namespace's own method and never collides with a member of the value.

The rule is chosen so that hoisting is A NO-OP. `memo(() => route.url)` and `memo(() => { const u =
route.url; return u })` are the same memo, because a binding holds and a return holds; under a rule
where the binding READ, lifting a subexpression into a local would silently turn adoption into
tracking and cost the caller its probe forwarding, with the output still plausible. That failure is
the one the whole design is arranged against, so it decides the rule.

| Form | Means |
| --- | --- |
| `foo` in an operand, text, attribute or value-typed argument | A live reactive READ |
| `const x = foo` / `return foo` / a `Reactive<…>`-typed argument | The `Reactive`. This is what makes adoption free, and it is the whole of how one is handed over — there is no sigil, because these three positions already cover every place one is wanted |
| `foo = bar` where `bar` is a `Reactive` | A compile error naming both repairs: `memo(() => …)` where the name should follow a different `Reactive` over time, `foo = bar()` to copy the value once |
| `foo = bar` | A write. `bar` may be settled or a LOAD — `user = fetchUser()` is the write that makes it loaded, `set` taking `Accepted \| Promise<Accepted>` — so a name is written the same way it is constructed |
| `foo.bar = v` | A write through a path: copy-on-write down the path, then `set`, so the reference moves and readers wake at the default `identity` |
| `foo.push(v)` | The same, where the type resolves the call to a known mutator |
| `foo.bar` | The value's `bar`. Not called, so never the `Reactive` API — `data.error` and `data.success` and `data.status` are the payload's, today and after anything is added |
| `foo.bar(…)` | The `Reactive` API where `bar` is one of its members, otherwise the value's method |
| `foo()` / `foo.set(v)` | The explicit forms, which keep compiling. `foo()` takes NO arguments |

### Expectations

* EVERY `Reactive` Member is callable — `set`, `peek`, `tail`, the probes, `invalidate`, `refresh`,
`watch`. That invariant is what keeps bare `foo.bar` unconditionally the
value, so adding a member later cannot silently reinterpret an app's payload field. A member that
would have to be read as a property does not get added; it becomes a call.
* A colliding payload is refused where it is constructed, not escaped where it is read. A `Stored`
whose keys meet the member names is a compile error at `state` / `memo` / `channel`, naming the key
and the two repairs — rename it, or nest it as `state<{ result: … }>`. That is where `Stored` is known
and where the fix is one rename, and it is why there is no sigil: a reserved name would make the
ambiguity sayable, so it would live in the codebase forever and every reader downstream would have to
know which spelling meant which. Refusing it means the ambiguity never exists to read, and it reserves
nothing — a payload may carry any field it likes, including `$`.
* `state.share` HANDS BACK THE ONE THAT WON, which may not be the one your `create` made, so the return value is the only name to use: `const message = state.share('chat', () => state(''))`. Building the `Reactive` outside the call and passing it in is what makes that go wrong silently — the local name goes on being read by the module that made it while every other module reads the shared one — and the thunk is what keeps the loser's `Reactive` from being built at all.
* A template-local binding shadows a reactive value of the same name for the body it is bound in —
`{#for await { message } of room.tail(100)}` inside a file that also has a `message` state.
* MEMBER ACCESS ON A `Reactive` SHORT-CIRCUITS. Where the compiler knows the receiver is one, `foo.bar` lowers to `foo()?.bar` — so an in-flight read is `undefined` rather than a TypeError, and the whole chain after it short-circuits with it, `foo.items.map(f)` included. That is what makes the `??` forms read the same everywhere: `{data.name ?? 'Loading'}` in a slot, `{#for stat of data.stats ?? []}` over a block. An `{#for}` over `undefined` iterates zero times rather than throwing. `pending()` is still what separates in-flight from a value that RESOLVED to `undefined`.
* Await over an expression is that same lowering with one term replaced: inside an `await` operand a read emits `(await foo.settled())` where it would otherwise emit `foo()`, so `{await invoice.total}` is `(await invoice.settled())?.total` and `{await invoice}` is `await invoice.settled()`. Without it the operand lowers to `await (invoice()?.total)` — `await undefined` while the value is in flight, which renders an empty hole, blocks nothing, and typechecks, `await` over a non-thenable being legal. That is the failure with nothing to catch it, and it is what decides the rule.
* THE READS ARE STARTED BEFORE THEY ARE AWAITED. `(await a)?.x + (await b)?.y` never touches `b` until `a` settles, so a second load does not begin until the first one ends and two independent loads serialize behind one hole. The read set is syntactic, so the lowering emits it as one `Promise.all` — which is the same "start all asynchronous work up front" the render already owes.
* ONLY A DEFINITELY-evaluated read is hoisted into that set — not one under `?:`, not the right operand of `&&` / `||` / `??`, not one inside a nested function. `{await (flag ? a.x : b.y)}` hoisted whole would START and block on a load the expression would never have performed. Those lower in place and serialize, which is the correct trade: a read that might not happen must not be started.
* A write through a member path — `foo.bar[k] = v` — compiles to a copy down that path plus a `set`,
so the reference moves and readers wake at the default `identity`. A state that declared one still
decides for itself, a path write being a write like any other: setting a field to the value it already
held is where a `canonical` identity earns its cost, the copy alone having woken everyone.
THE COPY IS THE POINT, not an implementation detail to optimise away: a `tail` past the default is for
REPLAYING past values — an undo stack is the shape — and replaying a value that was mutated underneath
you replays nothing. Mutating in place and bumping a version would be O(1) per write and would leave
`tail` holding N references to one object. WHAT IT COSTS is a copy per write, so
`for (const row of stream) rows.push(row)` is O(n²) and is the wrong shape for a stream: `foo().push(v)`
is the unlifted O(1) escape, and a stream of items wants a `Reactive` whose VALUE is the item. So does
an in-place mutator the type resolves: `push`, `splice`, `sort`, `reverse` on an array, `set` /
`delete` / `clear` / `add` on a Map or Set. THE LIFT IS TYPE-DIRECTED, NEVER NAME-DIRECTED — a payload
carrying its own `push` would otherwise be silently copied — so where the type does not resolve the
call it is refused rather than guessed. This is the machinery `bind:` already needs, member paths being
lvalues there. It reaches an ALIAS, since an identifier binding holds the `Reactive`: `const a = foo`
then `a.push(v)` is the same lift `foo.push(v)` is.
* `foo(...)` is always the READ and takes zero arguments; any argument is a compile error. A reactive value
whose value is a function is `foo()(x)` — the read, then the call — or `foo.peek()(x)` where the
caller does not want to join the flow. A reactive component never meets this, `<C/>` being a tag
rather than a call.
* THREE DIAGNOSTICS, and each guards a failure that leaves the output looking right. Destructuring a
`Reactive` reads it, so `const { name } = data` is a dead snapshot sitting beside a live `data.name` —
detectable in syntax, so it warns. A `Reactive` reaching a wire or `JSON.stringify` out of an
unannotated literal — `const args = { id, user }` holds `user`, where an `Args`-typed property would
have read it — warns at the crossing rather than at the literal, that being where it is wrong. And
where inference fails the compiler READS: valid TypeScript or JavaScript has to compile, so a lost
adoption is the accepted cost and refusing the file is not.

## Templating

### Expressions

| Form | Meaning |
| --- | --- |
| `{expr}` | Reactive text (escaped) |
| `{await expr}` | await in an expression means block rendering until resolved, and it governs the whole expression rather than a name — every reactive read inside it blocks, so `{await invoice}`, `{await invoice.total}` and `{await a.x + b.y}` are one rule and the bare name is its degenerate case. A read under it lowers to `await x.settled()`, a `Reactive` not being thenable, so this block is the only place the word `await` reaches one. See "await over an expression" under "Reading and writing by name". Over a STREAM that means until the stream closes, the same way it means until a value settles — one rule, and a source that never closes holds forever, which is the author's to resolve rather than abide's to special-case. |
| `{raw(...)}` | Raw HTML |
| `name={expr}` | Reactive attribute or property (whole-value expression) |
| `on<event>={fn}` | Native listener on an element. On a **component** the same syntax is an ordinary prop named `onclick` |
| `name="…{expr}…"` | Quoted values interpolate too, also on component props; a literal brace can appear in a string. |
| `bind:value` | Two-way bind — read the property, write back on input/change. |
| `bind:prop={state}` | On a COMPONENT, adds the write path to a prop. `count={total}` already reads live; `bind:count={total}` also writes back. It needs an lvalue — a state name, a member path, or the `{get, set}` pair — since `bind:count={total * 2}` has nothing to write to |
| `bind:checked` | Boolean bind on an `<input>` — a boolean DOM property mirrored as a boolean attribute, never stringified. Writes back on `change` |
| `bind:open` | The same, on a `<details>`, written back from `toggle`. |
| `bind:group` | Radio/checkbox membership, compared against the input's own `value`; never emitted as a `group` attribute |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer)}` | Node ref (state) or per-instance handler with the node as argument, which may RETURN a disposer run when the node goes. There is no node until there is a document, so it fills at HYDRATION rather than being switched off on a server. |
| `class:name={cond}` | Toggle a class on an element. |
| `style:prop={value}` | Set one style property on an element. |
| `{...expr}` | Spread props (component) / attributes (element) |

#### Expectations

* ESCAPING IS BY CONTEXT, and the context is syntax, so the compiler picks it rather than the value's
shape. In TEXT an expression is HTML-escaped. In an attribute value it is attribute-escaped.
* IN A URL-typed attribute — `href`, `src`, `action`, `formaction`, `poster`, `data`, `xlink:href` — it is
additionally SCHEME-checked: anything but `http:`, `https:`, `mailto:`, `tel:` or a relative reference
is dropped and warned on `abide:render`. Dropped rather than thrown, since a bad href is not a reason
to take the page down, and warned rather than silent, since it is a refusal. `javascript:` in an
`href` is the injection this exists for, and `csp()` is not the backstop for it — `csp()` is opt-in and
its `script-src` does not govern a URL scheme.
* `srcdoc` and a whole-attribute `style=` take no interpolated string; a computed style is
`style:prop={value}`, which is one property and one value. `on<event>` on an element takes a function,
never a string, so there is no attribute-as-code position to escape into.
* `{raw(...)}` is the ONE escape and is the only place any of this is skipped. It is the app saying so.

### Control flow

| Block | Branches | Notes |
| --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | - |
| `{#await promise}` | `{:then}`, `{:catch e}`, `{:finally}` | rendering the body while pending. `value` is a LIVE binding, which is what lets the `{:then}` body be updated rather than rebuilt. Every branch is bound to A PROBE, none to settledness — the pending body to `pending()`, `{:then}` to `success()`, `{:catch}` to a failure with nothing to serve (`error()` where `success()` is false), `{:finally}` to `done()`. `{:catch}` is bound to that pair rather than to `error()` alone because a rejected write and a failed revalidation fill `error()` over a value that is still being served, and unmounting `{:then}` for one of those is what would throw away the value the reader is looking at. `success()` stays true through a `refresh()`, which is what keeps `{:then}` mounted, and a STREAM is `pending()` until it closes — so there is no state in which none of the branches is mounted, and no fifth probe is owed. `{:finally}` therefore renders alongside whichever of the other two is mounted rather than replacing it, the way a `finally` runs after both, and a `refresh()` leaves it mounted for the same reason it leaves `{:then}` mounted: the load that finished still finished. Concretely on a `Reactive`: a first load with nothing to show mounts it, a value already in hand never mounts it (not even for a microtask), and a `refresh()` leaves `{:then}` mounted with the old value — `refreshing()` is what a spinner reads, and the `{:then}` body is updated when the new value lands rather than rebuilt. A bare promise has no probe to ask, so it is driven by settlement and is always pending on its first render |
| `{#await promise then value}` | `{:catch e}`, `{:finally}` | await a promise until resolved; over a stream, until it closes, as `{await expr}` does. `value` is a NAME or a destructuring pattern — `then { total }` — and live either way. |
| `{#for item, index of list by key}` | - | Keyless → positional (dev-warns if the body is stateful). `index` is live where the body reads it and does not exist where it does not — the compiler can see which, `index` being syntax. Both halves are load-bearing. Live, because a keyed reorder moves a row without changing it, so a snapshot leaves `{index + 1}` reading `1.` at the bottom of a reversed list. Absent, because reading it is not free: reversing 500 rows changes 500 indexes, so a body that prints one pays 500 text writes against a reconcile that moved far fewer nodes. That makes the two bodies different cases rather than one case measured twice — a reverse with `{index}` in it is being asked to do more work than a reverse without, and a benchmark that mixes them is comparing the ask, not the implementation. |
| `{#for await item of source}` | `{:catch}` | `source` may NAME its replay depth — `s.tail(n)`, or `s.tail(0)` for live-only — and a bare `{#for await x of s}` is `s.tail()`, which replays what the `Reactive` retained. There is no cap on what the block then accumulates: a stream painting a hundred thousand rows is the app's to bound, exactly as a `{#for}` over a hundred thousand items is, and conflating the two into one number made a chat room's default retention of 1 render one message. It takes `by` exactly as `{#for}` does — `{#for await event of events.tail(50) by event.id}` — and where the source is a ROOM the default key is the message's own `seq`. Any other stream is positional unless `by` names a key. A `refresh()` or a changed value identity re-streams it from a new cursor, which is where `tail` decides what comes back. `{:catch}` appends after the rows already painted: this block accumulated, where a `{#try}` body rendered as a unit. |
| `{#switch expr}` | `{:case v}` `{:default}` | - |
| `{#try}` | `{:catch e}`, `{:finally}` | Render time boundary, and a region — a failure replaces the whole body, that being the unit it rendered as. `error.abide` is the same mechanism at page granularity. See "Sinks". |

#### Expectations

* Control blocks narrow types, and what makes that true of a read by name is that a block binds each reactive read and probe call in its subject once for the body: `{#if invoice}` lowers to `const _invoice = invoice()`, and every `invoice.total` under it resolves to `_invoice.total` rather than to a second `invoice()?.total`. TypeScript narrows references, never calls, so without that binding `{#if isFruit(apple)}` is `isFruit(apple())` and narrows nothing, and `{#if invoice}` leaves `invoice.total` optional because the short-circuit is still in the lowering — the block would READ as narrowing while narrowing nothing. With it, a user-defined predicate narrows, `Stored | undefined` narrows to `Stored` with the `?.` correctly gone inside the block, and `{#switch invoice.kind}` narrows a discriminated union by the same mechanism. THE PROBE IS IN THE SET FOR THE SAME REASON THE READ IS: `{#if email.isError(email.error(), 'NotAnEmail')}` binds `const _failure = email.error()`, so the predicate narrows a reference and `email.error().data.value` in the body resolves to `_failure.data.value` with `.data` typed to what that failure declared. Leave probes out and the pattern cannot typecheck at all — `error()` is `unknown` and the body's call is a second expression — and it is the only spelling a refused write has, a refusing `transform` filling `error()` rather than throwing to a `{:catch}` that would have bound it.
* A template-local binding needs none of that, being an ordinary local: `{:catch e}`, `{:then v}` and `{#for item}` narrow the way any TypeScript binding does, which is why `longData.isError(error, 'DataAccessDenied')` already narrows `error.data` in the example above. It is that `Reactive`'S own `isError`, narrowed by what THAT producer declared — reaching for a sibling's is a compile error where the unions differ, and matches nothing where two producers happen to declare one name.
* The binding is per block evaluation, so the body reads ONE consistent snapshot rather than two reads a value could move between, and the block still re-runs when what it read changes. Three things do not narrow, and each is right: narrowing dies across a nested function in the body, which is TypeScript's own rule; an explicit re-read — `invoice()` — opts out of the binding and so out of the narrowing; and a probe's boolean says nothing about the value's type, so `{#if invoice.pending()}` narrows the value nothing — what binding a probe buys is that `isError` can narrow the result of `error()`, which is the other question.
* A binding takes a pattern, not only a name — `{#await invoice then { total }}`, `{:then { total }}`, `{#for await { message } of room.tail(100)}` — and THE DESTRUCTURED NAMES STAY LIVE: they lower to path reads off the block's value, never to a `const` snapshot taken when the branch mounted. That is what keeps "the `{:then}` body is updated rather than rebuilt" true for the destructured spelling, which is the one an author reaches for. A snapshot leaves the right value in the `Reactive` and stale text on screen after a `refresh()`, with nothing thrown and nothing wrong in the markup — so it is asserted by re-reading the body after a refresh, not by rendering it once. This is the `props()` exemption seen from the template side: a binding position the compiler lowers stays live, and `const { total } = invoice` written in a script is the dead snapshot that warns.

### Components

| Feature | Notes |
| --- | --- |
| `{#component Name(pattern)}` | **Inline component** — a reusable builder. TitleCase required. Nested inside `<Foo>…</Foo>` it becomes Foo's `X` prop, and THAT is the named-slot mechanism — there is no `<slot name>` |
| `<Name/>` | Capitalised tag = component invocation, and the same call `render` takes — see `Component` under "render": `<Name a={x}/>` is `Name({ a: x })`, so a page mounted in a template and one handed to `render` go through one mechanism rather than two |
| `<slot/>` | Renders children |
| `<slot>fallback</slot>` | Renders children, or the fallback where none were passed. Whitespace-only is none, since a pure-newline run is already dropped |
| `<Tag>…</Tag>` | Children passed to the component's `<slot/>` |

#### Expectations

* nested `{#component X()}` inside `<Foo>…</Foo>` becomes a named component prop as `X` — a builder, `(props) => Component`, which is what the parent calls where it places the slot
* components can be passed as values
* `const C = memo(…)` or `let C = state(…)` → `<C/>` | A state- or memo-named tag is a **reactive** component (re-mounts on change). A tag reads its HEAD and then calls it: `<C a={x}/>` reads `C` where the head is a `Reactive`, and calls the factory it got with `{ a: x }`. Two steps, which is why the zero-argument rule never reaches a tag — the call belongs to the factory, not to the read. It is also where `identity` earns its keep: a memo rebuilding its component value every recompute re-mounts the subtree every time, which is the freshly-built-wrapper failure wearing a costume — the output is right and the DOM is thrown away
* A COMPONENT IS KEYED BY POSITION; A memo is keyed by value. That is why props are reactive and do
not reinstantiate the component when they change — an instance keeps its identity and its props update
underneath, where a memo re-keys and lands on a different entry. Two `<Card user={a}/>` at two places
in the tree are two instances with identical props; two `getUser({ id })` calls in one scope are one
entry. The rest follows: props hold functions, reactive values and children, none of which is keyable,
where `Args` is `JsonValue` because the key is the wire form; and dropping a memo entry is a cache
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
* A prop is not A `Reactive`. Declared as a plain `T` it is a live read of the caller's expression, not a snapshot — `count={total}` tracks `total`, `count={total * 2}` tracks it as a derived read, and neither reinstantiates the component — and there is nothing behind it to write to, which is already why `bind:count={total * 2}` has nothing to bind. So a prop declared as a plain `T` has no `Reactive` face at all, rather than a `Reactive` minus `set`. That is what leaves `Reactive<T>` as the only other face: a child declaring it makes `bind:` at the call site a compile requirement, so every call site is forced to comply and there is no runtime warning to issue. The marker still sits at the call site — on the side giving write access up, where a reader sees it without opening the child — and the child declaring is what lets the compiler check it, which a child inspecting its own call sites could not do
* `props()` hands back one accessor per key, and the accessor is what the key's type declares. A plain `T` is a read-only accessor over the caller's expression — live, no members, and nothing to write to. A `Reactive<T>` is the caller's own `Reactive`, passed through unchanged, which is what `bind:` writes through and why a child declaring one makes `bind:` a compile requirement at every call site. One lowering, two accessor shapes, decided by the declared type — the same type-direction the lifted mutators and the dynamic-spread form already use.
* Destructuring `props()` is not destructuring A `Reactive`, so the warning that one is a dead snapshot does not reach it: an accessor is what keeps each binding live. `const { name } = data` on a `Reactive` is the dead one.
* The lowering is type-directed, as the lifted mutators are. A declared `Props` with no index
signature has a known key set, so every prop is one accessor and the shape is fixed whatever the call
site spelled. A `Props` carrying `Record<string, unknown>` is the component asking for the dynamic
form, and there an opaque `{...expr}` is one live read with its keys enumerated per read — which is
what makes proxying a prop set downward, or spreading it onto an element, sayable at all.
* AN EXPLICIT PROP BEATS A SPREAD, whatever the order. `<Event {...event} onclick={handle}/>` and
`<Event onclick={handle} {...event}/>` both bind `onclick` to `handle`: a named prop is the author
saying which one they mean, and source order would make that depend on where they happened to write
it. Two spreads against each other are still source order, there being nothing else to go on.
* The pattern is flat — renames and defaults, plus a rest element. No nested patterns. The rest element is LIVE like every other prop: the caller's prop set is known at the call site, so it is one accessor per key passed — a fixed shape, no proxy, no snapshot. What makes it the opt-out is the missing type, not a missing subscription, and because the call sites are typed even an undeclared prop usually resolves well enough to lift a write on
* `children` | Always accepted, never a name: `<slot/>` renders what is between the tags, and nothing has to declare it
* formatting whitespace: Two rules, and neither keeps a text node that renders nothing. A run of pure newlines — no space and no tab in it — is dropped wherever it stands, so `<b>a</b>` and `<b>b</b>` on their own lines at column 0 render `ab`. A run that renders nothing but carries a newline AND indentation is dropped at the two ends of every block body and of the file's own top-level template, since it would otherwise be a permanent member of the instance's movable range. An indented run in the middle of a body survives, which is what keeps the ordinary shape spaced. The case this changes: two blocks back to back with no whitespace between them — `{/if}{#if b}` — whose bodies each held an inline node, where `x y` now renders `xy` |

## Script / style blocks

| Block | Scope |
| --- | --- |
| `<script>` | Per-instance (component setup). |
| `<script module>` | Module scope — Request-local on a server, process-wide in a browser. The module BODY still runs once per process; what is scope-keyed is the reactive values it builds, exactly as `state.share` is, so imports are not re-run per request and one request's module state is never served to another. In a browser there is one scope, so a `<script module>` state is built on first import and lives as long as the tab. |
| nested `<script>` | Branch-local (per-item in a `{#for}`). Must be the first node of a block body, carries no `import`, and resolves off the level's scope. Setup, so it runs ONCE per item and does not track — what makes `memo(() => f(result))` in one re-run is the memo tracking `result`, which is a live binding rather than a snapshot. |
| `<style>` | Component-scoped: every root element carries a scope token and every selector requires it on its rightmost compound. Registered once at module scope |
| nested `<style>` | Subtree-scoped — an element carries every scope in force, so an outer rule reaches in and an inner one cannot reach out |
| `import './app.css'` | A stylesheet the component depends on, from any `<script>` in the file or any `.ts` it reaches. Global, not scoped — and the asymmetry with `<style>` is the point: a `<style>` block is written inside the component, so scoping it is what the author meant, while an imported file is authored elsewhere to be shared, and scoping it would defeat the one thing it is for. A side-effect import with NO binding; `import styles from './app.css'` is a compile error naming the bare form, because a second mechanism for the same file is what CSS modules are and one is enough. |
| `:global(…)` | The escape, per selector: the compound inside it is not required to carry the scope, so `.card :global(.child-thing)` stays scoped on the left and reaches a child component on the right. Without it a scope can never style anything it did not render |

### Expectations

* An `<!-- html comment -->` in the markup is for whoever opens the file and is not emitted: a
component ships one copy of its own commentary per instance, and a file's header comment is the
biggest one it has. Whitespace around a dropped comment is left alone, so nothing that was inline
stops being inline — except at a block body's two ends, where the comment and the indentation
holding it go together (see the formatting-whitespace row under Control flow). A comment that has to
reach the browser is `{raw('<!-- … -->')}`.
* the sugar reaches every script in the file, `<script module>` included — see "Reading and writing by name".
* A `<script module>` State is not a place to accumulate across callers on a server. It is scoped to the
request that read it and dropped with it, which is what stops the shape that reads as a cache and is a
cross-request leak. Something genuinely process-wide on a server is a `global` memo, where the scope is
spelled out loud and `Args` is where anything caller-specific goes.
* A scope token is ONE attribute holding a space-separated list — `data-abide="a1f3 b207"`, matched `[data-abide~="a1f3"]` — not one attribute per scope, so nesting depth costs no extra DOM writes per node.
* A `<style>` Block is a build artifact, not inline output. Every scope a route can reach is known at compile time, so the compiler writes them into a content-hashed stylesheet and the head carries a `<link rel="stylesheet">` to it. That is what a crawler, a view-source, a scriptless client and an email get, with no adoption anywhere and nothing to feature-detect — and it is why `style-src 'self'` needs neither a nonce nor a hash list: a linked sheet is not inline output at all. It also keeps the sheet's own line invariant, since a hash is chosen at build rather than per response, and gets it `immutable` for free off the same rule the bundle is served under. The HEAD as a whole is not byte-invariant and reading it that way is what leaves the seed manifest discovered late: the manifest and the trace id in it are per response, so the shell is two static buffers with one dynamic block between them — two writes and one serialization rather than one copy. What is byte-invariant is the two inline scripts, which is all the hash argument needs.
* The client reaches for `document.adoptedStyleSheets` only for a scope the document never linked: a lazily navigated route's component. A constructed sheet is not a `<style>` element either, so `style-src` does not reach it. There is NO fallback: `adoptedStyleSheets` in its mutable-array form is Chrome 99, Firefox 101 and Safari 16.4, so the newest engine without it predates anything abide targets. A branch that mounts later on a route already linked needs nothing — its scope was in the sheet before the branch existed, a scope token costing nothing on an element that never renders.
* An imported stylesheet is the same build artifact A `<style>` Block is, not a second path: the
compiler collects the `.css` imports out of a route's module graph and folds them into that route's
content-hashed sheet, ahead of the scoped blocks so a component rule can override an app-wide one
without `!important`. Deduped by resolved specifier, so a file ten components import is emitted once,
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
| `src/ui/pages/**/error.abide` | The page a refusal renders in, resolved nearest-ancestor like a layout. It takes the failure as a prop, renders inside the layouts above it so the chrome survives, and answers with the failure's own status. 404 is this file holding the `notFound` refusal abide declares — see "Refusals" — returned where no route matched, so it is a named failure a page can narrow with `notFound.is(failure)` and read a path off, rather than a second convention or a bare status. Where the thing that failed is one of those layouts, the boundary is the nearest `error.abide` strictly above it — rendering inside the layout that threw would re-run the throw — and because the chain is static the escalation is a compile-time list rather than a walk that could regress. The last entry on that list is abide's own minimal document — a status line and the failure's message, no layout and no app code — because app code is what is failing, and a fallback cannot be the thing that broke. Reaching it means an error page itself failed, so it warns on `abide:render`. `{#try}` is the same boundary at template granularity |
| `[name]` | Required dynamic segment → `route.params.name` |
| `[[name]]` | Optional segment (absent → param omitted) |
| `[...name]` | Rest / catch-all (terminal) → the `/`-joined remaining segments |
| precedence | literal > required > optional > rest. Sorted once, at install, so a match stops at the first hit |
| `/__abide/**` | Every endpoint abide controls |

## Expectations

* `APP_URL`'s path is the app's mount base: `APP_URL=https://abide.com/v2` serves the whole app under
`/v2`. Everything moves together: the pages, `/__abide/**`, and the client bundle. Nothing is left
answering at the origin root, so an app behind a proxy does not go on exposing its schema and log feed
beside its mounted copy. `route()` and `url` and `navigate` handle the mount root transparently.
* A hand-written `href="/users/42"` in a template does not move — it is a literal, not a call, and abide does not rewrite one.
* The template resolves names in the component's own script scope, and abide's helpers are ordinary imports with no privilege. Shadowing `url` with a local binding shadows it in the markup too.
* The CLIENT is told the base by the document, in a `<meta name="abide-mount">` the shell writes. It
cannot be in the bundle — a mount is chosen after the build — and it is not derived from where the
bundle was fetched from, which would name the CDN when there is one.
* All requests including routes go through the app's `middleware` even when rendering is handled by the client. `/__abide/**` is no exception, `GET /__abide/logs` included — which is what an app's auth rung gates it with. Three things sit outside the onion and each says why: the built assets, served in front of the pipeline; `/__abide/health`, because a load balancer presents no credentials; and `/__abide/principal`, because its answer is composed from the caller's own cookie.
* Two routes under one layout are two pages with the same chrome.

## `<head>`

* A `<head>` element in a `.abide` file contributes its children to the document head. Top level only — never inside a control block — the same restriction `<script module>` carries, and what makes the next line possible.
* Hoisted at compile time. The positions are static, so the shell knows the whole set before it flushes; only interpolated values are dynamic, which is what keeps "flush the head asap" true for a page three layouts deep.
* Merged by key, deepest contributor wins: `title`, `meta[name]`, `meta[property]`, `link[rel][href]`, `html[lang]`. Everything else appends in tree order, so a page's `<title>` replaces its layout's while two `<link rel=preload>` for different hrefs both survive.
* NOTHING HOLDS THE FLUSH BY DEFAULT, the head included. `<title>{name}</title>` is an ordinary read: unsettled, it renders what it has and is corrected when the value lands, through the property sink the element carries — see "Sinks", which is where the RCDATA positions get a shape that is not a `<template>`. Holding is OPT-IN and spelled the same way it is spelled anywhere else — `<title>{await name}</title>` — so the author decides whether a correct title is worth the delay to first byte, rather than the position deciding for them. The cost of not opting in is a visible flash in the tab, and a scriptless client keeps the uncorrected title, since there is no script to run the fill.
* On a client navigation the incoming page's keyed contributions replace the outgoing page's by key. A layout's do not move, matching layouts never being rebuilt.

## View transitions

* Whether any rule names `::view-transition*` or sets `view-transition-name` is what turns them on. That is the app saying it — the standard puts the entire control surface in CSS, so a boolean elsewhere would be the same intent spelled twice.
* It is a build fact, not a runtime walk: abide compiles every `<style>` block, so the answer is a manifest boolean and there is no cache to invalidate. A runtime walk could not see it anyway — a lazily navigated scope arrives through `document.adoptedStyleSheets`, and a constructed sheet is not in `document.styleSheets`, so the check would have been blind to exactly the scopes a walk was needed for.
* `updateCallbackDone`, not `finished`. The page is on screen when the DOM is written; waiting for the animation to END would hold the address bar and the commit behind it
* a browser without it Navigates exactly as it does now, so an app feature-detects nothing

## `render`

| Name | Type Signature | Description |
| --- | --- | --- |
| `Component` | `Component` | A component bound to its props — what `Page({ id })` hands back, what `<Page id={x}/>` is, and what a `<slot/>` renders. A `.abide` file default-exports the factory, `(props: P) => Component`, so supplying props is calling it and `render` needs neither a props parameter nor a generic. Binding is inert: the call fixes the props and runs no setup, which is what keeps `render` the only thing that touches the ambient request scope. |
| `render` | `(component: Component, shell?: Shell) => AsyncGenerator<Uint8Array>` | What produces a document, and what `page()` takes. Yields bytes rather than strings: the body is bytes either way, and encoding at the source keeps a `TextEncoder` out of the funnel per chunk. |
| `Shell` | `string \| URL \| undefined` | The document it renders into. `src/ui/app.html` is the default; naming another is what makes an email body or an embed possible. |

### Expectations

* Reads the ambient request scope — `request()`, `principal`, `cookies()`, `csp.nonce()` — so those are not parameters. `render` Itself works without one, which is what static generation needs; the accessors still throw, so a component reading one is simply not statically renderable. The list comes from running the render with no scope and collecting what threw, naming the component and the accessor — not from reading the module graph, which would be an interprocedural analysis nothing else in the build does.
* One generator serves every producer of a document: an app's own route, the page pipeline, static generation and the harness. Nothing is shaped for the handler case alone.
* A refusal thrown BEFORE the first flush answers with `error.abide` and the failure's status. After the first flush the status line is already out, so the stream errors and the client swaps `error.abide` in place — which is the one thing a rendered-to-string consumer, an email, cannot do.

## Sinks

A SINK is an addressable hole in the output stream that a value still in flight fills later. It is
about markup — a read that had nothing yet, a stream's rows, a boundary that has to be swapped — and
it is not how data reaches the client. That is the seed buffer answering the client's own request
(see "rpc"), and the two are separate mechanisms with separate lifetimes: a document carries no copy
of any answer. A value landing before the document closes fills its sink in place; one that does not
leaves the sink empty, and the client renders that part when its own request answers.

* A read of a `pending()` `Reactive` opens a sink, and renders what it has — `''` where nothing landed, and a derived memo's placeholder where it holds one (see "Propagation"). `{expr ?? 'Loading'}` works because
the value is genuinely `undefined`; `pending()` is what separates that from a value that resolved to
`undefined`.
* Boundaries are static, so a sink knows its enclosing `{#try}` / `error.abide` chain at compile time
and unwinds nothing at fill time.
* A fill has two modes. Fill writes the value into the sink. REPLACE swaps the enclosing boundary's
region, which is what a failure needs: a `{#try}` body cannot be repaired by filling one sink inside
it, the markup around that sink having already flushed. `error.abide` is the outermost boundary and
its region is the page body inside the layouts — the same swap `render` describes after a first
flush, rather than a second convention.
* `{#for await}`'s own `{:catch}` appends instead, that block having accumulated rather than rendered
as a unit. The discriminator is the BLOCK, never the retention: `tail` is replay depth on subscribe
and says nothing about what is on screen, so a `tail(0)` cursor with 500 rows painted keeps all 500.
* Replacement content is emitted at fill time, at the sink's position, and moved — never pre-rendered
into an inert `<template>` beside every boundary. A boundary that does not fail costs nothing.
* THE BATCHING UNIT IS THE FLUSH, never the production, and it is stated because the obvious
implementation is the expensive one. A `{#for await}` whose rows arrive after the stream has moved past
its list cannot write into that list again, so every row needs a fill — and one pair per row is two
elements parsed and one script run per row, five hundred rows costing a thousand elements and five
hundred executions of the same byte-identical script to deliver five hundred `<li>`. Productions that
arrive between two flushes therefore coalesce into ONE pair, so a fast stream costs two elements per
flush whatever the row count and a slow one degrades to per-production on its own. Nothing about the two
sink shapes changes; this says only WHEN the pair is emitted. Assert it as a count — fill pairs emitted
against rows delivered — the per-row arm being the one that still renders correctly.
* What the boundary does cost is retention: a `{#try}` body cannot be released while a sink inside it
is still open.
* A scriptless client cannot be repaired after the first flush. That is inherent to streaming, and it
is why `{await expr}` — which blocks — is what a page that must work without script uses.
* TWO SINK SHAPES, not three, and which one a position takes is syntax. A region sink is a `<template>`
carrying id, mode and target in attributes, followed by a byte-identical `<script>` that reads the
template beside it — flow content, a `{#try}` region, a `{#for await}`'s rows. A property sink carries
its id as an attribute on the owning element and the filler writes one property, which is what covers
every position an element cannot go in:

| Position | Owner carries | Filler writes |
| --- | --- | --- |
| `href={await x}`, any attribute | the element | the attribute or property |
| `class:`, `style:`, `bind:` | the element | the class, the style property, the bound property |
| `<title>{name}</title>` | `<title data-abide-sink="…">` | `.textContent` |
| `<textarea>{v}</textarea>` | the `<textarea>` | `.defaultValue` |

  RCDATA is why the second shape has to exist rather than being a tidier spelling of the first: the parser
creates no elements inside `<title>` or `<textarea>`, so a `<template>` there is text. The fill pair is
still emitted at fill time wherever the stream has reached and finds its target by id, so it never has to
sit in a position it would be illegal in. Identical bytes are what let one build-time hash cover every
filler in every document, which is what keeps a nonce out of the head, and it is one hash for both shapes.

## Rendering

* Goal is to get fastest time to first byte and have total time be max(asyncronous work wall time), and stream as much as possible during that time.
* User perception of speed is of the most highest importance. Flush the head asap.
* The rendering logic should share as much between client and server as possible.
* Start all asyncronous work up front, including rpcs, in parallel.
* RPCs streams are split to feed document generation as well as buffered until it can be picked up by a request made in the client. If a stream has not finished when the document is done with every blocking sink, the document is not held for it: what it produced is already inline, and the client's own request picks the rest up from the seed buffer.
* Render is an async generator
* If a structure is waiting on asyncronous completion it creates a sink and continues to generate past that until the document is done. If any of those sinks block render (or ssr) based on template signals (`{await foo}` or `{#await foo then bar}`) then flush waits until those sinks are done but never block document generation.
* Data is seeded to client via the adopted RPC responses in the client.
* Sockets follow the same adoption logic as RPCs. The seed buffer answers how the client joins; `seq` answers what happens when the buffer is not there — a socket that dropped and reopened, a tab too slow to adopt, a room the server restarted. Between them nothing is dropped and nothing is delivered twice within one incarnation, and the buffer can be released on a timer rather than held in hope. Across incarnations — a restart, or a reconnect landing on another instance — the epoch moves and the reset is announced rather than papered over.
* HYDRATION RE-EXECUTES SETUP. The client runs every `<script>`, every `state(…)` and every `memo` body
again rather than adopting a serialized setup result — one runtime and one code path on both sides, and
nothing to keep in step. It is affordable for exactly one reason: The seed buffer answers the calls the
RE-run makes. Setup issues the same rpcs off the same args and they are answered from what the render
buffered — for a handler over a MEMO, which is one call on both sides.
What is saved is the handler's work, not the round trip, and saying otherwise hides where this is
exposed. The bootstrap issues real fetches: the database hit, the inference, the warehouse scan are
what the buffer answers instead of, while the request itself is still made. It is free only while the
bundle load covers it — the calls go out of the head, ahead of the bundle, so a cold visit pays
nothing for them. A warm one is the case that stops holding: the bundle is `immutable` and already
cached, so it arrives in no time and the fetches are fully exposed, N of them at whatever the round
trip is. That is what makes the browser cache load-bearing rather than a bonus — a handler answering
`public, max-age` is served from the cache on that second visit and costs nothing again — and it is
why the buffer answers the client's own request rather than embedding data in the document, a choice
that has to be paid for out loud rather than assumed away. What is paid
twice is a memo body that is expensive and is not a load, there being nothing to seed; that is the cost
of the decision and the reason a heavy pure computation belongs behind an rpc.
* A `{#for await}` the server already painted is reconciled, never appended to. The document is not held
for an unfinished stream, so the server paints n rows inline and the client's own request is answered
from the buffer with the transcript from the start — the rows the server already painted, then the rest.
Hydration binds those n nodes to the block the way it binds every other marker, and the replayed
productions reconcile against them by the block's key — `seq` where the source is a room, positional
otherwise — so the first n produce no DOM write and row n+1 is the first append. Nothing here is the
socket's `seq` guarantee, which is about a dropped connection; this is the ordinary keyed reconcile
seen at the one moment the same rows arrive twice, and it is asserted by counting nodes moved across
hydration rather than by reading the list.
* SSR EMITS MARKERS, NOT A tree to diff. Sink and block boundaries are static, so the client walks the
marker list the document carried rather than the DOM, binds listeners and subscribes readers against
nodes it never rebuilds, and a mismatch rebuilds the enclosing block rather than the page — which is
what `abide:hydrate`'s "a mismatched sink rebuilt" is reporting.
* After first hydration the client does all rendering after the document request's middleware returns ok. Do what rendering can be done while waiting for document request onion. If there is no middleware, document request does not need to run.
* As little as possible of the page should be rebuilt between navigations. Shared layouts are never rebuilt.
* DOM operations are very expensive so DOM changes must be minimized.

# Configuration

## Environment variables

| Name | Type | Description |
| --- | --- | --- |
| `PORT` | `number` | Listen port (default `3000`). `--port` on a command overrides it by DECLARING it, so `config().PORT` is the port. Resolved as an integer `0`–`65535` whether a variable or an `onConfig` default named it — anything else falls back to the DEFAULT, so no reader checks the range again and a malformed `PORT` never silently binds a random port. `0` is the kernel's "whatever is free" and is the one number here that may be zero. |
| `APP_URL` | `string \| null` | The app's public URL. Its origin is what both gates compare against (WS CSWSH, CSRF) — undeclared, they fall back to the request's own, which is the weaker answer, since a caller controls its own `Host`, and the wrong one behind TLS termination, where that origin is the proxy's. Its path is the app's mount base: `https://abide.com/v2` serves every page, endpoint and asset under `/v2`. |
| `NODE_ENV` | `string` | Verbatim, and defaulted from the command when unset: `abide start` is `production`, `abide dev` is `development`. An explicit value always wins, completely — `NODE_ENV=production abide dev` minifies, requires `ABIDE_PRINCIPAL_SECRET`, sets `Secure` and ships no reload client. There is no second production flag: `config().NODE_ENV === 'production'` is the one comparison, and the command only supplies its default. |
| `APP_NAME` | `string` | The app's name, and therefore `log`'s default channel. Falls back to the nearest package.json `name`, then `abide`. |
| `APP_VERSION` | `string` | The `version` beside that `name`, or empty. Empty rather than absent, so no consumer branches on the field existing. |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory under `APP_NAME`. A path — nothing is created. |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | Seals the `abide-principal` cookie — a comma-separated list, signing with the first and verifying against any. That is what makes rotation non-destructive: prepend the new key, deploy, wait one half-TTL for the rolling re-seal to move everyone, drop the old. A single value swapped in place signs out every live session at that instant. Required in production for `principal.set()`; a dev process mints a random key and says so on `abide:principal`. |
| `ABIDE_PRINCIPAL_TTL` | `number` | Principal cookie life in ms (default 30d), rolling — re-sealed on the first resolve past half of it. |
| `ABIDE_APP_TOKEN` | `string \| null` | Bearer the remote CLI sends, for whatever an operator put in front of the app. |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. Asked before `APP_URL`; also marks a cross-origin proxy, which declines to volunteer `traceparent`. |
| `ABIDE_RPC_TIMEOUT` | `number` | Default ms a call may go without progress (default `Infinity`); a handler's `timeout` is the real knob. Per chunk on a handler that yields. |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | Default ceiling on a mutation's body in bytes (`Infinity` unset). An over-size declared `content-length` is 413 before buffering. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | Cap in bytes on a stream transcript held in memory, whichever thing holds it — a seed buffer entry, or a `global` memo's entry fanning one producer out to late readers. One number for one shape, rather than a second variable meaning the same thing somewhere else. Default: `Infinity`. A seed entry needs no other bound, being single-use and living seconds |
| `ABIDE_LOGS` | `boolean` | Opts IN to declaring the `GET` over `log.records`. Default closed → the address is unmounted → 404. Dispatched through the app's `middleware` like any route, so an app's auth rung governs it. |
| `ABIDE_OPENAPI` | `boolean` | Opts IN to declaring `GET /__abide/openapi.json`, the same way and for the same reason: publishing is a deployment decision, so the same document is right in staging and wrong on a public edge. Default closed → 404. `abide openapi` writes the document whatever this says, a file on disk not being an exposed surface. |
| `ABIDE_MCP` | `boolean` | Opts IN to declaring `POST /__abide/mcp`. Default closed → 404. Inside the app's `middleware` like every `/__abide/**` address, so the rung that authorises a caller authorises a model. |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | `log.records`'s `tail` — how many records the room retains for a later subscriber to replay (default `500`). |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | Machine log format. `null` means the shape follows the TTY. |
| `DEBUG` | `string \| null` | Log-channel gating in debug-npm grammar. A browser's `localStorage.debug` answers under this, never over it. |
| `NO_COLOR` | `string \| null` | Set to anything: no ansi anywhere, and `tsv` log output. Beats `FORCE_COLOR`. |
| `FORCE_COLOR` | `string \| null` | Set to anything: the readable form off a pipe, where the shape would otherwise follow the TTY. Loses to `NO_COLOR`. |

There is no `HOST`. The bind address is Bun's own default, and an app that needs another one reaches
`server()` and Bun's own `Bun.serve` options rather than a variable abide would only pass through.

## Files

| Convention | What it is |
| --- | --- |
| `src/**` | Abide app source files. |
| `src/server/**` | Server-related source. |
| `src/ui/**` | Browser-related source. |
| `src/shared/**` | Source shared by ui and server. |
| `src/server/app.ts` | Lifecycle hooks. Every export is optional, so the file is — an app of pages and endpoints needs none. What makes a directory an app is having something to serve: no `pages/` no handlers and no module is the one shape refused |
| `src/ui/app.html` | The document its pages are served in. `<slot></slot>` is where the page renders; a `src`/`href` naming a build entry is rewritten to what the build wrote, and the css the client graph imported is linked from the build. Absent → abide's own minimal shell |
| `src/ui/pages/**/page.abide` | HTML Routes. |
| `src/ui/pages/**/error.abide` | The page a refusal renders in. |
| `src/server/rpc/**/*.ts` | RPCs. |
| `src/server/sockets/**/*.ts` | Sockets. |

## Lifecycle hooks

A hook is called, never exported. Every one is an ordinary import from `abide` invoked at module
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
| `default` | `(request, server) => Response \| undefined \| Promise<…>`, or `{ fetch }` | The one export: a route of the app's own, asked first. |
| `middleware` | `(...rungs: Middleware<{ request: Request }, Response>[]) => () => void` | The per-request auth/observability rung, the same `Middleware` type the transports take, and PRE-routing. IT IS THE `Response`-Shaped lane, where the rpc lane is value-shaped: pre-routing there is no value to hand back, and it is therefore the one lane that can decorate a response — `const response = await next(ctx); response.headers.set(…)` — which is where a rung that must set a header belongs. It is also the lane that does not run on an in-process call, there being no request to route: it runs before the route resolves and before any rpc's or socket's own middleware, so it has a request and nothing else. Anything resource-aware — authorising by an id in the args — is necessarily a handler's own rung, which is where `ctx.args()` exists. `next(ctx)` hands back what the next rung returns; the innermost one runs the route. Short-circuited by returning without calling `next`, or by a throw. Auth is middleware |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the real boot: do setup, then `await start()`. Awaited |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Mirrors it for teardown: drain, then `await stop()`. Runs on SIGINT/SIGTERM/crash. Awaited |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error in this scope: a request that threw, and a `watch` effect or `Disposer` that threw. Scope-shaped rather than request-shaped, since a watch outlives the read that started it |
| `onConfig` | `<Extra>(fn: ConfigDefaults \| null, options?: ConfigOptions<Extra>) => () => void` | The app's config defaults, merged under the environment. Synchronous, and the only one that fails hard |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | Fields merged over the baseline `{ version, startedAt }`, on every server-side `health()` |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns what a caller presented into the principal, merged under the baseline `{ authenticated, expiresAt, error }` — a field colliding with one of those is dropped, since `authenticated` is abide's finding about a seal it verified rather than an app's to assert. Receives `null` for no valid seal. Fails closed |

### Expectations

* Every hook returns the way off again, so one registered by a module that is torn down can be, and
so the return type is one thing across all of them.
* FIVE COMPOSE AND TWO REPLACE, and which is which is decided by whether the hook contributes or
resolves. `middleware`, `onStart`, `onStop`, `onError` and `onHealth` compose — each call adds, in
registration order, which is what lets a module ship its own health field or its own rung. `onConfig`
and `onPrincipal` REPLACE and warn on `abide:config` / `abide:principal`: there is one config document
and one answer to who this caller is, so a second registration is a disagreement rather than an
addition.
* A hook that throws at registration fails hard; `onConfig` throwing when it RUNS also fails hard and
the server is not started (see `config`).

## Response helpers

An app's own route answers with the same helpers a transport handler does — `page`, `json`,
`jsonl`, `sse`, `redirect`, `refuse` — documented once under "rpc". There is no second set. Each
returns a plain `Response` and takes a `ResponseInit` the caller's headers ride in.

Two rules are the app-route lane's own. Every response built through one carries `traceresponse`,
every refusal included; outside a request the header is absent and a caller that set its own is not
overruled. And a source that throws mid-`jsonl`/`sse` Errors the body, the status line being already
out — the rpc lane's stream is the same machine with one extra frame, so it says the failure in a
line instead.

# CLI

## Commands

| Command | Purpose |
| --- | --- |
| `abide scaffold <name>` | Write a starter project, then `git init` + `bun install` + `abide dev` — each skippable (`--no-git` / `--no-install` / `--no-dev`). |
| `abide run <file> [args…]` | Run a script under the abide runtime. Everything after `<file>` belongs to the SCRIPT, so it is spawned: it reads its own `argv` and keeps its own exit code. |
| `abide check [dir…]` | Type-check `.abide`, reporting every diagnostic on the `.abide` line. The list is stdout; the exit code says it failed. |
| `abide dev [--port <n>]` | Watch the project and keep the app up: the client bundled into memory, the server restarted on every change, and full live-reload over the socket mux. `--port` (default `3000`) hops to the next open port if taken, then pins what it bound so no restart moves the app. `PORT` and `APP_URL` are written back from the listener and `config()` invalidated, so what the document reports is where it is actually listening and `abide logs` resolves an app a hop moved. |
| `abide build` | Code-split client → content-hashed chunks + `manifest.json`, minified and precompressed. Every `<style>` block compiles into the same set, so a route's scopes arrive as a content-hashed stylesheet the head links rather than as inline output. |
| `abide start [--port <n>]` | Boot the app's build from `abide build`, and open the interactive shell where stdout is a TTY. A port already held by an abide app is attached to under a TTY and is a failure without one — see "A TAKEN PORT IS NOT SILENTLY REUSED". |
| `abide connect [url]` | The interactive shell against a running app, booting nothing. No `url` reconnects to the last, remembered under `APP_DATA_DIR`. |
| `abide call <address> [args]` | One call to one handler, no shell — the only spelling, in argv and in the shell alike. Flags come from the argument schema; the exit code comes from the refusal's status. |
| `abide openapi [--out <file>] [--url <origin>]` | The OpenAPI document written to a file rather than served, for a repo that commits one or a client generator that reads one. `--url` supplies the mount the served form takes from `APP_URL`; without it `servers` is `[{ url: '/' }]` and the document is mount-relative, which is honest rather than wrong. |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio, for a model client that spawns a process rather than opening a socket. A bridge to `/__abide/mcp` on a running app, not a second implementation — it sends `ABIDE_APP_TOKEN` as a bearer the way `abide logs` does, so there is one tool list and one auth path however the model arrived. |
| `abide logs` | `abide call` on `log.records`, which is what a room-valued command already does — the tail replayed, then every record as it arrives. What the command adds is framing: printed by the rules THIS process's stdout answers to, with `+Nms` rebuilt from the record times. |
| `abide compile [--target] [--out] [--platforms]` | ONE standalone executable, via `bun build --compile`. `--platforms` cross-compiles a release set for the price of one client build, and makes `--out` name a directory. |
| `abide bundle` | A desktop launcher for the host platform: embedded assets and a first-run setup screen. Native windowing is best-effort — a system webview binary, or the default browser. |
| `abide lsp` | The `.abide` language server, over stdio. |
| `abide` · `-h` · `--help` | Usage, generated from `COMMANDS`. Asking for help is a success (stdout, `0`); an unknown subcommand is not (stderr, `2`). `abide <command> --help` is the same success, answering with that command's own row — read from the first argument only, so `abide run <file> --help` still belongs to the script. |

## Handlers as commands

Every handler is a command, derived from the route table the way an OpenAPI operation and an MCP
tool are — see `# Generated surfaces`, and `clients.cli` for withholding one. This is the third
framing of that one client: same route table, same middleware, same `principal`, same refusals, no
second implementation. Who is on the other end is not fixed — a person at a prompt, a script in CI, an
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
| help | Usage, generated from `COMMANDS` **and the route table** — the built-ins, then every handler this caller may reach, each with its `description` as the one-line summary. A third surface `description` is read on, and the third reason to write one |
| exit | Leave the shell. Where `abide start` opened it, this stops the server it booted, running `onStop` — a shell that outlived the process it started would be a prompt attached to nothing |

#### How a handler becomes a command

| Piece | Comes from |
| --- | --- |
| Name | the mount path's segments and the export name, space-separated. The same address MCP joins with `_`, spelled the way a shell reads |
| Flags | the argument schema. `GET` / `DELETE` args are flat by type, so each top-level key is one flag and a repeated flag is the array `URLSearchParams` already has a form for. A `POST` body is `JsonValue` and nests, which flags cannot express, so it takes `--json <body>` or reads the body from stdin — the split falls out of the existing rule rather than being decided here |
| Output | the result, framed by the TTY the way `ABIDE_LOG_FORMAT` already is: human-readable to a terminal, JSON to a pipe. A streaming handler prints one value per line, which is jsonl, so a pipe gets the framing the http caller would have got |
| Exit code | the refusal's status through the table this CLI already has — `3` for 422, `4` for 401/403, `5` for 404. A declared `Failed` carries a status, so a named refusal is a shell condition with no mapping written here |

#### Expectations

* `abide start` Binds and serves, and opens the shell where a person is watching. The shell follows the
TTY the way the log format does: a supervisor, a container and `abide start > log` get no prompt, and
everything the shell offers is reachable as `abide call <address>` regardless, so nothing is only
available interactively.
* A TAKEN PORT IS NOT SILENTLY REUSED. Under a TTY, `abide start` finding an abide app already on the
port attaches to it and says so — the second terminal is the case that matters, and booting a rival
process is never what was wanted. Without a TTY it fails, exit `1`: a supervisor told to start a
server and quietly given somebody else's is the incident this refuses to be part of. `abide dev` Hops
instead, which is the difference between a port that is an address and a port that is a convenience.
* The shell is a client over HTTP, even its own. Where `abide start` booted the server, the shell it
opens still speaks to it over localhost rather than reaching into the process — so the shell `abide
start` opens and the shell `abide connect` opens are ONE code path, and an in-process fast path would
be a second client to keep in step for a saving nobody at a keyboard can perceive.
* It authenticates as the operator, sending `ABIDE_APP_TOKEN` as a bearer the way `abide logs` and
`abide mcp` do. So the command list is PER-CALLER like the tool list: `help` shows what this caller may
reach, and `clients.cli` is what withholds a handler from it. Nothing about being at a terminal
skips a rung.
* `call` IS A prefix rather than a fallback, which is what keeps the namespace open. A bare
`abide <address>` gives the two vocabularies one namespace: a file named
`help.ts` had to be shadowed and reported, and — worse, because it fails later and further away —
abide can never add a built-in again without silently taking a name some app has already declared.
One prefix costs four characters and removes both, and nothing can collide.
* A socket is a command that does not return. Naming a room subscribes and prints each message as it
arrives; `--publish <message>` publishes instead, gated by that socket's `clientPublish` — the same
gate a browser's frames read, so a terminal publishes on exactly the terms a browser does.
Non-interactively it streams until the room ends or the process is signalled, which is what makes
`abide call <room> | grep` an ordinary thing to write.

## Expectations

* Exit codes `0` ok · `1` failed/unreachable · `2` usage · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx · `8` other 4xx.
* `abide start` and `abide dev` assemble from the same code, and differ in three
decisions: where the bundle came from, what a taken port means, and whether Bun's `development` is on.
* `abide dev` IS ONE PROCESS: the main thread watches, binds and serves, and a worker holds the app.
Replacing that worker is the reload. THE LISTENER IS THE MAIN THREAD'S so that a reload cannot drop
it, and what that costs is marshalling `(method, url, headers, body stream)` to the worker and
streaming the response back — a per-request proxy on no production path. On replacement the main
thread force-closes every live socket, which is what fires the reload trigger below: a socket that
outlived the worker would never reopen, and reopening is the whole mechanism. What has to be thrown
away is a MODULE GRAPH, not an operating system process — a graph is cached by resolved path and
cannot be evicted, so re-importing `app.ts` behind a cache-busting query would reload that one file
while every module it imports stayed as it was, leaving the app half of two versions with nothing
saying so. An isolate is the smallest thing that contains a whole graph, so terminating one is the
reload.
* The dev bundle is `Bun.build` into memory: unminified, and entry-named by its source (`client.js`, not
`client-<hash>.js`) so a breakpoint and a stack frame survive a rebuild — which is what `no-store` on
every dev asset pays for. Nothing is written so `abide dev` cannot leave a
half-built directory for `abide start` to serve. A client build that fails is not a process that
refuses: the pages still render, and the reload client is served by the dev worker itself — from
`/__abide/reload.js`, never out of the bundle — precisely so the page can reconnect once the build is
fixed. A file rather than an inline `<script>` because a document is served under the app's own
policy: `csp()` allows no unstamped inline script, and a shell head cut once at boot has no
per-request nonce to carry, where a script on this origin is already `'self'`. RELOAD IS THAT SOCKET
AND NO MESSAGE ON IT — a "reload now" frame could only be written by a process that is about to stop
being the one serving the page. So the connection is the TRIGGER and not the answer: reopening it
makes the page re-fetch `/__abide/reload.js?boot` and compare the boot id against the one the document
was served with, so a laptop that slept, a proxy that timed out and a browser reclaiming an idle socket
all reopen against a server that never moved and are left alone. The tag is `async`, not `defer`: a
document severed mid-body never finishes parsing, and a `defer` script in one never runs at all. The
watcher ignores dotted directories — which is what tells `.abide/` apart from `counter.abide` — plus
`node_modules/`, and the worker force-closes its socket before draining, since a socket never ends and
`shutdown()`'s graceful close would otherwise wait out every open tab on every restart.

# Documentation

* A documentation site should be a package under `packages/dogfood`
* Every user-exposed behavior or capability should be documented as real .abide and/or .ts files as examples.
* All examples should also be benchmarked and a part of end-to-end testing. That is a debt, not a
description: one of eight carries a bench today and none is driven by a spec, because neither can
run until the compiler does. Every example authored before then owes both, and saying so here is
what keeps "benchmarked" from reading as a property they already have.
* One example per page, and it is one problem that needs everything the page teaches — not a small
example carrying spare files. If a file in its Files panel is not part of the problem the summary
names, it is two examples wearing one title; if a subheading needs code the example does not have,
the repair is another file in that example, never a second example, which would put the snippet's
home on a page the reader has not been to. `coverage.test.ts` enforces the count.
* `{% example <name> %}` Embeds the directory: the render on top, then a tab per artifact it has.
The render is not one of those tabs — it is the thing the example is, and a reader who has to find a
tab before seeing one has been handed source to read instead of something to try.
* `{% snippet <example> <file> [anchor] %}` is how a page shows code, in place of pasting it into a
fence. The anchor is a line prefix matching exactly once, and the slice runs to the end of the
construct it opens; several anchors separated by ` … ` are one fence, in file order, with the gap
marked rather than closed. Caption, language, `— excerpt` and spine colour are derived from the
address. None matching, or two matching, is a build failure — which is the whole point, a sample
that no longer exists being the one kind of documentation error nothing else reports.
* A result is a machine, not a snapshot: `hold` waits and goes to the state `after` NAMES, `on` goes
somewhere on something the reader did, and `mirror` follows an input as it is typed without a state
change. A hold with nowhere to go, a transition naming no state, and two states sharing an id are
all refused at build, because all three render fine and dead-end silently. Where it rests is where
the clock stops — follow `hold` from the first state and settle on the first one without it — and
that is decided server-side so the frame is right before any script runs. Nothing plays at load.
* A panel an example has no artifact for is not rendered. Beside Files and the render: `wire`,
`compiled`, `bench` and `tests`. `vanilla` is not a panel — the hand-written arm ships in the download
and in the line counts, and a reader consults it through the ratio it produced rather than by reading
it. A panel is a high bar: a Logs panel was built, carried by five examples, and removed, because what
the app said while it ran is a footnote on every page that does not turn on a count of runs.
`wire` is the requests panel — the rpc calls the page made, each as its request line,
its headers and what came back — which is the one artifact that shows the seam an app never writes.
* Anything a result renders that the example's files do not produce belongs in a tip. A demo's own
controls and its instrumentation are the documentation talking, and outside a tip they read as the
app's output — `read-invoice` rendered a `Loading…` the page had no branch for, on the example whose
claim is that it has none.
* Benchmarking should take into account DOM work, repaint/reflow, wall time ms, render frames, cpu/memory. All benchmarks should be exposed 
* Three levels, and a reader may stop at any of them: a main overview with one section per area,
each showing that area's own opening; a section overview carrying that same opening and then what does
not fit on a landing page; and a topic page, one problem solved.
* A section overview owns its opening, and the main overview shows the same words by pulling them with
`{% lead <slug> %}`, so there is one place to edit them and the seam cannot drift. The build refuses A
lead that carries a relative link, because it renders at two depths.
* `covers:` in the frontmatter is where a page declares which capabilities it covers, so the order a
concept is introduced in is checkable rather than remembered. An overview does not declare one — it
routes, and the topic page covers; a capability counted as covered by a page that only links to it is
a gate that has quietly stopped working. A reference page declares none either, for the opposite
reason: it enumerates a surface rather than solving a problem with it, so counting it would mark every
capability covered by the page that merely lists them all. A topic page declaring none is not a hole —
what the gate asks is that every capability is claimed exactly once somewhere, so a page walking a
reader through capabilities other pages own has nothing of its own to claim.
* `packages/dogfood/tests/coverage.test.ts` is where this is enforced, against this document read as
the source: every capability covered, none claimed twice, none claimed that is not here. Beside it are
the brand rules a check can reach — a heading that leans on a pronoun, a heading enumerating names
after a colon that names fewer of them than the table under it, a nav label that is a bare prepositional
fragment, a link whose text no longer matches the `nav` it points at, an `abide` snippet teaching the
explicit spelling back, a fence with no caption to hang a spine on, a code sample wider than the 76
columns a snippet renders in, a page embedding more than one example, a control a result renders
that no template in that example writes, and a rule the result frame lifts out of `app.css` that no
longer resolves there — that last one being silent in the worst way, since the page still renders
and only the example stops looking like an abide page. What is left to a reviewer is whether an entry is the right page's,
which no check can decide.
* The voice, the vocabulary and the register of a title against a nav label are `docs/BRAND.md`'s —
rules a reviewer enforces rather than the build.
