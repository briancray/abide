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
7. **A clause states what holds today.** A rule that stops holding is deleted, and the clauses
   after it close the gap — every citation of a number is swept in the same change.

## Terms

A term below is a category the clauses are written over. It is defined here rather than in
REGISTRY.md because none of them is a name an app author writes.

| Term | Definition |
| --- | --- |
| read | A call to `s` or to `s.peek`. |
| write | A call to `s.set` or to `s.patch`. |
| gated | A production the `identity` comparison may collapse: one `s.set` or a body mints, and not one `publish` does. |
| probe | Any of `s.busy`, `s.ready`, `s.error`. |
| trigger | `s.refresh` or `s.invalidate`. |
| producer | A source a value can ask for a value: a body, a `store`, or the connection a subscriber's copy is carried over. A `publish` is not one. |
| materialisation | The making of a `Stored` from what a producer has yielded. |
| production | One materialisation of a `Stored` that a reader may observe. |
| provisional | A body run that read a value which had not landed. |
| reader | An expression or effect that performed a read. |
| revalidation | A load started by `s.refresh` over a value still being served. |
| refusal | A `Failed` answered in place of a value. |
| wired | A `Reactive` a `socket` or an `Rpc` carries, at either end of the connection. |
| subscriber | A far end of a connection a wired `Reactive` is carried to. |
| version | The number one production of a `global` value a `GET` serves is named by on the wire. |
| namespace | The name a log line is written under, and what `DEBUG` selects. |
| ring | The productions retained under `history`. |
| entry | One key's slot in a `Keyed`. |
| scope | The lifetime a value is filed under and dropped with. |
| adoption | What a `reactive` body does with a `Reactive` it returned. |
| forwarding | The delegation between an adopting `Reactive` and the one it adopted. |
| propagation | The derivation of a probe from the values a body read. |
| sink | What 35.7 defines. |
| implementation | Anything claiming conformance to this document. |

RFC 2119 keywords are used as that document defines them: **MUST**, **MUST NOT**, **SHALL**,
**SHOULD**, **SHOULD NOT**, **MAY**.

# 1. The reactive value

1.1 Every producer in this design MUST hand back a `Reactive`.

1.2 `Produced` MUST be the unit the producer yielded: `Stored` for every producer but a streaming one,
and one chunk for a streaming producer.

1.3 `Failures` MUST be the union of the refusals the producer declared, and MUST carry the
validation refusal wherever a `schema` is declared, without the app declaring it.

1.4 A `Reactive` MUST be thenable.

1.5 `s.catch` and `s.finally` MUST derive from `s.then`.

1.6 Where a load is told apart from a value, a `Reactive` MUST be taken as a value.

1.7 Reaching a `Reactive` MUST start the work it is for, unless a window holds it back per 5.19.

1.8 Reaching a `Reactive` that already exists MUST join the standing work rather than start a
second.

# 2. Reads

2.1 A read MUST return what is held, and MUST NOT await.

2.2 A read MUST throw where a producer failed and no value has landed.

2.3 A rejected write MUST NOT cause a read to throw.

2.4 A failed revalidation MUST NOT cause a read to throw.

2.5 `s.history` MUST replay the retained snapshot and then continue live from where that snapshot
ended, with no gap and no repeat.

2.6 The argument to `s.history` MUST be replay depth alone, bounded above by what is retained.

2.7 `s[Symbol.asyncIterator]` MUST yield the production in flight from its start, and MUST then
continue live.

2.8 `s.then` MUST resolve with the value where `s.busy` becomes false and 2.2 would not throw.

2.9 `s.then` MUST reject with what 2.2 throws, where 2.2 would throw.

2.10 A read MUST throw `NotLanded` where nothing has landed and no producer has failed.

2.11 `s.peek` MUST return `undefined` where 2.10 would throw.

2.12 `s.peek` MUST NOT join the flow.

2.13 A `NotLanded` thrown into a tracked body MUST abort that body.

2.14 A body a `NotLanded` aborted MUST re-run when the value it names lands.

2.15 A `NotLanded` and a `Failed` MUST be distinguishable by brand.

# 3. Probes

3.1 A probe MUST NOT throw.

3.2 A probe MUST answer about the value a read would serve, running what that read would run, and
MUST NOT otherwise start work.

3.3 Reading a probe MUST subscribe to that probe alone.

3.4 A sink MUST be opened where `s.busy` is true and `s.ready` is false.

3.5 `s.ready` and `s.error` MUST be orthogonal: either MAY be true while the other is.

3.6 `s.ready` MUST NOT move for a load in flight.

3.7 A streaming producer MUST report `s.busy` true until the stream closes.

3.8 A streaming producer MUST report `s.ready` true from its first chunk.

3.9 A value with no producer MUST report `s.busy` false.

# 4. Writes and gates

4.1 `s.set` MUST accept a settled value or a load, and `reactive` MUST accept the same two.

4.2 A load given to either MUST make the `Reactive` loaded, at construction and at every write
alike.

4.3 Where a `schema` is declared it MUST run first, on the settled value.

4.4 What `schema` returns MUST be what `transform` receives.

4.5 A `schema` MUST refuse by throwing, and the throw MUST be caught and converted rather than
escape the write.

4.6 A `transform` MUST refuse by returning a `Failed` rather than by throwing, per 15.5.

4.7 A `transform` MUST run untracked, on the settled value, once per materialisation of a `Stored`.

4.8 A `transform` MUST NOT run on a promise, and MUST NOT run per chunk.

4.9 A refused write MUST store nothing and MUST mint no production.

4.10 A refused write MUST fill `s.error`, and MUST NOT reach a `{:catch}`.

4.11 An accepted write or production MUST clear the standing `s.error`.

4.12 A failed revalidation MUST leave the held value being served, and MUST warn on
`abide:reactive` naming the value.

4.13 `s.set` MUST take the `Accepted` its factory declared, and a `Reactive` MUST carry that
`Accepted` wherever it is passed.

4.14 `reactive` called with no argument MUST land nothing.

4.15 `reactive` called with `undefined` MUST land `undefined`.

4.16 An opening `undefined`, the value form's or a body's first answer, MUST land without passing a
`schema`, a `transform`, a window or a `store`.

4.17 `s.set` MUST store a `Failed` it is given as a value rather than refuse the write.

# 5. Productions and identity

5.1 A reader MUST be woken only when read identity changes.

5.2 A gated production whose identity matches the previous `Stored` MUST NOT be retained, and MUST
wake no reader.

5.3 `identity` MUST be discriminated by arity: one parameter is a projection compared by `!==`, and
two is a comparator answering directly.

5.4 The default `identity` MUST be the reference.

5.5 `structural` MUST answer "not equal" wherever it cannot decide.

5.6 A production MUST be pushed rather than replace the head production.

5.7 `s.patch` MUST replace the head production rather than append one.

5.8 `throttle` and `debounce` MUST cap how often a value changes for a reader.

5.9 A capped window MUST cap the wake, and MUST NOT itself drop a production.

5.10 A cursor MUST deliver every production a window collapsed that retention still holds.

5.11 An implementation MUST NOT start work a window would discard.

5.12 `throttle` MUST allow a change immediately and then at most once per window.

5.13 `debounce` MUST delay a change until the changes stop.

5.14 Declaring both `throttle` and `debounce` MUST refuse at construction.

5.15 Where a `throttle` or a `debounce` window is holding a production back, the held value MUST
be served and `s.busy` MUST be true.

5.16 A `bind:` read MUST NOT be capped.

5.17 `throttle` and `debounce` on a streaming producer MUST cap how often its readers are woken.

5.18 A read of a capped streaming producer MUST serve the accumulation as the last release left it.

5.19 `throttle` and `debounce` on a `Keyed` MUST hold back starting a newly reached entry until the
window allows it.

5.20 An entry a `Keyed` window replaced with a later key before it started MUST NOT be started, and
MUST NOT be held.

5.21 An entry a `Keyed` window is holding back MUST report `s.busy` true.

5.22 `by` MUST key an element by the property it names, or by what the function it is returns for
that element.

5.23 `throttle` and `debounce` MUST cap the wakes an `s.patch` makes as they cap a production's.

5.24 `throttle` and `debounce` MUST hold an `s.refresh` as they hold a production, and a refresh a
window held MUST start one reload when the window closes.

# 6. Retention

6.1 Retention of `history` entries MUST be append-only.

6.2 Raising `history` MUST NOT make a write dearer.

6.3 The unit of `history` MUST be `Stored`.

6.4 A `ttl` expiry MUST wake no reader.

6.5 A production past its `ttl` MUST be dropped on the read that follows.

6.6 An implementation MUST NOT hold a timer per retained production.

6.7 A live cursor over `s.history` MUST NOT observe an expiry.

6.8 `ttl` on a value with no producer MUST reach its past productions alone.

6.9 An implementation MUST hold one expiry timer per value declaring `ttl`, armed at the nearest deadline that value holds.

6.10 A `ttl` expiry timer MUST NOT hold the process open.

6.11 A read finding the standing production past its `ttl` MUST NOT serve it.

6.12 A read finding the standing production past its `ttl` MUST run the producer.

6.13 A standing production past its `ttl` MUST be released.

6.14 A value whose standing production is past its `ttl` MUST report `s.ready` false.

6.15 An expiry MUST NOT report `s.busy` true.

6.16 A `history` of 0 MUST retain the standing production alone.

6.17 A streaming producer's production MUST enter the ring when its run closes, as the
accumulation at close.

6.18 An `undefined` production MUST NOT enter the ring.

6.19 A cursor MUST NOT be handed an `undefined` production.

6.20 A streaming run that failed, or that a trigger replaced before it closed, MUST enter nothing.

6.21 A cursor's replay over a streaming producer MUST end at the last run that closed.

6.22 A streaming producer's `ttl` MUST run from its run's close, and MUST NOT reach the run in
flight.

# 7. Triggers

7.1 Every `Reactive` MUST carry `s.refresh` and `s.invalidate`.

7.2 `s.invalidate` MUST drop the cache behind the value, and MUST NOT drop the value.

7.3 `s.invalidate` MUST NOT move a node and MUST NOT send a request.

7.4 `s.refresh` MUST keep serving what is held until the new value lands.

7.5 `s.refresh` MUST report `s.busy` true while the reload is in flight.

7.6 `s.refresh` and `s.invalidate` MUST be inert on a value with no producer, beside what 7.10 and
7.18 send its subscribers.

7.7 `s.invalidate` MUST mark the held value stale.

7.8 A load over a value marked stale MUST report `s.ready` false.

7.9 An accepted production MUST clear the stale mark.

7.10 `s.invalidate` on a wired `Reactive` MUST invalidate every subscriber's copy.

7.11 `s.refresh` MUST reload whether or not anything subscribes.

7.12 The first read of a value `s.invalidate` marked MUST run its producer.

7.13 A read of a value built from one `s.invalidate` marked MUST run that producer first.

7.14 `s.invalidate` MUST NOT wake a reader, a probe's reader included.

7.15 `s.invalidate` MUST discard the load or the stream it finds in flight.

7.16 A value `s.invalidate` marked MUST NOT report `s.busy` true until a read or a probe runs its
producer.

7.17 A value `s.invalidate` marked MUST go on being served until a read or a probe runs its producer.

