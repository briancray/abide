# Rulebook

Every rule that governs behaviour, stated once, numbered.

## What this document is

A **rulebook**. One clause per requirement, and the clause answers exactly one question: *what must
hold?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| Constrains behaviour, at build time or run time | here | a requirement is what two implementations have to agree on |
| Answerable from the type alone | REGISTRY.md | a signature is not a rule |
| Explains why the rule is this way | a guide in `packages/dogfood/content` | a reason is read once and never looked up |
| A measurement | the harness | a number in prose is a number nothing re-runs |

## Format rules

These are immutable. A change to them is a change to what this document is.

1. **One clause states one requirement.** A clause carrying two is two clauses.
2. **A rule is stated exactly ONCE.** Any clause that needs another cites its number. A second
   statement of a rule is drift, and only one of the two copies ever gets fixed.
3. **No clause carries a signature.** Types live in REGISTRY.md, and a check refuses a function
   arrow here.
4. **Every clause names something** — a name from REGISTRY.md, or a term the table below defines.
   A clause built on an undefined noun is prose about nothing, and a check refuses one.
5. **No rationale, no measurement, no example.** The word "because" is the tell.
6. **A group governing something REGISTRY does not name says so.** Most clauses hang off a name an
   app writes, and the check that every clause is cited is what stops a rule drifting free of the
   surface it governs. A few groups genuinely have no such name — the documentation system is not
   part of the framework's surface — and one of those declares itself FREE-STANDING on the line
   under its heading. The declaration is the exemption, so an uncited clause is either cited or
   visibly excused, and never merely missed.
7. **Clause numbers are stable.** A withdrawn clause is marked withdrawn in place. A number is
   never reused and never renumbered, because a guide, a test or a review comment may cite it.

## Terms

A term below is a category the clauses are written over. It is defined here rather than in
REGISTRY.md because none of them is a name an app author writes.

| Term | Definition |
| --- | --- |
| read | A call to `s` or to `s.peek`. |
| write | A call to `s.set` or to `s.patch`. |
| probe | Any of `s.pending`, `s.refreshing`, `s.done`, `s.success`, `s.streaming`, `s.error`. |
| trigger | `s.refresh` or `s.invalidate`. |
| producer | A source that supplies a value without a write. |
| materialisation | The making of a `Stored` from what a producer has yielded. |
| production | One materialisation of a `Stored` that a reader may observe. |
| provisional | A body run that read a value which had not landed. |
| reader | An expression or effect that performed a read. |
| revalidation | A load started by `s.refresh` over a value still being served. |
| refusal | A `Failed` answered in place of a value. |
| ring | The productions retained under `tail`. |
| entry | One key's slot in a keyed `memo`. |
| scope | The lifetime a value is filed under and dropped with. |
| adoption | What a `memo` does with a `Reactive` its body returned. |
| forwarding | The delegation between an adopting `Reactive` and the one it adopted. |
| propagation | The derivation of a probe from the values a body read. |
| sink | What 35.7 defines. |
| implementation | Anything claiming conformance to this document. |

RFC 2119 keywords are used as that document defines them: **MUST**, **MUST NOT**, **SHALL**,
**SHOULD**, **SHOULD NOT**, **MAY**.

# 1. The reactive value

1.1 Every producer in this design MUST hand back a `Reactive`.

1.2 *Withdrawn, superseded by 1.5, 1.6 and 1.7.* It read "A `Reactive` MUST NOT be thenable",
which reserved thenability across the design as the mark of a load and left `s.settled` the only
spelling of a gate.

1.3 `Produced` MUST be the unit the producer yielded: `Stored` for a state and for a room, and one
chunk for a streaming producer.

1.4 `Failures` MUST be the union of the refusals the producer declared, and MUST carry the
validation refusal wherever a `schema` is declared, without the app declaring it.

1.5 A `Reactive` MUST be thenable. See D95.

1.6 `s.catch` and `s.finally` MUST derive from `s.then`.

1.7 Where a load is told apart from a value, a `Reactive` MUST be taken as a value. See D95.

# 2. Reads

2.1 A read MUST return what is held, and MUST NOT await.

2.2 A read MUST return `undefined` where no value has landed and no producer has failed.

2.3 A read MUST throw where a producer failed and no value has landed. See D67.

2.4 A rejected write MUST NOT cause a read to throw.

2.5 A failed revalidation MUST NOT cause a read to throw.

2.6 `s.peek` MUST read as `s` does, except that it MUST NOT join the flow.

2.7 *Withdrawn, superseded by 2.12 and 2.13.* It read "`s.settled` MUST resolve when `s.pending`
becomes false", which left the promise face with no answer at all for the one case 2.3 throws for,
and named a member D95 removed.

2.8 `s.tail` MUST replay the retained snapshot and then continue live from where that snapshot
ended, with no gap and no repeat.

2.9 The argument to `s.tail` MUST be replay depth alone, bounded above by what is retained.

2.10 *Withdrawn, superseded by 2.11.* It read "`s[Symbol.asyncIterator]` MUST be defined as
`s.tail` called with no argument", which made the ring and the live cursor one sequence, so a
streaming producer's history was its chunks.

2.11 `s[Symbol.asyncIterator]` MUST yield the production in flight from its start, and MUST then
continue live. See D53.

2.12 `s.then` MUST resolve with the value where `s.pending` becomes false and 2.3 would not throw.

2.13 `s.then` MUST reject with what 2.3 throws, where 2.3 would throw. See D95.

# 3. Probes

3.1 A probe MUST NOT throw.

3.2 A probe MUST NOT start work.

3.3 Reading a probe MUST subscribe to that probe alone.

3.4 A sink MUST be opened by `s.pending`, and MUST NOT be opened by an absent value.

3.5 `s.refreshing` MUST NOT open a sink.

3.6 `s.pending` on a streaming producer MUST remain true until the stream closes, narrowed by 3.14
where a value is already landed. See D97.

3.7 `s.pending` on a room MUST remain true only until its first message.

3.8 `s.done` MUST stay true through `s.refresh`.

3.9 `s.done` MUST remain false while a room is live.

3.10 `s.success` and `s.error` MUST be orthogonal: either MAY be true while the other is.

3.11 A value with no producer MUST report `s.success` true from construction.

3.12 *Withdrawn, superseded by 3.13.* It read "`s.success` MUST be false while a load is in
flight or a stream is open", which made a probe about what has completed move for something in
flight, which is the axis `s.pending` and `s.refreshing` already answer.

3.13 `s.success` MUST NOT move for a load in flight.

3.14 A load given to `s.set` over a landed value that is not stale MUST report `s.refreshing`, and
MUST NOT report `s.pending`. See D84.

3.15 `s.streaming` MUST be true while a stream a producer is on is open, and MUST be false once
it closes. See D97.

# 4. Writes and gates

4.1 `s.set` MUST accept a settled value or a load, and `state` MUST accept the same two.

4.2 A load given to either MUST make the `Reactive` loaded, at construction and at every write
alike.

4.3 Where a `schema` is declared it MUST run first, on the settled value.

4.4 What `schema` returns MUST be what `transform` receives.

4.5 A `schema` MUST refuse by throwing, and the throw MUST be caught and converted rather than
escape the write.

4.6 A `transform` MUST refuse by returning a `Failed` rather than by throwing, per 15.6.

4.7 A `transform` MUST run untracked, on the settled value, once per materialisation of a `Stored`.

4.8 A `transform` MUST NOT run on a promise, and MUST NOT run per chunk.

4.9 A refused write MUST store nothing and MUST mint no production.

4.10 A refused write MUST fill `s.error`, and MUST NOT reach a `{:catch}`.

4.11 An accepted write or production MUST clear the standing `s.error`.

4.12 A failed revalidation MUST leave the held value being served, and MUST warn on
`abide:reactive` naming the value.

4.13 `s.set` MUST take the `Accepted` its factory declared, and a `Reactive` MUST carry that
`Accepted` wherever it is passed. See D49.

# 5. Productions and identity

5.1 A reader MUST be woken only when read identity changes.

5.2 A production whose identity matches the previous `Stored` MUST NOT be retained, and MUST wake
no reader.

5.3 `identity` MUST be discriminated by arity: one parameter is a projection compared by `!==`, and
two is a comparator answering directly.

5.4 The default `identity` on a state and on a memo MUST be `structural`.

5.5 The default `identity` on a room MUST be the reference. See D87.

5.6 `structural` MUST answer "not equal" wherever it cannot decide.

5.7 A production `s.set` mints on a state and on a memo MUST be pushed rather than replace the
head production.

5.8 `s.set` MUST replace the head production on a room, and MUST NOT mint a sequence number there.

5.9 `s.patch` MUST replace the head production rather than append one.

5.10 A callback given to `s.patch` MUST return nothing.

