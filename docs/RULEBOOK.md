# Rulebook

Every rule that governs behavior, stated once, numbered.

## What this document is

A **rulebook**. One clause per requirement, and the clause answers exactly one question: *what must
hold?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| Constrains behavior, at build time or run time | here | a requirement is what two implementations have to agree on |
| Answerable from the type alone | REGISTRY.md | a signature is not a rule |
| Explains why the rule is this way | a guide in `packages/dogfood/src` | a reason is read once and never looked up |
| A measurement | the harness | a number in prose is a number nothing reruns |

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

## Contents

- [1. The reactive value](#1)
- [2. Reads](#2)
- [3. Probes](#3)
- [4. Writes and gates](#4)
- [5. Productions and identity](#5)
- [6. Expiry](#6)
- [7. Triggers](#7)
- [8. Stores](#8)
- [9. Streams and wired values](#9)
- [10. Sharing](#10)
- [11. Derived and keyed values](#11)
- [12. Effects](#12)
- [13. Selections](#13)
- [14. Tracking](#14)
- [15. Refusals](#15)
- [16. Handlers and transports](#16)
- [17. Response helpers](#17)
- [18. Following a `GET`](#18)
- [19. Mount paths and schemas](#19)
- [20. Generated surfaces](#20)
- [21. Generated headers](#21)
- [22. Request-scoped ambients](#22)
- [23. Route and connectivity](#23)
- [24. Tracing](#24)
- [25. Health](#25)
- [26. Principal](#26)
- [27. Configuration](#27)
- [28. Logging](#28)
- [29. Content security policy](#29)
- [30. Addresses and navigation](#30)
- [31. Reading and writing by name](#31)
- [32. Templating](#32)
- [33. Props](#33)
- [34. Script and style blocks](#34)
- [35. Pages, rendering and sinks](#35)
- [36. Environment and files](#36)
- [37. Lifecycle hooks](#37)
- [38. Commands](#38)
- [39. Head and view transitions](#39)
- [40. Documentation](#40)
- [41. Rendering and hydration](#41)
- [42. The app object](#42)
- [43. The measurement harness](#43)
- [44. The assistant](#44)

## Terms

A term below is a category the clauses are written over. It is defined here rather than in
REGISTRY.md because none of them is a name an app author writes.

| Term | Definition |
| --- | --- |
| read | A call to `s` or to `s.peek`. |
| write | A call to `s.set` or to `s.patch`. |
| gated | A production the `identity` comparison may collapse: one a write or a body mints, and not a chunk a stream lands. |
| probe | Any of `s.busy`, `s.ready`, `s.error`. |
| trigger | `s.refresh` or `s.invalidate`. |
| producer | A source a value can ask for a value: a body, a `store`, or the connection a subscriber's copy is carried over. |
| materialization | The making of a `Stored` from what a producer has yielded. |
| production | One materialization of a `Stored` that a reader may observe. |
| provisional | A body run that read a value which had not landed. |
| reader | An expression or effect that performed a read. |
| revalidation | A load started by `s.refresh` over a value still being served. |
| refusal | A `Failed` answered in place of a value. |
| wired | A `Reactive` a `socket` or an `Rpc` carries, at either end of the connection. |
| subscriber | A far end of a connection a wired `Reactive` is carried to. |
| version | The number one production of a `global` value a `GET` serves is named by on the wire. |
| namespace | The name a log line is written under, and what `DEBUG` selects. |
| entry | One key's slot in a `Keyed`. |
| scope | The lifetime a value is filed under and dropped with. |
| adoption | What a `reactive` body does with a `Reactive` it returned. |
| forwarding | The delegation between an adopting `Reactive` and the one it adopted. |
| propagation | The derivation of a probe from the values a body read. |
| sink | What 35.7 defines. |
| implementation | Anything claiming conformance to this document. |
| dependency's `.abide` | A `.abide` file under a `node_modules` directory or outside the app's root. |
| fence | A `server`, `public`, `lib` or `tests` directory. |
| handler file | A `.ts` of the app's own, neither a `.d.ts` nor a `.test.ts`, directly in a directory under no fence. |
| private handler | A handler a `<script server>` declares. |

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

2.5 On a value that is not a streaming producer, `s[Symbol.asyncIterator]` MUST settle as `s.then`
does, yielding once what it resolves with.

2.6 On a streaming producer, `s[Symbol.asyncIterator]` MUST yield the chunks of the run being served
from its first, and MUST end when that run closes.

2.7 `s.then` MUST resolve with the value where `s.busy` becomes false and 2.2 would not throw.

2.8 `s.then` MUST reject with what 2.2 throws, where 2.2 would throw.

2.9 A read MUST throw `NotLanded` where nothing has landed and no producer has failed.

2.10 `s.peek` MUST return `undefined` where 2.9 would throw.

2.11 `s.peek` MUST NOT join the flow.

2.12 A `NotLanded` thrown into a tracked body MUST abort that body.

2.13 A body a `NotLanded` aborted MUST rerun when the value it names lands.

2.14 A `NotLanded` and a `Failed` MUST be distinguishable by brand.

# 3. Probes

3.1 A probe MUST NOT throw.

3.2 A probe MUST answer about the value a read would serve, running what that read would run, and
MUST NOT otherwise start work.

3.3 Reading a probe MUST subscribe the reader to that value's probes together, and MUST NOT
subscribe it to the value.

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

4.7 A `transform` MUST run untracked, on the settled value, once per materialization of a `Stored`.

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

4.18 `s.set` MUST hand back the refusal a gate refused it with, and nothing where it was accepted.

# 5. Productions and identity

5.1 A reader MUST be woken only when read identity changes.

5.2 A production whose identity matches the previous `Stored` MUST mint nothing, and MUST wake no
reader.

5.3 `identity` MUST be discriminated by arity: one parameter is a projection compared by `!==`, and
two is a comparator answering directly.

5.4 The default `identity` MUST be the reference.

5.5 `structural` MUST answer "not equal" wherever it cannot decide.

5.6 A write MUST mint a production of its own.

5.7 `s.patch` MUST mutate the production it serves in place rather than mint one.

5.8 `throttle` and `debounce` MUST cap how often a value changes for a reader.

5.9 A capped window MUST cap the wake, and MUST NOT itself drop a production.

5.10 A cursor over a streaming producer MUST deliver every chunk a window collapsed.

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

# 6. Expiry

6.1 A `ttl` expiry MUST wake no reader.

6.2 `ttl` on a value with no producer MUST be inert.

6.3 An implementation MUST hold one expiry timer per value declaring `ttl`, armed at the deadline of
the production it serves.

6.4 A `ttl` expiry timer MUST NOT hold the process open.

6.5 A read finding the standing production past its `ttl` MUST NOT serve it.

6.6 A read finding the standing production past its `ttl` MUST run the producer.

6.7 A standing production past its `ttl` MUST be released.

6.8 A value whose standing production is past its `ttl` MUST report `s.ready` false.

6.9 An expiry MUST NOT report `s.busy` true.

6.10 A streaming producer's `ttl` MUST run from its run's close, and MUST NOT reach the run in
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

7.8 A load over a value marked stale MUST report `s.ready` false, and a read over it MUST throw
`NotLanded` until it lands.

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

8.6 A restore of a streaming producer MUST seed its accumulation with what was stored.

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

# 9. Streams and wired values

9.1 A streaming producer's `Stored` MUST be the chunks accumulated so far, materialized on the
read that asks for it.

9.2 An implementation MUST NOT accumulate chunks by copying the accumulation per chunk.

9.3 `identity` MUST compare against the previous production alone.

9.4 A production arriving over a connection MUST replace a write standing on the subscriber's copy.

9.5 A `store` MUST round-trip the latest production.

9.6 A `reactive` body declared as an async generator function MUST be a streaming producer from
construction, and a body whose run hands back an async generator, or a promise resolving to one,
MUST be one from that run on.

9.7 `s.refresh` on a streaming producer MUST serve the held accumulation until the new stream's
first chunk, and that stream's accumulation from then on.

9.8 A `schema` and a `transform` on a streaming producer MUST run on the accumulation a read
materializes, at most once per chunk the accumulation holds.

9.9 A streaming producer MUST wake its readers at most once per task.

9.10 `flushSync` MUST deliver the wakes a streaming producer is holding.

9.11 A write to a streaming producer MUST stand until its accumulation next changes, and an adoption
made by one (11.61) MUST end with it.

9.12 A write to a streaming producer MUST NOT move a cursor over it.

9.13 `s.patch` on a streaming producer MUST mutate its accumulation in place.

9.14 A subscriber's copy of a wired `Reactive` MUST report `s.busy` true until the first production
arrives.

9.15 A cursor over a streaming producer MUST throw, once it has yielded every chunk, the failure its
run ended on.

9.16 A cursor over a streaming producer MUST end where a new run replaces the one it was reading.

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

11.17 Adoption MUST inherit the adopted `Reactive`'s `identity` where the outer declared none, for as
long as it adopts it.

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

11.39 A reader detaching from a `global` streaming `reactive` MUST NOT cancel the producer for the
readers that remain.

11.40 `args` on a `reactive` MUST check `Args`.

11.41 `args` MUST be unspellable on the unkeyed `reactive` overload, and spelling it MUST be a compile
error naming the overload.

11.42 `store` on a `Keyed` MUST accept a function of the `Args`.

11.43 `tags` MUST be what a `Selection` matches on, and MUST be the only selector reaching across
values.

11.44 The function form of `tags` MUST receive the value's `Args`.

11.45 A `Keyed`'s `ttl` MUST be the life of the entry.

11.46 A `reactive` MUST accept a `schema`, gating what its body produced.

11.47 An adopting `reactive` MUST run its own `schema` on the way in, as 11.14 has it run its
`transform`.

11.48 A `Keyed` MUST hold one expiry timer, armed at its oldest entry.

11.49 An entry MUST take the newest position on every production and every `s.patch`.

11.50 Every probe MUST forward from the adopted `Reactive` to the adopting one.

11.51 Every trigger on an adopting `Reactive` MUST reach the adopted one.

11.52 A provisional run MUST mint no production.

11.53 A reader joining a `global` `reactive`'s stream after it began MUST NOT be answered with a
refusal.

11.54 A `reactive` MUST NOT report `s.ready` before its body has run for the value being probed.

11.55 A probe over a key a `Keyed` has not computed MUST allocate no entry.

11.56 An implementation MUST NOT warn where two `Args` keys differ only in the case of a value.

11.57 An unkeyed `reactive` MUST NOT recompute before a read or an `Effect` asks for its value.

11.58 An unkeyed `reactive` MUST report `s.ready` only where every value its body read reports it.

11.59 `s.set` and `s.patch` on an adopting `Reactive`, given anything but a `Reactive`, MUST reach the
adopted `Reactive`.

11.60 `args` spelled on a `reactive` whose body declares no parameter MUST refuse at construction.

11.61 `s.set` given a `Reactive`, and `reactive` opened on one, MUST adopt it per 11.12, and MUST NOT
store it as a value — on a streaming producer, as a write that 11.59 does not reach through.

11.62 A body answering `undefined` MUST land `undefined`.

11.63 A body a `NotLanded` aborted that something probes MUST rerun in the turn that lands the
value it named.

11.64 Reaching a `Keyed` with an `Args` member 11.24 cannot write — anything outside `JsonValue`
but a `Date`, or a number that is not finite — MUST throw, naming the path to the member.

11.65 An adoption that would close a cycle of adopting `Reactive`s MUST be refused where it forms,
naming the cycle.

11.66 `s.set` MUST throw 11.65's refusal, and a body whose answer 11.65 refuses MUST fail with it.

11.67 A `reactive` without `global` MUST be built afresh in each request that reaches it, from its
declaration and never from what a write outside every request left.

11.68 A keyed value's body MUST be handed what its `args` gate returned.

11.69 A `Keyed` entry whose load is in flight MUST NOT be evicted by its `ttl`, and its life MUST
start again when the load ends.

11.70 `s.set` MUST take only a `Reactive` whose `Failures` are this value's.

11.71 An unkeyed `reactive` with a `store`, built on a server outside every request, MUST NOT run
the `store`'s `get` before it is reached.

# 12. Effects

12.1 A `Disposer` MUST run before each rerun of its `Effect`, and once more at teardown.

12.2 An `Effect` MUST run immediately, and again whenever a reactive value it read changes.

12.3 Where sources are given to `watch`, the `Effect` MUST run only when those sources change.

12.4 A `watch` registered inside a component MUST be owned by that component.

12.5 On a server a `watch` MUST rerun as it does in a browser, and its `Disposer` MUST run at the
teardown of the scope it was opened in.

12.6 A throw from an `Effect` or a `Disposer`, and a read of a failed `Reactive` inside one, MUST
reach `onError` as thrown, and MUST warn on `abide:watch` with the trace.

12.7 In a browser a throw from an `Effect` MUST additionally surface as an uncaught error — re-thrown
to the caller of `watch` from its first run, and reported with `reportError` from a rerun — and
MUST NOT keep any other `Effect` the same turn woke from running.

12.8 An `Effect` that threw MUST stop its `watch`.

12.9 `s.watch` MUST be `watch` narrowed to that `Reactive`, and MUST NOT diverge from it on 12.1,
12.2 or 12.8.

12.10 An `Effect` a write woke MUST run at the end of that turn, and MUST NOT run once per write.

12.11 `flushSync` MUST end the turn where it is called.

12.12 A read MUST answer what the writes in its turn left, whether or not the `Effect` values they
woke have run.

12.13 A `watch` registered inside a `{#if}` arm or a `{#for}` row MUST stop when the region
holding that arm or row is removed.

12.14 A `reactive` over a body that is not a stream, built where 12.4, 12.5 or 12.13 would own a
`watch`, MUST stop reading its sources once that owner stops and nothing else reads it, and MUST
answer a later read with what its body computes then.

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

13.12 A pattern given beside a `Keyed` or an `Rpc` MUST narrow it to the entries whose `Args`
match the pattern.

13.13 A `Selection` made in any scope MUST reach every `global` `reactive` it matches, and every
entry of a `global` `Keyed` it matches.

13.14 A bare `refresh` MUST NOT rerun a synchronous derivation, which MUST recompute from the
load it reads.

13.15 On a server, a bare `invalidate` or `refresh`, or one over a set of `tags`, MUST also send the
same trigger to every copy a browser follows over the mux that the selection matches by the `tags`
its build copied, whether or not the server holds a value it matches, and MUST NOT send it to a copy
fed from a value the server holds.

13.16 A bare `refresh`, and `refresh` over a set of `tags`, MUST invalidate, and MUST NOT reload,
every value a mutation's `declare` built.

13.17 A bare `invalidate` or `refresh`, or one over a set of `tags`, MUST NOT invalidate a value a
mutation's `declare` built while its write is in flight.

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

14.19 The compiler MUST NOT report a warning on a reactive read where the line above the read holds
`abide-ignore` followed by the number of the clause the warning cites.

# 15. Refusals

15.1 A refusal MUST be a declared value, and MUST NOT be a status code or a transport concern.

15.2 A refusal MUST fill the `Failures` of the `Reactive` that produced it.

15.3 A refusal declared through `refuse.named` MUST default to status 400.

15.4 Constructing a `Failed` MUST be inert, and MUST NOT throw.

15.5 Returning a `Failed` MUST refuse.

15.6 `Failed` MUST be structural.

15.7 `notFound` MUST be returned where no route matched.

15.8 `validationError` MUST be returned where a `schema` or an `args` gate refuses, or where a call's
args leave a parameter of its route no spelling as a segment (30.3, 30.19) — in process as over the
wire, and before the handler runs — at status 422.

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

15.17 A route, a file under a `public` directory and the built bundle MUST answer a method nothing at
that address answers with a refusal at status 405 carrying an `allow` naming the methods answered
there.

15.18 A refusal declared through `refuse.named` MUST carry data only where it is given a `schema`,
and its data's type MUST be inferred from that `schema`; a `message` function MUST be accepted only
beside one.

15.19 A `Keyed` entry or an `Rpc` whose last answer was a refusal at status 500 or above, or a throw,
MUST run its body again for the next reach rather than serve that answer.

15.20 A refusal below status 500 MUST be held for the next reach as a production is, until its
`ttl` ends.

15.21 A refusal MUST cross a wire as Problem Details (RFC 9457) under `application/problem+json`: its
name as `type`, or `about:blank` titled by its status's reason phrase where it was not declared, its
message as `detail`, and its data as a `data` member.

15.22 The `notFound` 15.7 returns, and the 405 15.17 answers at a route, MUST be painted as a page's
failure where the request prefers `text/html` over `application/json`, and MUST cross as 15.21
states otherwise.

# 16. Handlers and transports

## The handler and its `Rpc`

16.1 A handler MUST be a `reactive`, a plain function, or a value.

16.2 `GET`, `POST`, `PUT`, `PATCH` and `DELETE` MUST give the handler a handler file exports as its
default an address over http: that file's route, per 23.14.

16.3 An `Rpc` MUST hand back the same `Reactive` shape the handler had, `Produced` included.

16.4 An `Rpc` MUST be callable in both arms, the call being what issues the request.

16.5 Which arm `GET` takes MUST be read off a brand the factory stamped, and MUST NOT be inferred
from the shape.

16.6 `GET` over a plain function or a value MUST behave as `GET` over a `reactive` of it, built with
the options `GET` was handed; a `reactive` or a `Keyed` handed in MUST take the address's options
alone.

16.7 A mutation over a plain function or a value MUST have its value's `ttl` default to 0 unless its
options declare one.

16.8 `Failures` on an `Rpc` MUST be the union of what the handler declared, what its rungs
declared, and the undeclared `Failed` named `HttpError` per 17.4, with no data, which the transport
may answer any call with.

16.9 `rpc.url` MUST take the `Args`, MUST write each parameter of its route into the path, and MUST
carry the rest in the query on a `GET` or a `DELETE` alone.

16.10 `rpc.url` MUST resolve a mount-relative address at run time, and the build MUST NOT bake an
absolute one.

## Middleware and arguments

16.11 A `Middleware` rung MUST run on every call, in process as much as over the wire.

16.12 The rungs in registration order, the `ctx.args()` coerce-then-validate, and `timeout` MUST run
on every call.

16.13 The `Origin` gate on a mutation, `maxBodySize`, the `crossOrigin` preflight, the framing, the
`cache-control`, a status written through `response` and the seed buffer write MUST be wire-only.

16.14 `Middleware` rungs MUST be composed once at route-table construction, and MUST NOT be folded per call.

16.15 A composed `Middleware` chain MUST capture the rung and the next link, and MUST NOT capture anything
per-request.

16.16 A `Middleware` rung MUST short-circuit by returning what the handler would have returned.

16.17 `ctx.args()` MUST parse on first call and cache for the request.

16.18 `ctx.args()` MUST hand back `Args` coerced and validated against the `args` the value
declared.

16.19 Validation MUST be lazy, on that first `ctx.args()` call.

16.20 A body that will not parse as `Args` MUST be answered 400.

16.21 A throw from a `Middleware` rung MUST escape the whole onion rather than unwind through it.

16.22 `timeout` MUST raise the request's idle timeout, and MUST only raise it.

16.23 A request's `timeout` floor MUST be the maximum over every handler that ran in it.

16.24 `crossOrigin` MUST default to false, and where it is declared abide MUST answer the `OPTIONS`
preflight itself. An `OPTIONS` naming no `access-control-request-method` is no preflight, and MUST be
answered per 15.17.

16.25 A handler MUST be request-bound where its rungs or its body read the request scope, and
calling one from a scope that has none MUST be a build error, per 11.37.

16.26 Shape MUST belong to the `Reactive` and MUST NOT be declared at the transport; a transport MUST
read it.

16.27 A `schema` MUST run where its `Reactive` lives.

## What crosses the wire

16.28 A browser MUST receive a generated `Rpc` wrapper carrying the method, the mount-relative address and
the description, and MUST NOT receive the handler file or the `<script server>` that declared it.

16.29 Importing a module under a `server` directory from the client graph MUST be a compile error,
and MUST NOT be a silent stub.

16.30 An `Rpc` returning a raw `Value` MUST transport as `application/json`.

16.31 An `Rpc` returning `undefined` MUST answer 204 where no status was written through
`response`.

16.32 An `Rpc` returning an async generator MUST stream in the framing `Accept` names, and MUST
default to the first framing its chunk type admits.

16.33 The seed buffer MUST hold an `Rpc`'s transcript in the chunk type's default framing,
whichever framing the caller asked for.

16.34 An `Rpc` returning a binary MUST transport as `application/octet-stream`, or as a `Blob`'s own
type where it has one.

16.35 A returned `Blob` MUST be range-aware: abide MUST read `Range`, honor `If-Range` against the
ETag it derives, and answer 206, 416 and 304 as the protocol requires.

16.36 A handler MAY return a `Response`, and an in-process caller MUST receive it unconverted.

16.37 Where a handler returns a `Response`, `clients.mcp` and `clients.cli` MUST default to false.

16.38 A mutation MUST answer a request preferring `text/html` as a navigation: a returned
`redirect` passes through, a returned value becomes 303 back to the referrer, and a failure renders
`error.abide` at its own status.

16.39 A handler whose value carries a `Reactive` below its top level MUST be a compile error naming
the handler and the path to it.

## Answers and failures

16.40 A `Failed` escaping a handler MUST be answered at its own `status`.

16.41 A throw that is not a `Failed` MUST be answered 500.

16.42 `rpc.raw` MUST issue the call the `Rpc` issues, differing only in handing back the
`Response`. On a server it MUST be answered in process by the `App` answering the request it is made
in, and by the `App` built last only outside every request, until that `App` stops, after which
such a call MUST NOT reach it.

16.43 An `Rpc` call MUST evaluate its `Args` at the call, and MUST NOT re-evaluate them.

16.44 A jsonl answer MUST write one JSON value per line, per pull, typed `application/x-ndjson` where
the reader asks for that type and `application/jsonl` otherwise.

16.45 An sse answer MUST frame each value as `data: <json>` followed by a blank line, with
`text/event-stream` and `cache-control: private, no-store`.

16.46 A stream of value chunks MUST admit jsonl and then sse, and a stream of binary chunks MUST
admit `application/octet-stream` alone.

16.47 Where no handler fixed the framing, the chunk type MUST be read from the first chunk
produced.

16.48 A call's `signal` MUST end the load the call reached only where every call that reached that
load passed a `signal`, and every one of those has aborted.

16.49 A load ended under 16.48 MUST keep serving what its value held, MUST report `s.busy` false,
MUST refuse with `aborted` at status 499, and MUST abort the request carrying it where one does.

16.50 A `HEAD` MUST be answered by the `GET` handler mounted at its address.

16.51 A `HEAD` MUST NOT take from the seed buffer.

16.52 An `Rpc` answer with no body — a 204, or a status `response` writes with nothing returned, a
`redirect` included — MUST NOT carry `content-type`.

16.53 The 303 16.38 answers MUST go to the mount's root where the referrer is absent or is not of
`APP_URL`'s origin, per 36.2.

## Ceilings and timeouts

16.54 `maxBodySize` and `ABIDE_MAX_REQUEST_BODY_SIZE` MUST default to no ceiling.

16.55 A mutation's body over the ceiling `maxBodySize` or `ABIDE_MAX_REQUEST_BODY_SIZE` sets MUST
be refused 413, whether its length was declared or streamed.

16.56 Where neither `timeout` nor `ABIDE_RPC_TIMEOUT` is set, a call MUST NOT raise the request's
idle timeout.

16.57 A `timeout` of `Infinity` MUST leave the request's idle timeout off.

16.58 Where a handler names no `timeout`, `ABIDE_RPC_TIMEOUT` MUST be its `timeout`.

16.59 A load that goes `timeout` milliseconds without settling, or without a stream's next chunk,
MUST be ended and MUST refuse with `refuse(504)`.

16.60 A load ended under 16.59 MUST keep serving what its value held, a stream's chunks so far
included, and MUST report `s.busy` false.

16.61 A call joining a load MUST NOT extend that load's `timeout`.

16.62 A call reaching a value whose last load ended under 16.48 MUST start a new load, under the `signal`
that call passed.

16.63 A throw answered once its request's signal has aborted — a handler's or a page render's — MUST
answer `aborted` at 499, and MUST NOT report the throw as unexpected.

16.64 An `Rpc` over a plain function MUST NOT run that function before the first call reaches it.

## Addresses and private handlers

16.65 Each parameter of the route a handler file answers at MUST reach its handler's `Args` from the
path.

16.66 A request naming a parameter of its route in its query or its body as well as its path MUST be
answered `refuse(400)`.

16.67 A handler whose `Args` does not declare each parameter of its route MUST be a build error
naming the handler and the parameter.

16.68 A refusal reaching a jsonl or an sse answer after its status was sent MUST be sent as its last
frame — a line `{"$refusal": <Problem Details>}`, or an `event: refusal` whose data is the Problem
Details — and a reader MUST refuse with it after the chunks before it.

16.69 A `[...rest]` segment MUST take the most parts of an address the segments after it leave, so
a handler declared under one MUST answer at its own name.

16.70 A private handler MUST have an address below `/__abide/handlers/`, named by its file's path
below the root, a segment's brackets and dots dropped, and then its binding's name, and MUST NOT
take a parameter from the path.

16.71 A private handler MUST NOT be listed on `/__abide/mcp`, on `/__abide/openapi.json` or by the
command line.

16.72 A private handler MUST run under the `middleware` and `onError` filed at the route 37.1 files
its file's hooks at.

16.73 A handler file's default export MUST be declared by a call of abide's `GET`, `POST`, `PUT`,
`PATCH` or `DELETE`, and any other export, however the language spells it, MUST be a build error
naming it.

16.74 A module of the client graph importing a handler file MUST receive the wrapper 16.28 states as
that file's default.

## Streamed answers and ceilings, continued

16.75 A streamed answer — jsonl, sse, bytes, or a document `page` hands a stream — MUST carry
`X-Accel-Buffering: no`.

16.76 An `Rpc` streaming under 16.32 MUST end its answer where the run it sends ends: at that run's
close, where a new run replaces it, and with the failure that run ended on.

16.77 A `timeout` MUST NOT end a `throttle` or `debounce` window holding a production back, and the
call MUST wait on that window as 5.15 has it.

16.78 A body `/__abide/mcp` or `/__abide/bridge` reads over the ceiling `ABIDE_MAX_REQUEST_BODY_SIZE`
sets MUST be refused 413, whether its length was declared or streamed.

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

17.9 `json` MUST be defined as a write through `response` fixing the answer as `application/json`,
serialized as a bare return is.

17.10 `json` given `undefined` MUST answer `null` at the status written through `response`, and MUST
NOT answer 204.

# 18. Following a `GET`

18.1 Every `GET` a page follows MUST be carried over a single web socket mux.

18.2 A subscription over the mux from another origin MUST be refused unless the handler's
`crossOrigin` admits that origin.

18.3 A client reading a `GET` MUST be subscribed over the socket mux to that handler's productions
for those `Args`.

18.4 A subscriber's copy of a wired `Reactive` MUST carry what that `Reactive` declares of `by` as a
property name, `tags` as a list of names, and `identity` as `structural`.

18.5 A `GET` answered from a `global` value MUST carry the version of the production it answered
with as its `etag`.

18.6 A subscription to a `GET` MUST be sent the value standing where the version it names is not
that value's version, and MUST NOT be sent it where it is.

18.7 A version MUST name one production or one `s.patch` of one value, and no other production or
patch in this process or in any earlier one.

18.8 A subscription to a `GET` that declares `middleware` MUST run that `middleware` once as it opens,
in the request it opens in, and MUST be sent productions only where the `middleware` admitted it.

18.9 A client subscribing to a `GET` MUST name the version the answer it holds carried.

18.10 A subscriber's copy of a `GET` MUST take every value sent to it.

18.11 An `s.patch` of a value a `GET` serves MUST be sent to a subscription standing at the version it
was made over as what it wrote, as JSON Patch (RFC 6902), and MUST NOT be sent as the value.

18.12 A subscriber's copy of a `GET` sent what a patch wrote over a version it does not hold MUST read
the value again.

18.13 An `s.patch` whose writes cannot be sent as data MUST be sent as the value.

18.14 A subscriber's copy of a `GET` MUST go stale when the `max-age` its answer carried runs out.

18.15 The build MUST warn where a `GET`'s `Reactive` declares `by` or `tags` by a value that is not a
function and whose type is not the one 18.4 carries.

18.16 Every frame on one connection to the socket mux MUST be answered in one request scope, whose
`request` is the upgrade's.

18.17 A connection's request scope MUST be torn down when the connection closes.

18.18 The signal of a connection's `request` MUST abort when the connection closes.

18.19 A `GET` 18.5 versions MUST answer `304 Not Modified`, with no body, where its `If-None-Match`
names the version standing.

18.20 A `GET` 18.5 versions MUST answer a reader preferring `text/event-stream` with a follow of the
value as server-sent events: each frame 18.6 through 18.13 would send it, its op as the `event`, its
version as the `id` and its value or JSON Patch as the `data`, from the version `Last-Event-ID`
names.

18.21 A subscriber's copy of a `GET` written to since it last took what the server sent MUST read the
value again rather than apply what a patch wrote, as 18.12 has it for a version it does not hold.

18.22 A `GET` answered with a production its `global` value no longer stands at MUST carry no version.

18.23 A `GET` answered with a binary MUST carry no version.

18.24 A client MUST NOT subscribe to a `GET` whose answer was a binary or a refusal.

18.25 A browser's connection to the socket mux MUST be opened again, in every tab, on the
`abide-principal` header 26.24 has an answer carry.

18.26 A subscription to a `GET` MUST pass the `middleware` 37.2 runs at the route of the file that
declared it, as it opens, and MUST NOT be fed where a rung answered in the handler's place.

18.27 A reader of a `text/event-stream` answer — an `Rpc`'s copy and `abide watch` alike — MUST read
it by the format's fields: a comment skipped, the space after a field's colon optional, `data` lines
joined, and an event ended by a blank line.

18.28 A frame received over a connection `App.listen` or `abide dev` upgrades to the socket mux that is
over `ABIDE_MAX_SOCKET_MESSAGE_SIZE` bytes, 1048576 where it is unset, MUST close that connection.

18.29 A connection `App.listen` or `abide dev` upgrades to the socket mux MUST be pinged while idle,
and MUST be closed where 120 seconds pass with nothing received over it.

18.30 A connection `App.listen` or `abide dev` upgrades to the socket mux MUST be closed with 1013
where a frame sent to it is dropped rather than sent or held, which happens once 16 MiB are held
unsent, and MUST NOT be sent the frames after it.

18.31 A subscription to a `GET` that would take one connection to the socket mux past
`ABIDE_MAX_SOCKET_SUBSCRIPTIONS`, 1024 where it is unset, MUST be refused 429.

18.32 A subscription to a `GET` naming an id its connection already follows MUST replace that one, and
MUST NOT count toward 18.31's bound.

# 19. Mount paths and schemas

19.1 A route MUST be answered for each method by one file at most, a page answering `GET` and `HEAD`
at its own, and a second MUST be a build error naming both files, two routes differing only in
their parameters' names being one route.

19.2 A `Schema` MUST return what it accepts.

19.3 An implementation MUST NOT accept a predicate as a `Schema`.

19.4 The plain-function `Schema` form MUST throw what it refuses, and that throw MUST be caught where
the schema runs and become the `''` entry of `Issues<T>`, or the whole of it per 19.19.

19.5 `Paths<T>` MUST be dot-joined, MUST be depth-limited, and MUST widen to `string` past the limit.

19.6 Coercion MUST belong to the pipeline, and MUST NOT be asked of a `Schema`.

19.7 A `GET` or `DELETE`'s text args MUST be coerced from the type the `JsonSchema` declares, before
validation.

19.8 Coercion MUST happen at the `ctx.args()` that first asks, and every rung after it MUST see the
coerced value.

19.9 Where no `schema` is given it MUST be derived from the type annotation and the argument
defaults.

19.10 A default MUST make a member optional, and a defaulted parameter MUST make `Args` itself
optional.

19.11 Where inference fails the compiler MUST read rather than refuse the file, and the derived
`Schema` MUST widen.

19.12 A `Schema` that answers asynchronously MUST be refused.

19.13 A page that does not call `jsonSchema` MUST NOT carry `validateJson`.

19.14 A `JsonSchema` given as a `Schema` without `jsonSchema` MUST be refused, naming
`jsonSchema`.

19.15 A default in a keyed body's parameter or a handler's parameter that is not a literal MUST
be refused at construction, naming its `Args` member, and the build MUST refuse one on a handler.

19.16 `route.url` MUST hold the address a page is served at, the path `APP_URL` names included, on
the server as in the browser.

19.17 A request for the path `APP_URL` names, without its trailing `/`, MUST be redirected 308 to
that path with one, by path alone.

19.18 A `Schema` derived per 19.9 MUST refuse a member its type does not declare, wherever the type
carries no index signature.

19.19 An `Issues<T>` over a value that is not an object MUST be the bare list of messages, not a
record keyed by `''`.

19.20 A request MUST be answered by the most specific route answering its method, ranked as 30.9
ranks routes for `navigate`.

19.21 What a handler answers MUST be derived at build as a JSON Schema from the value its `Rpc`
reads, and none MUST be derived where that value may be `undefined`, where the handler streams, or
where the derivation constrains nothing.

19.22 A `JsonSchema` derived per 19.21 MUST NOT refuse a member its type does not declare, and MUST
leave unconstrained a value whose type has a method.

19.23 A `jsonSchema` given no type argument MUST be accepted as the `Schema` of any slot it is given
to, and MUST NOT change the type of the value that slot gates.

19.24 The value a body produces MUST be typed from the body alone, and a `schema` declared beside it
MUST NOT change that type.

# 20. Generated surfaces

20.1 Every surface `Clients` names MUST be derived from the route table, and MUST NOT be authored
beside it.

20.2 Every key of `Clients` MUST default to true, but where 16.37 defaults it to false.

20.3 `Clients` MUST decide what is generated and listed, and MUST NOT decide who may call.

20.4 `ui: false` MUST generate no client wrapper, and importing that handler from the client graph
MUST then be a compile error naming it.

20.5 `/__abide/openapi.json` and `/__abide/mcp` MUST be served from a `reactive` over the route table,
and MUST take no `ttl`.

20.6 `/__abide/openapi.json` MUST publish OpenAPI 3.1, and MUST publish a handler's `JsonSchema`
with no translation. It MUST declare every path parameter, with or without a schema, an optional or
rest one as present and required as OpenAPI requires.

20.7 `/__abide/openapi.json` and `/__abide/mcp` MUST each be open exactly where the route table
lists a handler for it. What a closed one answers is 36.7.

20.8 Every `/__abide/**` address MUST run inside the app's own middleware.

20.9 `/__abide/mcp` MUST publish every handler it lists as a tool, a `GET` taking no args included,
and MUST NOT publish one as a resource.

20.10 A handler whose own `Middleware` rung would refuse a caller MUST still be listed, and MUST
still be refused on the call.

20.11 `/__abide/openapi.json` MUST publish a `Schema`'s own JSON Schema where it has one, probing
one spelling for it, and MUST publish the type-derived `JsonSchema` where it has none.

20.12 `/__abide/mcp` MUST refuse 403 a request whose `Origin` is another origin's, before it reads
the body.

20.13 A handler's name on `/__abide/mcp` and `/__abide/openapi.json` MUST be its method in lower case
and then its route, each joined by `_`, with every character but a letter, a digit and `-` written
`_` and a segment's brackets and dots dropped, and two handlers sharing one MUST be a build error
naming both.

20.14 Every tool `/__abide/mcp` lists MUST carry `annotations` read off its handler's method:
`readOnlyHint` true for a `GET` alone, `idempotentHint` true for a `GET`, a `PUT` and a `DELETE`
alone, and `destructiveHint` true for every method but `GET`.

20.15 `/__abide/openapi.json` MUST publish a handler's 19.21 schema as its `200` response's, and
MUST publish none where 19.21 derives none.

20.16 A tool `/__abide/mcp` lists MUST declare its handler's 19.21 schema as its `outputSchema`
where that schema is an object, and MUST declare none otherwise.

20.17 A `tools/call` that `/__abide/mcp` answers for a tool declaring an `outputSchema` MUST carry
the value as `structuredContent` beside its text, and a refused call MUST carry none.

# 21. Generated headers

21.1 Every response MUST carry `x-content-type-options: nosniff`.

21.2 Every response MUST carry `traceresponse`, a refusal included.

21.3 A page, an rpc answer and a refusal MUST default to `cache-control: private, no-store`.

21.4 `/__abide/openapi.json` and `/__abide/mcp` MUST answer `cache-control: no-store`. `/__abide/health`
and `/__abide/principal` are answered as handlers (25.3) and carry 21.3's `private, no-store`.

21.5 The built bundle MUST answer `cache-control: public, max-age=31536000, immutable`.

21.6 A page MUST carry `referrer-policy: strict-origin-when-cross-origin`.

21.7 An answer that depends on a request header MUST carry `vary` naming it.

21.8 A `GET` over a `global` `reactive` MUST answer a `max-age` derived from that value's `ttl`, and an
app MUST NOT be required to state the duration a second time.

21.9 A `GET` over a `global` `reactive` MUST answer `private`.

21.10 A write through `response` MUST override every header and the status the answer carries.

21.11 The `max-age` 21.8 derives MUST replace 21.3's `no-store`, and 21.3 MUST decide the rest
of that header.

21.12 A file under a `public` directory MUST answer `cache-control: public, max-age=0, must-revalidate`.

21.13 A file under a `public` directory MUST answer an `etag` derived from its bytes.

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

22.10 A write through `cookies` or `response` MUST throw once the response headers are out, and on
a connection to the socket mux, whose headers went out with the upgrade. A caller minted there MUST
be that scope's alone.

# 23. Route and connectivity

23.1 Each member of `route` MUST be its own `Reactive`, and `route` MUST NOT be one `Reactive` over a
composite.

23.2 `route.url` MUST be one `URL` instance per navigation, built when the route resolves.

23.3 A page route MUST be created where a `.abide` 23.21 makes a page has a template or a head.

23.4 A page route's file path MUST determine its `route.url`.

23.5 `Params` MUST carry what `[param]`, `[[optional]]` and `[...rest]` matched.

23.6 `route.name` MUST be the resolution path.

23.7 In a browser `online` MUST be `navigator.onLine` and its events.

23.8 On a server `online` MUST be true.

23.9 In a page or a layout, `route.params()` MUST be typed by that file's own route: a required
segment as text, an optional one as text that may be absent, a rest as a list, and in a layout any
segment a page below it adds.

23.10 `reachable` MUST be true where the host answered a request, whatever the status it answered.

23.11 `reachable` MUST be false where the host has not answered within 5 seconds.

23.12 `reachable` MUST hold each host's answer for 60 seconds, as a `global` value's `ttl` holds one.

23.13 `reachable` MUST ask a host that names no scheme over https, and an origin as written.

23.14 A route MUST be the path of its file below the app's `--root` without its extension, and an
`index.abide`'s, a `layout.abide`'s and an `error.abide`'s MUST be its directory's.

23.15 A file under a fence MUST NOT have a route.

23.16 A fence under a fence MUST be a build error naming both, save a `server` directory under a
`lib` or a `tests` directory.

23.17 A route whose first segment is `__abide` MUST be a build error.

23.18 An `index.abide`, a `layout.abide` or an `error.abide` under a fence MUST be a build error.

23.19 An `import '…' with { type: 'routes' }` in an app's `.abide` MUST place every `.abide` under the
directory it names, and every handler file, at the importing file's directory, routed by its path
below the named directory as 23.14 routes the app's own, and a specifier naming no directory MUST be a build error.

23.20 A directory two `type: 'routes'` imports name, or one that is the app's own, MUST be a build
error naming the mount.

23.21 A `.abide` of the app's own directly in a directory under no fence MUST be a page, save a
`layout.abide`, an `error.abide` and the root's `launcher.abide`.

23.22 A file of the app's own directly in a directory under no fence that is neither a `.abide` nor
a handler file MUST be a build error naming the file and a `lib` directory, save one beside the
`package.json` of a root that holds it, nor a `.ts`.

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

25.4 `Health` MUST admit a field an app declares on it for what its `onHealth` adds.

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

26.11 The `principal` seal MUST be a JWT (RFC 7519) signed HS256 rather than encrypted, its payload
the claims' own members beside `exp` and `iat`, and a token naming any other `alg` MUST read as no
seal.

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

26.23 Where a browser's load of the `principal` document is refused, `principal` MUST report an
unauthenticated caller carrying that refusal as `principal.error`.

26.24 Where a handler's `principal.set` or `principal.clear` ran, its answer MUST say so in an
`abide-principal` header, and a browser that reads `principal` MUST reload the document on it in
every tab, serving the one it holds until the new one lands per 7.4.

26.25 `Principal` MUST admit a field an app declares on it, of any type.

# 27. Configuration

27.1 `config` MUST throw what `onConfig` threw.

27.2 Precedence MUST be derived, then `config` from the app, then the environment.

27.3 `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` MUST be derived where the config does not carry
them.

27.4 `ConfigDefaults` MUST be synchronous by contract.

27.5 `config.invalidate` MUST re-read the environment and rerun `onConfig`.

27.6 Every `onConfig` filed MUST compose, in the order 37.7 states: the defaults each returns merged
over the ones before it, and its schema run per 27.7.

27.7 Each `onConfig` `schema` MUST be checked last, over the whole document, and what each accepts
MUST be merged over the document in the order 37.7 states.

27.8 A value out of `Env` MUST be coerced to the type of the default it overrides, and a value that
will not coerce MUST keep that default.

27.9 `config` MUST be an unkeyed `global` `reactive` over the precedence 27.2 states.

27.10 Filing or unfiling `onConfig` MUST invalidate `config`, so a read taken before the app's
module ran is not the one served after it.

27.11 `ConfigDefaults` MUST be handed the environment over what 27.3 derives.

27.12 `Config` MUST admit a field an app declares on it, of any type.

27.13 `abide check` and `abide lsp` MUST type `Config` with what the defaults of every `onConfig`
called as a statement at the top of a `<script server>` or a handler file return, and a union return with the keys
every member of it has.

# 28. Logging

28.1 Every line MUST be appended to `log.records`, an ordinary `reactive` holding the lines kept as an
array.

28.2 `log` MUST always write.

28.3 `log.warning` and `log.error` MUST always write.

28.4 `log.named` MUST prefix the app name, on a server and in a browser alike, and calling it again
MUST append another segment.

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

30.8 A route `url` and `navigate` take MUST be a page route, per 23.14, and MUST NOT be a handler
file's.

30.9 `navigate` MUST match the most specific route, ranking a static segment above a required
one, a required above an optional, and an optional above a rest, and where one route ends, its end
below a required segment and above an optional one.

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

30.26 `abide check` MUST refuse a `url` literal that no page route of the app (23.3) is filed under
and no public file of the app is served at.

30.27 A `navigate` whose request fails, or whose route's chunks fail to load, MUST leave the address
to the document.

30.28 A `Query` record and the args an `Rpc` carries in its URL MUST be written in one spelling: a
member left `undefined` omitted, a list its member repeated, an empty list its name with no `=`, and
anything else its text.

30.29 A back or forward history step `navigate` answers MUST restore the scroll the entry it arrives
at was left at, once that entry's page is mounted.

30.30 A page hydrated at an entry that carries the scroll it was left at, by a reload or a return to
the document, MUST land at that scroll.

30.31 A `navigate` that a later `navigate` overtakes before it mounts MUST abort the request it made
to `middleware`.

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
copy MUST NOT be optimized away.

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

31.16 `route.url`, `route.params`, `route.name` and `route.navigating` MUST each be read and written
as a name bound to a `Reactive` is, per 31.1 to 31.7.

# 32. Templating

32.1 `{expr}` MUST render reactive text, escaped.

32.2 `{raw(...)}` MUST render raw HTML.

32.3 A `name={expr}` attribute or property expression MUST be reactive, whole or interpolated.

32.4 `on<event>` MUST bind a native listener on an element, and MUST be an ordinary prop on a
component.

32.5 `bind:value` MUST read the property and write it back on input or change, through the member
path where its operand is a path into a value (31.8).

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

32.15 `{#for}` over an async iterable that is not also iterable MUST render each item as it
arrives, and MUST append rather than reconcile.

32.16 `{#try}` MUST be a render-time boundary over a region, and a failure MUST replace the whole
body.

32.17 A capitalized tag `<Name/>` MUST be a component invocation.

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

32.25 A bare `raw(...)` call MUST lower to a call to `raw` wherever a template expression whose
value reaches markup holds it: a slot, an attribute value, a `{#if}` condition, a `{#for}` subject,
and a value handed to a component. In a listener, a `bind:` operand and a `{#for}` key it MUST call
what the file binds.

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

32.33 A `{#for}` MUST take an `s.patch` written to a row's item, or to an object the patch reached
through it, as that item changing under 32.67.

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

32.39 An inline `{#component Name(pattern)}` MUST be TitleCase.

32.40 The pattern of a `{#component Name(pattern)}` MUST be read as the pattern of a `props` call,
and its annotation as that call's type argument.

32.41 A `{#component Name(pattern)}` MUST be accepted wherever a node may stand in a `.abide`
template: at its top level, inside an element, in a `{#if}`, `{#for}` or `{#try}` body, and in the
body of another `{#component Name(pattern)}`.

32.42 Every name in scope where a `{#component Name(pattern)}` is written — its file's `<script>`
and `<script module>` names, its file's imports, a `{#for}` row's item and index, a `{:catch e}`
binding, and an enclosing `{#component Name(pattern)}`'s props — MUST be in scope in its body.

32.43 A `{#component Name(pattern)}` MUST be in scope throughout the body it is written in, before
its declaration and in every body nested inside that one included, and in no other; that body is
the template's top level, a `{#for}` row, a `{#if}` or `{#try}` arm, what stands between the tags
of a `<Name/>` or a `<slot>`, or a `{#component Name(pattern)}`'s own, and an element around it is
not one.

32.44 A `{#component Name(pattern)}` MUST be in scope in its own body.

32.45 A `<style>` block of a file MUST apply to the elements its `{#component Name(pattern)}`
blocks write.

32.46 A `<script>` written in the body of a `{#component Name(pattern)}`, outside any block in it,
MUST be that component's per-instance setup.

32.47 A `<style>` written in the body of a `{#component Name(pattern)}`, outside any block in it,
MUST apply to the elements that component writes, and to no other element its file writes.

32.48 A `{#component Name(pattern)}` whose body holds two `<script>` blocks outside any block in it
MUST be a build error.

32.49 A `{#component Name(pattern)}` whose name another `{#component Name(pattern)}` in the same
body also declares MUST be a build error.

32.50 A `{#component Name(pattern)}` written directly between the tags of a `<Name/>` MUST be passed
to that component as the prop its name spells.

32.51 A `{#component Name(pattern)}` passed under 32.50 MUST NOT be in scope in the body the
`<Name/>` it is passed to stands in.

32.52 A `{#component Name(pattern)}` passed under 32.50 MUST NOT be among the children a `<slot/>`
renders.

32.53 A `<Name/>` given a prop both as an attribute and as a `{#component Name(pattern)}` passed
under 32.50 MUST be a build error.

32.54 `abide check` MUST hold a `{#component Name(pattern)}` passed under 32.50 to the type its
component's `props` call declares for that prop, and MUST report a mismatch on the
`{#component Name(pattern)}`.

32.55 A `{#component Name(pattern)}` at the template's top level whose name an import, a `<script>`
declaration or a `<script module>` declaration of its file also binds MUST be a build error.

32.56 A `{:catch}` or a `{:finally}` anywhere but directly inside a `{#try}` MUST be a build
error.

32.57 An `await` in a template expression — a slot, an attribute value, a listener, a `bind:`
operand, a `{#if}` condition, a `{#for}` subject or key, or a value handed to a component — outside
any function that expression declares, MUST be a compile error.

32.58 A `bind:value` MUST be numeric once its value has been a number or its input is `type=number`
or `type=range`, and MUST stay numeric for the life of the binding; a numeric bind MUST write a
number for text that reads as one, `undefined` for blank text, and nothing for any other text.

32.59 A numeric `bind:value` MUST NOT write its value into the property while the property's text
already reads as that number.

32.60 A `bind:value` MUST NOT write between a `compositionstart` and its `compositionend`, and MUST
write once on the `compositionend`.

32.61 The server MUST render a `<textarea>`'s `bind:value` as its text, and a `<select>`'s as
`selected` on the option its value selects — the first whose value reads as the value's text, or
each one a list holds under 32.62.

32.62 A `bind:value` on a `<select multiple>` MUST hold a list: each option is selected where the list
holds its value as text, and a change MUST write the values of the selected options, in order.

32.63 A `{#if}`, `{#for}`, `{#try}` or `{#component Name(pattern)}` not closed by its own close tag
before the end of the file, or before the close tag of the element it was opened in, MUST be a build
error at the tag that opened it.

32.64 An `{:else}` anywhere but directly inside a `{#if}`, and a close tag that does not name the
innermost open block, MUST be a build error at that tag.

32.65 A template tag spelled as a block — `{#name}`, `{:name}`, `{/name}` or `{@name}` — whose name is
none of the blocks 32.12, 32.13, 32.16 and 32.39 govern MUST be a build error naming those blocks.

32.66 A region emptied while a `bind:element` exit (32.38) holds a node in it MUST be filled by what
arrives in it next as an empty region, and the held node MUST NOT be hydrated as that arrival's
markup.

32.67 A `{#for}` MUST keep the row and the nodes of a key it keeps when that key's item is a
different value, and MUST update the row's bindings that read the item in place.

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

33.21 A prop a `<Name/>` passes as a bare attribute, a name with no value, MUST reach the child as
`true`.

33.22 A `props` rest element handed on whole MUST carry each key's value, read where it is read,
and MUST NOT carry the accessor.

33.23 `Attributes<Tag>` MUST type each attribute `Tag` takes under its HTML name, by every value
that writes that attribute per 32.37.

33.24 `Attributes<Tag>` MUST type an `on<event>` member's event as the one `Tag` dispatches, with
that element as its `currentTarget`.

33.25 A `props` rest element MUST NOT hold `children`.

33.26 `Attributes<Tag>` over an SVG element MUST type the SVG attributes, presentation attributes
included, under the names SVG spells them, and a tag both HTML and SVG name MUST be typed as the HTML
element.

# 34. Script and style blocks

34.1 A `<script>` block MUST be per-instance component setup.

34.2 A `<script module>` block MUST be module scope, on a server as in a browser.

34.3 A `<script>`, a `<script module>` or a `<script server>` MUST NOT await at its top level, and
one that does MUST be a compile error.

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

34.12 A `<script>` carrying a `lang` attribute MUST be a compile error.

34.13 `generics` on a component's `<script>` MUST declare that component's type parameters: its
blocks and template MUST be checked for every type they admit, and a `<Name/>` MUST infer them from
the props it passes.

34.14 A relative specifier any script block imports from MUST resolve against the `.abide` file it
is written in.

34.15 A `.abide` file any script block names in an `import()` MUST resolve to the module that file
compiles to, as a static import of it does.

34.16 A `.abide` file a server module imports MUST resolve to a function that binds its props and
answers a `Component`, under `abide dev`, `abide start` and `abide compile` alike.

34.17 An `export` in any script block of a `.abide`, however the language spells it, MUST be a compile
error.

34.18 A write a `<script>` makes outside any function to a `let` or `var` its file's
`<script module>` declares, holding no `Reactive`, MUST be warned on.

34.19 A `<script server>` block MUST be module scope run on a server alone, and the module a browser
loads MUST NOT carry it.

34.20 A `<script server>` in a `.abide` file of the app's own under a `server` or `public` directory
MUST be a compile error.

34.21 A file a script block imports `with { type: 'text' }`, a `.abide` among them, MUST be imported
as its text and typed a `string`, on a server, in a browser and to the checker alike.

34.22 A binding a `<script server>` imports that its file's `<script module>` or `<script>` imports
from the same specifier under the same name MUST compile as that one binding, a value wherever any
of them imports it as one. Where that binding is a `.abide`'s default or namespace imported as a
value by both, it MUST be a compile error, since the server block's is the bound function (34.16)
and the other's the module (32.17).

34.23 A `.abide` file any script block imports MUST be compiled with the app that imports it,
wherever it lies.

34.24 A dependency's `.abide` MUST be a component, and MUST NOT be an address, save where a mount
places it (23.19).

34.25 A dependency's `.abide` MUST be typed by the project of the app that imports it.

34.26 A dependency's `.abide` MUST run on the abide that the app's root resolves.

34.27 A dependency's `.ts` MUST NOT give a handler an address, save the one a mount places it at
(23.19).

34.28 A `<script>` carrying a `server` attribute with a value, or beside any other attribute, MUST be
a compile error.

34.29 A `</script>` that closes no `<script>` MUST be a compile error.

34.30 A `</script>` inside a string, a template, a comment or a regular expression in a `<script>`,
`<script module>` or `<script server>` block MUST be a compile error.

# 35. Pages, rendering and sinks

35.1 A `layout.abide` MUST render every page whose route lies below its own through a slot.

35.2 An `error.abide` MUST be resolved nearest-ancestor by route, as a layout is.

35.3 An `error.abide` that itself fails MUST escalate past the boundary, and MUST warn on
`abide:render`.

35.4 `render` MUST take a `Component` already bound to its props.

35.5 `render` MUST produce a document as its bytes.

35.6 `render` MUST render into abide's own document, which carries an encoding and a viewport, each
keyed, and nothing else.

35.7 A sink MUST be a hole a `render` leaves where a value is still in flight, for the browser to
fill once that value lands.

35.8 An attribute a sink fills MUST be filled on the element itself.

35.9 A sink inside RCDATA MUST fill through the element's own property rather than through markup.

35.10 The batching unit of a sink fill MUST be the turn and MUST NOT be the production.

35.11 A `render` MUST close when its walk is done, and MUST NOT write a sink's fill into the
document it streams.

35.12 Two `layout.abide` files, or two `error.abide` files, at one route MUST be a build error naming
both.

35.13 A `layout.abide` with no template MUST NOT wrap a page.

35.14 An `error.abide` with neither a template nor a head MUST NOT answer for a page.

35.15 The outermost component of a render — the root `layout.abide` of a page, or the component given
to `render` — written inside `<html>` MUST write the document: its `<head>`'s children
MUST contribute to the head as a `<head>` block's do, its `<body>`'s children MUST be its template,
and the attributes of its `<html>` and `<body>` MUST be written onto the document's own two.

35.16 An `<html>` or `<body>` in a page, an error page or any layout but the root `layout.abide`,
one nested in markup, one with markup beside it, or an `<html>` holding anything but a `<head>` and a
`<body>`, MUST be a build error, and a component writing `<html>` placed inside another MUST be
refused where it renders.

35.17 An attribute on the document's `<html>` or `<body>` MUST be typed, rendered and bound as one
on any element is.

# 36. Environment and files

36.1 `PORT` MUST default to 3000, and a command's own port flag MUST override it by declaring it.

36.2 `APP_URL`'s origin MUST be what both origin gates compare against.

36.3 `NODE_ENV` MUST be read verbatim, and MUST be defaulted from the command where unset.

36.4 `APP_DATA_DIR` MUST be a path, and abide MUST NOT create it.

36.5 `ABIDE_PRINCIPAL_SECRET` MUST accept a comma-separated list.

36.6 `ABIDE_APP_TOKEN` and `ABIDE_APP_URL` MUST be read by the remote CLI only.

36.7 A closed surface — `/__abide/openapi.json` or `/__abide/mcp` (20.7), or `/__abide/bridge`
(44.19) — MUST answer 404.

36.8 `ABIDE_LOG_FORMAT` unset MUST follow the TTY.

36.9 `NO_COLOR` MUST beat `FORCE_COLOR`.

36.10 A module MUST be importable from either graph unless it lies under a `server` directory, per
16.29.

36.11 A file under a `public` directory MUST be answered at that directory's path below the app's
`--root` followed by its own path below that directory, rooted at the mount rather than at the
origin.

36.12 A file under a `public` directory MUST be answered with the bytes as authored.

36.13 A file under a `public` directory answered at a route's address, or at another such file's,
MUST be refused by `abide build` and by `abide dev`, naming both.

36.14 A file under a `public` directory MUST carry a `content-type` derived from its extension.

36.15 A URL in the client bundle naming the address of a file under a `public` directory MUST resolve
to that address below the path `APP_URL` names, and MUST NOT be resolved as a path on disk by
`abide build` or by `abide dev`.

36.16 `NODE_ENV` MUST default to `development` under `abide dev`, and to `production` under
`abide build` and `abide start`.

36.17 A file under a `public` directory whose `content-type` is `text/*` MUST name `charset=utf-8` where
its extension's type names none.

36.18 A seed buffer entry whose stream transcript passes `ABIDE_MAX_STREAM_BUFFER_SIZE`, counted in
the chunk type's default framing, MUST stop holding it, and the `Rpc` call it was for MUST be
answered per 41.12.

# 37. Lifecycle hooks

37.1 A lifecycle hook MUST be filed at the route of the `.abide` or the handler file that called it,
one under a `lib` or a `tests` directory at the route of the directory holding that one, and at the
root route where neither did; a call MUST be read as a hook only where it names a hook the module
imports from abide, under any name, or a member of a namespace it imports from abide.

37.2 `middleware` filed below the root route MUST run after routing, over a request its route or a
route below it answers, outermost route first.

37.3 `middleware` filed at the root route MUST run pre-routing, over the request and the response, and over the upgrade to the
socket mux, which MUST open only at its own address below the mount, only in an app with a handler
to carry, and MUST NOT open where a rung answered in the lane's place — under `abide dev` as under
`abide start`.

37.4 `onStart` MUST wrap `createApp` and `onStop` MUST wrap `App.stop`, each composed in the order 37.7
states, the first filed outermost.

37.5 `onError` MUST run on an unexpected error in a request its route or a route below it answers,
nearest route first, and on one outside every request where filed at the root route.

37.6 A hook `onStart` or `onStop` wraps that throws MUST fail hard, and the server MUST NOT
start.

37.7 `onConfig`, `onPrincipal`, `onStart`, `onStop` and `onHealth` MUST each compose every hook filed,
by route depth, then by route, then in the order called — the answers of `onConfig` and
`onPrincipal` merged, a later one's member over an earlier one's.

37.8 Under `abide start` and `abide dev`, a rejection nothing handled and a throw nothing caught MUST
reach `onError` as 37.5's error does.

37.9 Under `abide dev`, a rejection nothing handled and a throw nothing caught MUST NOT end the
process.

37.10 Under `abide start` and the executable's `start`, a rejection nothing handled and a throw
nothing caught MUST stop the app through `App.stop`, and the process MUST then exit with 1.

37.11 Under `abide start` and the executable's `start`, `SIGTERM` and `SIGINT` MUST stop the app
through `App.stop`, and the process MUST then exit with 0.

37.12 A second `SIGTERM` or `SIGINT` while the app is stopping MUST end the process at once.

37.13 A lifecycle hook called in a module of the app's own that is neither a `.abide` nor a handler
file MUST be a build error naming the module and the hook.

# 38. Commands

## The commands

38.1 `abide scaffold` MUST write a starter project, and MUST skip a step already done.

38.2 `abide run` MUST pass everything after the file to the script.

38.3 `abide check` MUST report every diagnostic on the `.abide` line.

38.4 `abide dev` MUST watch the project and keep the app up.

38.5 `abide build` MUST emit content-hashed chunks and a manifest, minified and precompressed.

38.6 `abide start` MUST boot what `abide build` produced.

38.7 `abide` given `--url` and no command MUST boot nothing.

38.8 `abide call` MUST be the one spelling for calling a handler, in argv and in the shell alike.

38.9 `abide openapi` and `abide mcp` MUST derive from the same route table the served surfaces do,
per 20.1.

38.10 `abide compile` and `abide bundle` MUST produce a standalone artifact.

38.11 `abide lsp` MUST speak over stdio.

38.12 Asking `abide` for help MUST be a success, and an unknown command MUST NOT be.

38.13 `abide mcp` MUST be a bridge a model client spawns and kills, and `abide start` MUST NOT be
put in that position.

## `dev`, `build`, `start` and `check`

38.14 `abide dev` MUST hold the app in a child process and keep the listener in its own.

38.15 `abide dev` MUST replace that process to reload, and MUST force-close every live socket on
replacement.

38.16 `abide dev` MUST build the client into memory, unminified and entry-named by its source, and
MUST write nothing to disk.

38.17 A client build that fails under `abide dev` MUST NOT stop the server, and the reload client
MUST be served by the dev worker rather than out of the bundle.

38.18 `abide build` MUST copy every `public` directory into the built output, and each file MUST be
listed in the manifest 38.5 emits.

38.19 `abide dev` MUST answer a file under a `public` directory out of the source tree, per 38.16.

38.20 `abide start` MUST answer what `abide build` bundled under `/__abide/client`, and MUST answer
nothing else there.

38.21 `abide start` MUST answer 404 at an address no route matches, per 30.8.

38.22 The document `abide start` serves MUST load the client entry, and MUST load it from the head.

38.23 The document `abide start` serves MUST link the stylesheet `abide build` bundled, and MUST
link none where the build bundled none.

38.24 A request `abide dev` has not begun to answer when it replaces the worker MUST be answered
by the replacement.

38.25 `--root` MUST default to `src` where the working directory holds one, and to the working
directory otherwise; and the app it finds MUST be the one the whole command means — what it builds,
boots, serves and announces.

38.26 A command that finds no app at its `--root` MUST fail, naming where it looked.

38.27 `--out` MUST default beside the app rather than beside the working directory.

38.28 The document `abide start` or `abide dev` serves MUST preload, from the head, every chunk its
route imports statically, and MUST NOT preload a chunk reached only through a dynamic import.

38.29 `abide start` MUST answer the document, the bundle and an `Rpc`'s JSON answer in an
encoding the request accepts where it has one, and MUST name `accept-encoding` in `vary`.

38.30 `abide build` and `abide dev` MUST type an app with no `tsconfig.json` against a default
project, and MUST NOT compile it untyped.

38.31 `abide check` MUST check each `.abide` file as the program it lowers to.

38.32 `abide check` MUST exit non-zero where it reports an error, and MUST exit zero where it reports
warnings alone.

38.33 `abide check` MUST report a refusal the build would make as a finding, and MUST go on checking
every file that refusal does not stop.

38.34 `abide lsp` MUST report what 38.3 reports, over the text the editor holds rather than the
text on disk, and every refusal the app's tree makes of the file, as the tree was last saved.

38.35 `abide dev` MUST send a response body as the app produces it.

38.36 `abide dev` MUST read no more of a response body whose length is not declared than the
connection has taken.

38.37 A response `abide dev` has begun to answer when it replaces the worker MUST end in an error.

38.38 `abide dev` MUST answer in the identity encoding.

38.39 `abide lsp` MUST answer a hover and a jump to a definition about the text it last checked, with
a name read by name as the `Reactive` it was declared as, a member of it as a member of the value, and
a component tag as the component it invokes.

38.40 `abide check` MUST hold every attribute a component tag passes to the type its component's
`props` call declares, and MUST report a mismatch on the attribute.

38.41 A worker `abide dev` did not replace that exits MUST be replaced, and every request it held
MUST be answered or ended rather than left open.

## Scaffolding, compiled executables and the shell

38.42 The project `abide scaffold` writes MUST depend on the abide that wrote it in a spelling that
installs, and MUST type the runtime its server modules run on.

38.43 `abide build` and `abide dev` MUST build the client with the plugins the app's `bunfig.toml`
names under `[serve.static] plugins`, after abide's own.

38.44 The executable `abide compile` writes MUST read nothing from the app's source tree or its build
when it runs.

38.45 The executable `abide compile` writes MUST NOT read a `bunfig.toml` where it is started.

38.46 `abide compile` given no `--out` MUST write the executable into the directory it was run from,
named after the app's `package.json` name without its scope.

38.47 `abide compile --platforms` MUST write one executable per platform, each named with its
platform as a suffix.

38.48 `abide compile` MUST refuse `--target` and `--platforms` given together.

38.49 The executable `abide compile` writes MUST take `--port` on `start` as `abide start` does.

38.50 The executable `abide compile` writes MUST answer every command `abide` answers.

38.51 The executable `abide compile` writes MUST refuse a command that needs the app's source, naming
the `abide` command that runs it.

38.52 The usage the executable `abide compile` writes prints MUST NOT list a command it refuses, nor a
flag only such a command reads.

38.53 `abide` and the executable given no command and no running app to talk to MUST serve the app
and open 38.7's shell on it.

38.54 Leaving the shell 38.53 opens with `exit` MUST stop the app.

38.55 Input that ends MUST NOT stop the app `abide` serves under 38.53.

38.56 A script the executable's `run` imports MUST resolve `abide`'s entries and the app's handler
files to the ones the executable holds.

38.57 `abide run` and the executable's `run` MUST resolve the configuration under the app's identity.

38.58 `abide dev`, `abide start` and the app 38.53 serves MUST print every address the app answers at,
the local one first.

38.59 38.7's shell MUST answer `help` with every word it takes.

38.60 A line the app logs while 38.7's shell is open on a terminal MUST NOT move the shell's prompt,
nor the line being typed — `log` or the console alike.

38.61 `abide call`'s args MUST be `name=value` words, each value coerced by the app it reaches as
19.7 coerces a query's and a name given twice a list, or one JSON object where the first word opens
one.

38.62 38.7's shell MUST list and complete each handler `call` reaches that `clients.cli` does not
withhold, with its args, and with its `description` where the declaration writes one as a literal.

## Ports, rebuilds and encodings

38.63 `abide dev` given neither `--port` nor `PORT` MUST listen on the first free port from 3000
through 3099.

38.64 `abide dev` given a port by `--port` or `PORT` MUST NOT listen on any other.

38.65 Each compile `abide dev` makes MUST compile the tree as it stands: what an earlier compile in
the same process found MUST NOT change what a later one emits.

38.66 Each file `abide build` writes MUST replace its predecessor whole, and a build MUST remove from
its output only a file it did not produce that was written before it began.

38.67 `abide start` and the executable's `start` MUST NOT read their input.

38.68 An `Rpc`'s JSON answer under 1024 bytes MUST be answered in the identity encoding.

38.69 `abide watch` MUST follow a `GET` per 18.20, and print its value and its value after each
`s.patch`.

## The desktop app

38.70 The executable `abide bundle` writes, started on macOS with no command, MUST open a window on
the app rather than 38.53's shell, and given a command MUST answer it as 38.50 does.

38.71 The window `abide bundle`'s executable opens MUST show the launcher page where nothing is
remembered, offering to start the app in the process and to connect to one running at a URL.

38.72 The launcher's start form MUST ask for each field the `onConfig` schema's JSON Schema
declares, or each field `onConfig`'s defaults return where the schema has none, and MUST boot the
app with its values as the environment, showing a refusal by field.

38.73 The launcher MUST remember a start's values or a connect's URL under `APP_DATA_DIR`, and MUST
start or connect the same way at the next launch.

38.74 The `disconnect` role MUST stop the app the launcher serves, forget what 38.73 remembered, and
show the launcher page.

38.75 The app `abide bundle`'s launcher serves MUST listen on loopback alone, on the port the last
launch served it on where that port is free.

38.76 Quitting the launcher MUST stop the app it serves through `App.stop` before the process exits.

38.77 `abide bundle` MUST refuse on a platform other than macOS, naming `abide compile`.

38.78 `abide bundle` given no `--out` MUST write the `.app` into the directory it was run from, named
as 38.46 names the executable.

38.79 `abide bundle` MUST give the `.app` the icon the public file answered at `/icon.icns` holds,
or one drawn at every size from the one at `/icon.png` where there is no `.icns`.

38.80 The desktop app MUST read what the `onLauncher` `src/launcher.abide` calls answers as it
launches, and MUST refuse to launch on a key it does not take, or a value of a type the key does not
take.

38.81 `LauncherOptions` MUST NOT admit turning off both `start` and `connect`, and the desktop app
MUST refuse to launch on an `onLauncher` answer that does.

38.82 Where the app's `src/launcher.abide` has markup of its own, the launcher MUST render it
through `render`, bound to the `Launch` it would show, in place of its own page; one holding script
blocks alone MUST leave the launcher's own page standing.

38.83 A form `onLauncher` turns off MUST have no address in `Launch`, MUST NOT be
answered, and MUST NOT be done again at launch, and turning `connect` off MUST take the `connect`
item out of the default menu bar.

38.84 The page `src/launcher.abide` renders MUST carry its own `<style>` in the head of the
document it renders into.

38.85 A `src/launcher.abide` that fails to render MUST reach `onError`, and the launcher MUST
show its own page in its place.

38.86 The window MUST open at the `width` and `height` `onLauncher` answers where no launch
before it left a size, and MUST NOT be resized below its `minWidth` and `minHeight`.

38.87 The app's package name, as 38.46 names the executable, MUST name the app in its bundle, its
menu bar and its `Launch`.

38.88 The desktop app's menu bar MUST be the application, File, Edit, View and Window menus, with
the items every `onMenu` filed by the layouts and the page the window shows answers, outermost
first: a menu whose `label` names one already standing appends its
items to that one, and any other stands before Window.

38.89 A `MenuItem` whose `MenuRole` AppKit answers MUST be sent down the responder chain, and MUST
be disabled where nothing in the chain answers it.

38.90 Picking a `MenuItem` with an `href` MUST `navigate` to it in the page that filed it.

38.91 Picking a `menuItem` MUST run every function its `on` filed, in the page that filed it,
whether the launcher serves that app or connected to it, and a throw from one MUST NOT stop the
rest.

38.92 The menu bar MUST be told again after every navigation the page makes and after every change
to what an `onMenu` it filed read, and MUST be the default alone from each load the launcher starts
until the page loaded tells it its route's menus.

## Bytecode, chunks and tooling

38.93 The executable `abide compile` writes MUST carry the app's code as bytecode, and MUST still
report an error at its source line.

38.94 The chunks `abide build` and `abide dev` emit MUST NOT load, for a route, a module of the
framework that no name the route imports reaches.

38.95 `abide start` MUST compress an answer of 64 KB or more off the event loop, into the bytes the
same encoding and quality make on it, and MUST compress a smaller one without yielding.

38.96 `abide dev` MUST abort a request's signal when its caller hangs up, and when the process
answering it is replaced or ended.

38.97 A stack frame in a module compiled from a `.abide` MUST name the `.abide` and the line written
there, under `abide dev`, `abide start` and `abide compile` alike, and the client bundle `abide dev`
serves MUST carry a source map placing its positions in the `.abide`; the bundle `abide build` writes
MUST NOT carry one.

38.98 `abide lsp` MUST answer a completion at a member access with the members of what the text it
last checked holds there, as 38.39 answers a hover.

38.99 `abide dev` MUST rebuild when a dependency's `.abide` it compiled changes.

38.100 `abide start` and `createApp` MUST build the app first where its output holds no build.

38.101 The launcher's accent MUST be the most saturated hue of the app's icon (38.79), taken when
`abide bundle` runs, and the platform's own accent where the icon gives none; `Launch` MUST carry
the accent and the icon to `src/launcher.abide`.

38.102 The launcher's own page MUST show the app's icon, its name and a button for each form
`onLauncher` leaves on. A button whose form asks for anything MUST open it in a modal dialog,
a start that asks for nothing MUST start at once, a refused start or connect MUST show its dialog
open on the refusal, and the `connect` menu role MUST show the connect dialog open.

38.103 The project `abide scaffold` writes MUST carry a `check` script that runs `abide check`.

38.104 The project `abide scaffold` writes MUST carry instructions for a coding agent that name where
the installed package holds the documentation, the registry and the rulebook.

38.105 Every clause an `abide check` diagnostic or a refusal cites MUST resolve in a rulebook the
published package holds.

38.106 The documentation the instructions `abide scaffold` writes name (38.104) MUST be every page
as one markdown file, in reading order.

38.107 `onLauncher` called anywhere but `src/launcher.abide` MUST be a build error naming that file.

38.108 `abide routes` MUST print every route with each method it answers and the file answering
it, every private handler with its address and its file, and every hook with the file that filed it;
with `--json` it MUST print the same as one JSON document.

38.109 Under `bun test` with `@abide/abide/test` preloaded, a test MUST import a `.abide` of the app as
the module it compiles to, whether or not `createApp` has run.

38.110 A build `abide start`, `abide call`, `abide openapi` or `abide mcp` makes first (38.100) MUST
be reported on stderr, leaving the command's stdout to its own output.

38.111 `abide openapi` MUST print the OpenAPI document on stdout.

38.112 The project `abide scaffold` writes MUST carry a handler file, a test that calls it, a test
that mounts its page and measures a click with `@abide/harness/abide`, and a `test` script that runs
`bun test`, and those tests MUST pass in the project as written.

38.113 A flag `abide` does not know, or one missing its value, MUST be refused with one line naming
the flag, followed by the usage, and MUST NOT be a success.

38.114 An unknown command within two edits of an `abide` command MUST be refused naming that
command.

38.115 `--version` MUST print the version of abide, and on a compiled app's executable (38.50) the
version of the app it holds, and MUST be a success.

38.116 `abide lsp` MUST answer the references to a name and a rename of it across every `.abide`
and `.ts` of the app, each placed where the author wrote it — a reactive's declaration in a script
and its reads by name in markup alike, a prop and the attribute naming it on every tag that passes
it, asked at either, and a component and its close tags as well as its open ones — and MUST refuse
a rename of a name declared in a library.

38.117 `abide lsp` MUST answer a completion in markup with the blocks the template parser reads
after `{#`, `{:` and `{/`, the components in scope after `<`, and inside a component's tag the props
its `props` call declares that the tag does not yet pass.

38.118 A diagnostic `abide lsp` publishes for a finding that cites a clause MUST carry the clause as
its code, linked to that clause on the documentation's rulebook page.

38.119 `mount` MUST render the component it is given into the document's body as the server renders
it, MUST hydrate it there with that component's browser module, and MUST run every effect the
hydration woke before it settles; it MUST throw where the component was not imported from a
`.abide` and bound, or where the process has no DOM.

# 39. Head and view transitions

39.1 A `<head>` element in a `.abide` file MUST contribute its children to the document head.

39.2 A `<head>` element MUST be top level, and MUST NOT appear inside a control block.

39.3 The build MUST hoist `<head>` contributions at compile time.

39.4 `<head>` contributions MUST be merged by key, and the deepest contributor MUST win. The shell's
`<head>` MUST be the outermost contributor.

39.5 A `<head>` contribution with no merge key MUST append — in tree order among the contributions
its level mounts with, and when it mounts for a component mounted after its level.

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

39.13 In a browser, a `<head>` contribution that reads a value MUST follow it for as long as the
page, layout or component that made it is mounted.

39.14 When a page, layout or component leaves — on a client navigation, or with its region — a keyed
`<head>` contribution it made and no deeper contributor still makes MUST return to the nearest
remaining outer contributor's value for its key, and MUST be removed where no remaining outer
contributor has that key.

39.15 A `<head>` contribution with no merge key that its page, layout or component writes again
MUST replace, in place, the one that same contributor wrote before.

39.16 A `<head>` contribution with no merge key MUST be removed when the page, layout or component
that made it leaves.

39.17 A `<script>` a `<head>` contribution writes in a browser MUST run when it is written, as the
one a server paints does, and MUST NOT run again while the same contributor writes it unchanged.

39.18 A `view-transition-name` transition a navigation starts MUST carry the type `back` or `forward`
for a history step in that direction, and `push` for any other navigation.

39.19 A browser whose view transitions take no types MUST run a navigation's `view-transition-name`
transition without them.

# 40. Documentation

*Free-standing: these clauses govern the documentation system, which REGISTRY does not name — a
`<Snippet>` is not something an app writes.*

40.1 The documentation site MUST be the package at `packages/dogfood`.

40.2 Every name REGISTRY carries MUST be documented against real `.abide` and `.ts` files.

40.3 Every `<Example>` SHOULD carry an end-to-end spec.

40.4 A file an `<Example>` names that is not part of the problem its summary names MUST NOT be
one of its files.

40.5 `<Example>` MUST render the example's component inline, above a tab per file it is made
of, and the render MUST NOT be one of those tabs.

40.6 `<Snippet>` MUST be how a page shows code from an example, in place of pasting it into a
fence.

40.7 A `<Snippet>` anchor MUST be a line prefix matching exactly once, and the slice MUST run to the end
of the construct it opens.

40.8 Several `<Snippet>` anchors separated by an elision MUST render as one fence in file
order, with the gap marked rather than closed.

40.9 A `<Snippet>`'s caption, language and spine MUST be derived from its address.

40.10 A `<Snippet>` anchor matching none or matching two MUST fail the page it is on as it renders.

40.11 A page MUST declare in its `SITE` entry's `covers` which REGISTRY names it covers, and an
overview or a reference page MUST declare none.

40.12 Every name `covers` may claim MUST be claimed by exactly one page.

40.13 The voice, the vocabulary and the register of a title against a nav label MUST be
`docs/BRAND.md`'s, and MUST NOT be stated here.

40.14 An `<Example>` MUST run the component it names in the docs app, and MUST NOT run a
stand-in for it.

40.15 A request an `<Example>` makes MUST be answered by the docs app's own handlers, and MUST
NOT be answered by a fixture.

40.16 Instrumentation the documentation adds to an `<Example>` MUST sit outside the render.

40.17 A page MUST embed one `<Example>` per behavior it teaches, save a page 40.37 exempts.

40.18 An `<Example>` MUST demonstrate exactly one behavior.

40.19 A readout the hand-written arm paired with an `<Example>` renders MUST be one that example's
own source names.

40.20 An `<Example>` MUST be embedded by exactly one page declaring `covers`.

40.21 An `<Example>` MUST model a pattern from an app `docs/BRAND.md` names.

40.22 Every `<Example>` a page embeds MUST be drawn from the same app.

40.23 A control an `<Example>` renders MUST sit with the value it changes.

40.24 An `<Example>` MUST prove the heading it sits under.

40.25 An `<Example>` MUST NOT carry code its proof does not need.

40.26 The capability an `<Example>` proves MUST be one the app it is drawn from would reach
for.

40.27 A heading that carries an `<Example>` MUST be followed by it, with nothing between
them.

40.28 An `<Example>`'s summary MUST state the situation it is in, and MUST NOT restate the
heading.

40.29 A comment in an `<Example>`'s own source MUST fit on one line, and a reason longer than
that MUST go in the copy after the card.

40.30 A page's lead MUST read standalone, being what a section overview shows for that page, and
MUST NOT carry a relative link.

40.31 A page whose `covers` names one REGISTRY entry SHOULD open on a section giving that entry's
forms, the options they share, and a link to its reference page.

40.32 A page reporting the build's own results MUST NOT be listed in `SITE`.

40.33 A documentation page MUST be an `index.abide` written by hand at its route, and its title, nav
label, intent, lead, app and `covers` MUST be its `SITE` entry's alone.

40.34 An `<Example>` MUST render a component in the `lib` directory beside the page that embeds it,
and that component's handlers, hooks and data MUST be in its own file, save a file the example is
about.

40.35 A page's `.md` twin MUST be derived from what its `index.abide` renders.

40.36 The documentation site MUST serve `docs/RULEBOOK.md` at `/rulebook`, read from the file as the
site builds, with each clause and each group anchored by its own number.

40.37 A page whose every behavior is performed by a command, or decided by the deployment an app is
served from, MAY embed no `<Example>`.

40.38 A page embedding no `<Example>` under 40.37 MUST name which of the two in its `SITE` entry's
`cardless`.

40.39 A page an `<Example>` frames MUST sit below a `frame` directory beside the page embedding it,
and MUST be served with none of the site's chrome around it.

40.40 A hand-written arm under the documentation site's `arms` MUST be paired with an `<Example>`
of the same id.

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

41.8 A `{#for}` block over a value the server already painted MUST be reconciled against that value by
the block's key once it lands, keeping each painted row whose key the value holds under 32.67, and
MUST NOT be appended to.

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

41.23 On the client, a `layout.abide` MUST NOT hydrate or build its markup before
the page under it is set up.

41.24 Where hydration's setup chooses an arm of an `{#if cond}` other than the one the server painted,
or no component for a `<Name/>` under 32.34 the server painted one for, the region MUST be filled
from the choice rather than adopted, warning on `abide:hydrate`.

41.25 Hydration MUST NOT set up a page until every `Rpc` call `render` built its markup from settled
has answered or failed.

41.26 An `Rpc` call answering a stream MUST NOT be waited for under 41.25.

41.27 An `Rpc` call `render` built the page's markup from in flight MUST be in flight as hydration
adopts the page, however early its answer arrived.

41.28 A `render` MUST let the turn's queued microtasks run between setting up a `<Name/>` whose setup
made an `Rpc` call and building that component's markup.

# 42. The app object

42.1 `createApp` MUST build the route table and compose every `Middleware` rung, per 16.14.

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

42.11 `App.stop` MUST end every stream it is still answering, close every open socket, and drop every
seed entry its renders left, with its timer.

42.12 A second `App` in one process MUST share the first's `config` and `global` entries, per 27.9 and
11.34.

42.13 A test MUST reach a handler through the same `App` a host holds, and abide MUST NOT generate a
client of its own for one.

42.14 `App[Symbol.asyncDispose]` MUST be `App.stop`, so an `App` held by `await using` MUST stop as
42.10 and 42.11 do when its scope exits.

42.15 `App.stop` asked again while the app is stopping MUST answer with the stop under way, and
`onStop` MUST run once.

42.16 Under `bun test`, `createApp` MUST build the app at most once per state of its sources and
the framework's, MUST NOT boot a build that state did not make, and MUST NOT require a prior
`abide build`.

42.17 `App.stop` still draining once `ABIDE_STOP_TIMEOUT` milliseconds have passed MUST close every
connection still answering, and MUST then run `onStop` without waiting on what is still in flight.

42.18 `ABIDE_STOP_TIMEOUT` MUST default to 5000.

# 43. The measurement harness

43.1 `@abide/harness/measure`, `@abide/harness/engine` and `@abide/harness/server` MUST each be
reachable through only the dependency each is named for, `@abide/harness/report` MUST have none,
and no module `@abide/harness` ships outside `@abide/harness/abide` MUST reach a package it is used
to measure.

43.2 A `Work` record MUST partition nodes moved by node kind, and MUST NOT carry a total across
those kinds.

43.3 A DOM member `@abide/harness/measure` does not count MUST throw naming that member while a case is
armed.

43.4 A patched member MUST tally only where no patched member is already tallying, and
`@abide/harness/measure` MUST install its patches once for the process.

43.5 The patch set `@abide/harness/measure` installs MUST be the same list of interfaces and members in
both substrates, and it MUST NOT add a member to the DOM it measures: a listed member a substrate
lacks is left absent there.

43.6 A `Work` record MUST NOT carry a duration, and `time` MUST throw while the counters are armed.

43.7 A floor MUST be measured by running one arm twice under its own name, and `ratio` MUST report
a value inside that floor as a tag rather than as a number.

43.8 `batch` MUST interleave its arms, and MUST NOT run one arm in a block.

43.9 A `gate` MUST carry a revert installing the broken arm and what that arm reports, and a revert
leaving the gate passing MUST be reported as a failure.

43.10 `ratio` MUST throw where two samples disagree on substrate, on case or on batch size, and
where one arm is given twice.

43.11 A `Sample` MUST be at least 100 times the clock's measured resolution, and `batch` MUST throw
rather than report a smaller one.

43.12 A refusal MUST be taken where the `Sample` is constructed, and MUST NOT be deferred to where
it is reported.

43.13 `shares` MUST take the trace, the layer, the denominator and a threshold, and MUST throw
where the layer runs outside the denominator.

43.14 `shares` MUST report an observed ceiling of zero for an op under one frame.

43.15 A count of calls MUST be taken with `spyOn`.

43.16 `retained` MUST throw in a process with a DOM.

43.17 `allocated` MUST report a batch mean, and MUST NOT report a count an exact integer can be
compared against.

43.18 `batch` MUST throw in a parallel worker.


43.19 `measure` MUST leave a source that published no record absent from `published`, and
`publishedBy` MUST return null for that source rather than a record of zeroes.

43.20 `publishedBy` MUST throw naming each field it is asked for that the source's record does not
carry as a number, and `measure` MUST NOT create a field a source did not publish.

43.21 A counter `measure` reads rather than counts MUST be published as a fixed-shape record of
numbers under its source's name on `globalThis.__HARNESS_WORK__`.

43.22 `batch` MUST throw on a duration whose op touched an emulated DOM.

43.23 `measure` from `@abide/harness/abide` MUST report `wakes`, `bindingRuns` and `descents` off the
record abide publishes, and MUST report each as absent where abide has published none.

43.24 `spawned` MUST kill a child that has not exited by its deadline and throw naming the command,
and MUST NOT wait on a child synchronously.

43.25 `inAFreshProcess` MUST run its source in a child `bun` with no DOM preloaded, and MUST NOT mark
the child a parallel worker unless it is given a worker id.

43.26 `rowsCommand` MUST print its catalog as one JSON array under `--list`, and otherwise MUST print
one JSON row per line as each lands, for the items `inScope` and `matchesFilter` select by
`--scope` and `--filter`.

43.27 `testRows` MUST run each test file in a process of its own, and MUST report a file whose
runner wrote no report as `broken` rather than as a result.

# 44. The assistant

44.1 `assistant` MUST answer only through a handler that yields it, and MUST NOT mount an address
of its own.

44.2 `assistant` MUST yield the same `AssistantEvent` sequence for one conversation whichever
`Provider` ran it.

44.3 `assistant` MUST refuse 400, before any `Provider` is reached, a transcript whose last
`AssistantMessage` is not the user's.

44.4 `assistant` MUST hold no conversation between calls, and MUST take the whole transcript with
each one.

44.5 `claudeCode` MUST send a transcript to Claude Code as one message, its earlier turns folded
above the last.

44.6 With `mcp`, the `Toolbox` `assistant` hands a `Provider` MUST list the tools `/__abide/mcp`
lists, and MUST call each as a request through the app answering the request.

44.7 A `Toolbox` call MUST carry the asking request's `cookie` and `authorization` headers, and MUST
NOT carry any other header of it.

44.8 `mcp` over an app whose route table lists no handler for `/__abide/mcp` MUST throw.

44.9 `claudeApi` MUST call the Messages API again with the tool results only while a turn stops for
`tool_use`, and MUST send each assistant turn's blocks back as they arrived.

44.10 `claudeApi` MUST throw where no `apiKey` is given, and MUST NOT read a key from the
environment.

44.11 A conversation reaching `maxTurns` with a tool call pending MUST end on a `done` whose `stop`
is `max_turns`, and MUST NOT run that call.

44.12 `claudeApi` MUST send the results of one turn's tool calls back in one message.

44.13 `claudeCode` MUST run a turn on the Claude Code of the bridge paired with the asking browser,
and MUST refuse 409 where none is paired.

44.14 A code `claudeCode.bridgeCommand` mints MUST pair one bridge with the browser that asked for
it, once, and MUST NOT pair once it has expired.

44.15 A bridge MUST run Claude Code with its built-in tools off, no setting source read and no MCP
server but the bridge's own, in an empty directory removed when the run ends.

44.16 A bridge MUST take from the site no Claude Code option `ClaudeCodeConfig` does not name.

44.17 An MCP request a bridge's Claude Code makes MUST be answered from the `Toolbox` of the turn it
was made in.

44.18 `claudeCode` MUST end a turn's run on the bridge when the caller hangs up.

44.19 `/__abide/bridge` MUST be closed until `claudeCode` has minted a pairing code in that process.

44.20 `claudeCode.bridge` MUST yield a `BridgeStatus` whenever the asking browser's pairing changes,
and MUST yield a fresh command where the standing one's code expires unpaired.

44.21 A failure the Messages API reports to `claudeApi`, or a bridge reports to `claudeCode`, MUST
refuse 502.

44.22 A bridge `claudeCode.bridge` has watched MUST be sent away once nothing watches it and it has
run no turn for 30 seconds.

44.23 A post to `/__abide/bridge` carrying a line that is not JSON MUST be refused 400, and none of
its lines MUST be relayed.

44.24 A bridge MUST answer an MCP request its Claude Code made with a failure where the report
carrying it was not taken by `/__abide/bridge`, or where no reply arrived within 120 seconds.

44.25 A bridge whose stream from `/__abide/bridge` ends unasked MUST redial it with its pairing's
token, each wait twice the last, until it is refused or 30 seconds have passed.

44.26 `/__abide/bridge` MUST hold a pairing whose stream dropped for 30 seconds, and a `GET` bearing
its token within them MUST resume the stream with every frame the dropped one had not sent.

44.27 `/__abide/bridge` MUST send a comment on a pairing's stream every 15 seconds for as long as
the stream is open.

44.28 A bridge whose stream from `/__abide/bridge` carries no line for 45 seconds MUST end it and
redial it as 44.25 says.