7.18 `s.refresh` on a wired `Reactive` MUST refresh every subscriber's copy.

# 8. Stores

8.1 A `Store` MUST provide both `get` and `set`.

8.2 A `Store`'s `get` MUST be a producer, and the value MUST therefore answer to 7.1.

8.3 A `Store`'s `get` MUST answer before the initial value, and the initial value MUST be what a
miss falls back to.

8.4 A synchronous `get` MUST NOT make the value loaded.

8.5 A restore MUST mint a production without running `schema` or `transform`.

8.6 A restore of a streaming producer MUST seed the ring with the accumulation.

8.7 A restored stream MUST report `s.ready` true and `s.busy` false.

8.8 A `Store`'s `set` MUST run once per production, per 5.2.

8.9 A `Store`'s `set` on a streaming producer MUST run once at close, on the accumulation.

8.10 Writes to a `Store` MUST coalesce latest-wins, and MUST NOT queue.

8.11 A write to a `Store` MUST NOT block a reader.

8.12 A failed `Store` write MUST NOT detach the store; it MUST reach `onError` and warn on
`abide:reactive`.

8.13 A `Store`'s `set` MUST receive the `Reactive`'s own `ttl`, in milliseconds.

8.14 A `store` MUST run where the `Reactive` is constructed.

8.15 A value a `Store`'s `get` cannot read MUST be a miss, per 8.3.

8.16 A trigger on a `Reactive` with both a body and a `store` MUST run the body.

8.17 A `Store`'s `get` answering `undefined` MUST be a miss.

8.18 A `Store`'s `get` MUST NOT run while a write to that `Store` is in flight or held per 8.10,
the value of that write standing in its place.

8.19 A `Store`'s `get` answering a miss with nothing left to serve MUST land an error on `s.error`.

# 9. History and streams

9.1 `s.publish` on a wired `Reactive` MUST send the production to every subscriber.

9.2 A streaming producer's `Stored` MUST be the chunks accumulated so far, materialised on the
read that asks for it.

9.3 An implementation MUST NOT accumulate chunks by copying the accumulation per chunk.

9.4 `s.set` on a wired `Reactive` MUST NOT be sent to a subscriber as it lands.

9.5 `s.publish` MUST hand back the sequence number it minted, or the `Failed` a `transform` refused
it with.

9.6 A publish MUST mint a production whatever `identity` says.

9.7 `identity` MUST compare against the previous production alone, and MUST NOT scan the ring.

9.8 A `schema` MUST gate what `s.publish` takes.

9.9 A production arriving over a connection MUST replace a write standing on the subscriber's copy.

9.10 `history` MUST be how far back a reconnect resumes, and a cursor older than it MUST be answered
with the whole ring rather than with a gap.

9.11 A `store` MUST round-trip the latest production, and MUST NOT persist the ring.

9.12 A `transform` and a `schema` MUST run on every publish, the server's own included.

9.13 `s.publish` on a `Reactive` nothing carries MUST reach its own readers alone.

9.14 A production arriving over a connection MUST carry the sequence number its owner minted, and the
subscriber MUST NOT renumber it.

9.15 `s.history` on an adopting `Reactive` MUST forward to the adopted `Reactive`.

9.16 A `Reactive` a `socket` carries MUST be process-wide.

9.17 An implementation MUST NOT provide a revoke or a clear over what a `Reactive` retains.

9.18 A ring MUST NOT be where a removal is enforced.

9.19 A `Reactive`'s history epoch MUST be minted when that `Reactive` is constructed, and MUST NOT
change while it lives.

9.20 A `reactive` body declared as an async generator function MUST be a streaming producer, and
the declaration MUST be read once, at construction.

9.21 `s.refresh` on a streaming producer MUST serve the held accumulation until the new stream's
first chunk, and that stream's accumulation from then on.

9.22 A `schema` and a `transform` on a streaming producer MUST run on the accumulation a read
materialises, at most once per chunk the accumulation holds.

9.23 A streaming producer MUST wake its readers at most once per task.

9.24 `flushSync` MUST deliver the wakes a streaming producer is holding.

9.25 A write to a streaming producer MUST stand until its accumulation next changes, and an adoption
made by one (11.62) MUST end with it.

9.26 A write to a streaming producer MUST NOT move a cursor over it.

9.27 `s.patch` on a streaming producer MUST mutate its accumulation in place.

9.28 A keyed `reactive`'s `history` MUST be retained per entry.

9.29 A subscriber's copy of a wired `Reactive` MUST report `s.busy` true until the first production
arrives.

# 10. Sharing

10.1 `reactive.share` MUST get or create in one call.

10.2 A key given to `reactive.share` MUST be a literal, and a non-literal MUST be a build error.

10.3 A key `Shared` declares MUST be checked against it, and a key it does not declare MUST be
inferred from the thunk.

10.4 A value created by `reactive.share` MUST NOT be evicted within its scope.

10.5 The scope of `reactive.share` MUST be the component instance and its descendants.

10.6 `reactive.share` MUST create in the calling scope where no ancestor holds that key.

10.7 An implementation MUST NOT provide a process-wide `reactive.share`.

# 11. Derived and keyed values

11.1 A `reactive` body declaring no parameter MUST produce an unkeyed, tracked `Reactive`.

11.2 A `reactive` body declaring one parameter MUST produce a keyed, untracked `Keyed`.

11.3 An implementation MUST NOT provide an option converting one `reactive` form into the other.

11.4 A `Keyed` MUST hold one entry per `Args` key, computed when that key is reached.

11.5 An unkeyed `reactive` MUST recompute on the first read that follows a change to a value its
body read.

11.6 A `Keyed` MUST NOT recompute for that reason, and `ttl`, `invalidate`, `refresh` and
eviction MUST be its only ways back.

11.7 Both `reactive` body forms MUST accept a write.

11.8 A write to a `reactive` that is not adopting MUST stand until the next recompute replaces it.

11.9 An implementation MUST NOT warn on a write to a `reactive`.

11.10 A write of a settled value to a `reactive` MUST move no probe.

11.11 A write of an unsettled value to a `reactive` MUST be a load, per 4.2 and 1.6.

11.12 A `Reactive` returned from a `reactive` body MUST be adopted, and MUST NOT be stored as a
value.

11.13 Adoption MUST mirror the adopted productions into the adopting `Reactive`.

11.14 An adopting `reactive` MUST run its own `transform` on the way in.

11.15 Adoption MUST forward members the adopted `Reactive` declares beyond the common face, by
delegation to whatever is currently adopted.

11.16 On re-adoption a `reactive` MUST clear where the newly adopted `Reactive` has nothing to serve.

11.17 Adoption MUST inherit the adopted `Reactive`'s `identity` where the outer declared none.

11.18 A recompute landing on the same adopted `Reactive` MUST wake no reader.

11.19 An adopting `reactive` MUST report `s.busy` only where the newly adopted `Reactive` reports
it.

11.20 `s.busy` and `s.ready` MUST be the probes that propagate.

11.21 An unkeyed `reactive` MUST report `s.busy` for its own load, or for any value its body read.

11.22 An implementation MUST derive a propagated probe on the read that asks for it, and MUST NOT
hold a subscription per source for it.

11.23 A `Keyed` MUST propagate nothing.

11.24 An `Args` object MUST become a key by its canonical wire form: members sorted by name,
`undefined` members dropped, and `Date` written ISO.

11.25 An `Args` key MUST be structural.

11.26 The key MUST be taken before `args` runs.

11.27 The order over `Args` MUST be coerce, apply syntax defaults, canonicalize, validate, then
the body.

11.28 An `args` gate MUST refuse and MUST NOT decide which entry an `Args` object lands on.

11.29 A literal default written in the body's parameter MUST participate in the `Args` key, on
both sides, and an absent `Args` MUST be keyed as `{}` where the parameter writes one.

11.30 The build MUST warn where `args` declares a default the parameter does not.

11.31 A reactive value in an argument position MUST be read, and `Args` MUST be plain args.

11.32 A `reactive` without `global` MUST be request-local on a server and process-local in a browser.

11.33 `ttl: Infinity` without `global` MUST mean to the end of that scope.

11.34 `global: true` MUST place entries in a process-wide cache that outlives every request.

11.35 A `global` `reactive` MUST be bounded by its own `ttl` and by `invalidate`, and by nothing else.

11.36 An implementation MUST NOT evict a `global` entry on a size or a count limit.

11.37 `global: true` MUST be a build error on a body reading `request`, `response`, `principal`,
`cookies`, `csp.nonce` or `route`, and the error MUST name the ambient.

11.38 Coalescing of a `reactive` load MUST be within a scope: two reads of one key in one scope share
one load, and two scopes load twice.

11.39 `history` MUST be accepted by every `reactive` form.

11.40 A reader detaching from a `global` streaming `reactive` MUST NOT cancel the producer for the
readers that remain.

11.41 `args` on a `reactive` MUST check `Args`.

11.42 `args` MUST be unspellable on the unkeyed `reactive` overload, and spelling it MUST be a compile
error naming the overload.

11.43 `store` on a `Keyed` MUST accept a function of the `Args`.

11.44 `tags` MUST be what a `Selection` matches on, and MUST be the only selector reaching across
values.

11.45 The function form of `tags` MUST receive the value's `Args`.

11.46 A `Keyed`'s `ttl` MUST be the life of the entry, and the ring MUST be discarded with it.

11.47 A `reactive` MUST accept a `schema`, gating what its body produced.

11.48 An adopting `reactive` MUST run its own `schema` on the way in, as 11.14 has it run its
`transform`.

11.49 A `Keyed` MUST hold one expiry timer, armed at its oldest entry.

11.50 An entry MUST take the newest position on every production.

11.51 Every probe MUST forward from the adopted `Reactive` to the adopting one.

11.52 Every trigger on an adopting `Reactive` MUST reach the adopted one.

11.53 A provisional run MUST mint no production.

11.54 A reader joining a `global` `reactive`'s stream after it began MUST NOT be answered with a
refusal.

11.55 A `reactive` MUST NOT report `s.ready` before its body has run for the value being probed.

11.56 A probe over a key a `Keyed` has not computed MUST allocate no entry.

11.57 An implementation MUST NOT warn where two `Args` keys differ only in the case of a value.

11.58 An unkeyed `reactive` MUST NOT recompute before a read or an `Effect` asks for its value.

11.59 An unkeyed `reactive` MUST report `s.ready` only where every value its body read reports it.

11.60 `s.set`, `s.publish` and `s.patch` on an adopting `Reactive`, given anything but a `Reactive`, MUST
reach the adopted `Reactive`.

11.61 `args` spelled on a `reactive` whose body declares no parameter MUST refuse at construction.

11.62 `s.set` given a `Reactive` MUST adopt it per 11.12, and MUST NOT store it as a value — on a
streaming producer, as a write that 9.15 and 11.60 do not reach through.

11.63 A body answering `undefined` MUST land `undefined`.

11.64 A body a `NotLanded` aborted that something probes MUST re-run in the turn that lands the
value it named.

11.65 Reaching a `Keyed` with an `Args` member 11.24 cannot write — anything outside `JsonValue`
but a `Date`, or a number that is not finite — MUST throw, naming the path to the member.

11.66 An adoption that would close a cycle of adopting `Reactive`s MUST be refused where it forms,
naming the cycle.