5.11 `throttle` and `debounce` MUST cap how often a value changes for a reader. See D61.

5.12 A capped window MUST cap the wake, and MUST NOT itself drop a production. See D68.

5.13 A cursor MUST deliver every production a window collapsed that retention still holds.

5.14 An implementation MUST NOT start work a window would discard.

5.15 `throttle` MUST allow a change immediately and then at most once per window.

5.16 `debounce` MUST delay a change until the changes stop.

5.17 Declaring both `throttle` and `debounce` MUST be a build error naming the value.

5.18 Inside a `throttle` or `debounce` window the held value MUST be served and `s.refreshing` MUST
be true.

5.19 A `bind:` read MUST NOT be capped.

# 6. Retention

6.1 Retention of `tail` entries MUST be append-only.

6.2 Raising `tail` MUST NOT make a write dearer.

6.3 The unit of `tail` MUST be `Stored`.

6.4 A `ttl` expiry MUST wake no reader.

6.5 A production past its `ttl` MUST be dropped on the read that follows.

6.6 An implementation MUST NOT hold a timer per retained production.

6.7 A live cursor over `s.tail` MUST NOT observe an expiry.

6.8 `ttl` MUST be inert on a value with no producer, and MUST NOT drop what the app put there.

6.9 An implementation MUST hold one expiry timer per ring, armed at the head's expiry. See D54.

6.10 A `ttl` expiry timer MUST NOT hold the process open.

# 7. Triggers

7.1 Every `Reactive` MUST carry `s.refresh` and `s.invalidate`.

7.2 `s.invalidate` MUST drop the cache behind the value, and MUST NOT drop the value.

7.3 `s.invalidate` MUST NOT move a node and MUST NOT send a request.

7.4 `s.refresh` MUST keep serving what is held until the new value lands.

7.5 `s.refresh` MUST report `s.refreshing` true while the reload is in flight.

7.6 *Withdrawn, superseded by 13.7.* It read "where nothing subscribes to it, `s.refresh` MUST
behave as `s.invalidate`", which made one call mean two things by a condition nothing can observe.

7.7 `s.refresh` and `s.invalidate` MUST be inert on a value with no producer.

7.8 `s.invalidate` MUST mark the held value stale. See D55.

7.9 A load over a value marked stale MUST report `s.pending`.

7.10 A value `s.invalidate` marked stale MUST continue to be served until the load lands.

7.11 An accepted production MUST clear the stale mark.

7.12 A load over a value marked stale MUST report `s.done` false.

7.13 `s.refresh` and `s.invalidate` MUST be inert on a room.

7.14 `s.refresh` MUST reload whether or not anything subscribes. See D74.

# 8. Stores

8.1 A `Store` MUST provide both `get` and `set`.

8.2 A `Store`'s `get` MUST be a producer, and the value MUST therefore answer to 7.1.

8.3 A `Store`'s `get` MUST answer before the initial value, and the initial value MUST be what a
miss falls back to.

8.4 A synchronous `get` MUST NOT make the value loaded.

8.5 A restore MUST mint a production without running `schema` or `transform`. See D59.

8.6 A restore of a streaming producer MUST seed the ring with the accumulation.

8.7 A restored stream MUST report `s.done` and `s.success` true and `s.streaming` false.

8.8 A `Store`'s `set` MUST run once per production, per 5.2.

8.9 A `Store`'s `set` on a streaming producer MUST run once at close, on the accumulation.

8.10 Writes to a `Store` MUST coalesce latest-wins, and MUST NOT queue.

8.11 A write to a `Store` MUST NOT block a reader.

8.12 A failed `Store` write MUST NOT detach the store; it MUST reach `onError` and warn on
`abide:reactive`.

8.13 A `Store`'s `set` MUST receive the `Reactive`'s own `ttl`, in milliseconds.

8.14 A `store` MUST run where the `Reactive` is constructed.

8.15 A value a `Store`'s `get` cannot read MUST be a miss, per 8.3.

# 9. Rooms and streams

9.1 A room's production MUST be one complete `Message`.

9.2 *Withdrawn, superseded by 1.3.* It read "a streaming producer's production MUST be one
chunk", which contradicted what a production is: a chunk is a `Produced`, and the `Stored` it is
a piece of is materialised once.

9.3 A streaming producer's `Stored` MUST be the accumulated chunks, materialised once on close.

9.4 An implementation MUST NOT accumulate chunks by copying the accumulation per chunk.

9.5 Whether a producer is a room or a stream MUST be decided by what the producer declared, and MUST
NOT be inferred at run time.

9.6 *Withdrawn, superseded by REGISTRY's `Room` row.* It read "a `Room` MUST be a `Reactive`
whose value is the latest `Message`, carrying `publish`", which is what that row's type says.

9.7 `publish` MUST hand back the sequence number it minted, or the `Failed` a `transform` refused it
with.

9.8 A publish that `identity` deems a consecutive duplicate MUST mint no production, and MUST hand
back the standing sequence number.

9.9 A room's `identity` MUST compare against the previous `Message` alone, and MUST NOT scan the
ring.

9.10 A `schema` on a `channel` MUST gate what a publish takes. See D51.

9.11 `args` on a `channel` MUST refuse only, and MUST NOT normalise the room key.

9.12 A room's `tail` MUST be how far back a reconnect resumes, and a cursor older than it MUST be
answered with the whole ring rather than with a gap.

9.13 A `store` on a `channel` MUST round-trip the latest `Message`, and MUST NOT persist the ring.

9.14 A `transform` and a `schema` on a `channel` MUST run on every publish, the server's own
included.

9.15 A `Room` MUST be created by a publish, and MUST NOT be created by a subscribe.

9.16 Subscribing to a room nothing has published to MUST allocate no entry, and MUST read as
`s.pending`.

9.17 A `Room` MUST be discarded when its subscriber count reaches zero. See D64.

9.18 A `Room` MUST be process-wide.

9.19 `publish` MUST be the only way a `Room` changes, and an implementation MUST NOT provide a
revoke or a clear. See D8.

9.20 A `Room` MUST NOT be where a removal is enforced.

9.21 A `Room`'s history epoch MUST be minted when the `Room` is constructed, and MUST NOT change
while that `Room` lives. See D100.

# 10. Sharing

10.1 `state.share` MUST get or create in one call.

10.2 A key given to `state.share` MUST be a literal, and a non-literal MUST be a build error.

10.3 A key `Shared` declares MUST be checked against it, and a key it does not declare MUST be
inferred from the thunk.

10.4 A value created by `state.share` MUST NOT be evicted within its scope.

10.5 The scope of `state.share` MUST be the component instance and its descendants.

10.6 `state.share` MUST create in the calling scope where no ancestor holds that key.

10.7 An implementation MUST NOT provide a process-wide `state.share`. See D56.

# 11. Memoized values

11.1 A `memo` body declaring no parameter MUST produce an unkeyed, tracked `Reactive`.

11.2 A `memo` body declaring one parameter MUST produce a keyed, untracked `Memo`.

11.3 An implementation MUST NOT provide an option converting one `memo` form into the other.

11.4 A keyed `memo` MUST hold one entry per `Args` key, computed on the first read of that key.

11.5 An unkeyed `memo` MUST recompute when a value its body read changes.

11.6 A keyed `memo` MUST NOT recompute for that reason, and `ttl`, `invalidate`, `refresh` and
eviction MUST be its only ways back.

11.7 Both `memo` forms MUST accept a write.

11.8 A write to a `memo` MUST stand until the next recompute replaces it.

11.9 An implementation MUST NOT warn on a write to a `memo`. See D2.

11.10 A write of a settled value to a `memo` MUST move no probe.

11.11 A write of an unsettled value to a `memo` MUST be a load, per 4.2 and 1.7.

11.12 A `Reactive` returned from a `memo` body MUST be adopted, and MUST NOT be stored as a value. See D43.

11.13 Adoption MUST mirror the adopted productions into the outer ring.

11.14 An adopting `memo` MUST run its own `transform` on the way in.

11.15 Adoption MUST forward members the adopted `Reactive` declares beyond the common face, by
delegation to whatever is currently adopted.

11.16 On re-adoption a `memo` MUST clear where the newly adopted `Reactive` has nothing to serve.

11.17 Adoption MUST inherit the adopted `Reactive`'s `identity` where the outer declared none.

11.18 A recompute landing on the same adopted `Reactive` MUST wake no reader.

11.19 An adopting `memo` MUST report `s.pending` only where the newly adopted `Reactive` reports
it.

11.20 `s.pending`, `s.refreshing` and `s.done` MUST be the probes that propagate. See D69.

11.21 An unkeyed `memo` MUST report `s.pending` for its own load, or for any value its body read.