11.67 `s.set` MUST throw 11.66's refusal, and a body whose answer 11.66 refuses MUST fail with it.

11.68 A `reactive` without `global` MUST be built afresh in each request that reaches it, from its
declaration and never from what a write outside every request left.

11.69 A keyed value's body MUST be handed what its `args` gate returned.

# 12. Effects

12.1 A `Disposer` MUST run before each rerun of its `Effect`, and once more at teardown.

12.2 An `Effect` MUST run immediately, and again whenever a reactive value it read changes.

12.3 Where sources are given to `watch`, the `Effect` MUST run only when those sources change.

12.4 A `watch` registered inside a component MUST be owned by that component.

12.5 On a server a `watch` MUST run once, and its `Disposer` MUST still run at scope teardown.

12.6 A throw from an `Effect` or a `Disposer`, and a read of a failed `Reactive` inside one, MUST
reach `onError` as thrown, and MUST warn on `abide:watch` with the trace.

12.7 In a browser a throw from an `Effect` MUST additionally be re-thrown, to surface as an uncaught
error.

12.8 An `Effect` that threw MUST stop its `watch`.

12.9 `s.watch` MUST be `watch` narrowed to that `Reactive`, and MUST NOT diverge from it on 12.1,
12.2 or 12.8.

12.10 An `Effect` a write woke MUST run at the end of that turn, and MUST NOT run once per write.

12.11 `flushSync` MUST end the turn where it is called.

12.12 A read MUST answer what the writes in its turn left, whether or not the `Effect` values they
woke have run.

12.13 A `watch` registered inside a `{#if}` arm or a `{#for}` row MUST stop when the region
holding that arm or row is removed.

# 13. Selections

13.1 A `Selection` MUST be one `Reactive`, one `Keyed`, one `Rpc`, or a set of `tags`.

13.2 `busy` over a `Selection` MUST answer whether ANY entry in it is busy.

13.3 An implementation MUST hold one signal per `Selection`, and MUST NOT hold one per entry.

13.4 `s.refresh`, `s.invalidate`, `k.refresh`, `k.invalidate`, `rpc.refresh` and `rpc.invalidate`
MUST be defined as `refresh` and `invalidate` over a `Selection`, and MUST NOT be a second
mechanism.

13.5 An implementation MUST NOT provide a free `done`, `success` or `error` over a `Selection`.

13.6 A bare `invalidate`, `refresh`, `busy` or `ready` MUST match only entries whose producer is a
load: a `store`, or a body that has handed back a pending answer or a stream.

13.7 A bare `refresh`, and `refresh` over a `Selection` that is not one `Reactive`, MUST reload
only entries something subscribes to and MUST mark the rest.

13.8 A `Selection` MUST be scope-bounded, and a tag MUST be scoped the same way.

13.9 A `Selection`'s signal MUST be keyed by the canonical form of its `tags`, and a bare
selection MUST hold exactly one.

13.10 On a server a bare `invalidate` and a bare `refresh` MUST each reach every `global` `reactive`
in the process.

13.11 `ready` over a `Selection` MUST answer whether EVERY entry in it is ready.

13.12 A pattern given beside a `Selection` MUST narrow it to the entries whose `Args` match the
pattern.

13.13 A `Selection` made in any scope MUST reach every `global` `reactive` it matches, and every
entry of a `global` `Keyed` it matches.

13.14 A bare `refresh` MUST NOT re-run a synchronous derivation, which MUST recompute from the
load it reads.

# 14. Tracking

14.1 A `Reactive` MUST be tracked only where something downstream will be rebuilt from it.

14.2 A template expression MUST track the `Reactive` values it reads.

14.3 An unkeyed `reactive` body MUST track.

14.4 A keyed `reactive` body MUST NOT track.

14.5 A block body's binding MUST track, and MUST bind the value the block produced rather than a
`Reactive`.

14.6 A `watch` `Effect` MUST track, narrowed where 12.3 gives it sources.

14.7 A component `<script>` setup body MUST NOT track.

14.8 A branch-local `<script>` in a block body MUST NOT track.

14.9 An event handler and a `bind:` write-back MUST NOT track.

14.10 A `Transformer`, a `Disposer`, middleware and a lifecycle hook MUST NOT track.

14.11 A `Reactive` MUST push its own subscriber when it evaluates, whoever reached it.

14.12 On a server a tracked read of a value still in flight MUST open the sink 3.4 opens.

14.13 Tracking MUST be synchronous, and a read in a continuation after an `await` MUST register
against nothing.

14.14 The compiler MUST warn on a reactive read an `await` dominates inside a tracked body, naming
the read.

14.15 The compiler MUST warn on a reactive read in a condition position inside an unkeyed
`reactive` body, where what the condition decides reads another value, naming the read.

14.16 The compiler MUST warn on a reactive read inside a function a tracked body creates and
does not call synchronously, naming the read.

14.17 The compiler MUST warn on a reactive read left of `??` where the type the read yields
excludes `null` and `undefined`, naming `s.ready`.

14.18 The compiler MUST NOT warn under 14.16 on a read inside the `get` or `set` of a component's
`bind:` pair.

# 15. Refusals

15.1 A refusal MUST be a declared value, and MUST NOT be a status code or a transport concern.

15.2 A refusal MUST fill the `Failures` of the `Reactive` that produced it.

15.3 A refusal declared through `refuse.named` MUST default to status 400.

15.4 Constructing a `Failed` MUST be inert, and MUST NOT throw.

15.5 Returning a `Failed` MUST refuse.

15.6 `Failed` MUST be structural.

15.7 `notFound` MUST be returned where no route matched, and where no handler is mounted at that
address and method.

15.8 `validationError` MUST be returned where a `schema` or an `args` gate refuses, at status 422.

15.9 An implementation MUST declare no refusal names beyond those `notFound`, `validationError` and
`aborted` carry and the one 17.4 names.

15.10 An expression statement whose type is `Failed` MUST be a compile error naming both repairs.

15.11 Where `refuse.named` is given a `schema`, the data MUST be checked at construction.

15.12 A `message` given as a function MUST run at construction, on the data.

15.13 A `refuse.named` given no `message` MUST take its status's reason phrase (17.8), or its name
for a status with none. A throw from a `message` function MUST be caught, the `message` falling
back the same way, and MUST warn on `abide:refuse`.

15.14 The `schema` MUST run before the `message` function.

15.15 A `schema` refusal at construction MUST warn on `abide:refuse` rather than stop the `Failed`
being built.

15.16 An address that will not percent-decode MUST be answered `refuse(400)`.

15.17 A page, a file under `src/ui/public` and the built bundle MUST answer a method other than
`GET` or `HEAD` with a refusal at status 405 carrying `allow: GET, HEAD`.

15.18 A refusal declared through `refuse.named` MUST carry data only where it is given a `schema`,
and its data's type MUST be inferred from that `schema`; a `message` function MUST be accepted only
beside one.

# 16. Handlers and transports

16.1 A handler MUST be a `reactive`, or a plain function.

16.2 `GET`, `POST`, `PUT`, `PATCH` and `DELETE` MUST give a handler an address over http, mounted by
file path and export name.

16.3 An `Rpc` MUST hand back the same `Reactive` shape the handler had, `Produced` included.

16.4 An `Rpc` MUST be callable in both arms, the call being what issues the request.

16.5 Which arm `GET` takes MUST be read off a brand the factory stamped, and MUST NOT be inferred
from the shape.

16.6 `GET` over a plain function MUST behave as `GET` over a `reactive` of that function.

16.7 A `reactive` handed to a mutation MUST have its `ttl` default to 0 unless it declared one.

16.8 A mutation over a `Reactive` with no producer MUST publish into it, and declaring that handler
MUST be the authorisation for it.

16.9 `Failures` on an `Rpc` MUST be the union of what the handler declared and what its rungs
declared.

16.10 `rpc.url` MUST take the `Args` on a `GET` or a `DELETE`, and MUST take none on a mutation.

16.11 `rpc.url` MUST resolve a mount-relative address at run time, and the build MUST NOT bake an
absolute one.

16.12 A `Middleware` rung MUST run on every call, in process as much as over the wire.

16.13 The rungs in registration order, the `ctx.args()` coerce-then-validate, and `timeout` MUST run
on every call.

16.14 The `Origin` gate on a mutation, `maxBodySize`, the `crossOrigin` preflight, the framing, the
`cache-control`, a status written through `response` and the seed buffer write MUST be wire-only.

16.15 The `Middleware` onion MUST be composed once at route-table construction, and MUST NOT be folded per call.

16.16 A composed `Middleware` chain MUST capture the rung and the next link, and MUST NOT capture anything
per-request.

16.17 A `Middleware` rung MUST short-circuit by returning what the handler would have returned.

16.18 `ctx.args()` MUST parse on first call and cache for the request.

16.19 `ctx.args()` MUST hand back `Args` coerced and validated against the `args` the value
declared.

16.20 Validation MUST be lazy, on that first `ctx.args()` call.

16.21 A body that will not parse as `Args` MUST be answered 400.

16.22 A throw from a `Middleware` rung MUST escape the whole onion rather than unwind through it.

16.23 `timeout` MUST raise the request's idle timeout, and MUST only raise it.

16.24 A request's `timeout` floor MUST be the maximum over every handler that ran in it.

16.25 `crossOrigin` MUST default to false, and where it is declared abide MUST answer the `OPTIONS`
preflight itself.

16.26 A handler MUST be request-bound where its rungs or its body read the request scope, and
calling one from a scope that has none MUST be a build error, per 11.37.

16.27 Shape MUST belong to the `Reactive` and MUST NOT be declared at the transport; a transport MUST
read it.

16.28 A `schema` MUST run where its `Reactive` lives.

16.29 A browser MUST receive a generated `Rpc` wrapper carrying the method, the mount-relative address and
the description, and MUST NOT receive the server module.

16.30 Importing a name from `#server` that is not a handler MUST be a compile error from the client
graph, and MUST NOT be a silent stub.

16.31 An `Rpc` returning a raw `Value` MUST transport as `application/json`.

16.32 An `Rpc` returning `undefined` MUST answer 204 where no status was written through
`response`.

16.33 An `Rpc` returning an async generator MUST stream in the framing `Accept` names, and MUST
default to the first framing its chunk type admits.

16.34 The seed buffer MUST hold an `Rpc`'s transcript in the chunk type's default framing,
whichever framing the caller asked for.

16.35 An `Rpc` returning a binary MUST transport as `application/octet-stream`, or as a `Blob`'s own
type where it has one.

16.36 A returned `Blob` MUST be range-aware: abide MUST read `Range`, honour `If-Range` against the
ETag it derives, and answer 206, 416 and 304 as the protocol requires.

16.37 A handler MAY return a `Response`, and an in-process caller MUST receive it unconverted.

16.38 Where a handler returns a `Response`, `clients.mcp` and `clients.cli` MUST default to false.

16.39 A mutation MUST answer a request preferring `text/html` as a navigation: a returned
`redirect` passes through, a returned value becomes 303 back to the referrer, and a failure renders
`error.abide` at its own status.

16.40 A handler whose value carries a `Reactive` below its top level MUST be a compile error naming
the handler and the path to it.

16.41 A `Failed` escaping a handler MUST be answered at its own `status`.

16.42 A throw that is not a `Failed` MUST be answered 500.

16.43 `rpc.raw` MUST issue the call the `Rpc` issues, differing only in handing back the
`Response`. On a server it MUST be answered in process by the `App` answering the request it is made
in, and by the `App` built last only outside every request.

16.44 An `Rpc` call MUST evaluate its `Args` at the call, and MUST NOT re-evaluate them.

16.45 A jsonl answer MUST write one JSON value per line, per pull.

16.46 An sse answer MUST frame each value as `data: <json>` followed by a blank line, with
`text/event-stream`, `no-cache` and `X-Accel-Buffering: no`.

16.47 A stream of value chunks MUST admit jsonl and then sse, and a stream of binary chunks MUST
admit `application/octet-stream` alone.

16.48 Where no handler fixed the framing, the chunk type MUST be read from the first chunk
produced.

16.49 An `Rpc` over a `Reactive` declaring `history` MUST frame each production with the sequence
number and the epoch 18.10 and 18.11 mint where the reader asks for jsonl or sse over JSON, on the
wire and in the seed buffer alike, and MUST answer a reader asking for JSON the standing production.

16.50 An sse answer over a `Reactive` declaring `history` MUST carry each production's sequence
number and epoch as `id: <seq>:<epoch>`, and a moved epoch as one `event: reset` whose data is the
ring.

16.51 `Last-Event-ID` MUST be read as the sequence number and epoch a reconnect carries, per 18.13,
and one naming no epoch MUST be compared as a moved epoch.

16.52 A call's `signal` MUST end the load the call reached only where every call that reached that
load passed a `signal`, and every one of those has aborted.

16.53 A load ended under 16.52 MUST keep serving what its value held, MUST report `s.busy` false,
MUST refuse with `aborted` at status 499, and MUST abort the request carrying it where one does.

16.54 A `HEAD` MUST be answered by the `GET` handler mounted at its address.

16.55 A `HEAD` MUST NOT take from the seed buffer.

16.56 An `Rpc` answered 204 MUST NOT carry `content-type`.

16.57 The 303 16.39 answers MUST go to the mount's root where the referrer is absent or is not of
`APP_URL`'s origin, per 36.2.

16.58 `maxBodySize` and `ABIDE_MAX_REQUEST_BODY_SIZE` MUST default to no ceiling.

16.59 A mutation's body over the ceiling `maxBodySize` or `ABIDE_MAX_REQUEST_BODY_SIZE` sets MUST
be refused 413, whether its length was declared or streamed.

16.60 Where neither `timeout` nor `ABIDE_RPC_TIMEOUT` is set, a call MUST NOT raise the request's
idle timeout.

16.61 A `timeout` of `Infinity` MUST leave the request's idle timeout off.

16.62 Where a handler names no `timeout`, `ABIDE_RPC_TIMEOUT` MUST be its `timeout`.

16.63 A load that goes `timeout` milliseconds without settling, or without a stream's next chunk,
MUST be ended and MUST refuse with `refuse(504)`.

16.64 A load ended under 16.63 MUST keep serving what its value held, a stream's chunks so far
included, and MUST report `s.busy` false.

16.65 A call joining a load MUST NOT extend that load's `timeout`.

16.66 A call reaching a value whose last load ended under 16.52 MUST start a new load, under the `signal`
that call passed.

16.67 A throw answered once its request's signal has aborted — a handler's, or a page render's —
MUST answer `aborted` at 499, and MUST NOT report the throw as unexpected.

# 17. Response helpers

17.1 Every body helper MUST take `Values<T>`.

17.2 `page` MUST be defined as a write through `response` naming `text/html`, and MUST take what
a render produced rather than perform the render.

17.3 `redirect` MUST be defined as a write through `response` carrying a `RedirectStatus`,
defaulting to 302.

17.4 `refuse` on a server MUST hand back, per 15.5, the undeclared `Failed` named `HttpError` at
the given status.

17.5 `refuse` MUST carry no data, and MUST NOT take an options bag for any.

17.6 `jsonl`, `sse` and `bytes` MUST each be defined as a write through `response` fixing the
framing of a streaming answer.

17.7 An implementation MUST NOT negotiate past a framing a handler fixed.

17.8 An answer at a failure status (400-599) MUST carry that status's registered reason phrase as
its `statusText` when nothing wrote one, and `refuse` given no `message` MUST take the same phrase,
falling back to `HttpError` for a status with none.

# 18. Sockets

18.1 A `Socket` called with `Args` MUST hand back the same `Reactive` the `Keyed` it wraps hands back
for those `Args`.

18.2 Every `socket` MUST be carried over a single web socket mux.

18.3 An upgrade MUST pass the `socket` lane's `middleware`.

18.4 A `SocketEvent` rung MUST refuse by throwing.

18.5 `crossOrigin` on a `socket` MUST be closed unless declared.

18.6 `clientPublish` MUST default to false.

18.7 `clientPublish` MUST gate this transport alone.

18.8 A `transform` MUST still run on a publish `clientPublish` admits.

18.9 `SocketOptions` MUST carry no schema, per 16.27.

18.10 Every production of a wired `Reactive` MUST carry a sequence number, monotonic per `Reactive` and
minted with the production.

18.11 A wired `Reactive` MUST carry the epoch 9.19 mints, and an implementation MUST compare epochs for
equality rather than for order.

18.12 The sequence number and the epoch MUST be internal, and an app MUST NOT write either.

18.13 A reconnect to a wired `Reactive` MUST carry the last sequence number rendered and compare epochs.

18.14 A moved epoch MUST deliver the ring marked as a reset.

18.15 A block receiving a reset MUST clear its accumulated rows and repaint from the ring.

18.16 The sequence number MUST be the default key of a `{#for}` block over a cursor of a wired
`Reactive`.

18.17 A client reading a `GET` MUST be subscribed over the socket mux to that handler's productions
for those `Args`.

18.18 `socket` MUST refuse a `Reactive` built without `global`.

18.19 A subscriber's copy of a wired `Reactive` MUST carry what that `Reactive` declares of `by` as a
property name, `tags` as a list of names, `history`, and `identity` as `structural`.

18.20 A `GET` answered from a `global` value that declares no `middleware` MUST carry the version of
the production it answered with in `abide-version`.

18.21 A subscription to a `GET` MUST be sent the value standing where the version it names is not
that value's version, and MUST NOT be sent it where it is.

18.22 A version MUST name one production or one `s.patch` of one value, and no other production or
patch in this process or in any earlier one.

18.23 A production MUST NOT be sent to a subscription to a `GET` that declares `middleware`.

18.24 A client subscribing to a `GET` MUST name the version the answer it holds carried.

18.25 A subscriber's copy of a `GET` MUST take every value sent to it.

18.26 An `s.patch` of a value a `GET` serves MUST be sent to a subscription standing at the version it
was made over as what it wrote, and MUST NOT be sent as the value.

18.27 A subscriber's copy of a `GET` sent what a patch wrote over a version it does not hold MUST read
the value again.

18.28 An `s.patch` whose writes cannot be sent as data MUST be sent as the value.

18.29 A subscriber's copy of a `GET` MUST go stale when the `max-age` its answer carried runs out.

18.30 The build MUST warn where a `GET`'s `Reactive` declares `by`, `tags` or `history` by a value
that is not a function and whose type is not the one 18.19 carries.

# 19. Mount paths and schemas

19.1 A handler declared with `socket` MUST be mounted as 16.2 mounts one declared over http.

19.2 A mount path MUST be owned by exactly one handler, and a collision MUST be a build error
naming both files that declared a `GET` or a `socket` there.

19.3 A `Schema` MUST return what it accepts.

19.4 An implementation MUST NOT accept a predicate as a `Schema`.

19.5 The plain-function `Schema` form MUST throw what it refuses, and that throw MUST be caught where
the schema runs and become the `''` entry of `Issues<T>`.

19.6 `Paths<T>` MUST be dot-joined, MUST be depth-limited, and MUST widen to `string` past the limit.

19.7 Coercion MUST belong to the pipeline, and MUST NOT be asked of a `Schema`.

19.8 A `GET` or `DELETE`'s text args MUST be coerced from the type the `JsonSchema` declares, before
validation.

19.9 Coercion MUST happen at the `ctx.args()` that first asks, and every rung after it MUST see the
coerced value.

19.10 Where no `schema` is given it MUST be derived from the type annotation and the argument
defaults.

19.11 A default MUST make a member optional, and a defaulted parameter MUST make `Args` itself
optional.

19.12 Where inference fails the compiler MUST read rather than refuse the file, and the derived
`Schema` MUST widen.

19.13 A `Schema` that answers asynchronously MUST be refused.

19.14 A page that does not call `jsonSchema` MUST NOT carry `validateJson`.

19.15 A `JsonSchema` given as a `Schema` without `jsonSchema` MUST be refused, naming
`jsonSchema`.

19.16 Every value a module under `src/server/rpc` exports MUST be declared by a call of abide's
`GET`, `POST`, `PUT`, `PATCH` or `DELETE` — however the language spells the export, the call or its
import — and an export that is not MUST be a build error naming it.

19.17 A default in a keyed body's parameter or a handler's parameter that is not a literal MUST
be refused at construction, naming its `Args` member, and the build MUST refuse one on a handler.

19.18 `route.url` MUST hold the address a page is served at, the path `APP_URL` names included, on
the server as in the browser.

19.19 A root-absolute `href` or `src` in the `Shell` MUST be answered below the path `APP_URL`
names.

19.20 A request for the path `APP_URL` names, without its trailing `/`, MUST be redirected 308 to
that path with one, by path alone.

# 20. Generated surfaces

20.1 Every surface `Clients` names MUST be derived from the route table, and MUST NOT be authored
beside it.

20.2 Every key of `Clients` MUST default to true.

20.3 `Clients` MUST decide what is generated and listed, and MUST NOT decide who may call.

20.4 `ui: false` MUST generate no client wrapper, and importing that handler from `#ui` or a `.abide`
file MUST then be the compile error 16.30 states.

20.5 `/__abide/openapi.json` and `/__abide/mcp` MUST be served from a `reactive` over the route table,
and MUST take no `ttl`.

20.6 `/__abide/openapi.json` MUST publish OpenAPI 3.1, and MUST publish a handler's `JsonSchema`
with no translation.

20.7 `/__abide/openapi.json` MUST be gated by `ABIDE_OPENAPI` and `/__abide/mcp` by `ABIDE_MCP`.
What a closed one answers is 36.7.

20.8 Every `/__abide/**` address MUST run inside the app's own middleware.

20.9 `/__abide/mcp` MUST publish a handler that reads as a tool and a resource according to which
arm `GET` took, and MUST NOT require a flag to tell them apart.

20.10 A handler whose own `Middleware` rung would refuse a caller MUST still be listed, and MUST
still be refused on the call.

20.11 `/__abide/openapi.json` MUST publish a `Schema`'s own JSON Schema where it has one, probing
one spelling for it, and MUST publish the type-derived `JsonSchema` where it has none.

20.12 `/__abide/mcp` MUST refuse 403 a request whose `Origin` is another origin's, before it reads
the body.

# 21. Generated headers

21.1 Every response MUST carry `x-content-type-options: nosniff`.

21.2 Every response MUST carry `traceresponse`, a refusal included.