11.22 An implementation MUST derive a propagated probe on the read that asks for it, and MUST NOT
hold a subscription per source for it.

11.23 *Withdrawn, superseded by 11.20.* It read "`s.refreshing` MUST NOT propagate", which D3
decided on a cost that deriving at read removes. See D3.

11.24 *Withdrawn, superseded by 3.3.* It read "Reading a probe MUST NOT join the value flow",
which is what 3.3 requires of every probe read, a memo's included.

11.25 A keyed `memo` MUST propagate nothing.

11.26 An `Args` object MUST become a key by its canonical wire form: members sorted by name,
`undefined` members dropped, and `Date` written ISO.

11.27 An `Args` key MUST be structural.

11.28 The key MUST be taken before `args` runs. See D4.

11.29 The order over `Args` MUST be coerce, apply syntax defaults, canonicalize, validate, then
the body.

11.30 An `args` gate MUST refuse and MUST NOT decide which entry an `Args` object lands on.

11.31 A default written in the body's parameter MUST participate in the `Args` key, on both sides.
See D5.

11.32 The build MUST warn where `args` declares a default the parameter does not.

11.33 A reactive value in an argument position MUST be read, and `Args` MUST be plain args.

11.34 A `memo` without `global` MUST be request-local on a server and process-local in a browser. See D88.

11.35 `ttl: Infinity` without `global` MUST mean to the end of that scope.

11.36 `global: true` MUST place entries in a process-wide cache that outlives every request.

11.37 A `global` `memo` MUST be bounded by its own `ttl` and by `invalidate`, and by nothing else.

11.38 An implementation MUST NOT evict a `global` entry on a size or a count limit. See D6.

11.39 `global: true` MUST be a build error on a body reading `request`, `response`, `principal`,
`cookies`, `csp.nonce` or `route`, and the error MUST name the ambient. See D7.

11.40 Coalescing of a `memo` load MUST be within a scope: two reads of one key in one scope share
one load, and two scopes load twice.

11.41 A `global` `memo` over a streaming body SHOULD declare `tail: Infinity`.

11.42 A reader detaching from a `global` streaming `memo` MUST NOT cancel the producer for the
readers that remain.

11.43 `args` on a `memo` MUST check `Args`. See D48.

11.44 `args` MUST be unspellable on the unkeyed `memo` overload, and spelling it MUST be a compile
error naming the overload. See D1.

11.45 `store` on a keyed `memo` MUST accept a function of the `Args`.

11.46 `tags` MUST be what a `Selection` matches on, and MUST be the only selector reaching across
memos.

11.47 The function form of `tags` MUST receive the memo's `Args`.

11.48 *Withdrawn, superseded by 5.15.* It read "`throttle` MUST fire a revalidation immediately
and then at most once per window", which filed a cap on every reactive value under the memo.

11.49 *Withdrawn, superseded by 5.16.* It read "`debounce` MUST delay a revalidation until the
triggers stop", and moves with 11.48.

11.50 *Withdrawn, superseded by 5.17.* It read "declaring both `throttle` and `debounce` MUST be
a build error naming the `memo`", and moves with 11.48.

11.51 *Withdrawn, superseded by 5.18.* It read as 5.18 does over a `memo` alone, where what is
owed inside the window is a reload rather than any change.

11.52 A keyed `memo`'s `ttl` MUST be the life of the entry, and the ring MUST be discarded with it.

11.53 A `memo` MUST accept a `schema`, gating what its body produced. See D50.

11.54 An adopting `memo` MUST run its own `schema` on the way in, as 11.14 has it run its
`transform`.

11.55 A keyed `memo` MUST hold one expiry timer, armed at its oldest entry.

11.56 An entry MUST take the newest position on every production.

11.57 Every probe MUST forward from the adopted `Reactive` to the adopting one. See D66.

11.58 Every trigger on an adopting `Reactive` MUST reach the adopted one.

11.59 A provisional run MUST mint no production. See D71.

11.60 A reader joining a `global` `memo`'s stream after it began MUST NOT be answered with a
refusal.

11.61 A `memo` MUST report `s.pending` before its body has run for the value being probed. See D85.

11.62 A probe over a key a keyed `memo` has not computed MUST allocate no entry. See D86.

11.63 An implementation MUST NOT warn where two `Args` keys differ only in the case of a value.
See D4.

# 12. Effects

12.1 A `Disposer` MUST run before each rerun of its `Effect`, and once more at teardown.

12.2 An `Effect` MUST run immediately, and again whenever a reactive value it read changes.

12.3 *Withdrawn, superseded by REGISTRY's `watch` row.* It read "`watch` MUST hand back the way
to stop it", which is what that row's return type says.

12.4 Where sources are given to `watch`, the `Effect` MUST run only when those sources change.

12.5 A `watch` registered inside a component MUST be owned by that component.

12.6 On a server a `watch` MUST run once, and its `Disposer` MUST still run at scope teardown.

12.7 A throw from an `Effect` or a `Disposer`, and a read of a failed `Reactive` inside one, MUST
reach `onError` with the trace attached and MUST warn on `abide:watch`.

12.8 In a browser a throw from an `Effect` MUST additionally be re-thrown as an unhandled
rejection.

12.9 An `Effect` that threw MUST stop its `watch`. See D9.

12.10 `s.watch` MUST be defined as `watch` narrowed to that `Reactive`, and MUST NOT be a second
mechanism.

# 13. Selections

13.1 A `Selection` MUST be one `Reactive`, one keyed `Memo`, or a set of `tags`.

13.2 `pending` and `refreshing` over a `Selection` MUST answer whether any entry in it is in that
state.

13.3 An implementation MUST hold one signal per `Selection`, and MUST NOT hold one per entry.

13.4 `s.refresh`, `s.invalidate`, `m.refresh` and `m.invalidate` MUST be defined as `refresh` and
`invalidate` over a `Selection`, and MUST NOT be a second mechanism.

13.5 An implementation MUST NOT provide a free `done`, `success` or `error` over a `Selection`.
See D10.

13.6 A bare `invalidate` MUST match only entries that have a producer.

13.7 A bare `refresh`, and `refresh` over a `Selection` that is not one `Reactive`, MUST reload
only entries something subscribes to and MUST mark the rest.

13.8 A `Selection` MUST be scope-bounded, and a tag MUST be scoped the same way.

13.9 A `Selection`'s signal MUST be keyed by the canonical form of its `tags`.

13.10 On a server a bare `invalidate` and a bare `refresh` MUST each reach every `global` `memo`
in the process. See D65.

13.11 *Withdrawn, superseded by 13.10.* It read "an implementation MUST NOT provide a `refresh`
over a `Selection` wider than the scope", which made the bare `refresh` narrower than the bare
`invalidate` beside it.

# 14. Tracking

14.1 A `Reactive` MUST be tracked only where something downstream will be rebuilt from it.

14.2 A template expression MUST track the `Reactive` values it reads.

14.3 An unkeyed `memo` body MUST track.

14.4 A keyed `memo` body MUST NOT track.

14.5 A block body's binding MUST track, and MUST bind the value the block produced rather than a
`Reactive`.

14.6 A `watch` `Effect` MUST track, narrowed where 12.4 gives it sources.

14.7 A component `<script>` setup body MUST NOT track.

14.8 A branch-local `<script>` in a block body MUST NOT track.

14.9 An event handler and a `bind:` write-back MUST NOT track.

14.10 A `Transformer`, a `Disposer`, middleware and a lifecycle hook MUST NOT track.

14.11 A `Reactive` MUST push its own subscriber when it evaluates, whoever reached it.

14.12 On a server a tracked read MUST register no subscriber, and MUST register the sink 3.4 opens
where what it read is still in flight.

14.13 Tracking MUST be synchronous, and a read in a continuation after an `await` MUST register
against nothing.

14.14 The compiler MUST warn on a reactive read an `await` dominates inside a tracked body, naming
the read. See D11.

14.15 The compiler MUST warn on a reactive read in a condition position inside a tracked body,
naming the read.

14.16 The compiler MUST warn on a reactive read inside a function a tracked body creates and
does not call synchronously, naming the read.

# 15. Refusals

15.1 A refusal MUST be a declared value, and MUST NOT be a status code or a transport concern.

15.2 A refusal MUST fill the `Failures` of the `Reactive` that produced it.

15.3 *Withdrawn, superseded by REGISTRY's `refuse.typed` row.* It read "`refuse.typed` MUST hand
back a factory carrying `is`", which is what that row's type says.

15.4 A refusal declared through `refuse.typed` MUST default to status 400. See D12.

15.5 Constructing a `Failed` MUST be inert, and MUST NOT throw.

15.6 Returning a `Failed` MUST refuse. See D90.

15.7 `Failed` MUST be structural.