21.3 A page, an rpc answer and a refusal MUST default to `cache-control: private, no-store`.

21.4 `/__abide/health`, `/__abide/principal`, `/__abide/openapi.json` and `/__abide/mcp` MUST answer
`cache-control: no-store`.

21.5 The built bundle MUST answer `cache-control: public, max-age=31536000, immutable`.

21.6 A page MUST carry `referrer-policy: strict-origin-when-cross-origin`.

21.7 An answer that depends on a request header MUST carry `vary` naming it.

21.8 A `GET` over a `global` `reactive` MUST answer a `max-age` derived from that value's `ttl`, and an
app MUST NOT be required to state the duration a second time.

21.9 A `GET` over a `global` `reactive` MUST answer `private`.

21.10 A write through `response` MUST override every header and the status the answer carries.

21.11 The `max-age` 21.8 derives MUST replace 21.3's `no-store`, and 21.3 MUST decide the rest
of that header.

21.12 A file under `src/ui/public` MUST answer `cache-control: public, max-age=0, must-revalidate`.

21.13 A file under `src/ui/public` MUST answer an `etag` derived from its bytes.

21.14 A request whose `if-none-match` is `*`, or lists the `etag` 21.13 derives under weak
comparison, MUST be answered 304.

21.15 An `Rpc` answer MUST carry `server-timing` with its handler's duration under a metric naming
the run: `Seeded` where the `render`'s run answered it, `Cached` where a `global` production already
held answered it, `Started` where it is a stream timed to its first chunk, and `Direct` otherwise.

21.16 The `max-age` 21.8 derives MUST be what is left of the answered production's `ttl`.

21.17 A `GET` over a `global` `reactive` whose `ttl` is `Infinity` MUST keep 21.3's `no-store`.

21.18 A page MUST default to `content-security-policy: frame-ancestors 'none'`.

21.19 `access-control-allow-origin` MUST name only an origin the handler's `crossOrigin` admits.

21.20 An answer whose request ran `middleware` rungs MUST carry `server-timing` `Middleware` with the
time those rungs took apart from what they wrapped.

21.21 The `Direct` duration 21.15 carries MUST NOT include the time 21.20 counts.

# 22. Request-scoped ambients

22.1 `request`, `response` and `server` MUST throw outside a request.

22.2 `cookies` MUST be isomorphic, and on a server writes MUST be collected onto the response.

22.3 A cookie's `secure` MUST default from `NODE_ENV`.

22.4 A read of a cookie by name MUST track that name.

22.5 A write through `cookies` MUST wake the readers of that name alone.

22.6 Where the browser reports cookie changes, a change made outside `cookies` MUST wake the readers
of that name.

22.7 Where the browser does not report them, a change made outside `cookies` MUST wake nothing.

22.8 `cookies` MUST throw outside a request on a server.

22.9 A write through `response` MUST be collected onto the response being built for the request
being served.

# 23. Route and connectivity

23.1 Each member of `route` MUST be its own `Reactive`, and `route` MUST NOT be one `Reactive` over a
composite.

23.2 `route.url` MUST be one `URL` instance per navigation, built when the route resolves.

23.3 A page route MUST be created where a `page.abide` file lies under `src/ui/pages`.

23.4 A page route's file path MUST determine its `route.url`.

23.5 `Params` MUST carry what `[param]`, `[[optional]]` and `[...rest]` matched.

23.6 `route.name` MUST be the resolution path.

23.7 In a browser `online` MUST be `navigator.onLine` and its events.

23.8 On a server `online` MUST be true.

23.9 In a page or a layout, `route.params()` MUST be typed by that file's own route: a required
segment as text, an optional one as text that may be absent, a rest as a list, and in a layout any
segment a page below it adds.

# 24. Tracing

24.1 `trace` MUST be built on first ask and held for the request.

24.2 `trace.sampled` MUST carry the caller's sampling decision verbatim.

24.3 A span MUST be a `LogRecord`, and MUST NOT be a second feed.

24.4 A span MUST carry `startedAt` as ISO-8601 and its duration as a monotonic measurement.

24.5 `trace.headers` MUST carry `traceparent` naming the current span as parent.

24.6 A `trace.span` opened with `timing` MUST be carried in its answer's `server-timing` under its
name, where it closed before the head was sent.

24.7 A `trace.span` opened with `timing` MUST throw where its name is not an HTTP token.

# 25. Health

25.1 `GET /__abide/health` MUST answer `Health` over http.

25.2 An app's own `onHealth` fields MUST win every collision.

25.3 `health` MUST be seeded per 41.5.

# 26. Principal

26.1 Each member of `principal` MUST be its own `Reactive`, per 23.1.

26.2 The identity members of `principal` MUST share one resolve per request.

26.3 A caller carrying `principal.error` MUST NOT be authenticated.

26.4 The baseline MUST win every collision in `Principal`.

26.5 `principal.caller` MUST be read off its own cookie or minted, and MUST need no resolution.

26.6 `principal.caller` MUST survive a sign-in.

26.7 `principal.caller` MUST NOT survive a sign-out, and `principal.clear` MUST rotate it.

26.8 `principal.set` MUST NOT rotate `principal.caller`.

26.9 `principal.clear` MUST sign the caller out for the rest of this request as well as the next.

26.10 `Principal` MUST never be null, and an anonymous visitor MUST be `authenticated` false.

26.11 The `principal` seal MUST be an HMAC over the claims and their expiry, and MUST be signed
rather than encrypted.

26.12 The principal cookie MUST be set `HttpOnly` and `SameSite=Lax`, and `Secure` in production.

26.13 A bad signature, a lapsed seal and a malformed cookie MUST be one answer: `principal` reports
an anonymous caller.

26.14 A `principal` MUST be resolved at most once per request.

26.15 A `principal` seal MUST be refreshed once half spent.

26.16 An implementation MUST keep no server-side principal store and no revocation list.

26.17 `principal` MUST be seeded per 41.5.

26.18 The cookie the `principal` seal is carried in MUST be named `abide-principal`.

26.19 The cookie `principal.caller` is read from MUST be named `abide-caller`.

26.20 `principal.set` MUST throw where the sealed cookie would exceed the browser's cookie ceiling,
naming the byte count.

26.21 `principal.set` MUST throw once the response headers are out.

26.22 `principal.caller` MUST throw in a browser.

# 27. Configuration

27.1 `config` MUST throw what `onConfig` threw.

27.2 Precedence MUST be derived, then `config` from the app, then the environment.

27.3 `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` MUST be derived where the config does not carry
them.

27.4 `ConfigDefaults` MUST be synchronous by contract.

27.5 `config.invalidate` MUST re-read the environment and re-run `onConfig`.

27.6 A second `onConfig` MUST replace the first, its schema included, and MUST warn on
`abide:config`.

27.7 The `config` `schema` MUST be checked last, over the whole document.

27.8 A value out of `Env` MUST be coerced to the type of the default it overrides, and a value that
will not coerce MUST keep that default.

27.9 `config` MUST be an unkeyed `global` `reactive` over the precedence 27.2 states.

27.10 Filing or unfiling `onConfig` MUST invalidate `config`, so a read taken before the app's
module ran is not the one served after it.

# 28. Logging

28.1 Every line MUST be published to `log.records`, which MUST be an ordinary `reactive` declaring
`history`.

28.2 `log` MUST always write.

28.3 `log.warning` and `log.error` MUST always write.

28.4 `log.named` MUST prefix the app name, and calling it again MUST append another segment.

28.5 A `Logger` MUST carry the same levels and the same `log.enabled` as `log`.

28.6 `log.enabled` MUST answer whether a gated line on that namespace would be written.

28.7 A namespace `log.enabled` reports closed MUST NOT run the measurement a gated line would report.

28.8 A correctness or a configuration failure MUST report on a namespace `abide:` names.

28.9 `DEBUG` MUST gate namespaces in debug-npm grammar, and MUST be read from the environment
on a server.

28.10 `DEBUG` MUST reach a browser through the document rather than through the bundle.

28.11 A browser's own stored `DEBUG` setting MUST answer only where the document carries none, and
MUST NOT override it.

28.12 The app name `log.named` prefixes MUST be read per line, so a logger named before the app's
identity resolved writes under it once it has.

# 29. Content security policy

29.1 `csp` MUST be one `Middleware` rung.

29.2 `csp` MUST set `content-security-policy` on `text/html` only.

29.3 `csp.nonce` MUST be this response's nonce.

29.4 On a server, `csp.nonce` MUST be readable only inside a request scope, per 11.37.

29.5 The `csp` baseline MUST be `default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
`img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`, `style-src-attr 'unsafe-inline'`,
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` and `form-action 'self'`.

29.6 `sources` MUST replace a directive rather than add to it.

29.7 A directive given an empty array in `sources` MUST be dropped.

29.8 A directive name the `csp` baseline lacks MUST be added.

29.9 The inline output `render` emits MUST be permitted by a build-time hash in `script-src`, and
MUST NOT consume `csp.nonce`.

29.10 The inline output `render` emits MUST be byte-invariant across responses.

29.11 In a browser, `csp.nonce` MUST answer the nonce the document was served with.

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

30.8 A route MUST be the directory path of a `page.abide` under `pages`, in the segment spelling
`url` takes.

30.9 `navigate` MUST match the most specific route, ranking a static segment above a required
one, a required above an optional, and an optional above a rest.

30.10 An address `navigate` matches no route for MUST be left to the document, and MUST NOT be
refused.

30.11 A page `navigate` reached MUST build its own markup, and a page the server painted MUST be
hydrated where it stands.

30.12 `navigate` MUST stop the bindings of the page it replaced, per 12.13.

30.13 A plain click on a same-origin link a route matches MUST reach `navigate`, and a click
carrying a modifier, a `target` or a `download` MUST NOT.

30.14 A pointer over, a press on or focus on a link 30.13 would take MUST load its route's chunks,
and MUST NOT make an `Rpc` call.

30.15 `navigate` MUST pass the address it matched through `middleware` before it mounts the page.

30.16 A request `navigate` makes MUST be answered 204 with no body, at the status `middleware`
wrote where it wrote one.

30.17 `navigate` MUST mount the route a redirect in that answer lands on, at the address it landed
on.

30.18 `navigate` MUST leave an answer other than 204 to the document.

30.19 `url` MUST throw where a param, or a member of a rest param, is `.` or `..`.

30.20 A history step to an address that differs from the page shown only in its fragment MUST NOT
pass through `middleware`, and MUST NOT remount the page.

30.21 `navigate` to the page shown, at an address carrying a fragment, MUST NOT pass through
`middleware`, and MUST NOT remount the page.

30.22 A `navigate` that mounts a page, without `keepScroll`, MUST scroll to the element the address's
fragment names, and to the top where it names none.

30.23 `navigate` to an address the route of the page shown matches MUST NOT remount the page, and
MUST move `route.url` and `route.params` to that address.

30.24 A navigation 30.23 keeps the page for MUST pass through `middleware` where its path differs from
the page shown, and MUST NOT where only its query or fragment does.

30.25 A `navigate` that does not remount the page MUST NOT move the scroll, except to the element a
fragment it carries names.

30.26 `abide check` MUST refuse a `url` literal that no page of the app is filed under.

# 31. Reading and writing by name

31.1 Inside a `.abide` file a name bound to a `Reactive` MUST be read wherever 31.3 does not hold it.

31.2 A read by name MUST be live.

31.3 A name MUST hold the `Reactive` only where the declared type of its position is a `Reactive`: an
annotated binding, an annotated return, a `Reactive`-typed parameter, a `bind:` operand, an `await`
operand — or where 31.14 holds it.

31.4 Assignment to such a name MUST be a write, and the assigned value MAY be settled, a load, or a
`Reactive`.

31.5 A property access on such a name MUST reach the value, except a member declared on the
`Reactive` type, which MUST reach that member bound to the `Reactive`.

31.6 A call on such a name MUST reach the `Reactive` API where the member is declared on the
`Reactive` type, and the value's method otherwise.

31.7 `s` and `s.set` MUST keep compiling inside a `.abide` file.

31.8 A write through a member path into plain data MUST copy down that path and then write, and the
copy MUST NOT be optimised away.

31.9 A mutator lifted per 31.8 MUST be resolved from the type of the `Reactive` rather than from
the member name.

31.10 A template-local binding MUST shadow a name bound to a `Reactive` for the body it is bound in.

31.11 A read spelled `foo()` MUST take no arguments, and an argument MUST be a compile error.

31.12 A destructuring pattern or a spread over such a name MUST read it once.

31.13 The compiler MUST warn where 31.5 reaches a `Reactive` member the value's type also declares,
naming the explicit read.

31.14 A name MUST hold the `Reactive` where the declared type of its position is a `Selection`, or a
type parameter constrained by one.

31.15 A write through a member path that reaches a value which is not plain data — an array, or an
object whose prototype is `Object.prototype` or `null` — MUST assign on that value itself, MUST NOT
copy it or any level above it, and MUST NOT wake a reader.

# 32. Templating

32.1 `{expr}` MUST render reactive text, escaped.

32.2 `{raw(...)}` MUST render raw HTML.

32.3 A `name={expr}` attribute or property expression MUST be reactive, whole or interpolated.

32.4 `on<event>` MUST bind a native listener on an element, and MUST be an ordinary prop on a
component.

32.5 `bind:value` MUST read the property and write it back on input or change.

32.6 `bind:prop` on a component MUST hand the child the caller's `Reactive`, or its `{ get, set }` pair,
as that prop's write path.

32.7 A boolean bind MUST mirror a boolean DOM property as a boolean attribute, and MUST NOT write a
string.

32.8 `bind:group` MUST compare against the input's own value, and MUST NOT emit a `group` attribute.

32.9 `bind:element` MUST accept a `Reactive` of an element, or a callback returning an optional
`Disposer`.

32.10 `class:name` and `style:prop` MUST set one class or one style property.

32.11 `{...expr}` MUST spread props on a component and attributes on an element.

32.12 `{#if}` MUST render one branch.

32.13 `{#for}` with neither a key nor a `by` 32.32 reads MUST be positional.

32.14 `{#for}` without a key over a stateful body and a subject that reads a `Reactive` or calls a
function MUST warn in development.

32.15 `{#for}` over an async iterable MUST render each item as it arrives, and MUST append rather
than reconcile.

32.16 `{#try}` MUST be a render-time boundary over a region, and a failure MUST replace the whole
body.

32.17 A capitalised tag `<Name/>` MUST be a component invocation.

32.18 `<slot/>` MUST render children, and a fallback MUST render where none were passed.

32.19 An interpolated `style` attribute MUST lower to `style:prop` under a static property name, and
MUST NOT be built as a string.

32.20 An interpolation in a URL-typed attribute MUST be scheme-checked, and a scheme outside
`http:`, `https:`, `mailto:`, `tel:` or a relative reference MUST be dropped and warned on
`abide:render`, naming the attribute and not the value.

32.21 A control block MUST bind each reactive read and probe call in its subject once for the body.

32.22 `{#for}` over an absent subject MUST iterate zero times.

32.23 A template expression a `NotLanded` aborted MUST leave what it last rendered in place.

32.24 `raw` MUST hand back a value branded as raw markup.

32.25 `{raw(...)}` MUST lower to a call to `raw`.

32.26 A slot MUST render a value branded by `raw` without escaping it.

32.27 Static text in a `.abide` template MUST render as markup, in body text and in an attribute
value alike.

32.28 A static value in an attribute 32.20 scheme-checks MUST be escaped the way `{expr}` is.

32.29 A keyed `{#for}` MUST move a row it keeps, and the move MUST NOT take the row's nodes out of
the document.

32.30 A slot MUST be bounded by an anchor pair of its own while it holds a value branded by `raw`,
and MUST NOT be bounded by one while it holds none.

32.31 The anchor pair bounding a slot under 32.30 MUST be distinct from the one bounding a `{#if}`,
a `{#for}`, a `{#try}`, a `<slot/>` or a `<Name/>`.

32.32 `{#for}` without a key over a subject that is a `Reactive` named alone MUST key its rows by
that value's `by`, where it declares one.

32.33 A `{#for}` MUST NOT keep a row showing an item as it stood before an `s.patch` wrote to that
item, or to an object the patch reached through it.

32.34 A `<Name/>` whose name is bound to a `Reactive`, or to a prop `props` hands back, MUST invoke
the component the value holds.

32.35 A `<Name/>` under 32.34 MUST replace its component when the value changes to a different
one, and MUST NOT rebuild it when the value is the same component.

32.36 A `<Name/>` under 32.34 whose value is absent MUST render nothing.

32.37 An attribute whose value is `null` or `undefined` MUST be absent; an attribute HTML reads by
presence MUST be present or absent by the value's truthiness, and a string that makes one present
MUST be written as its text; and any other MUST be written as its text — whether named or spread,
and whether the server writes it or the browser does.

32.38 A `bind:element` callback's `Disposer` that hands back a thenable MUST keep the nodes holding
that element in the document until it settles, and MUST remove them then.

# 33. Props

33.1 `props` MUST be callable from a `<script>` block only, and calling it from a `<script module>`
block MUST be a compile error.

33.2 A component with no `props` call MUST accept no props of its own, and a caller passing one
MUST be an error.

33.3 `props` with no type argument MUST hand back an untyped record, which is the opt-out.

33.4 `props` MUST hand back one accessor per key, and the accessor's shape MUST be what that key's
type declares.

33.5 A prop MUST be a live read of the caller's expression, and MUST NOT be a snapshot.

33.6 A write by name to a prop the caller bound MUST reach the caller's `Reactive`.

33.7 A write by name to a prop the caller did not bind MUST stand in the child until the caller's
expression next changes.

33.8 `bind:` MUST be accepted on every prop, whatever type the child declares for it.

33.9 Destructuring `props` MUST keep every binding live.

33.10 The `props` lowering MUST be type-directed: a declared prop type with no index signature MUST give a
fixed accessor per key, whatever the call site spelled.

33.11 A prop type carrying an index signature MUST take the dynamic form, where a spread is one
live read with its keys enumerated per read.

33.12 An explicit prop MUST beat a `{...expr}` spread, whatever the source order.

33.13 Two `{...expr}` spreads against each other MUST resolve in source order.

33.14 The `props` pattern MUST be flat: renames, defaults and a rest element, and no nested
patterns.

33.15 A `props` rest element MUST be live, one accessor per key the call site passed, and a member
read by name MUST read `undefined` where the call site did not pass it.

33.16 `children` MUST always be accepted and MUST never be declared.

33.17 In a `.abide` template a run of whitespace carrying newlines but no space or tab MUST be
dropped wherever it stands.

33.18 In a `.abide` template a run of whitespace that renders nothing but carries a newline and
indentation MUST be dropped at both ends of every block body and of the top-level template.

33.19 The static text of a prop a `<Name/>` passes MUST reach the child as the characters it stands
for, decoded by HTML's attribute-value rule, and each static piece of an interpolated one MUST be
decoded on its own.

33.20 A `props` default MUST answer wherever the caller's expression reads `undefined`, the key
left out included, and its binding MUST be typed without `undefined`.

# 34. Script and style blocks

34.1 A `<script>` block MUST be per-instance component setup.

34.2 A `<script module>` block MUST be request-local on a server and process-wide in a browser.

34.3 A `<script>` or a `<script module>` MUST NOT await at its top level, and one that does MUST be
a compile error.

34.4 A `<style>` block written outside a block body MUST be component-scoped: every root element MUST
carry a scope token, and every selector MUST require it on its rightmost compound.

34.5 `:global(…)` MUST exempt the compound inside it from carrying the scope token.

34.6 A stylesheet imported from any `<script>` in the file, or any `.ts` it reaches, MUST be a
dependency of that component.

34.7 A branch-local `<script>` MUST run once each time the `{#for}` row or `{#if}` arm it is written
in is built.

34.8 A name a branch-local `<script>` declares MUST be in scope in the body it is written in, and in
no other.

34.9 A block body holding two branch-local `<script>` blocks MUST be a build error.

34.10 A `<script>` or a `<style>` inside a `{#try}` MUST be a build error.

34.11 A `<style>` written in a `{#for}` row or an `{#if}` arm MUST apply to the elements that body holds,
and to no other element the component writes.

# 35. Pages, rendering and sinks

35.1 A `src/ui/pages/**/layout.abide` MUST render its child page through a slot.

35.2 A `src/ui/pages/**/error.abide` MUST be resolved nearest-ancestor, as a layout is.

35.3 An `error.abide` that itself fails MUST escalate past the boundary, and MUST warn on
`abide:render`.

35.4 `render` MUST take a `Component` already bound to its props.

35.5 `render` MUST produce a document as its bytes.

35.6 A `Shell` MUST default to `src/ui/app.html`.

35.7 A sink MUST be a hole a `render` leaves where a value is still in flight, for the browser to
fill once that value lands.

35.8 An attribute a sink fills MUST be filled on the element itself.

35.9 A sink inside RCDATA MUST fill through the element's own property rather than through markup.

35.10 The batching unit of a sink fill MUST be the turn and MUST NOT be the production.

35.11 A `render` MUST close when its walk is done, and MUST NOT write a sink's fill into the
document it streams.

# 36. Environment and files

36.1 `PORT` MUST default to 3000, and a command's own port flag MUST override it by declaring it.

36.2 `APP_URL`'s origin MUST be what both origin gates compare against.

36.3 `NODE_ENV` MUST be read verbatim, and MUST be defaulted from the command where unset.

36.4 `APP_DATA_DIR` MUST be a path, and abide MUST NOT create it.

36.5 `ABIDE_PRINCIPAL_SECRET` MUST accept a comma-separated list.

36.6 `ABIDE_APP_TOKEN` and `ABIDE_APP_URL` MUST be read by the remote CLI only.

36.7 `ABIDE_LOGS`, `ABIDE_OPENAPI`, `ABIDE_MCP` and `ABIDE_BRIDGE` MUST each be closed by default, and
a closed one MUST answer 404.

36.8 `ABIDE_LOG_FORMAT` unset MUST follow the TTY.

36.9 `NO_COLOR` MUST beat `FORCE_COLOR`.

36.10 `#server`, `#ui` and `#shared` MUST be the seams the source is split by.

36.11 A file under `src/ui/public` MUST be answered at its path below that directory, rooted at the
mount rather than at the origin.

36.12 A file under `src/ui/public` MUST be answered with the bytes as authored.