15.8 `notFound` MUST be returned where no route matched, and where no handler is mounted at that
address and method.

15.9 `validationError` MUST be returned where a `schema` refuses, at status 422.

15.10 An implementation MUST declare no refusal names beyond those `notFound` and `validationError`
carry and the one 17.8 names. See D13, amended by D63.

15.11 An expression statement whose type is `Failed` MUST be a compile error naming both repairs.

15.12 Where `refuse.typed` is given a `schema`, the data MUST be checked synchronously at
construction.

15.13 A `message` given as a function MUST run at construction, on the data. See D57.

15.14 A throw from that function MUST be caught, the `message` falling back to the name, and MUST
warn on `abide:refuse`.

15.15 The `schema` MUST run before the `message` function.

15.16 A `schema` refusal at construction MUST warn on `abide:refuse` rather than stop the `Failed`
being built.

# 16. Handlers and transports

16.1 A handler MUST be a `memo`, a `channel`, or a plain function.

16.2 `GET`, `POST`, `PUT`, `PATCH` and `DELETE` MUST give a handler an address over http, mounted by
file path and export name.

16.3 An `Rpc` MUST hand back the same `Reactive` shape the handler had, `Produced` included.

16.4 An `Rpc` MUST be callable in both arms, the call being what issues the request.

16.5 Which arm `GET` takes MUST be read off a brand the factory stamped, and MUST NOT be inferred
from the shape. See D14.

16.6 `GET` over a plain function MUST behave as `GET` over a `memo` of that function.

16.7 A `memo` handed to a mutation MUST have its `ttl` default to 0 unless it declared one.

16.8 A `POST` over a `channel` MUST publish into the room, and declaring that handler MUST be the
authorisation for it.

16.9 `Failures` on an `Rpc` MUST be the union of what the handler declared and what its rungs
declared.

16.10 `rpc.url` MUST take the `Args` on a `GET` or a `DELETE`, and MUST take none on a mutation.

16.11 `rpc.url` MUST resolve a mount-relative address at run time, and the build MUST NOT bake an
absolute one.

16.12 A `Middleware` rung MUST run on every call, in process as much as over the wire. See D15.

16.13 The rungs in registration order, the `ctx.args()` coerce-then-validate, and `timeout` MUST run
on every call.

16.14 The `Origin` gate on a mutation, `maxBodySize`, the `crossOrigin` preflight, the framing, the
`cache-control`, a status written through `response` and the seed buffer write MUST be wire-only.

16.15 The `Middleware` onion MUST be composed once at route-table construction, and MUST NOT be folded per call.
See D16.

16.16 A composed `Middleware` chain MUST capture the rung and the next link, and MUST NOT capture anything
per-request.

16.17 A `Middleware` rung MUST short-circuit by returning what the handler would have returned.

16.18 `ctx.args()` MUST parse on first call and cache for the request.

16.19 `ctx.args()` MUST hand back `Args` coerced and validated against the `schema` the memo
declared.

16.20 Validation MUST be lazy, on that first `ctx.args()` call.

16.21 A body that will not parse as `Args` MUST be answered 400.

16.22 A throw from a `Middleware` rung MUST escape the whole onion rather than unwind through it.

16.23 `timeout` MUST raise the request's idle timeout, and MUST only raise it.

16.24 A request's `timeout` floor MUST be the maximum over every handler that ran in it.

16.25 *Withdrawn, superseded by 20.3.* It stated 20.3's requirement a second time, spelled over
the option rather than the type.

16.26 `crossOrigin` MUST default to false, and where it is declared abide MUST answer the `OPTIONS`
preflight itself.

16.27 A handler MUST be request-bound where its rungs or its body read the request scope, and
calling one from a scope that has none MUST be a build error, per 11.39.

16.28 Shape MUST belong to the `Reactive` and MUST NOT be declared at the transport; a transport MUST
read it.

16.29 A `schema` MUST run where its `Reactive` lives.

16.30 A browser MUST receive a generated `Rpc` wrapper carrying the method, the mount-relative address and
the description, and MUST NOT receive the server module. See D17.

16.31 Importing a name from `#server` that is not a handler MUST be a compile error from the client
graph, and MUST NOT be a silent stub.

16.32 An `Rpc` returning a raw `Value` MUST transport as `application/json`.

16.33 An `Rpc` returning `undefined` MUST answer 204 where no status was written through
`response`.

16.34 An `Rpc` returning an async generator MUST stream in the framing `Accept` names, and MUST
default to the first framing its chunk type admits. See D91.

16.35 *Withdrawn, superseded by 16.34.* It read "a caller sending `Accept: text/event-stream`
MUST get the same address framed as sse, and that answer MUST carry `vary: accept`", which made
one entry of the framing table a clause of its own, and restated 21.8 for it.

16.36 The seed buffer MUST hold an `Rpc`'s transcript in the chunk type's default framing,
whichever framing the caller asked for.

16.37 An `Rpc` returning a binary MUST transport as `application/octet-stream`, or as a `Blob`'s own
type where it has one.

16.38 A returned `Blob` MUST be range-aware: abide MUST read `Range`, honour `If-Range` against the
ETag it derives, and answer 206, 416 and 304 as the protocol requires.

16.39 A handler MAY return a `Response`, and an in-process caller MUST receive it unconverted.

16.40 Where a handler returns a `Response`, `clients.mcp` and `clients.cli` MUST default to false.

16.41 A second reader of a returned `Response` in one scope MUST be teed, bounded by
`ABIDE_MAX_STREAM_BUFFER_SIZE`.

16.42 A mutation MUST answer a request preferring `text/html` as a navigation: a returned
`redirect` passes through, a returned value becomes 303 back to the referrer, and a failure renders
`error.abide` at its own status.

16.43 A handler whose return type carries a `Reactive` MUST be a compile error naming the read.
See D60.

16.44 A `Failed` escaping a handler MUST be answered at its own `status`.

16.45 A throw that is not a `Failed` MUST be answered 500. See D75.

16.46 `rpc.raw` MUST issue the call the `Rpc` issues, differing only in handing back the
`Response`. See D76.

16.47 An `Rpc` call MUST evaluate its `Args` at the call, and MUST NOT re-evaluate them.

16.48 A jsonl answer MUST write one JSON value per line, per pull.

16.49 An sse answer MUST frame each value as `data: <json>` followed by a blank line, with
`text/event-stream`, `no-cache` and `X-Accel-Buffering: no`.

16.50 A stream of value chunks MUST admit jsonl and then sse, and a stream of binary chunks MUST
admit `application/octet-stream` alone.

16.51 Where no handler fixed the framing, the chunk type MUST be read from the first chunk
produced.

16.52 An `Rpc` over a `Channel` MUST frame each message with the sequence number and the epoch
18.10 and 18.11 mint, on the wire and in the seed buffer alike. See D93.

16.53 An sse answer over a `Channel` MUST carry that sequence number as `id:`, and a moved epoch
as `event: reset`.

16.54 `Last-Event-ID` MUST be read as the last sequence number a reconnect carries, per 18.13.

# 17. Response helpers

17.1 Every body helper MUST take `Values<T>`.

17.2 `page` MUST be defined as a write through `response` naming `text/html`, and MUST take what
a render produced rather than perform the render.

17.3 *Withdrawn, superseded by 16.32.* It read "`json` MUST serialize and tag
`application/json`, and MUST send `null` where the value is `undefined`", which answered one
value two ways: a returned `undefined` is 204 under 16.33, and the helper made it `null`.

17.4 *Withdrawn, superseded by 16.48.* It read as 16.48 does, over a helper rather than over
the answer the return type already framed.

17.5 *Withdrawn, superseded by 16.49.* It read as 16.49 does, and let a handler hard-code the
framing 16.34 has the caller negotiate.

17.6 `redirect` MUST be defined as a write through `response` carrying a `RedirectStatus`,
defaulting to 302.

17.7 *Withdrawn, superseded by 15.6.* It read "`refuse` MUST throw, and MUST be declared
`never`", which put two opposite disciplines under one prefix — the declared refusal returned,
the undeclared one thrown.

17.8 `refuse` on a server MUST hand back, per 15.6, the undeclared `Failed` named `HttpError` at
the given status. See D63.

17.9 `refuse` MUST carry no data, and MUST NOT take an options bag for any. See D18.

17.10 `jsonl`, `sse` and `bytes` MUST each be defined as a write through `response` fixing the
framing of a streaming answer. See D92.

17.11 An implementation MUST NOT negotiate past a framing a handler fixed.

# 18. Sockets

18.1 A `Socket` MUST hand back the same `Room` a `channel` invokes to.

18.2 Every `Socket` MUST be carried over a single web socket mux.

18.3 An upgrade MUST pass the `socket` lane's `middleware`.

18.4 A `SocketEvent` rung MUST refuse by throwing.