36.13 A `src/ui/public` path resolving to the address of a page route MUST be refused by
`abide build` and by `abide dev`, naming both.

36.14 A file under `src/ui/public` MUST carry a `content-type` derived from its extension.

36.15 A URL in the client bundle naming the address of a file under `src/ui/public` MUST resolve
to that address below the path `APP_URL` names, and MUST NOT be resolved as a path on disk by
`abide build` or by `abide dev`.

36.16 `NODE_ENV` MUST default to `development` under `abide dev`, and to `production` under
`abide build` and `abide start`.

36.17 A file under `src/ui/public` whose `content-type` is `text/*` MUST name `charset=utf-8` where
its extension's type names none.

36.18 A seed buffer entry whose stream transcript passes `ABIDE_MAX_STREAM_BUFFER_SIZE`, counted in
the chunk type's default framing, MUST stop holding it, and the `Rpc` call it was for MUST be
answered per 41.12.

# 37. Lifecycle hooks

37.1 A lifecycle hook MUST be called rather than exported, and `src/server/app.ts` MUST be optional.

37.2 The `default` export MUST be the app's own route, answering where it returns a `Response`.

37.3 `middleware` MUST run pre-routing, over the request and the response, and over the upgrade to the
socket mux, which MUST NOT open where a rung answered in the lane's place.

37.4 `onStart` MUST wrap `createApp` and `onStop` MUST wrap `App.stop`.

37.5 `onError` MUST run on an unexpected error in that scope.

37.6 A hook `onStart` or `onStop` wraps that throws MUST fail hard, and the server MUST NOT
start.

37.7 `onConfig` and `onPrincipal` MUST replace rather than compose, and a second MUST warn.

37.8 Under `abide start` and `abide dev`, a rejection nothing handled and a throw nothing caught MUST
reach `onError` as 37.5's error does.

37.9 Under `abide dev`, a rejection nothing handled and a throw nothing caught MUST NOT end the
process.

37.10 Under `abide start` and the executable's `start`, a rejection nothing handled and a throw
nothing caught MUST stop the app through `App.stop`, and the process MUST then exit with 1.

37.11 Under `abide start` and the executable's `start`, `SIGTERM` and `SIGINT` MUST stop the app
through `App.stop`, and the process MUST then exit with 0.

37.12 A second `SIGTERM` or `SIGINT` while the app is stopping MUST end the process at once.

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

38.10 `abide logs` MUST be a live subscription to `log.records`, as `abide connect` makes one.

38.11 `abide compile` and `abide bundle` MUST produce a standalone artifact.

38.12 `abide lsp` MUST speak over stdio.

38.13 Asking `abide` for help MUST be a success, and an unknown command MUST NOT be.

38.14 `abide mcp` MUST be a bridge a model client spawns and kills, and `abide start` MUST NOT be
put in that position.

38.15 `abide dev` MUST hold the app in a child process and keep the listener in its own.

38.16 `abide dev` MUST replace that process to reload, and MUST force-close every live socket on
replacement.

38.17 `abide dev` MUST build the client into memory, unminified and entry-named by its source, and
MUST write nothing to disk.

38.18 A client build that fails under `abide dev` MUST NOT stop the server, and the reload client
MUST be served by the dev worker rather than out of the bundle.

38.19 `abide build` MUST copy `src/ui/public` into the built output, and each file MUST be listed in
the manifest 38.5 emits.

38.20 `abide dev` MUST answer a file under `src/ui/public` out of the source tree, per 38.17.

38.21 `abide start` MUST answer what `abide build` bundled under `/__abide/client`, and MUST answer
nothing else there.

38.22 `abide start` MUST answer 404 at an address no route matches, per 30.8.

38.23 The document `abide start` serves MUST load the client entry, and MUST load it from the head.

38.24 The document `abide start` serves MUST link the stylesheet `abide build` bundled, and MUST
link none where the build bundled none.

38.25 A request `abide dev` has not begun to answer when it replaces the worker MUST be answered
by the replacement.

38.26 `--root` MUST default to `src` where that holds a `src/ui`, and to the working directory
where that holds a `ui`.

38.27 A command that finds no app at its `--root` MUST fail, naming where it looked.

38.28 `--out` MUST default beside the app rather than beside the working directory.

38.29 The document `abide start` or `abide dev` serves MUST preload, from the head, every chunk its
route imports statically, and MUST NOT preload a chunk reached only through a dynamic import.

38.30 `abide start` MUST answer the document and the bundle in an encoding the request accepts
where it has one, and MUST name `accept-encoding` in `vary`.

38.31 `abide build` and `abide dev` MUST type an app with no `tsconfig.json` against a default
project, and MUST NOT compile it untyped.

38.32 `abide check` MUST check each `.abide` file as the program it lowers to.

38.33 `abide check` MUST exit non-zero where it reports an error, and MUST exit zero where it reports
warnings alone.

38.34 `abide check` MUST report a refusal the build would make as a finding, and MUST go on checking
every file that refusal does not stop.

38.35 `abide lsp` MUST report what 38.3 reports, over the text the editor holds rather than the
text on disk.

38.36 `abide dev` MUST send a response body as the app produces it.

38.37 `abide dev` MUST read no more of a response body whose length is not declared than the
connection has taken.

38.38 A response `abide dev` has begun to answer when it replaces the worker MUST end in an error.

38.39 `abide dev` MUST answer in the identity encoding.

38.40 `abide lsp` MUST answer a hover and a jump to a definition about the text it last checked, with
a name read by name as the `Reactive` it was declared as, a member of it as a member of the value, and
a component tag as the component it invokes.

38.41 `abide check` MUST hold every attribute a component tag passes to the type its component's
`props` call declares, and MUST report a mismatch on the attribute.

38.42 A worker `abide dev` did not replace that exits MUST be replaced, and every request it held
MUST be answered or ended rather than left open.

38.43 The project `abide scaffold` writes MUST depend on the abide that wrote it in a spelling that
installs, and MUST type the runtime its server modules run on.

38.44 `abide build` and `abide dev` MUST build the client with the plugins the app's `bunfig.toml`
names under `[serve.static] plugins`, after abide's own.

38.45 The executable `abide compile` writes MUST read nothing from the app's source tree or its build
when it runs.

38.46 The executable `abide compile` writes MUST NOT read a `bunfig.toml` where it is started.

38.47 `abide compile` given no `--out` MUST write the executable into the directory it was run from,
named after the app's `package.json` name without its scope.

38.48 `abide compile --platforms` MUST write one executable per platform, each named with its
platform as a suffix.

38.49 `abide compile` MUST refuse `--target` and `--platforms` given together.

38.50 The executable `abide compile` writes MUST take `--port` on `start` as `abide start` does.

38.51 The executable `abide compile` writes MUST answer every command `abide` answers.

38.52 The executable `abide compile` writes MUST refuse a command that needs the app's source, naming
the `abide` command that runs it.

38.53 The usage the executable `abide compile` writes prints MUST NOT list a command it refuses, nor a
flag only such a command reads.

38.54 `abide start` and the executable's `start` MUST open 38.7's shell on the app they serve.

38.55 Leaving the shell 38.54 opens with `exit` MUST stop the app.

38.56 Input to the shell `start` opens that ends MUST NOT stop the app.

38.57 A script the executable's `run` imports MUST resolve `abide`'s entries and the app's handler
modules to the ones the executable holds.

38.58 `abide run` and the executable's `run` MUST resolve the configuration under the app's identity.

38.59 `abide dev` and `abide start` MUST print every address the app answers at, the local one first.

38.60 38.7's shell MUST answer `help` with every word it takes.

38.61 A line the app logs while 38.7's shell is open on a terminal MUST NOT move the shell's prompt,
nor the line being typed — `log` or the console alike.

38.62 `abide call`'s args MUST be `name=value` words, each value coerced as 19.8 coerces a query's
and a name given twice a list, or one JSON object where the first word opens one.

38.63 38.7's shell MUST list each handler `call` reaches with its args, and with its `description`
where the declaration writes one as a literal.

# 39. Head and view transitions

39.1 A `<head>` element in a `.abide` file MUST contribute its children to the document head.

39.2 A `<head>` element MUST be top level, and MUST NOT appear inside a control block.

39.3 The build MUST hoist `<head>` contributions at compile time.

39.4 `<head>` contributions MUST be merged by key, and the deepest contributor MUST win. The shell's
`<head>` MUST be the outermost contributor.

39.5 A `<head>` contribution with no merge key MUST append in tree order.

39.6 On a client navigation the incoming page's keyed `<head>` contributions MUST replace the
outgoing page's by key, and a layout's MUST NOT move.

39.7 View transitions MUST be turned on by a `<style>` rule naming a view-transition selector or
property, and MUST NOT be turned on by a separate option.

39.8 Whether an app uses view transitions MUST be decided at build time from the compiled `<style>`
blocks, and MUST NOT be decided by a runtime walk of the document's stylesheets.

39.9 A `view-transition-name` transition MUST be awaited to the point the DOM is written, and MUST
NOT be awaited to the end of the animation.

39.10 A browser with no `view-transition-name` support MUST navigate as it otherwise would, and an
app MUST NOT be required to feature-detect.

39.11 A `<head>` contribution's merge key MUST be the tag for `<title>` and `<base>`, the `name` or
`property` attribute for `<meta>`, and `rel` with `href` for `<link>`.

39.12 The last `<head>` contribution for a key within one file MUST win.

39.13 In a browser, a `<head>` contribution that reads a value MUST follow it for as long as its page
or layout is mounted.

39.14 On a client navigation, a keyed `<head>` contribution that a leaving page or layout made and
no arriving one makes MUST return to the next-outer contributor's value for its key — the nearest
kept layout's, else the shell's — and MUST be removed where no outer contributor has that key.

# 40. Documentation

*Free-standing: these clauses govern the documentation system, which REGISTRY does not name — a
`{% snippet %}` is not something an app writes.*

40.1 The documentation site MUST be the package at `packages/dogfood`.

40.2 Every name REGISTRY carries MUST be documented against real `.abide` and `.ts` files.

40.3 Every `{% example %}` SHOULD carry an end-to-end spec.

40.4 A file an `{% example %}` names that is not part of the problem its summary names MUST NOT be
one of its files.

40.5 `{% example %}` MUST render the example's component inline, above a tab per file it is made
of, and the render MUST NOT be one of those tabs.

40.6 `{% snippet %}` MUST be how a page shows code from an example, in place of pasting it into a
fence.

40.7 A `{% snippet %}` anchor MUST be a line prefix matching exactly once, and the slice MUST run to the end
of the construct it opens.

40.8 Several `{% snippet %}` anchors separated by an elision MUST render as one fence in file
order, with the gap marked rather than closed.

40.9 A `{% snippet %}`'s caption, language and spine MUST be derived from its address.

40.10 A `{% snippet %}` anchor matching none or matching two MUST be a build failure.

40.11 A page MUST declare in `covers` which REGISTRY names it covers, and an overview or a reference
page MUST declare none.

40.12 Every name `covers` may claim MUST be claimed by exactly one page.

40.13 The voice, the vocabulary and the register of a title against a nav label MUST be
`docs/BRAND.md`'s, and MUST NOT be stated here.

40.14 An `{% example %}` MUST run the component it names in the docs app, and MUST NOT run a
stand-in for it.

40.15 A request an `{% example %}` makes MUST be answered by the docs app's own handlers, and MUST
NOT be answered by a fixture.

40.16 Instrumentation the documentation adds to an `{% example %}` MUST sit outside the render.

40.17 A page MUST embed one `{% example %}` per behaviour it teaches.

40.18 An `{% example %}` MUST demonstrate exactly one behaviour.

40.19 A readout the hand-written arm paired with an `{% example %}` renders MUST be one that example's
own source names.

40.20 An `{% example %}` MUST be embedded by exactly one page declaring `covers`.

40.21 An `{% example %}` MUST model a pattern from an app `docs/BRAND.md` names.

40.22 Every `{% example %}` a page embeds MUST be drawn from the same app.

40.23 A control an `{% example %}` renders MUST sit with the value it changes.

40.24 An `{% example %}` MUST prove the heading it sits under.

40.25 An `{% example %}` MUST NOT carry code its proof does not need.

40.26 The capability an `{% example %}` proves MUST be one the app it is drawn from would reach
for.

40.27 A heading that carries an `{% example %}` MUST be followed by it, with nothing between
them.

40.28 An `{% example %}`'s summary MUST state the situation it is in, and MUST NOT restate the
heading.

40.29 A comment in an `{% example %}`'s own source MUST fit on one line, and a reason longer than
that MUST go in the copy after the card.

40.30 A page's lead MUST read standalone, being what a section overview shows for that page, and
MUST NOT carry a relative link.

40.31 A page whose `covers` names one REGISTRY entry SHOULD open on a section giving that entry's
forms, the options they share, and a link to its reference page.

40.32 A page reporting the build's own results MUST NOT be listed in `NAV`.

# 41. Rendering and hydration

41.1 `render` MUST send nothing until the page and every layout around it are set up and built, and a
refusal or a throw before then MUST be answered at its own status by the nearest `error.abide`.

41.2 A render MUST start every asynchronous read up front and in parallel.

41.3 `render` MUST NOT be held for an unfinished stream: what the stream produced MUST go out
inline, and the rest MUST be picked up by the client's own request.

41.4 A render MUST continue past a value still in flight, opening the sink 3.4 opens.

41.5 Data MUST reach a browser by answering that browser's own `Rpc` call from the seed buffer, and
a document MUST NOT carry a copy of an answer.

41.6 Hydration MUST re-execute setup: every `<script>` and every `reactive` body runs
again, and a serialized setup result MUST NOT be adopted.

41.7 The `Rpc` calls that re-execution makes MUST be answered from the seed buffer.

41.8 A `{#for}` block over a cursor the server already painted MUST be reconciled against the replayed
productions by the block's key, and MUST NOT be appended to.

41.9 `render` MUST delimit a dynamic region with a comment anchor, and MUST NOT add a node, an
attribute or a wrapper to the document for any other purpose than 41.20's script.

41.10 A hydration mismatch MUST rebuild the enclosing block and MUST NOT rebuild the page, warning
on `abide:hydrate`.

41.11 A shared `layout.abide` MUST NOT be rebuilt between navigations.

41.12 An `Rpc` call the seed buffer cannot answer MUST fall through to running the handler, and
MUST warn on `abide:hydrate`.

41.13 The seed buffer MUST be filled from the production the render already had, and a handler
MUST NOT be run a second time to fill it.

41.14 A `{#for}` key the list repeats MUST reconcile the last row under that key, and MUST stop and
remove every row it shadows.

41.15 A repeated `{#for}` key MUST warn once for the block on `abide:hydrate`.

41.16 A seed buffer entry MUST answer one `Rpc` call, and MUST be dropped once it has.

41.17 A seed buffer entry no `Rpc` call takes MUST be dropped 30 seconds after the `render` that
filled it.

41.18 A seed buffer entry MUST be matched by `principal.caller`, the handler and the call's `Args`
key.

41.19 A `render` MUST set up a page and every layout around it, and let the turn's queued microtasks
run, before it builds any of their markup.

41.20 A `render` MUST write one inline script into the head once setup has run and before any
markup, starting each `Rpc` call the setup made as the request the browser's `Rpc` makes for it.

41.21 The browser's `Rpc` MUST take a call 41.20's script started in place of making it, once.

41.22 An `Rpc` call for args a seed buffer entry already answered MUST NOT warn on
`abide:hydrate`.

# 42. The app object

42.1 `createApp` MUST build the route table and compose every onion, per 16.15.

42.2 `createApp` MUST read `config` where it builds the app, and MUST NOT leave that read to the
first request.

42.3 `createApp` MUST NOT bind a socket.

42.4 A hook `onStart` wraps MUST NOT observe the port.

42.5 `App.fetch` MUST answer a `Request` where no socket is bound.

42.6 `App.fetch` MUST be `App.run` with dispatch over it, and MUST NOT be a second scope
constructor.

42.7 `App.run` MUST run its function in one scope, and MUST hand back what that function returned.

42.8 A `Request` on `App.run` MUST be optional, and a scope made without one MUST be the scope 22.1
and 22.8 throw in.

42.9 `App.listen` MUST be where the socket is bound, and MUST be what supplies `server`.

42.10 `App.stop` MUST stop accepting and drain what is in flight before `onStop` runs.

42.11 `App.stop` MUST end every live stream, close every open socket, and clear every timer the app
holds.

42.12 A second `App` in one process MUST share the first's socket-carried values, `config` and `global`
entries, per 9.16, 27.9 and 11.34.

42.13 A test MUST reach a handler through the same `App` a host holds, and abide MUST NOT generate a
client of its own for one.

42.14 `App[Symbol.asyncDispose]` MUST be `App.stop`, so an `App` held by `await using` MUST stop as
42.10 and 42.11 do when its scope exits.

42.15 `App.stop` asked again while the app is stopping MUST answer with the stop under way, and
`onStop` MUST run once.

# 44. The measurement harness

*Free-standing: these clauses govern the measurement harness, which REGISTRY does not name — a
`Sample` is not something an app writes.*

44.1 `harness/measure`, `harness/engine` and `harness/server` MUST each be reachable through only
the dependency each is named for, and `harness/report` MUST have none.

44.2 A `Work` record MUST partition nodes moved by node kind, and MUST NOT carry a total across
those kinds.

44.3 A DOM member `harness/measure` does not count MUST throw naming that member while a case is
armed.

44.4 A patched member MUST tally only where no patched member is already tallying, and
`harness/measure` MUST install its patches once for the process.

44.5 The patch set `harness/measure` installs MUST be the same list of interfaces and members in
both substrates.

44.6 A `Work` record MUST NOT carry a duration, and `time` MUST throw while the counters are armed.

44.7 A floor MUST be measured by running one arm twice under its own name, and `ratio` MUST report
a value inside that floor as a tag rather than as a number.

44.8 `batch` MUST interleave its arms, and MUST NOT run one arm in a block.

44.9 A `gate` MUST carry a revert installing the broken arm and what that arm reports, and a revert
leaving the gate passing MUST be reported as a failure.

44.10 `ratio` MUST throw where two samples disagree on substrate, on case or on batch size, and
where one arm is given twice.

44.11 A `Sample` MUST be at least 100 times the clock's measured resolution, and `batch` MUST throw
rather than report a smaller one.

44.12 A refusal MUST be taken where the `Sample` is constructed, and MUST NOT be deferred to where
it is reported.

44.13 `shares` MUST take the trace, the layer, the denominator and a threshold, and MUST throw
where the layer runs outside the denominator.

44.14 `shares` MUST report an observed ceiling of zero for an op under one frame.

44.15 A count of calls MUST be taken with `spyOn`.

44.16 `retained` MUST throw in a process with a DOM.

44.17 `allocated` MUST report a batch mean, and MUST NOT report a count an exact integer can be
compared against.

44.18 `batch` MUST throw in a parallel worker.

44.19 A hand-written arm under `harness/arms` MUST be paired with an `{% example %}`.

44.20 `measure` MUST report `wakes`, `bindingRuns` and `descents` as absent where no record has been
published, and MUST NOT report zero for one.

44.21 A published record MUST carry every field `measure` reads off it as a number, and `measure`
MUST throw naming each field that is absent.

44.22 A counter `measure` reads rather than counts MUST be published as a fixed-shape record
reached through `globalThis.__ABIDE_WORK__`.

44.23 `batch` MUST throw on a duration whose op touched an emulated DOM.
# 45. The assistant

45.1 `assistant` MUST answer only through a handler that yields it, and MUST NOT mount an address
of its own.

45.2 `assistant` MUST yield the same `AssistantEvent` sequence for one conversation whichever
`Provider` ran it.

45.3 `assistant` MUST refuse 400, before any `Provider` is reached, a transcript whose last
`AssistantMessage` is not the user's.

45.4 `assistant` MUST hold no conversation between calls, and MUST take the whole transcript with
each one.

45.5 `claudeCode` MUST send a transcript to Claude Code as one message, its earlier turns folded
above the last.

45.6 With `mcp`, the `Toolbox` `assistant` hands a `Provider` MUST list the tools `/__abide/mcp`
lists, and MUST call each through the `/__abide/mcp` of the app answering the request.

45.7 A `Toolbox` call MUST carry the asking request's `cookie` and `authorization` headers, and MUST
NOT carry any other header of it.

45.8 `mcp` over an MCP surface `ABIDE_MCP` has not opened MUST throw, naming `ABIDE_MCP`.

45.9 `claudeApi` MUST call the Messages API again with the tool results only while a turn stops for
`tool_use`, and MUST send each assistant turn's blocks back as they arrived.

45.10 `claudeApi` MUST throw where no `apiKey` is given, and MUST NOT read a key from the
environment.

45.11 A conversation reaching `maxTurns` with a tool call pending MUST end on a `done` whose `stop`
is `max_turns`, and MUST NOT run that call.

45.12 `claudeApi` MUST send the results of one turn's tool calls back in one message.

45.13 `claudeCode` MUST run a turn on the Claude Code of the bridge paired with the asking browser,
and MUST refuse 409 where none is paired.

45.14 A code `claudeCode.bridgeCommand` mints MUST pair one bridge with the browser that asked for
it, once, and MUST NOT pair once it has expired.

45.15 A bridge MUST run Claude Code with its built-in tools off, no setting source read and no MCP
server but the bridge's own, in an empty directory removed when the run ends.

45.16 A bridge MUST take from the site no Claude Code option `ClaudeCodeConfig` does not name.

45.17 An MCP request a bridge's Claude Code makes MUST be answered from the `Toolbox` of the turn it
was made in.

45.18 `claudeCode` MUST end a turn's run on the bridge when the caller hangs up.

45.19 `/__abide/bridge` MUST be gated by `ABIDE_BRIDGE`, and `claudeCode` MUST throw, naming
`ABIDE_BRIDGE`, where it is closed.

45.20 `claudeCode.bridge` MUST yield a `BridgeStatus` whenever the asking browser's pairing changes,
and MUST yield a fresh command where the standing one's code expires unpaired.

45.21 A failure the Messages API reports to `claudeApi`, or a bridge reports to `claudeCode`, MUST
refuse 502.

45.22 A bridge `claudeCode.bridge` has watched MUST be sent away once nothing watches it and it has
run no turn for 30 seconds.