18.5 `crossOrigin` on a `socket` MUST be closed unless declared.

18.6 `clientPublish` MUST default to false.

18.7 `clientPublish` MUST gate this transport alone. See D19.

18.8 A `transform` MUST still run on a publish `clientPublish` admits.

18.9 `SocketOptions` MUST carry no schema, per 16.28.

18.10 Every `Message` MUST carry a sequence number, monotonic per `Room` and minted at publish.

18.11 A `Room` MUST carry the epoch 9.21 mints, and an implementation MUST compare epochs for
equality rather than for order.

18.12 The sequence number and the epoch MUST be internal, and an app MUST NOT write either.

18.13 A reconnect to a `Room` MUST carry the last sequence number rendered and compare epochs.

18.14 A moved epoch MUST deliver the ring marked as a reset.

18.15 A block receiving a reset MUST clear its accumulated rows and repaint from the ring.

18.16 The sequence number MUST be the default key of a `{#for await}` block whose source is a `Room`.

18.17 *Withdrawn, superseded by 20.2.* It read "`clients` on a `socket` MUST omit the `openapi`
key", which withheld an option from one producer rather than letting it stand inert there, and made
`Clients` two types to do it.

# 19. Mount paths and schemas

19.1 A handler declared with `socket` MUST be mounted as 16.2 mounts one declared over http.

19.2 A mount path MUST be owned by exactly one handler, and a collision MUST be a build error
naming both files that declared a `GET` or a `socket` there.

19.3 A `Schema` MUST return what it accepts.

19.4 An implementation MUST NOT accept a predicate as a `Schema`. See D20.

19.5 The plain-function `Schema` form MUST throw what it refuses, and that throw MUST be caught where
the schema runs and become the `''` entry of `Issues<T>`.

19.6 *Withdrawn, superseded by REGISTRY's `Issues<T>` row.* It read "`Issues<T>` MUST be keyed by
path on a composite, and MUST be a bare list on a primitive", which is that row's conditional type.

19.7 `Paths<T>` MUST be dot-joined, MUST be depth-limited, and MUST widen to `string` past the limit.

19.8 Coercion MUST belong to the pipeline, and MUST NOT be asked of a `Schema`. See D21.

19.9 A `GET` or `DELETE`'s text args MUST be coerced from the type the `JsonSchema` declares, before
validation.

19.10 Coercion MUST happen at the `ctx.args()` that first asks, and every rung after it MUST see the
coerced value.

19.11 Where no `schema` is given it MUST be derived from the type annotation and the argument
defaults.

19.12 A default MUST make a member optional, and a defaulted parameter MUST make `Args` itself
optional.

19.13 Where inference fails the compiler MUST read rather than refuse the file, and the derived
`Schema` MUST widen. See D22.

19.14 *Withdrawn, superseded by REGISTRY's `Args` rows.* It read "`JsonValue` MUST bound what an
`Args` may hold", which is what every `Args` row's type says.

19.15 *Withdrawn, superseded by REGISTRY's `validateJson` row.* It read "`validateJson` MUST hand
back `Issues<T>`, or `null` where the value matches", which is that row's return type.

# 20. Generated surfaces

20.1 Every surface `Clients` names MUST be derived from the route table, and MUST NOT be authored
beside it.

20.2 Every key of `Clients` MUST default to true. See D96.

20.3 `Clients` MUST decide what is generated and listed, and MUST NOT decide who may call. See D23.

20.4 `ui: false` MUST generate no client wrapper, and importing that handler from `#ui` or a `.abide`
file MUST then be the compile error 16.31 states.

20.5 `/__abide/openapi.json` and `/__abide/mcp` MUST be served from a `memo` over the route table,
and MUST take no `ttl`.

20.6 `/__abide/openapi.json` MUST publish OpenAPI 3.1, and MUST publish a handler's `JsonSchema`
with no translation.

20.7 `/__abide/openapi.json` MUST be gated by `ABIDE_OPENAPI` and `/__abide/mcp` by `ABIDE_MCP`.
What a closed one answers is 36.7.

20.8 Every `/__abide/**` address MUST run inside the app's own middleware. See D62.

20.9 `/__abide/mcp` MUST publish a handler that reads as a tool and a resource according to which
arm `GET` took, and MUST NOT require a flag to tell them apart.

20.10 A handler whose own `Middleware` rung would refuse a caller MUST still be listed, and MUST
still be refused on the call.

20.11 `/__abide/openapi.json` MUST publish a `Schema`'s own JSON Schema where it has one, probing
one spelling for it, and MUST publish the type-derived `JsonSchema` where it has none. See D34.

# 21. Generated headers

21.1 Every response MUST carry `x-content-type-options: nosniff`.

21.2 Every response MUST carry `traceresponse`, a refusal included.

21.3 A page, an rpc answer and a refusal MUST default to `cache-control: private, no-store`.

21.4 *Withdrawn, superseded by 21.11.* It read "a handler's own `ResponseInit` MUST override that
default", and a `ResponseInit` on a helper is the write through `response` 21.11 governs.

21.5 `/__abide/health` and `/__abide/principal` MUST answer `cache-control: no-store`.

21.6 The built bundle MUST answer `cache-control: public, max-age=31536000, immutable`.

21.7 A page MUST carry `referrer-policy: strict-origin-when-cross-origin`.

21.8 An answer that depends on a request header MUST carry `vary` naming it.

21.9 A `GET` over a `global` `memo` MUST answer a `max-age` derived from that memo's `ttl`, and an
app MUST NOT be required to state the duration a second time. See D72.

21.10 A `GET` over a `global` `memo` MUST answer `private`.

21.11 A write through `response` MUST override the default 21.3 states.

21.12 The `max-age` 21.9 derives MUST replace 21.3's `no-store`, and 21.3 MUST decide the rest
of that header. See D72.

21.13 A file under `src/ui/public` MUST answer `cache-control: public, max-age=0, must-revalidate`.
See D98.

21.14 A file under `src/ui/public` MUST answer an `etag` derived from its bytes.

21.15 A request whose `if-none-match` matches the `etag` 21.14 derives MUST be answered 304.

# 22. Request-scoped ambients

22.1 `request`, `response` and `server` MUST throw outside a request.

22.2 *Withdrawn, superseded by 11.34.* It read "a key `Bag` declares MUST be typed by it, and
an undeclared key MUST be permitted", which gave a per-request value a second home: an untyped
record beside the request-local `memo` that already holds one, carrying no probe and no trigger.

22.3 `cookies` MUST be isomorphic, and on a server writes MUST be collected onto the response.

22.4 A cookie's `secure` MUST default from `NODE_ENV`.

22.5 *Withdrawn, superseded by 22.3.* It read "`cookies` MUST state its asymmetries between the two
sides rather than smooth them over", which named no observable and no side, so two implementations
could satisfy it and disagree. The asymmetries themselves are 22.3, 22.8, 22.9 and 22.10, and the
writing rule is BRAND's "Name the cost".

22.6 A read of a cookie by name MUST track that name. See D58.

22.7 A write through `cookies` MUST wake the readers of that name alone.

22.8 Where the browser reports cookie changes, a change made outside `cookies` MUST wake the readers
of that name.

22.9 Where the browser does not report them, a change made outside `cookies` MUST wake nothing.

22.10 `cookies` MUST throw outside a request on a server.

22.11 A write through `response` MUST be collected onto the response being built for the request
being served. See D89.

# 23. Route and connectivity

23.1 Each member of `route` MUST be its own `Reactive`, and `route` MUST NOT be one `Reactive` over a
composite. See D24.

23.2 `route.url` MUST be one `URL` instance per navigation, built when the route resolves.

23.3 A page route MUST be created where a `page.abide` file lies under `src/ui/pages`.

23.4 A page route's file path MUST determine its `route.url`.

23.5 `Params` MUST carry what `[param]`, `[[optional]]` and `[...rest]` matched.

23.6 `route.name` MUST be the resolution path.

23.7 In a browser `online` MUST be `navigator.onLine` and its events.

23.8 On a server `online` MUST be true.

# 24. Tracing

24.1 `trace` MUST be built on first ask and held for the request.

24.2 `trace.sampled` MUST carry the caller's sampling decision verbatim.

24.3 *Withdrawn, superseded by REGISTRY's `trace.span` row.* It read "`trace.span` MUST hand back
exactly what its body returned", which is what that row's `<T>(name, body: () => T) => T` says.

24.4 A span MUST be a `LogRecord`, and MUST NOT be a second feed.

24.5 A span MUST carry `startedAt` as ISO-8601 and its duration as a monotonic measurement.

24.6 `trace.headers` MUST carry `traceparent` naming the current span as parent.

# 25. Health

25.1 `GET /__abide/health` MUST answer `Health` over http.

25.2 *Withdrawn, superseded by 20.8.* It read "`GET /__abide/health` MUST be answered outside
the middleware, and MUST therefore be unauthenticated", which made one address a lane of its own
and decided an app's authorization for it.

25.3 An app's own `onHealth` fields MUST win every collision. See D25.

25.4 *Withdrawn, superseded by REGISTRY's `Health` row.* It read "`Health` MUST carry `version`,
`abide` and `startedAt`, and `version` MUST be empty rather than absent", which is that row's three
required `string` members.

25.5 `health` MUST be seeded per 41.6.

# 26. Principal

26.1 Each member of `principal` MUST be its own `Reactive`, per 23.1.

26.2 The identity members of `principal` MUST share one resolve per request.

26.3 A caller carrying `principal.error` MUST NOT be authenticated.

26.4 The baseline MUST win every collision in `Principal`. See D25.

26.5 `principal.caller` MUST be read off its own cookie or minted, and MUST need no resolution.

26.6 `principal.caller` MUST survive a sign-in.

26.7 `principal.caller` MUST NOT survive a sign-out, and `principal.clear` MUST rotate it.

26.8 `principal.set` MUST NOT rotate `principal.caller`.

26.9 `principal.clear` MUST sign the caller out for the rest of this request as well as the next.

26.10 `Principal` MUST never be null, and an anonymous visitor MUST be `authenticated` false.

26.11 *Withdrawn, superseded by 20.8.* It read "`GET /__abide/principal` MUST be open and MUST
answer `no-store`", which decided an app's authorization for one address the way 25.2 did for its
sibling, and restated 21.5 to do it.

26.12 The `principal` seal MUST be an HMAC over the claims and their expiry, and MUST be signed
rather than encrypted.

26.13 The principal cookie MUST be set `HttpOnly` and `SameSite=Lax`, and `Secure` in production.

26.14 A bad signature, a lapsed seal and a malformed cookie MUST be one answer: `principal` reports
an anonymous caller.

26.15 A `principal` MUST be resolved at most once per request.

26.16 A `principal` seal MUST be refreshed once half spent.

26.17 An implementation MUST keep no server-side principal store and no revocation list. See D26.

26.18 `principal` MUST be seeded per 41.6.

26.19 The cookie the `principal` seal is carried in MUST be named `abide-principal`.

26.20 The cookie `principal.caller` is read from MUST be named `abide-caller`.

26.21 `principal.set` MUST throw where the sealed cookie would exceed the browser's cookie ceiling,
naming the byte count.

26.22 `principal.set` MUST throw once the response headers are out.

26.23 `principal.caller` MUST throw in a browser. See D83.

# 27. Configuration

27.1 *Withdrawn, superseded by REGISTRY's `Config` row.* It read "every field of `Env` MUST be
present in `Config`", which is what that row's type says.

27.2 `config` MUST throw what `onConfig` threw.

27.3 Precedence MUST be derived, then `config` from the app, then the environment.

27.4 `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` MUST be derived where the config does not carry
them.

27.5 `ConfigDefaults` MUST be synchronous by contract.

27.6 `config.invalidate` MUST re-read the environment and re-run `onConfig`.

27.7 A second `onConfig` MUST replace the first, its schema included, and MUST warn on
`abide:config`.

27.8 The `config` `schema` MUST be checked last, over the whole document.

27.9 A value out of `Env` MUST be coerced to the type of the default it overrides, and a value that
will not coerce MUST keep that default.

27.10 `config` MUST be an unkeyed `global` `memo` over the precedence 27.3 states. See D52.

# 28. Logging

28.1 Every line MUST be published to `log.records`, which MUST be an ordinary `Room`.

28.2 `log` MUST always write.

28.3 `log.warning` and `log.error` MUST always write.

28.4 `log.channel` MUST prefix the app name, and calling it again MUST append another segment.

28.5 A `Logger` MUST carry the same levels and the same `log.enabled` as `log`.

28.6 `log.enabled` MUST answer whether a gated line on that channel would be written.

28.7 A channel `log.enabled` reports closed MUST NOT run the measurement a gated line would report.
See D27.

28.8 *Withdrawn, superseded by REGISTRY's `LogRecord` row.* It read "a `LogRecord` MUST carry the
time, the level, the channel, the message and the trace", which is that row's five members.

28.9 A correctness or a configuration failure MUST report on a channel `abide:` names.

28.10 `DEBUG` MUST gate named channels in debug-npm grammar, and MUST be read from the environment
on a server.

28.11 `DEBUG` MUST reach a browser through the document rather than through the bundle.

28.12 A browser's own stored `DEBUG` setting MUST answer only where the document carries none, and
MUST NOT override it.

# 29. Content security policy

29.1 `csp` MUST be one `Middleware` rung.

29.2 `csp` MUST set `content-security-policy` on `text/html` only.

29.3 `csp.nonce` MUST be this response's nonce.

29.4 `csp.nonce` MUST be readable only inside a request scope, per 11.39.

29.5 The `csp` baseline MUST be `default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
`img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`, `style-src-attr 'unsafe-inline'`,
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` and `form-action 'self'`.

29.6 `sources` MUST replace a directive rather than add to it.

29.7 A directive given an empty array in `sources` MUST be dropped.

29.8 A directive name the `csp` baseline lacks MUST be added.

29.9 The inline output `render` emits MUST be permitted by a build-time hash in `script-src`, and
MUST NOT consume `csp.nonce`. See D81.

29.10 The inline output `render` emits MUST be byte-invariant across responses.

# 30. Addresses and navigation

30.1 `url` MUST build an address from a route literal.

30.2 `url` MUST require a params argument where the literal carries a required segment, and MUST
make it optional otherwise.

30.3 A required segment MUST map to a required key of `ParamsOf<P>`.

30.4 An `OptionalNames<P>` segment MUST map to an optional key, and leaving one out MUST omit that
segment.

30.5 A `RestNames<P>` segment MUST map to an optional key taking an array as well as a scalar.

30.6 The `Query` argument MUST be last.

30.7 `navigate` MUST navigate, and MUST NOT reload the document.

# 31. Reading and writing by name

31.1 Inside a `.abide` file a name bound to a `Reactive` MUST be read where it appears in an operand,
in text, in an attribute, or in a value-typed argument.

31.2 A read by name MUST be live.

31.3 A name MUST hold the `Reactive` in a binding, in a return, and in a `Reactive`-typed argument
position. See D28.

31.4 Assigning a `Reactive` to such a name MUST be a compile error naming both repairs.

31.5 Assignment to such a name MUST be a write, and the assigned value MAY be settled or a load.

31.6 *Withdrawn, superseded by 31.11.* It required the copy-on-write 31.11 requires, over "a path"
rather than a member path, and without the no-elision half.

31.7 A property access on such a name MUST reach the value, and MUST NOT reach the `Reactive` API.

31.8 A call on such a name MUST reach the `Reactive` API where the member is one of its own, and the
value's method otherwise.

31.9 `s` and `s.set` MUST keep compiling inside a `.abide` file.

31.10 Reads inside one `{await expr}` MUST be started before they are awaited.

31.11 A write through a member path MUST copy down that path and then write, and the copy MUST NOT
be optimised away. See D35.

31.12 A property access on a name bound to a `Reactive` MUST short-circuit where nothing has landed,
and the rest of the chain MUST short-circuit with it. See D78.

31.13 A read inside an `{await expr}` operand that is not definitely evaluated MUST lower in place,
and MUST NOT join the set 31.10 starts. See D79.

31.14 A mutator lifted per 31.11 MUST be resolved from the type of the `Reactive` rather than from
the member name. See D80.

31.15 A template-local binding MUST shadow a name bound to a `Reactive` for the body it is bound in.

31.16 A read spelled `foo()` MUST take no arguments, and an argument MUST be a compile error.

# 32. Templating

32.1 `{expr}` MUST render reactive text, escaped.

32.2 `{await expr}` MUST block rendering until the expression resolves, and MUST govern the whole
expression.

32.3 `{raw(...)}` MUST render raw HTML.

32.4 A `name={expr}` attribute or property expression MUST be reactive, whole or interpolated.

32.5 `on<event>` MUST bind a native listener on an element, and MUST be an ordinary prop on a
component.

32.6 `bind:value` MUST read the property and write it back on input or change.

32.7 `bind:prop` on a component MUST add the write path to a prop that already reads live.

32.8 A boolean bind MUST mirror a boolean DOM property as a boolean attribute, and MUST NOT write a
string.

32.9 `bind:group` MUST compare against the input's own value, and MUST NOT emit a `group` attribute.

32.10 `bind:element` MUST accept a `Reactive` of an element, or a callback returning an optional
`Disposer`.

32.11 `class:name` and `style:prop` MUST set one class or one style property.

32.12 `{...expr}` MUST spread props on a component and attributes on an element.

32.13 `{#if}` and `{#switch}` MUST render one branch.

32.14 `{#await}` without `then` MUST render its body while pending, and its binding MUST be live.

32.15 `{#await ... then value}` MUST await before rendering, and over a stream MUST await the close.

32.16 `{#for}` without a key MUST be positional.

32.17 `{#for}` without a key over a stateful body MUST warn in development.

32.18 `{#for await}` MUST accept a source that names its own replay depth.

32.19 `{#try}` MUST be a render-time boundary over a region, and a failure MUST replace the whole
body.

32.20 An inline `{#component Name(pattern)}` MUST be TitleCase.

32.21 A capitalised tag `<Name/>` MUST be a component invocation.

32.22 `<slot/>` MUST render children, and a fallback MUST render where none were passed.

32.23 An interpolated `style` attribute MUST lower to `style:prop` under a static property name, and
MUST NOT be built as a string. See D36.

32.24 An interpolation in a URL-typed attribute MUST be scheme-checked, and a scheme outside
`http:`, `https:`, `mailto:`, `tel:` or a relative reference MUST be dropped and warned on
`abide:render`.

32.25 A control block MUST bind each reactive read and probe call in its subject once for the body.

32.26 `{#for}` and `{#for await}` over an absent subject MUST iterate zero times. See D78.

# 33. Props

33.1 `props` MUST be callable from a `<script>` block only, and calling it from a `<script module>`
block MUST be a compile error.

33.2 A component with no `props` call MUST accept no props of its own, and a caller passing one
MUST be an error.

33.3 `props` with no type argument MUST hand back an untyped record, which is the opt-out.

33.4 `props` MUST hand back one accessor per key, and the accessor's shape MUST be what that key's
type declares.

33.5 A prop declared as a plain type MUST be a live read of the caller's expression, and MUST NOT
be a snapshot.

33.6 A prop declared as a plain type MUST have no `Reactive` face at all, rather than a `Reactive`
without its write.

33.7 A prop declared as a `Reactive` MUST be the caller's own `Reactive`, passed through unchanged.

33.8 A child declaring a `Reactive` prop MUST make `bind:` a compile requirement at every call
site.

33.9 Destructuring `props` MUST keep every binding live.

33.10 The `props` lowering MUST be type-directed: a declared prop type with no index signature MUST give a
fixed accessor per key, whatever the call site spelled.

33.11 A prop type carrying an index signature MUST take the dynamic form, where a spread is one
live read with its keys enumerated per read.

33.12 An explicit prop MUST beat a `{...expr}` spread, whatever the source order.

33.13 Two `{...expr}` spreads against each other MUST resolve in source order.

33.14 The `props` pattern MUST be flat: renames, defaults and a rest element, and no nested
patterns.

33.15 A `props` rest element MUST be live, one accessor per key the call site passed.

33.16 `children` MUST always be accepted and MUST never be declared.

33.17 In a `.abide` template a run of whitespace carrying newlines but no space or tab MUST be
dropped wherever it stands.

33.18 In a `.abide` template a run of whitespace that renders nothing but carries a newline and
indentation MUST be dropped at both ends of every block body and of the top-level template.

# 34. Script and style blocks

34.1 A `<script>` block MUST be per-instance component setup.

34.2 A `<script module>` block MUST be request-local on a server and process-wide in a browser.

34.3 A `<style>` block MUST be component-scoped: every root element MUST carry a scope token, and
every selector MUST require it on its rightmost compound.

34.4 `:global(…)` MUST exempt the compound inside it from carrying the scope token.

34.5 A stylesheet imported from any `<script>` in the file, or any `.ts` it reaches, MUST be a
dependency of that component.

34.6 A component scope the document never linked MUST reach the page through
`document.adoptedStyleSheets`. See D82.

34.7 An implementation MUST NOT provide a fallback for `document.adoptedStyleSheets`.

# 35. Pages, rendering and sinks

35.1 A `src/ui/pages/**/layout.abide` MUST render its child page through a slot.

35.2 A `src/ui/pages/**/error.abide` MUST be resolved nearest-ancestor, as a layout is.

35.3 An `error.abide` that itself fails MUST escalate past the boundary, and MUST warn on
`abide:render`.

35.4 `render` MUST take a `Component` already bound to its props.

35.5 `render` MUST produce a document as an async generator of bytes.

35.6 A `Shell` MUST default to `src/ui/app.html`.

35.7 A sink MUST be an addressable hole in the output stream that a value still in flight fills
later.

35.8 An attribute a sink fills MUST be filled on the element itself.

35.9 A sink inside RCDATA MUST fill through the element's own property rather than through markup.

35.10 The batching unit of a sink fill MUST be the flush and MUST NOT be the production. See D37.

# 36. Environment and files

36.1 `PORT` MUST default to 3000, and a command's own port flag MUST override it by declaring it.

36.2 `APP_URL`'s origin MUST be what both origin gates compare against.

36.3 `NODE_ENV` MUST be read verbatim, and MUST be defaulted from the command where unset.

36.4 `APP_DATA_DIR` MUST be a path, and abide MUST NOT create it.

36.5 `ABIDE_PRINCIPAL_SECRET` MUST accept a comma-separated list.

36.6 `ABIDE_APP_TOKEN` and `ABIDE_APP_URL` MUST be read by the remote CLI only.

36.7 `ABIDE_LOGS`, `ABIDE_OPENAPI` and `ABIDE_MCP` MUST each be closed by default, and a closed one
MUST answer 404.

36.8 `ABIDE_LOG_FORMAT` unset MUST follow the TTY.

36.9 *Withdrawn, superseded by 28.10 and 28.12.* It restated both, and omitted 28.12's precedence:
read alone it let a browser's stored setting override a document that carries one.

36.10 `NO_COLOR` MUST beat `FORCE_COLOR`.

36.11 `#server`, `#ui` and `#shared` MUST be the seams the source is split by.

36.12 A file under `src/ui/public` MUST be answered at its path below that directory, rooted at the
mount rather than at the origin. See D99.

36.13 A file under `src/ui/public` MUST be answered with the bytes as authored.

36.14 A `src/ui/public` path resolving to the address of a page route MUST be a build error naming
both.

36.15 A file under `src/ui/public` MUST carry a `content-type` derived from its extension.

# 37. Lifecycle hooks

37.1 A lifecycle hook MUST be called rather than exported, and `src/server/app.ts` MUST be optional.

37.2 The `default` export MUST be the app's own route, answering where it returns a `Response`.

37.3 `middleware` MUST run pre-routing, over the request and the response.

37.4 `onStart` MUST wrap `createApp` and `onStop` MUST wrap `App.stop`. See D100.

37.5 `onError` MUST run on an unexpected error in that scope.

37.6 A hook `onStart` or `onStop` wraps that throws MUST fail hard, and the server MUST NOT
start.

37.7 `onConfig` and `onPrincipal` MUST replace rather than compose, and a second MUST warn.

# 38. Commands

38.1 `abide scaffold` MUST write a starter project, and MUST skip a step already done.

38.2 `abide run` MUST pass everything after the file to the script.

38.3 `abide check` MUST report every diagnostic on the `.abide` line.

38.4 `abide dev` MUST watch the project and keep the app up.

38.5 `abide build` MUST emit content-hashed chunks and a manifest, minified and precompressed.

38.6 `abide start` MUST boot what `abide build` produced.

38.7 `abide connect` MUST boot nothing.

38.8 `abide call` MUST be the one spelling for calling a handler, in argv and in the shell alike.

38.9 `abide openapi` and `abide mcp` MUST derive from the same route table the served surfaces do,
per 20.1.

38.10 `abide logs` MUST be `abide call` over `log.records`.

38.11 `abide compile` and `abide bundle` MUST produce a standalone artifact.

38.12 `abide lsp` MUST speak over stdio.

38.13 Asking `abide` for help MUST be a success, and an unknown command MUST NOT be.

38.14 `abide mcp` MUST be a bridge a model client spawns and kills, and `abide start` MUST NOT be
put in that position. See D38.

38.15 `abide dev` MUST hold the app in a worker and keep the listener on the main thread.

38.16 `abide dev` MUST replace that worker to reload, and MUST force-close every live socket on
replacement.

38.17 `abide dev` MUST build the client into memory, unminified and entry-named by its source, and
MUST write nothing to disk.

38.18 A client build that fails under `abide dev` MUST NOT stop the server, and the reload client
MUST be served by the dev worker rather than out of the bundle.

38.19 `abide build` MUST copy `src/ui/public` into the built output, and each file MUST be listed in
the manifest 38.5 emits.

38.20 `abide dev` MUST answer a file under `src/ui/public` out of the source tree, per 38.17.

# 39. Head and view transitions

39.1 A `<head>` element in a `.abide` file MUST contribute its children to the document head.

39.2 A `<head>` element MUST be top level, and MUST NOT appear inside a control block.

39.3 The build MUST hoist `<head>` contributions at compile time.

39.4 `<head>` contributions MUST be merged by key, and the deepest contributor MUST win.

39.5 A `<head>` contribution with no merge key MUST append in tree order.

39.6 Nothing in a `<head>` MUST hold the flush by default, and holding MUST be opt-in and spelled
as it is anywhere else.

39.7 On a client navigation the incoming page's keyed `<head>` contributions MUST replace the
outgoing page's by key, and a layout's MUST NOT move.

39.8 View transitions MUST be turned on by a `<style>` rule naming a view-transition selector or
property, and MUST NOT be turned on by a separate option.

39.9 Whether an app uses view transitions MUST be decided at build time from the compiled `<style>`
blocks, and MUST NOT be decided by a runtime walk of the document's stylesheets.

39.10 A `view-transition-name` transition MUST be awaited to the point the DOM is written, and MUST
NOT be awaited to the end of the animation.

39.11 A browser with no `view-transition-name` support MUST navigate as it otherwise would, and an
app MUST NOT be required to feature-detect.

# 40. Documentation

*Free-standing: these clauses govern the documentation system, which REGISTRY does not name — a
`{% snippet %}` is not something an app writes.*

40.1 The documentation site MUST be the package at `packages/dogfood`.

40.2 Every name REGISTRY carries MUST be documented against real `.abide` and `.ts` files.

40.3 Every `{% example %}` directory SHOULD carry a bench and an end-to-end spec.

40.4 *Withdrawn, superseded by 40.23 and 40.24.* It read "a page MUST embed at most one
`{% example %}`, and that example MUST be one problem needing everything the page teaches", which
made the size of an example a function of how many names the page claimed rather than of what the
example demonstrates.

40.5 A file in an `{% example %}` directory that is not part of the problem its summary names MUST
NOT be there.

40.6 *Withdrawn, superseded by 40.23.* It read "where a subheading needs code the `{% example %}`
does not have, the repair MUST be another file in that directory and MUST NOT be a second
example", which is the repair 40.4 forced and leaves with it.

40.7 `{% example %}` MUST render the example directory as the running page above a tab per artifact
it has, and the render MUST NOT be one of those tabs.

40.8 `{% snippet %}` MUST be how a page shows code from an example, in place of pasting it into a
fence.

40.9 A `{% snippet %}` anchor MUST be a line prefix matching exactly once, and the slice MUST run to the end
of the construct it opens.

40.10 Several `{% snippet %}` anchors separated by an elision MUST render as one fence in file
order, with the gap marked rather than closed.

40.11 A `{% snippet %}`'s caption, language and spine MUST be derived from its address.

40.12 A `{% snippet %}` anchor matching none or matching two MUST be a build failure.

40.13 A panel an `{% example %}` has no artifact for MUST NOT be rendered.

40.14 The hand-written arm an `{% example %}` carries MUST NOT be a panel.

40.15 *Withdrawn, superseded by 40.21.* It read "anything an example renders that its own files do
not produce MUST be inside a tip", which stopped being sayable when the frame began running the
hand-written arm: the arm is not the `files/` the panel shows, and the instrumentation moved out of
the frame rather than into a tip.

40.16 A page MUST declare in `covers` which REGISTRY names it covers, and an overview or a reference
page MUST declare none.

40.17 Every name `covers` may claim MUST be claimed by exactly one page.

40.18 The voice, the vocabulary and the register of a title against a nav label MUST be
`docs/BRAND.md`'s, and MUST NOT be stated here.

40.19 An `{% example %}` MUST run its hand-written arm, and MUST NOT run a scripted stand-in for
one. See D40.

40.20 The network an `{% example %}` arm talks to MUST be that example's own wire fixture or the
hand-written server its manifest names, and a request neither answers MUST be reported in the frame
rather than left to hang. See D77.

40.21 Instrumentation the documentation adds to an `{% example %}` MUST sit outside the render.

40.22 Two wire fixtures an `{% example %}` arm's request cannot be told apart by MUST be a build
failure.

40.23 A page MUST embed one `{% example %}` per behaviour it teaches.

40.24 An `{% example %}` MUST demonstrate exactly one behaviour.

40.25 *Withdrawn, superseded by 40.32.* It read "an `{% example %}` whose behaviour is a claim
about work MUST render the count of that work", and what it required was bookkeeping in the source
a reader came to read — a counter per claim, declared, incremented and rendered. See D45.

40.26 A readout an `{% example %}` arm renders MUST be one that example's own source names.

40.27 An `{% example %}` directory MUST be embedded by exactly one page declaring `covers`. See D41.

40.28 An `{% example %}` MUST model a pattern from an app `docs/BRAND.md` names. See D42.

40.29 Every `{% example %}` a page embeds MUST be drawn from the same app.

40.30 A control an `{% example %}` renders MUST sit with the value it changes.

40.31 An `{% example %}` MUST prove the heading it sits under. See D44.

40.32 An `{% example %}` MUST NOT carry code its proof does not need. See D45.

40.33 The capability an `{% example %}` proves MUST be one the app it is drawn from would reach
for.

40.34 A heading that carries an `{% example %}` MUST be followed by it, with nothing between
them. See D46.

40.35 An `{% example %}`'s summary MUST state the situation it is in, and MUST NOT restate the
heading.

40.36 A comment in an `{% example %}`'s own source MUST fit on one line, and a reason longer than
that MUST go in the copy after the card. See D47.

40.37 A page's lead MUST read standalone, being what a section overview shows for that page, and
MUST NOT carry a relative link.

40.38 A page whose `covers` names one REGISTRY entry SHOULD open on a section giving that entry's
forms, the options they share, and a link to its reference page.

# 41. Rendering and hydration

41.1 `render` MUST flush the `<head>` as soon as it is known.

41.2 A render MUST start every asynchronous read up front and in parallel. See D70.

41.3 `render` MUST NOT be held for an unfinished stream: what the stream produced MUST go out
inline, and the rest MUST be picked up by the client's own request.

41.4 A render MUST continue past a value still in flight, opening the sink 3.4 opens.

41.5 A flush MUST wait for a sink a template asked to block on, and MUST NOT hold document
generation for it.

41.6 Data MUST reach a browser by answering that browser's own `Rpc` call from the seed buffer, and
a document MUST NOT carry a copy of an answer. See D39.

41.7 Hydration MUST re-execute setup: every `<script>`, every `state` and every `memo` body runs
again, and a serialized setup result MUST NOT be adopted.

41.8 The `Rpc` calls that re-execution makes MUST be answered from the seed buffer.

41.9 A `{#for await}` block the server already painted MUST be reconciled against the replayed
productions by the block's key, and MUST NOT be appended to.

41.10 `render` MUST emit markers rather than a tree to diff, and the client MUST walk the marker
list the document carried rather than the DOM.

41.11 A hydration mismatch MUST rebuild the enclosing block and MUST NOT rebuild the page, warning
on `abide:hydrate`.

41.12 A shared `layout.abide` MUST NOT be rebuilt between navigations.

41.13 An `Rpc` call re-execution makes that the seed buffer cannot answer MUST be a hydration
mismatch, per 41.11. See D73.

41.14 The seed buffer MUST be filled from the production the render already had, and a handler
MUST NOT be run a second time to fill it. See D94.

# 42. The app object

42.1 `createApp` MUST build the route table and compose every onion, per 16.15.

42.2 `createApp` MUST read `config` where it builds the app, and MUST NOT leave that read to the
first request.

42.3 `createApp` MUST NOT bind a socket.

42.4 A hook `onStart` wraps MUST NOT observe the port. See D100.

42.5 `App.fetch` MUST answer a `Request` where no socket is bound. See D98.

42.6 `App.fetch` MUST be `App.run` with dispatch over it, and MUST NOT be a second scope
constructor.

42.7 `App.run` MUST run its function in one scope, and MUST hand back what that function returned.

42.8 A `Request` on `App.run` MUST be optional, and a scope made without one MUST be the scope 22.1
and 22.10 throw in.

42.9 `App.listen` MUST be where the socket is bound, and MUST be what supplies `server`.

42.10 `App.stop` MUST stop accepting and drain what is in flight before `onStop` runs.

42.11 `App.stop` MUST end every live stream, close every open socket, and clear every timer the app
holds.

42.12 A second `App` in one process MUST share the first's rooms, `config` and `global` entries, per
9.18, 27.10 and 11.36.

42.13 A test MUST reach a handler through the same `App` a host holds, and abide MUST NOT generate a
client of its own for one. See D99.
