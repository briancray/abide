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
- [45. Offline](#45)
- [46. Outbox](#46)
- [47. Databases](#47)
- [48. Problem reports](#48)
- [49. Headless components](#49)
- [50. Dialogs, toasts and popovers](#50)
- [51. Lists and tables](#51)
- [52. Formatting, markdown and charts](#52)
- [53. Keys, element behaviors and chat](#53)
- [54. Guards, fetches and jobs](#54)
- [55. Worker files](#55)
- [56. Forms](#56)
- [57. Pipes](#57)
- [58. Ledgers](#58)
- [59. Options](#59)

## Terms

A term below is a category the clauses are written over. It is defined here rather than in
REGISTRY.md because none of them is a name an app author writes.

| Term | Definition |
| --- | --- |
| read | A call to `s` or to `s.peek`. |
| write | A call to `s.set` or to `s.patch`. |
| gated | A production the `identity` comparison may collapse: one a write or a body mints, and not a chunk a stream lands. |
| probe | Any of `s.busy`, `s.ready`, `s.error`, `s.issues`. |
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
| adoption | What a `reactive.derived` body does with a `Reactive` it returned. |
| forwarding | The delegation between an adopting `Reactive` and the one it adopted. |
| propagation | The derivation of a probe from the values a body read. |
| sink | What 35.7 defines. |
| implementation | Anything claiming conformance to this document. |
| dependency's `.abide` | A `.abide` file under a `node_modules` directory or outside the app's root. |
| fence | A `public` or `lib` directory, or the root's `native` directory. |
| server file | A file named `<name>.server.<extension>`. |
| worker file | A file named `<name>.worker.ts` under a `lib` directory or the root's `native` directory, of the app's own or under a directory it mounts. |
| thread | The worker a worker file's exports run in: a `Worker` on a server, a Web Worker in a browser. |
| test file | A `.test.ts` file. |
| declaration file | A `.d.ts` file. |
| handler file | A server file of the app's own (`<name>.server.ts`), directly in a directory under no fence. |
| param file | A file of the app's own named `<NAME>.param.ts`, directly in a directory under no fence. |
| matcher | What a param file declares, and what a segment naming it matches by. |
| private handler | A value a `<script server>` exports. |
| menu bar extra | The item `menuBarExtra` puts in the platform's menu bar. |
| example app | The app every `<Example>` is drawn from, kept whole so a reader can download it and run it. |
| headless component | A function `@abide/abide` exports handing back parts an app spreads onto elements it writes. |
| option | A property an object handed to a name a public entry point exports may leave out. |

RFC 2119 keywords are used as that document defines them: **MUST**, **MUST NOT**, **SHALL**,
**SHOULD**, **SHOULD NOT**, **MAY**.

# 1. The reactive value

1.1 `reactive` and `reactive.derived` MUST hand back a `Reactive`, and a call of an `Rpc`, a `memo`, a
`ledger` or a `pipe` MUST NOT hand back one of its own making.

1.2 `Produced` MUST be the unit the producer yielded: `Stored` for every producer but a streaming one,
and one chunk for a streaming producer.

1.3 `Failures` MUST be the union of the refusals the producer declared, and MUST carry the
validation refusal wherever a `schema` is declared, without the app declaring it.

1.4 A `Reactive` MUST be thenable.

1.5 `s.catch` and `s.finally` MUST derive from `s.then`.

1.6 Where a load is told apart from a value, a `Reactive` MUST be taken as a value.

1.7 Reaching a `Reactive` MUST start the work it is for, unless a window holds it back per 5.18.

1.8 Reaching a `Reactive` that already exists MUST join the standing work rather than start a
second.

# 2. Reads

2.1 A read MUST return what is held, and MUST NOT await.

2.2 A read MUST throw where a producer failed and nothing but an opening `undefined` (4.16) has
landed.

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

2.13 A body a `NotLanded` aborted MUST rerun when the value it names lands, or when its producer
fails.

2.14 A `NotLanded` and a `Failed` MUST be distinguishable by brand.

2.15 Where `s.then` is given no `onFailed`, what it hands back MUST NOT be reported as an unhandled
rejection for the refusal 2.8 passes through to it.

2.16 The `Reactive` `s.then` hands back MUST be busy until the handler that ran has returned, and
what it returned has settled as 2.7 and 2.8 settle a `Reactive` or as a promise settles.

2.17 The `Reactive` `s.then` hands back MUST land what the handler that ran settled to, or, where
no handler ran, what 2.7 resolves with.

2.18 Where `s.then` is given no `onFailed`, the `Reactive` it hands back MUST fail with the refusal
2.8 passes through to it.

2.19 The `Reactive` `s.then` hands back MUST fail with what the handler that ran threw, or with what
it returned rejected or refused with.

2.20 A failure of the `Reactive` `s.then` hands back MUST be reported as an unhandled rejection
where nothing has reached that `Reactive`, save the refusal 2.15 exempts.

2.21 A failure of the `Reactive` `s.then` hands back MUST NOT be reported as an unhandled rejection
where something has reached that `Reactive`.

2.22 `s.then` MUST run its handlers whether or not anything reaches what it hands back.

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

3.10 A `set` or a `patch` on a value with a body that moves what it holds MUST make `s.synced` false.

3.11 A production the value's body, or the server a copy follows, makes MUST make `s.synced` true.

3.12 A value with no body MUST report `s.synced` true.

3.13 A value MUST report `s.synced` false where a value it read or adopts does.

3.14 A probe over a value a mutation's `declare` built MUST NOT run its body.

3.15 `s.issues` MUST answer the `data` of the refusal `s.error` answers where that refusal is a
`ValidationError`, and `undefined` otherwise.

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

4.12 A failed revalidation MUST leave the held value being served, and, save where it fails with
37.28's abort, MUST warn on `abide:reactive` naming the value.

4.13 `s.set` MUST take the `Accepted` its factory declared, and a `Reactive` MUST carry that
`Accepted` wherever it is passed.

4.14 `reactive` called with no argument MUST land nothing.

4.15 `reactive` called with `undefined` MUST land `undefined`.

4.16 An opening `undefined`, the value form's or a body's first answer, MUST land without passing a
`schema`, a `transform`, a window or a `store`.

4.17 `s.set` MUST store a `Failed` it is given as a value rather than refuse the write.

4.18 `s.set` MUST hand back the refusal a gate refused it with, and nothing where it was accepted.

4.19 `reactive` called with no argument and an `Rpc`, or a union of `Rpc`s, as its type argument
MUST be typed as one `Reactive` over the value a call of each of them answers, its refusals as its
failures.

4.20 `reactive` given a function that is neither a `Reactive` nor a `Keyed` MUST hold it as its
value.

# 5. Productions and identity

5.1 A reader MUST be woken only when read identity changes.

5.2 A production whose identity matches the previous `Stored` MUST mint nothing, and MUST wake no
reader.

5.3 `identity` MUST be discriminated by arity: one parameter is a projection compared by `!==`, and
two is a comparator answering directly.

5.4 The default `identity` MUST be the reference.

5.5 `deepEqual` MUST answer "not equal" wherever it cannot decide.

5.6 A write MUST mint a production of its own.

5.7 `s.patch` MUST mutate the production it serves in place rather than mint one.

5.8 `throttle` and `debounce` on a `memo` MUST cap how often each of its entries changes for a reader.

5.9 A capped window MUST cap the wake, and MUST NOT itself drop a production.

5.10 A cursor over a streaming producer MUST deliver every chunk a window collapsed.

5.11 An implementation MUST NOT start work a window would discard.

5.12 `throttle` MUST allow a change immediately and then at most once per window. A window of
`Infinity` stands open for good: the first change is allowed and no other.

5.13 `debounce` MUST delay a change until the changes stop.

5.14 Declaring both `throttle` and `debounce` MUST refuse at construction.

5.15 Where a `throttle` or a `debounce` window is holding a production back, or a body's run under
5.11, the value served before it MUST go on being served and `s.busy` MUST be true.

5.16 `throttle` and `debounce` on a streaming producer MUST cap how often its readers are woken.

5.17 A read of a capped streaming producer MUST serve the accumulation as the last release left it.

5.18 `throttle` and `debounce` on a `memo` MUST start the first entry it reaches at once, and MUST
hold back starting each newly reached entry after it until the window allows it.

5.19 An entry a `memo`'s window replaced with a later key before it started MUST NOT be started, and
MUST NOT be held.

5.20 An entry a `memo`'s window is holding back MUST report `s.busy` true.

5.21 `key` MUST key an element by the property it names, or by what the function it is returns for
that element.

5.22 `throttle` and `debounce` MUST cap the wakes an `s.patch` makes as they cap a production's.

5.23 `throttle` and `debounce` MUST hold an `s.refresh` as they hold a production, and a refresh a
window held MUST start one reload when the window closes.

5.24 `throttle` and `debounce` on a `memo` MUST cap its owner's `set` and `patch` on an entry as they
cap the entry's productions, so every reader and follower of the entry is woken at that pace, and a
call MUST answer the last value written.

5.25 A `Reactive` re-adopted onto an entry a `memo`'s window is holding back MUST go on serving what
it served, reporting `s.busy` true and `s.ready` as it stood, until the entry starts, and 11.16 MUST
then apply.

# 6. Expiry

6.1 An entry of a `memo` whose `ttl` runs out while something subscribes to it MUST be refreshed per
7.4 and 7.5, and what lands MUST reach whatever subscribes to it.

6.2 An entry of a `memo` whose `ttl` runs out while nothing subscribes to it MUST be released, and
the next call with its `Args` MUST run the function afresh.

6.3 An entry's `ttl` MUST run from its reach, and again from each value that lands on it, a
production or an `s.patch`.

6.4 A `ttl` timer MUST NOT hold the process open.

6.5 An entry whose `ttl` is 0, and an entry of a mutation's (16.7), MUST be released per 6.2 whether
or not anything subscribes to it.

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

7.19 A load over a value `s.invalidate` marked that is refused with `HttpError` at 503 MUST leave the
value it held being served.

7.20 `App.stop` MUST abort the signal `abortSignal` answers outside every run and request before it
drains what is in flight.

7.21 The signal 7.20 aborts MUST stay aborted from that abort until `App.stop` resolves, `onStop`
included, and MUST be one not aborted from then on.

7.22 `abortSignal` called while a `reactive.derived` or `memo` body runs, its synchronous part or a step of its stream,
MUST answer a signal of that run's own.

7.23 The signal 7.22 answers MUST abort where a new run of that value starts, where the value or its
entry is released, and where its owner's signal aborts: 7.25's for a value filed in a request
(11.32), and 7.20's for any other, a `global` value's included.

7.24 On a server, `abortSignal` called in work a `reactive.derived` or `memo` run carries across an `await` MUST answer
7.22's signal of that run, and a signal already aborted once a new run of that value has started or
the value or its entry has been released.

7.25 `abortSignal` called in a request, outside every run 7.22 and 7.24 name, MUST answer a signal
that aborts where the received request's signal does, 18.18's close of a connection among them, and
where 7.20 aborts.

7.26 In a browser, `abortSignal` called outside a `reactive.derived` or `memo` body's synchronous part and the steps of its
stream MUST answer 7.20's signal.

# 8. Stores

8.1 A `Store` MUST provide both `get` and `set`.

8.2 A `Store`'s `get` MUST be a producer, and the value MUST therefore answer to 7.1.

8.3 A `Store`'s `get` MUST answer before the initial value, and the initial value MUST be what a
miss falls back to.

8.4 A synchronous `get` MUST NOT make the value loaded.

8.5 A restore MUST mint a production without running `schema` or `transform`.

8.6 A restore of a streaming producer MUST seed its accumulation with what was stored.

8.7 A restored stream MUST report `s.ready` true and `s.busy` false.

8.8 A `Store`'s `set` MUST run once per production, per 5.2, save a restore and the initial value a
miss falls back to.

8.9 A `Store`'s `set` on a streaming producer MUST run once at close, on the accumulation.

8.10 Writes to a `Store` MUST coalesce latest-wins, and MUST NOT queue.

8.11 A write to a `Store` MUST NOT block a reader.

8.12 A failed `Store` write MUST NOT detach the store; it MUST reach `onError` and warn on
`abide:reactive`.

8.13 A `Store`'s `set` MUST receive, in milliseconds, the `ttl` of the `memo` whose entry it keeps, and
infinity for any other value.

8.14 A `store` MUST run where the `Reactive` is constructed.

8.15 A value a `Store`'s `get` cannot read MUST be a miss, per 8.3.

8.16 A trigger on a `Reactive` with both a body and a `store` MUST run the body.

8.17 A `Store`'s `get` answering `undefined` MUST be a miss.

8.18 A `Store`'s `get` MUST NOT run while a write to that `Store` is in flight or held per 8.10,
the value of that write standing in its place.

8.19 A `Store`'s `get` answering a miss with nothing left to serve MUST land an error on `s.error`.

8.20 A `Store`'s `watch` MUST be called once, where the `Reactive` is constructed, and each call of
the function it is handed MUST run `get` again as a restore, per 8.18, and MUST NOT run the body.

8.21 What a `Store`'s `watch` returns MUST be called once the `Reactive` is released: a `Keyed`
entry evicted, or the setup or request that built it, or its `Keyed`, ended, or the entry opened on
its store's log (18.45).

8.22 `store.web` MUST keep the value under its key in `localStorage`, or in `sessionStorage` where
its `area` is `'session'`.

8.23 `store.web` MUST answer every `get` with a miss, and MUST write nothing, where the process has
no Web Storage.

8.24 `store.web`'s `watch` MUST call what it is handed when another document writes or clears its
key in its area.

8.25 `store.sqlite` MUST keep the value in one row of its table under its key, and MUST create the
table where it does not exist.

8.26 `store.web`, `store.sqlite`, `store.redis`, `store.indexedDB` and `store.cookies` MUST answer a miss for a value whose `ttl`, as their `set` received it, has passed.

8.27 `store.web`, `store.sqlite`, `store.redis`, `store.indexedDB` and `store.cookies` MUST run their `schema` on what `get` reads, and MUST throw what it refuses, per 8.15.

8.28 `store.web`, `store.sqlite`, `store.redis`, `store.indexedDB` and `store.cookies` MUST keep the value as JSON.

8.29 `store.web`, `store.sqlite`, `store.redis`, `store.indexedDB` and `store.cookies` MUST keep the value under the app name followed by its key.

8.30 `store.web`, `store.redis`, `store.indexedDB` and `store.cookies` MUST answer a `get` that reads
the text they last read or wrote with the value they answered for that text.

8.31 `store.redis` MUST keep the value under its key in Redis.

8.32 `store.redis` MUST hand Redis a finite `ttl` as the key's own expiry.

8.33 `store.redis`'s `watch` MUST call what it is handed when the key's keyspace channel, in the
database its client selected, carries an event.

8.34 `store.indexedDB` MUST keep the value under its key in a table of the `abide` IndexedDB
database.

8.35 `store.indexedDB` MUST answer every `get` with a synchronous miss, and MUST write nothing,
where the process has no IndexedDB.

8.36 `store.indexedDB`'s `watch` MUST call what it is handed when a `store.indexedDB` in another
document writes its key.

8.37 `store.cookies` MUST keep the value in a cookie, read and written through `cookies()`.

8.38 `store.cookies` MUST write a finite `ttl` as the cookie's `Max-Age`, and an infinite one as
400 days.

8.39 `store.cookies`'s `set` MUST throw for a value whose cookie would pass 4096 bytes.

8.40 `store.cookies`'s `watch` MUST call what it is handed where the browser reports a change to its
cookie, per 22.6.

8.41 `store.sqlite` given a function MUST call it at each `get` and `set`, and keep the value in the
`Database` that call hands back.

8.42 `store.sqlite` given a string MUST keep the value in the `Database` the opener `database`
returns for that string hands back, per 47, and MUST make one such opener per string.

8.43 A release that changes the key or the JSON a `store` keeps a value under MUST, in that release
and each one before the next minor release after it, read a value kept in the form before the
change, and MUST write what it read back in the new form.

# 9. Streams and wired values

9.1 A streaming producer's `Stored` MUST be the chunks accumulated so far, materialized on the
read that asks for it.

9.2 An implementation MUST NOT accumulate chunks by copying the accumulation per chunk.

9.3 `identity` MUST compare against the previous production alone.

9.4 A production arriving over a connection MUST replace a write standing on the subscriber's copy.

9.5 A `store` MUST round-trip the latest production.

9.6 A `reactive.derived` or `memo` body declared as an async generator function MUST be a streaming producer from
construction, and a body whose run hands back an async iterable that is not a `Reactive` — an async
generator or a `ReadableStream` among them — or a promise resolving to one, MUST be one from that
run on, and a run replaced by a later one MUST cancel the stream it was reading.

9.7 `s.refresh` on a streaming producer MUST serve the held accumulation until the new stream's
first chunk, and that stream's accumulation from then on.

9.8 A `schema` and a `transform` on a streaming producer MUST run on the accumulation a read
materializes, at most once per chunk the accumulation holds.

9.9 A streaming producer MUST wake its readers at most once per task.

9.10 `flushSync` MUST deliver the wakes a streaming producer is holding.

9.11 A write to a streaming producer MUST stand until its accumulation next changes, and an adoption
made by one (11.60) MUST end with it.

9.12 A write to a streaming producer MUST NOT move a cursor over it.

9.13 `s.patch` on a streaming producer MUST mutate its accumulation in place.

9.14 A subscriber's copy of a wired `Reactive` MUST report `s.busy` true until the first production
arrives.

9.15 A cursor over a streaming producer MUST throw, once it has yielded every chunk, the failure its
run ended on.

9.16 A cursor over a streaming producer MUST end where a new run replaces the one it was reading.

9.17 A streaming producer's run MUST NOT end, to a reader of it or of a value forwarding it, before
every chunk that run produced has reached that reader.

9.18 A cursor opened over a streaming producer while a run is in flight that has produced no chunk
MUST walk that run, and MUST NOT walk the accumulation 9.7 serves meanwhile.

# 10. Sharing

10.1 A handle `reactive.shared` hands back MUST get or create its value in one call.

10.2 A value a handle created MUST NOT be evicted within its scope.

10.3 The scope of a handle's value MUST be the component instance that created it and its
descendants.

10.4 A `Shared` handle MUST create its value in the calling component instance where no ancestor holds
one for that handle, and MUST tell one handle from another by its identity alone.

10.5 An implementation MUST NOT provide a process-wide `reactive.shared`.

10.6 A handle's value MUST be what `create` answers where it answers a `Reactive`, and a `reactive`
holding what it answers otherwise.

10.7 A `Shared` handle called outside a component instance MUST throw, naming 10.3.

# 11. Derived and keyed values

11.1 `reactive.derived` MUST produce an unkeyed, tracked `Reactive`.

11.2 A `memo` called MUST answer a promise of its function's value for that call's `Args` key, or where
the function answers an async iterable, a stream of its chunks; it MUST run the function only for a
key it holds no value for, and MUST key a function that declares no parameter on `undefined`.

11.3 `memo` and `reactive.derived` MUST NOT read a body's parameters to decide what they produce.

11.4 A `memo` MUST hold one entry per `Args` key, computed when that key is first called.

11.5 A `reactive.derived` MUST recompute on the first read that follows a change to a value its
body read.

11.6 A `memo` MUST NOT run its function again for that reason, and `ttl`, `invalidate`, `refresh`
and eviction MUST be its only ways back.

11.7 Both `memo` forms MUST accept a write.

11.8 A write to a `reactive.derived` that is not adopting MUST stand until the next recompute replaces it.

11.9 An implementation MUST NOT warn on a write to a `reactive.derived`.

11.10 A write of a settled value to a `reactive.derived` MUST move no probe.

11.11 A write of an unsettled value to a `reactive.derived` MUST be a load, per 4.2 and 1.6.

11.12 A `Reactive` returned from a `reactive.derived` or `memo` body MUST be adopted, and MUST NOT be stored as a
value.

11.13 Adoption MUST mirror the adopted productions into the adopting `Reactive`.

11.14 An adopting `Reactive` MUST run its own `transform` on the way in.

11.15 Adoption MUST forward members the adopted `Reactive` declares beyond the common face, by
delegation to whatever is currently adopted.

11.16 On re-adoption a `Reactive` MUST clear where the newly adopted `Reactive` has nothing to serve,
save where 5.25 holds the change back.

11.17 Adoption MUST inherit the adopted `Reactive`'s `identity` where the outer declared none, for as
long as it adopts it.

11.18 A recompute landing on the same adopted `Reactive` MUST wake no reader.

11.19 An adopting `Reactive` MUST report `s.busy` only where the newly adopted `Reactive` reports
it.

11.20 `s.busy` and `s.ready` MUST be the probes that propagate.

11.21 A `reactive.derived` MUST report `s.busy` for its own load, or for any value its body read.

11.22 An implementation MUST derive a propagated probe on the read that asks for it, and MUST NOT
hold a subscription per source for it.

11.23 An `Rpc`'s entry for one `Args` key MUST propagate nothing.

11.24 An `Args` object MUST become a key by its canonical wire form: members sorted by name,
`undefined` members dropped, `Date` written ISO, and an object left with no members keyed as an
absent `Args`.

11.25 An `Args` key MUST be structural.

11.26 The key MUST be taken before `args` runs.

11.27 The order over `Args` MUST be coerce, apply syntax defaults, canonicalize, validate, then
the body.

11.28 An `args` gate MUST refuse and MUST NOT decide which entry an `Args` object lands on.

11.29 A literal default written in the body's parameter MUST participate in the `Args` key, on
both sides, and the parameter's defaults MUST apply to an absent `Args` as to `{}`.

11.30 The build MUST warn where `args` declares a default the parameter does not.

11.31 A reactive value in an argument position MUST be read, and `Args` MUST be plain args.

11.32 A `reactive`, a `reactive.derived`, and a `memo` without `global`, MUST be request-local on a server and
process-local in a browser.

11.33 `ttl: Infinity` without `global` MUST mean to the end of that scope.

11.34 `global: true` MUST place entries in a process-wide cache that outlives every request.

11.35 A `global` `memo` MUST be bounded by its own `ttl` and by `invalidate`, and by nothing else.

11.36 An implementation MUST NOT evict a `global` entry on a size or a count limit.

11.37 `global: true` MUST be a build error on a body reading `request`, `response`, `principal`,
`cookies`, `csp.nonce` or `route`, and the error MUST name the ambient.

11.38 Coalescing of a `memo` load MUST be within a scope: two reads of one key in one scope share
one load, and two scopes load twice.

11.39 A reader detaching from a `global` streaming `memo` MUST NOT cancel the producer for the
readers that remain.

11.40 `args` on a `memo` MUST check `Args`.

11.41 `args` MUST be unspellable on a `reactive.derived`, and spelling it MUST be a compile error naming it.

11.42 `store` on a `Keyed` MUST accept a function of the `Args`.

11.43 `tags` MUST be what a `Selection` matches on, and MUST be the only selector reaching across
values.

11.44 The function form of `tags` MUST receive the value's `Args`.

11.45 A `memo`'s `ttl` MUST be the life of each of its entries, which 6.1 and 6.2 end.

11.46 A `memo` MUST accept a `schema`, gating what its body produced.

11.47 An adopting `Reactive` MUST run its own `schema` on the way in, as 11.14 has it run its
`transform`.

11.48 A `Keyed` MUST hold one expiry timer, armed at its oldest entry.

11.49 Every probe MUST forward from the adopted `Reactive` to the adopting one.

11.50 Every trigger on an adopting `Reactive` MUST reach the adopted one.

11.51 A provisional run MUST mint no production.

11.52 A reader joining a `global` `memo`'s stream after it began MUST NOT be answered with a
refusal.

11.53 A `memo` MUST NOT report `s.ready` before its body has run for the value being probed.

11.54 A probe over a key an `Rpc` has not been called with MUST allocate no entry.

11.55 An implementation MUST NOT warn where two `Args` keys differ only in the case of a value.

11.56 A `reactive.derived` MUST NOT recompute before a read or an `Effect` asks for its value.

11.57 A `reactive.derived` MUST report `s.ready` only where every value its body read reports it.

11.58 `s.set` and `s.patch` on an adopting `Reactive`, given anything but a `Reactive`, MUST reach the
adopted `Reactive`.

11.59 `args` spelled on a `reactive.derived` MUST refuse at construction.

11.60 `s.set` given a `Reactive`, and `reactive` opened on one, MUST adopt it per 11.12, and MUST NOT
store it as a value — on a streaming producer, as a write that 11.58 does not reach through.

11.61 A body answering `undefined` MUST land `undefined`.

11.62 A body a `NotLanded` aborted that something probes MUST rerun in the turn that lands the
value it named.

11.63 Reaching a `Keyed` with an `Args` member 11.24 cannot write — anything outside `JsonValue`
but a `Date`, or a number that is not finite — MUST throw, naming the path to the member.

11.64 An adoption that would close a cycle of adopting `Reactive`s MUST be refused where it forms,
naming the cycle.

11.65 `s.set` MUST throw 11.64's refusal, and a body whose answer 11.64 refuses MUST fail with it.

11.66 A `reactive`, a `reactive.derived`, and a `memo` without `global`, MUST be built afresh in each request that reaches it
or whose `render` builds it under 41.34, from its declaration and never from what a write outside
every request left.

11.67 A keyed value's body MUST be handed what its `args` gate returned.

11.68 A `Keyed` entry whose load is in flight MUST NOT be evicted by its `ttl`, and its life MUST
start again when the load ends.

11.69 `s.set` MUST take only a `Reactive` whose `Failures` are this value's.

11.70 A `reactive.derived` with a `store`, built on a server outside every request, MUST NOT run
the `store`'s `get` before it is reached.

11.71 A `Keyed` MUST NOT hold an entry for an `Args` its `args` gate refuses, and the gate MUST run
once per entry.

11.72 A body's first run in a scope that reads the `memo` it is building MUST fail with a
`ReferenceError`.

11.73 `reactive.derived` or `memo` given anything but a function, or given a `Reactive` or a `memo`, MUST
throw at construction.

11.74 A `reactive.derived` that called a `memo` MUST run again where the `memo`'s entry for the key it called
is refreshed or invalidated, and MUST NOT run again for another key's.

11.75 A `memo` whose function answers an async iterable MUST run it once per `Args` key and keep its
chunks, and each call MUST answer a stream handing on every chunk of that run from its start.

11.76 `m.set(args, value)` MUST replace the value of a `memo`'s entry for `args`, and `m.patch(args,
mutate)` MUST mutate it in place, each building the entry where none is held, MUST NOT run the
function, and MUST stand until the next write, `ttl`, `refresh` or `invalidate` — save where the entry
holds the rows a `table` call answered, which 47.40 writes to the table.

11.77 `m.readable(args)` MUST answer a stream handing on the entry's value now and its value after
each change, in order, each a copy no later change mutates.

11.78 A `memo` given a `store` MUST open an entry on the value the store keeps for its `Args` without
running its function, and MUST keep there what the entry produces and what its owner writes.

11.79 A `memo` given a `schema`, a `transform` or an `identity` MUST apply each to every entry's value
as 4.3, 4.6 and 5.3 apply them to a `reactive`'s.

11.80 `m.set` and `m.patch` MUST take the write alone only where the `memo` takes no `Args` at all,
and MUST take `args` before it where its `Args` are optional.

11.81 `reactive` and `reactive.derived` given a `ttl`, a `throttle`, a `debounce`, `tags` or `global` MUST throw
a `TypeError` at construction naming the `memo` that declares it.

# 12. Effects

12.1 A `Disposer` MUST run before each rerun of its `Effect`, and once more at teardown.

12.2 An `Effect` MUST run immediately, and again whenever a reactive value it read changes.

12.3 Where sources are given to `watch`, the `Effect` MUST run only when those sources change.

12.4 A `watch` registered inside a component MUST be owned by that component.

12.5 On a server a `watch` MUST rerun as it does in a browser, and its `Disposer` MUST run at the
teardown of the scope it was opened in.

12.6 A throw from an `Effect` or a `Disposer`, and a read of a failed `Reactive` inside one, MUST
reach `onError` as thrown, and MUST warn on `abide:watch` with the trace.

12.7 Where `isServer` is false, a throw from an `Effect` MUST additionally surface as an uncaught
error — re-thrown to the caller of `watch` from its first run, and reported with `reportError` from
a rerun — and MUST NOT keep any other `Effect` the same turn woke from running.

12.8 An `Effect` that threw MUST stop its `watch`.

12.9 `s.watch` MUST be `watch` narrowed to that `Reactive`, and MUST NOT diverge from it on 12.1,
12.2 or 12.8.

12.10 An `Effect` a write woke MUST run at the end of that turn, and MUST NOT run once per write.

12.11 `flushSync` MUST end the turn where it is called.

12.12 A read MUST answer what the writes in its turn left, whether or not the `Effect` values they
woke have run.

12.13 A `watch` registered inside a `{#if}` arm or a `{#for}` row MUST stop when the region
holding that arm or row is removed.

12.14 A `memo`, built where 12.4, 12.5 or 12.13 would own a `watch`, MUST stop
reading its sources once that owner stops and nothing else reads it, and MUST answer a later read
with what its body computes then.

12.15 The `Effect` values one turn wakes, a slot's own update among them, MAY run in any order,
save where a clause orders them.

12.16 A stream released under 12.14 MUST stop its run, and the later read MUST start it once more,
whether or not the stopped run had closed.

12.17 A `reactive`, a `reactive.derived` or a `memo` declared where 12.4, 12.5 and 12.13 would own no `watch` MUST NOT be
owned by one current where it is first reached, save the instance a request builds of it under
11.66, which that request owns.

12.18 Where one turn wakes an `Effect` and an `Effect` whose run opened it, directly or through
others, the opener MUST run, or be found to read nothing that changed, before the `Effect` it opened.

# 13. Selections

13.1 A `Selection` MUST be one `Reactive` or a set of `tags`, and `busy`, `ready` and `synced` MUST NOT
take a `memo` or an `Rpc`.

13.2 `busy` over a `Selection` MUST answer whether ANY entry in it is busy.

13.3 An implementation MUST hold one signal per `Selection`, and MUST NOT hold one per entry.

13.4 `s.refresh` and `s.invalidate` MUST be `refresh` and `invalidate` over `s`, and a `memo`'s and an
`Rpc`'s `refresh` and `invalidate` MUST be the same mechanism over the entries they match, and none
of them MUST be a second mechanism.

13.5 An implementation MUST NOT provide a free `done`, `success`, `error` or `issues` over a `Selection`.

13.6 A bare `invalidate`, `refresh`, `busy` or `ready` MUST match only entries whose producer is a
load: a `store`, or a body that has handed back a pending answer or a stream, or has taken a call
41.20's script started that the server painted settled (41.27).

13.7 A bare `refresh`, and `refresh` over a `Selection` that is not one `Reactive`, MUST reload
only entries something subscribes to and MUST mark the rest, and MUST mark every entry it reaches
before it reloads any, so a reload reading another entry the same refresh reaches reads it reloaded.

13.8 A `Selection` MUST be scope-bounded, and a tag MUST be scoped the same way.

13.9 A `Selection`'s signal MUST be keyed by the canonical form of its `tags`, and a bare
selection MUST hold exactly one.

13.10 On a server a bare `invalidate` and a bare `refresh` MUST each reach every `global` `memo` in the
process.

13.11 `ready` over a `Selection` MUST answer whether EVERY entry in it is ready.

13.12 A pattern given to a `memo`'s or an `Rpc`'s `refresh` or `invalidate`, or to `outbox`, MUST
narrow it to the entries whose `Args` hold the pattern: an object holds another where it holds every member the other names, an array
holds another where it holds each of the other's items in any order beside any others, and any
other value holds only itself.

13.13 A `Selection` made in any scope MUST reach every entry of a `global` `memo` or `Keyed` it
matches.

13.14 A bare `refresh` MUST NOT rerun a synchronous derivation, which MUST recompute from the
load it reads.

13.15 On a server, a bare `invalidate` or `refresh`, or one over a set of `tags`, MUST also send the
same trigger to every copy a browser follows over the mux or an event stream (18.20) that the
selection matches by the `tags` its `GET` declares — a function of `Args` answered for the `Args` that
copy follows — whether or not the server holds a value it matches, and MUST NOT send it to a copy
fed from a value the server holds.

13.16 A bare `refresh`, and `refresh` over a set of `tags`, MUST invalidate, and MUST NOT reload,
every value a mutation's `declare` built.

13.17 A bare `invalidate` or `refresh`, or one over a set of `tags`, MUST NOT invalidate a value a
mutation's `declare` built while its write is in flight.

13.18 `synced` over a selection MUST be true where every entry in it is synced, and a bare `synced`
where every value it sweeps is.

13.19 `refresh` and `invalidate` over an `Rpc` no call has reached in the current scope MUST do
nothing, and MUST NOT build its value.

13.20 `refresh` over a set of `tags` MUST NOT rerun a synchronous derivation that carries none of
them, which MUST recompute from the load it reads.

# 14. Tracking

14.1 A `Reactive` MUST be tracked only where something downstream will be rebuilt from it.

14.2 A template expression MUST track the `Reactive` values it reads.

14.3 A `reactive.derived` body MUST track.

14.4 A `memo` body MUST NOT track.

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

14.15 The compiler MUST warn on a reactive read in a condition position inside a
`reactive.derived` body, where what the condition decides reads another value, naming the read.

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

15.7 `refuse.notFound` MUST be returned where no route matched.

15.8 `refuse.validation` MUST be returned where a `schema` or an `args` gate refuses, or where a call's
args leave a parameter of its route no spelling as a segment (30.3, 30.19) — in process as over the
wire, and before the handler runs — at status 422.

15.9 An implementation MUST declare no refusal names beyond those `refuse.notFound`,
`refuse.validation` and `refuse.aborted` carry, the one 17.4 names, and those 54.1, 54.4, 54.5 and
54.12 name.

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

15.19 A `Keyed` entry or an `Rpc` whose last answer was a transient refusal — at status 408, 425,
429, or 500 and above — or a throw, MUST run its body again for the next reach rather than serve that
answer, save as 15.23 holds it.

15.20 A refusal 15.19 does not count transient MUST be held for the next reach as a production is,
until its `ttl` ends.

15.21 A refusal MUST cross a wire as Problem Details (RFC 9457) under `application/problem+json`: its
name as `type`, or `about:blank` titled by its status's reason phrase where it was not declared, its
message as `detail`, and its data as a `data` member.

15.22 The `refuse.notFound` 15.7 returns, and the 405 15.17 answers at a route, MUST be painted as
a page's failure where the request prefers `text/html` over `application/json`, and MUST cross as
15.21 states otherwise.

15.23 A transient refusal answered with a `Retry-After`, in seconds or as an HTTP date, MUST be
served by every reach before the time that header names, rather than run again under 15.19.

15.24 A refusal answered with a `Retry-After` MUST carry one naming the same time wherever it crosses
a wire again under 15.21.

# 16. Handlers and transports

## The handler and its `Rpc`

16.1 A handler MUST be a `Reactive`, a `Keyed`, a plain function, or a value.

16.2 `rpc` MUST give the handler an address over http: a handler file's default `rpc` that file's
route, per 23.14, and each other `rpc` it exports that route and then the export's name.

16.3 An `Rpc` called MUST answer a promise of the handler's value for those `Args`, rejected with its
refusal, or where the handler streams, an async iterable of its chunks.

16.4 An `Rpc` MUST be callable in both arms, the call being what issues the request.

16.5 Which arm `rpc` takes MUST be read off a brand the factory stamped, and MUST NOT be inferred
from the shape.

16.6 `rpc` over a plain function MUST keep the function's value per `Args` key, keying a function
that declares no parameter on `undefined` and reading none of its parameters, and over a value MUST
behave as `rpc` over a `reactive` of it, each built with the options `rpc` was handed; a `Reactive`
handed in MUST take the address's options alone.

16.7 An `rpc` over a plain function answering a verb other than `GET` MUST have its value's `ttl` default to 0 unless its options
declare one.

16.8 `Failures` on an `Rpc` MUST be the union of what the handler declared, what its rungs
declared, the undeclared `Failed` named `HttpError` per 17.4, with no data, which the transport
may answer any call with, and, wherever the `Schema` 19.9 derives from its `Args` is an object's,
the undeclared `ValidationError` of 15.8 with `Issues` of the `Args` as its data.

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

16.22 `timeout` and `ABIDE_RPC_TIMEOUT` MUST default to no bound.

16.23 A request MUST NOT be ended by the idle timeout of the server `App.listen` or `abide dev` binds
from when it has been received whole until its answer, a stream's last chunk included, has been sent.

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

16.29 Importing a server file from the client graph MUST be a compile error,
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
`response.redirect` passes through, a returned value becomes 303 back to the referrer, and a failure
renders `error.abide` at its own status.

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
MUST refuse with `refuse.aborted` at status 499, and MUST abort the request carrying it where one
does.

16.50 A `HEAD` MUST be answered by the `GET` handler mounted at its address.

16.51 A `HEAD` MUST NOT take from the seed buffer.

16.52 An `Rpc` answer with no body — a 204, or a status `response` writes with nothing returned, a
`response.redirect` included — MUST NOT carry `content-type`.

16.53 The 303 16.38 answers MUST go to the mount's root where the referrer is absent or is not of
`APP_URL`'s origin, per 36.2.

## Ceilings and timeouts

16.54 `maxBodySize` and `ABIDE_MAX_REQUEST_BODY_SIZE` MUST default to no ceiling.

16.55 A mutation's body over the ceiling `maxBodySize` or `ABIDE_MAX_REQUEST_BODY_SIZE` sets MUST
be refused 413, whether its length was declared or streamed.

16.56 A connection to the server `App.listen` or `abide dev` binds MUST be ended once it goes 10
seconds without a byte while no request over it is being answered.

16.57 An answer typed `text/event-stream` MUST carry a comment every 15 seconds for as long as it is
open.

16.58 Where a handler names no `timeout`, `ABIDE_RPC_TIMEOUT` MUST be its `timeout`.

16.59 A load that goes `timeout` milliseconds without settling, or a stream without its first
chunk, MUST be ended and MUST refuse with `refuse(504)`, and a stream past its first chunk MUST NOT
be ended for the time between chunks.

16.60 A load ended under 16.59 MUST keep serving what its value held, a stream's chunks so far
included, and MUST report `s.busy` false.

16.61 A call joining a load MUST NOT extend that load's `timeout`.

16.62 A call reaching a value whose last load ended under 16.48 MUST start a new load, under the `signal`
that call passed.

16.63 A throw answered once its request's signal has aborted — a handler's or a page render's — MUST
answer `refuse.aborted` at 499, and MUST NOT report the throw as unexpected.

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

16.70 A private handler MUST be answered as `rpc` over it, MUST have an address below
`/__abide/handlers/`, named by its file's path below the root, a segment's brackets and dots
dropped, and then its export's name, and MUST NOT take a parameter from the path.

16.71 A private handler MUST NOT be listed on `/__abide/mcp`, on `/__abide/openapi.json` or by the
command line.

16.72 A private handler MUST run under the `middleware` and `onError` filed at the route 37.1 files
its file's hooks at.

16.73 A handler file exporting no value declared by a call of abide's `rpc` MUST be a build error
naming it.

16.74 A module of the client graph importing a handler file MUST receive the wrapper 16.28 states in
place of each `rpc` it exports, under that export's name, and an import of any other export MUST be
a build error naming it.

## Streamed answers and ceilings, continued

16.75 A streamed answer — jsonl, sse, bytes, or a document `response.page` hands a stream — MUST
carry `X-Accel-Buffering: no`.

16.76 An `Rpc` streaming under 16.32 MUST end its answer where the run it sends ends: at that run's
close, where a new run replaces it, and with the failure that run ended on.

16.77 A `timeout` MUST NOT end a `throttle` or `debounce` window holding a production back, and the
call MUST wait on that window as 5.15 has it.

16.78 A body `/__abide/mcp` or `/__abide/bridge` reads over the ceiling `ABIDE_MAX_REQUEST_BODY_SIZE`
sets MUST be refused 413, whether its length was declared or streamed.

16.79 An `Rpc` call in a browser that gets no answer, and whose `signal` has not aborted, MUST refuse
with `HttpError` at 503.

16.80 A `GET` call in a browser MUST be sent with `cache` `force-cache` where the page has loaded no
answer for its args and the worker `ABIDE_OFFLINE` turns on answers the page, and with `no-cache`
otherwise.

16.81 A call in a browser given `offline` that gets no answer, or an answer at 502, 503 or 504, MUST
settle to what `offline` returns for its args, as a write made here (3.10), save a `GET` whose copy
already holds an answer for them.

16.82 A mutation call that 16.81 settles MUST be queued in `outbox`, and MUST refuse as it was
answered where `outbox` cannot keep it.

16.83 A mutation call given `offline` MUST be queued in `outbox`, and not sent, while `outbox` holds
a call not yet delivered.

16.84 `offline` MUST be inert on a server.

16.85 A call in a browser answered from a copy the worker `ABIDE_OFFLINE` turns on kept MUST settle
as a write made here (3.10), and a `GET`'s copy that 16.81 or this settles MUST be loaded again once
`online` is true.

16.86 A refusal a rung may answer with MUST reach `Failures` (16.8) where the rungs are listed at the
declaration, and a rung naming no refusal, one typed to answer anything or a `Middleware` whose
`Refused` is `Failed<string, unknown>`, MUST add none.

16.87 A handler whose parameter carries no annotation MUST take its `Args` from the `args` its options
declare.

16.88 A handler file's `rpc.address` MUST be its route (23.14) under the mount (16.10) once the file is
loaded in a process serving the app's compilation, `bun test`'s under `@abide/abide/test` included
(38.109), whether or not `createApp` has run.

16.89 A mutation's `refreshes` MUST `refresh` what it names, or what it returns for the call's
`Args` once that settles — the tags in it as one set of `tags` (13.15), and each `Selection` in it as
`refresh` over that `Selection` does, narrowed by the pattern paired with it (13.12) — once for each
run of the handler that answers without a refusal, and MUST NOT where the run is answered with a
refusal, the handler's or a rung's, or with a throw.

16.90 The `refresh` 16.89 states MUST have run before the call's answer settles, and before an
answer over the wire is sent.

16.91 Where the answer streams, the `refresh` 16.89 states MUST run once the run closes, before its
last frame is sent, and MUST NOT run where the run ends on a failure.

16.92 An `rpc` answering `GET` alone declared with `refreshes` MUST be refused as it is declared.

16.93 A `GET` call in a browser whose copy the build marked as streaming MUST be read over the
socket mux, answered as the request the call names made with the headers of the connection's
upgrade.

16.94 A `GET` call 16.93 reads whose answer carries a cookie or the `abide-principal` header, is a
redirect or is a binary MUST be taken over http as the answer the mux began, and MUST NOT run its
handler again.

16.95 A `GET` call 16.93 reads whose connection to the socket mux closes MUST refuse as 16.79 has it
where its answer's status had not arrived, and MUST fail its stream where it had, save where 18.25
opens the connection again, which MUST make the call again as 9.7 has a refresh run it.

16.96 A `GET` call 16.93 reads MUST NOT read its answer's body further while a frame of it the
connection was sent is held unsent, and MUST count toward 18.31's bound while it is read.

16.97 A `GET` call 41.20's script started that 41.26 does not wait for, whose answer is a jsonl
stream, carrying no cookie or `abide-principal` header, to a request carrying a caller, MUST be
answered over http only until its first chunk and the chunks ready with it, or a second without one,
and MUST read the rest of that run over the socket mux.

16.98 An answer of a `GET` call that 16.94 or 16.97 hands from one leg to the other MUST be given
only to a request carrying the caller and the sign-in the request it answered carried, and any other
request for it MUST be answered 404, as one naming no such answer is.

16.99 A `GET` call taking an answer 16.98 governs MUST name it in a header and not in its URL, and
the answer MUST be sent `cache-control: no-store`.

16.100 A `GET` call 16.93 reads whose answer 16.94 would hand to http, over a connection whose
upgrade carried no caller, MUST refuse as 16.79 has it.

16.101 The function a mutation's `refreshes` names MUST run in the scope the call's handler ran in.

16.102 A failure of a mutation's `refreshes`, thrown or rejected by its function or by a `refresh`
16.89 requests, MUST NOT change the call's answer, and MUST be warned once on `abide:reactive` naming
the handler and the failure.

16.103 An entry of a mutation's `refreshes` whose `refresh` fails MUST NOT keep the entries after it
from being refreshed.

16.104 An entry of a mutation's `refreshes` naming an `Rpc`, a pattern and options MUST refresh as
`rpc.refresh` given that pattern and those options does.

16.105 A handler whose value may hold `undefined` as an array or tuple item MUST be a compile error
naming the handler and the path to it.

16.106 A release that changes the shape of a request an `Rpc` sends MUST, in that release and each
one before the next minor release after it, answer a request sent in the shape before the change.

16.107 A `reactive.derived` body handing back an `Rpc` call's answer whole, and a `Reactive` set or opened on
one, MUST adopt the handler's value for those `Args` (11.12), as it would the value itself.

16.108 An `Rpc` called in a `reactive.derived` body MUST subscribe the body to the handler's value for those
`Args`, so a body that awaits the answer runs again where that value moves.

16.109 A handler declared over a `Reactive` MUST throw at construction, and a handler whose body
answers a `Reactive` MUST throw on the run that answers it, each naming a `memo`'s value, written
with `rpc.set` and `rpc.patch`, as the way to serve a value the server writes.

16.110 A handler MUST take a `memo`'s value options, `throttle` and `debounce` among them, and a
`GET`'s browser copy MUST keep the pace they declare as a `memo` does (5.18-5.25).

16.111 `rpc` MUST answer the verbs its value answers by — a function `GET`, any other value `GET`,
`PUT` and `PATCH` — or, where its options declare `methods`, the verbs `methods` names, and a call
of it MUST be sent as the first of them.

16.112 `methods` naming a verb its value cannot answer by — a function more than one verb, a value
any verb but `GET`, `PUT` and `PATCH`, or none of them `GET` — MUST be refused as it is declared.

16.113 `address` MUST put an `rpc` at that address in place of the one 16.2 gives it, and a private
handler declaring one MUST be a build error naming it.

16.114 A `GET` call whose URL, its args in the query, would be longer than 2048 characters MUST be
sent to its address as `QUERY`, its args as its JSON body, and a server MUST answer a `QUERY` as the
`GET` at its address.

16.115 A value's `PUT` MUST write the `value` its body carries as its owner's write (11.76), and a
value's `PATCH` MUST apply the JSON Patch its body's `ops` carry (18.11) to the value in place, and
each MUST answer the value then held.

16.116 A browser's copy of a value answering `PUT` or `PATCH` MUST send its `set` as a `PUT` and
its `patch` as a `PATCH` of the ops the mutation made, and MUST then hold what the server answers,
or load the value again where the answer is a refusal.

# 17. Response helpers

17.1 Every body helper MUST take `Values<T>`.

17.2 `response.page` MUST be defined as a write through `response` naming `text/html`, and MUST take
what a render produced rather than perform the render.

17.3 `response.redirect` MUST be defined as a write through `response` carrying a `RedirectStatus`,
defaulting to 302.

17.4 `refuse` on a server MUST hand back, per 15.5, the undeclared `Failed` named `HttpError` at
the given status.

17.5 `refuse` MUST carry no data, and MUST NOT take an options bag for any.

17.6 `response.jsonl`, `response.sse` and `response.bytes` MUST each be defined as a write through
`response` fixing the framing of a streaming answer.

17.7 An implementation MUST NOT negotiate past a framing a handler fixed.

17.8 An answer at a failure status (400-599) MUST carry that status's registered reason phrase as
its `statusText` when nothing wrote one, and `refuse` given no `message` MUST take the same phrase,
falling back to `HttpError` for a status with none.

17.9 `response.json` MUST be defined as a write through `response` fixing the answer as
`application/json`, serialized as a bare return is.

17.10 `response.json` given `undefined` MUST answer `null` at the status written through `response`,
and MUST NOT answer 204.

# 18. Following a `GET`

18.1 Every `GET` a page follows MUST be carried over a single web socket mux.

18.2 A subscription over the mux from another origin MUST be refused unless the handler's
`crossOrigin` admits that origin.

18.3 A client reading a `GET` MUST be subscribed over the socket mux to that handler's productions
for those `Args`.

18.4 A subscriber's copy of a wired `Reactive` MUST carry what that `Reactive` declares of `key` as a
property name, `tags` as a list of names, `identity` as `deepEqual`, and `throttle` or `debounce` as
a number, and MUST NOT carry a function form of `key` or `tags`, which stays the server's (13.15).

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

18.15 The build MUST warn where a `GET`'s `Reactive` declares `key`, `tags`, `throttle` or `debounce`
by a value that is not a function and whose type is not the one 18.4 carries.

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

18.33 A browser's connection to the socket mux that closed while a `GET` is followed MUST be opened
again at once where `online` becomes true or the page becomes visible.

18.34 A browser's connection to the socket mux MUST NOT be opened again while `online` is false.

18.35 A subscriber's copy of a `GET` written here (3.10) MUST NOT take a value or a patch sent to it
while `outbox` holds a call not yet delivered, and MUST read the value again once it holds none.

18.36 A subscription to `/__abide/pairing` MUST be sent a trigger meant for the browser and the
sign-in the upgrade of its connection carried, and MUST NOT be sent one meant for any other.

18.37 `rpc.refresh` and `rpc.invalidate` given a `caller` MUST send their trigger only to the
subscriptions whose connection's upgrade carried that `principal.caller`, and MUST act on the values
the server holds as they would given none.

18.38 `rpc.refresh` and `rpc.invalidate` given a `caller` MUST throw in a browser.

18.39 A `caller` of `true` given to `rpc.refresh` or `rpc.invalidate` MUST stand for the
`principal.caller` of the request it is given in, and MUST send the trigger to no subscription where
that request carries none.

18.40 A subscription to a `global` `GET` for `Args` no entry holds MUST build the entry for them, and
MUST be fed from it, as a call for them would build it.

18.41 A production that replaces a followed value MUST be sent to a subscription standing at the
version it replaced as the JSON Patch from that value to the new one, an array its `key` tells apart
matched element by element, and MUST NOT be sent as the value.

18.42 A served `memo` entry kept in a store with an append face MUST record each change in that
log, and its version MUST be the number of the change's record; opened again on that store where
the value it holds is the value the log leaves, it MUST stand at the log's last record. Until a log
read asynchronously has answered, the entry MUST be versioned per 18.7.

18.43 A subscription naming a version the log of 18.42 holds MUST be sent the records after it as
JSON Patch, in this process or one opened on the store after it.

18.44 The log of 18.42 MUST write the value whole every 64 records, MUST keep 64 records behind that,
and a subscription naming a version older than the records kept MUST be sent the value.

18.45 A record another process appends to the log of 18.42 MUST be applied to this process's entry at
that record's number, and sent on to its subscriptions, and an entry opened on that log MUST NOT
re-read its store when the store's `watch` says it moved.

18.46 A change of 18.42 to a `memo` entry MUST be numbered the record after the last this process knows of, without
waiting on the log, and MUST be appended only where that number is still the log's next.

18.47 Where another process's record took a number this process named, its `memo` entry MUST apply
that process's records, then its own changes not yet appended over them, MUST append the result as the
value whole and stand at its number, and a subscription naming a number it gave up MUST be sent the
value.

# 19. Mount paths and schemas

19.1 A route MUST be answered for each method by one file at most, a page answering `GET` and `HEAD`
at its own, and a second MUST be a build error naming both files, two routes differing only in
their parameters' names or matchers being one route.

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

19.13 A page that calls neither `jsonSchema` nor `form` MUST NOT carry `validateJson`.

19.14 A `JsonSchema` given as a `Schema` without `jsonSchema` MUST be refused, naming
`jsonSchema`.

19.15 A default in a keyed body's parameter or a handler's parameter that is not a literal MUST
be refused at construction, naming its `Args` member, and the build MUST refuse one on a handler.

19.16 `route.url` MUST hold the address a page is served at, the path `APP_URL` names included, on
the server as in the browser.

19.17 The root of an app served below the path `APP_URL` names MUST be that path without a trailing
`/`, as `url('/')` writes it, and a request for the path with one MUST be redirected 308 to it, by
path alone.

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

19.25 `validateJson` MUST read a member left `undefined`, at any depth of a record, as absent to
`required`, `properties` and `additionalProperties` — in process as the wire carries it (30.28).

19.26 An `Issues<T>` over an `Rpc` MUST be the `Issues` of that `Rpc`'s `Args`.

19.27 A `GET` or `DELETE`'s text arg the `JsonSchema` declares a record, or a list of records or
lists, MUST be read from its JSON text, and text that is not that JSON MUST be left as text.

19.28 Where a handler's `args` is `jsonSchema` over a document written as a literal, inline or bound
to a name first, the build MUST read that document as the handler's args document in place of the
one 19.9 derives.

19.29 A mutation's browser copy MUST hold the args document the build read for it, and a `GET`'s
MUST NOT.

# 20. Generated surfaces

20.1 Every surface `Clients` names MUST be derived from the route table, and MUST NOT be authored
beside it.

20.2 Every key of `Clients` MUST default to true, but where 16.37 defaults it to false.

20.3 `Clients` MUST decide what is generated and listed, and MUST NOT decide who may call.

20.4 `ui: false` MUST generate no client wrapper, and importing that handler from the client graph
MUST then be a compile error naming it.

20.5 `/__abide/openapi.json` and `/__abide/mcp` MUST be served from a value derived from the route
table, and MUST NOT expire while the route table stands.

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

20.18 Every tool call the MCP surface answers MUST write one `debug` line on `abide:mcp` naming the
tool, the status it was answered with and how long it took, whether `/__abide/mcp` or a `Toolbox`
made the call — a call naming a tool it does not publish answered 404, and one whose answer threw
500.

20.19 A tool `/__abide/mcp` lists MUST declare an `inputSchema` whose top-level `type` is `object`,
whatever its handler's args schema declares there.

20.20 A handler `/__abide/mcp` would list whose args schema can never be an object MUST refuse the
app at boot, naming the handler.

20.21 A `tools/call` that `/__abide/mcp` answers for a call answered with an image body of a type
44.36 names MUST carry that body as one `image` content item, base64 with its type, in place of its
text, and MUST carry no `structuredContent`.

20.22 A call to a tool declaring an `outputSchema` that is answered with an `image/*` body MUST be
refused, its text naming the tool and the image's type, and MUST be logged per 20.18 as a 500.

20.23 A path parameter `/__abide/openapi.json` publishes, save a rest's, and a route parameter an MCP
tool's input declares, a rest's on each of its items, MUST carry the pattern its segment takes a part
by, anchored, and a matcher's name MUST be no part of the path, the operation or the tool.

20.24 `rpc.tool` MUST be the name 20.13 gives its handler, read from its `rpc.address` with the mount
(16.10) taken off, and MUST be `undefined` while its `rpc.address` is.

# 21. Generated headers

21.1 Every response MUST carry `x-content-type-options: nosniff`.

21.2 Every response MUST carry `traceresponse`, a refusal included.

21.3 A page, an rpc answer and a refusal MUST default to `cache-control: private, no-store`, save
where 21.22 or 21.25 has it.

21.4 `/__abide/openapi.json` and `/__abide/mcp` MUST answer `cache-control: no-store`. `/__abide/health`
and `/__abide/principal` are answered as handlers (25.3) and carry 21.3's `private, no-store`.

21.5 The built bundle MUST answer `cache-control: public, max-age=31536000, immutable`.

21.6 A page MUST carry `referrer-policy: strict-origin-when-cross-origin`.

21.7 An answer that depends on a request header MUST carry `vary` naming it.

21.8 A `GET` declaring `global` MUST answer a `max-age` derived from its `ttl`, and an app MUST NOT be
required to state the duration a second time.

21.9 A `GET` declaring `global` MUST answer `private`.

21.10 A write through `response` MUST override every header and the status the answer carries.

21.11 The `max-age` 21.8 derives MUST replace 21.3's `no-store`, or lead 21.22's directives, and the
rest of that header MUST be the one 21.3 or 21.22 gives.

21.12 A file under a `public` directory MUST answer `cache-control: public, max-age=0, must-revalidate`,
save where 21.23 has it.

21.13 A file under a `public` directory MUST answer an `etag` derived from its bytes.

21.14 A request whose `if-none-match` is `*`, or lists the `etag` 21.13 derives under weak
comparison, MUST be answered 304.

21.15 An `Rpc` answer MUST carry `server-timing` with its handler's duration under a metric naming
the run: `Seeded` where the `render`'s run answered it, `Cached` where a `global` production already
held answered it, `Started` where it is a stream timed to its first chunk, and `Direct` otherwise.

21.16 The `max-age` 21.8 derives MUST be what is left of the answered entry's `ttl`.

21.17 A `GET` declaring `global` whose `ttl` is `Infinity` MUST keep the `cache-control` 21.3
or 21.22 gives it.

21.18 A page MUST default to `content-security-policy: frame-ancestors 'none'`.

21.19 `access-control-allow-origin` MUST name only an origin the handler's `crossOrigin` admits.

21.20 An answer whose request ran `middleware` rungs MUST carry `server-timing` `Middleware` with the
time those rungs took apart from what they wrapped.

21.21 The `Direct` duration 21.15 carries MUST NOT include the time 21.20 counts.

21.22 Where 45.1 has a page register the worker `ABIDE_OFFLINE` turns on, the answer of a `GET` of
the app's own that is neither a refusal nor a stream 16.32 frames MUST default to `cache-control:
private, stale-while-revalidate=604800, stale-if-error=31536000`.

21.23 Where 45.1 has a page register the worker `ABIDE_OFFLINE` turns on, a file under a `public`
directory MUST answer `cache-control: public, max-age=0, stale-if-error=31536000`.

21.24 Where 45.1 has a page register the worker `ABIDE_OFFLINE` turns on, an answer carrying the
`abide-principal` header 26.24 has it carry MUST carry `clear-site-data: "cache"`.

21.25 Where 45.1 has a page register the worker `ABIDE_OFFLINE` turns on, a page MUST default to
`cache-control: private, max-age=0, stale-if-error=31536000`.

# 22. Request-scoped ambients

22.1 `request`, `request.ip`, `response` and `server` MUST throw outside a request.

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

22.11 `isServer` MUST be true inside a request, an `App.run` or a `render`, and wherever there is no
document, and MUST be false everywhere else.

22.12 `request.ip` MUST answer the address of the peer the listener received the request being
served from, the same under `abide start`, `abide dev` and `App.listen`, and `null` where the
listener names none.

22.13 `request.ip` MUST answer `'in-process'` for a request no listener received: one `App.fetch` or
`App.run` was handed in process, a call the app makes of itself among them.

# 23. Route and connectivity

23.1 Each member of `route` MUST be its own `Reactive`, and `route` MUST NOT be one `Reactive` over a
composite.

23.2 `route.url` MUST be one `URL` instance per navigation, built when the route resolves.

23.3 A page route MUST be created where a `.abide` 23.21 makes a page has a template or a head.

23.4 A page route's file path MUST determine its `route.url`.

23.5 `Params` MUST carry what `[param]`, `[[optional]]` and `[...rest]` matched.

23.6 `route.name` MUST be the resolution path.

23.7 Where `isServer` is false, `online` MUST be `navigator.onLine` and its events, save while 41.32
holds it.

23.8 Where `isServer` is true, `online` MUST be true.

23.9 In a page or a layout, `route.params()` MUST be typed by that file's own route: a required
segment as text, an optional one as text that may be absent, a rest as a list, and in a layout any
segment a page below it adds — under `abide check`, a page's required or optional segment whose
matcher is an alternation of literals as the union of those literals.

23.10 `reachable` MUST be true where the host answered a request, whatever the status it answered.

23.11 `reachable` MUST be false where the host has not answered within 5 seconds.

23.12 `reachable` MUST hold each host's answer for 60 seconds, as a `global` `memo`'s `ttl` holds an
entry nothing subscribes to (6.2).

23.13 `reachable` MUST ask a host that names no scheme over https, and an origin as written.

23.14 A route MUST be the path of its file below the app's `--root` without its extension, a handler
file's being `.server.ts`, and an `index.abide`'s, a `layout.abide`'s and an `error.abide`'s MUST be
its directory's.

23.15 A file under a fence MUST NOT have a route, save `src/native/menubar.abide` (38.167).

23.16 A fence under a fence MUST be a build error naming both.

23.17 A route whose first segment is `__abide` MUST be a build error.

23.18 An `index.abide`, a `layout.abide` or an `error.abide` under a fence MUST be a build error.

23.19 An `import '…' with { type: 'routes' }` in an app's `.abide` MUST place every `.abide` under the
directory it names, and every handler file, at the importing file's directory, routed by its path
below the named directory as 23.14 routes the app's own, and a specifier naming no directory MUST be a build error.

23.20 A directory two `type: 'routes'` imports name, or one that is the app's own, MUST be a build
error naming the mount.

23.21 A `.abide` of the app's own directly in a directory under no fence MUST be a page, save a
`layout.abide` and an `error.abide`.

23.22 A file of the app's own directly in a directory under no fence MUST be a `.abide`, a handler
file (`<name>.server.ts`), a param file (`<NAME>.param.ts`), a test file (`<name>.test.ts`), a bench
file (`<name>.bench.ts`) or a declaration file (`<name>.d.ts`), and any other MUST be a build error
naming the file and a `lib` directory — save a file directly in a root that holds its package's
`package.json`, which MAY be any file but a `.ts`.

23.23 A server file of the app's own under no `lib` directory, and no handler file, MUST be a build
error naming the file and a `lib` directory.

23.24 A param file MUST hold one `export const`, of the name it is filed under, whose value is a
regular expression literal carrying no flag, and anything else, an import included, MUST be a build
error naming the file.

23.25 A matcher repeating, with `*`, `+` or `{n,}`, a group that itself holds such a repetition, or
carrying a backreference, MUST be a build error naming its file.

23.26 A segment `[name=NAME]`, `[[name=NAME]]` or `[...name=NAME]` MUST name the param file `NAME.param.ts`
in the directory holding that segment or the nearest directory above it below the root it is filed
under, and one naming none MUST be a build error naming the segment's file and `NAME`.

23.27 Two routes naming different matchers, or a matcher and none, at one parameter position after
one static prefix MUST be a build error naming both files.

23.28 In a browser `route.index` MUST be 0 at an entry a document load arrived at carrying no index
the router wrote, one more than the index of the entry a push or a browser's fragment step left, and
the index the entry was written with where a history step or a reload arrives at it — so a step back
of no more than `route.index` entries MUST arrive at an entry of this app's router.

23.29 On a server `route.index` MUST be 0.

23.30 Where `isServer` is false, `media(query)` MUST be whether `matchMedia(query)` matches, and MUST
follow its `change` event, save while 41.32 holds it.

23.31 Where `isServer` is true, `media(query)` MUST be false.

23.32 `media` MUST hand back the same value for the same query text, and MUST NOT add a listener
for a query it already holds.

23.33 The root's `native` directory MUST be a fence, and a `native` directory anywhere else MUST
NOT be one.

# 24. Tracing

24.1 `trace` MUST be built on first ask and held for the request.

24.2 `trace.sampled` MUST carry the caller's sampling decision verbatim.

24.3 A span MUST be a `LogRecord`, and MUST NOT be a second feed.

24.4 A span MUST carry `startedAt` as ISO-8601 and its duration as a monotonic measurement.

24.5 `trace.headers` MUST carry `traceparent` naming the current span as parent.

24.6 A `trace.span` opened with `timing` MUST be carried in its answer's `server-timing` under its
name, where it closed before the head was sent.

24.7 A `trace.span` opened with `timing` MUST throw where its name is not an HTTP token.

24.8 A `trace.span` whose body returns a thenable MUST close when it settles, and MUST take a
`Reactive` as a value per 1.6.

24.9 A span MUST carry its own id and the id of the span it opened under in its `LogRecord`'s
`span`, and MUST close as an error where its body threw or its thenable rejected.

24.10 Where `abide:request` is enabled, each request MUST be written as a `server` span whose id is
the one `traceresponse` names and whose parent is the one the caller's `traceparent` names, named by
its method and the route it matched, and closing as an error where its answer's status is 500 or
above.

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
`abide-principal` header, and on it a browser MUST, in every tab and once in each, refresh
everything it holds save a `global` value, as a bare `refresh` does (13.7), where the call was not a
`GET`, and reload the `principal` document where it was, each value serving the one it holds until
the new one lands per 7.4.

26.25 `Principal` MUST admit a field an app declares on it, of any type.

26.26 `principal.resolved` MUST hold the claims `principal.set` sealed where no `onPrincipal` is
filed, and where one is, MUST hold what the resolvers answered and no claim they left out.

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

27.9 `config` MUST be an unkeyed `global` `memo` over the precedence 27.2 states.

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

30.3 A required segment MUST map to a required key of `ParamsOf<P>`, typed under `abide check` as
23.9 types it where its matcher is an alternation of literals.

30.4 An `OptionalNames<P>` segment MUST map to an optional key, and leaving one out MUST omit that
segment.

30.5 A `RestNames<P>` segment MUST map to an optional key taking an array as well as a scalar.

30.6 The `Query` argument MUST follow the params, and the defaults 30.40 compares it with MUST
follow the `Query`.

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

30.19 `url` MUST throw where a param, or a member of a rest param, of a segment naming no matcher
carries a `.`, and where any param or member is `.` or `..`.

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

30.26 `abide check` MUST refuse a `url` literal that no page route of the app (23.3) is filed under,
no public file of the app is served at, and that is none of the four addresses 21.4 names.

30.27 A `navigate` whose request fails, or whose route's chunks fail to load, MUST leave the address
to the document, save where 30.32 holds.

30.28 A `Query` record and the args an `Rpc` carries in its URL MUST be written in one spelling: a
member left `undefined` omitted, a list of primitives its member repeated, an empty list its name with
no `=`, a record or a list holding a record or a list its canonical JSON per 11.24, and anything else
its text.

30.29 A back or forward history step `navigate` answers MUST restore the scroll the entry it arrives
at was left at, once that entry's page is mounted.

30.30 A page hydrated at an entry that carries the scroll it was left at, by a reload or a return to
the document, MUST land at that scroll.

30.31 A `navigate` that a later `navigate` overtakes before it mounts MUST abort the request it made
to `middleware`.

30.32 A `navigate` that is not a history step, whose request gets no answer while `online` is false,
MUST leave the page and the address where they stand, save where 45.12 holds.

30.33 A history step under 30.20, and a `navigate` under 30.21, MUST move `route.url` to the address
it steps to.

30.34 A `[param]` or an `[[optional]]` segment naming no matcher MUST NOT match a part carrying a
`.`, and such a `[...rest]` MUST NOT take one.

30.35 A segment naming a matcher MUST match a part only where the whole part, percent-decoded,
matches it, and a `[...rest]` naming one MUST take a part only where it does.

30.36 No dynamic segment MUST match a part that is `.` or `..`.

30.37 An address whose part a segment refuses, by its matcher or by 30.34, MUST be matched against
the routes 30.9 ranks after that route.

30.38 `navigate` given a number MUST step the history by that many entries, back where it is
negative, and MUST settle once the entry the next history step arrives at is arrived at, per 30.29.

30.39 `navigate` given 0 MUST settle at once, and MUST NOT reload the document.

30.40 `url` MUST leave out of the address each member of its `Query` whose spelling under 30.28 is
the spelling of the member of the same name in its defaults.

30.41 `route.query` MUST read each member its defaults name from `route.url`'s query as its
default's type: a number as a number, `true` or `false` as a boolean, text as text, and a list as
every repeat of the name as text, a name with no `=` being the empty list per 30.28.

30.42 A member `route.url` does not carry, or whose text 30.41 cannot read as its default's type,
MUST read as its default.

30.43 A write to the value `route.query` answers MUST set each member its defaults name to what the
write carries, and a member the write leaves out or leaves `undefined` to its default.

30.44 A write to the value `route.query` answers MUST be one `navigate`, with `replace` and
`keepScroll`, to the address 30.48 names with its query rewritten, each member at its default left
out per 30.40.

30.45 A write to the value `route.query` answers MUST leave every member of the query of the address
30.48 names that its defaults do not name as it stands.

30.46 A write to the value `route.query` answers where `navigate` has no router MUST throw.

30.47 A change to `route.url` that leaves every member the defaults name reading as it did MUST NOT
wake a reader of the value `route.query` answers.

30.48 Until the `navigate` the last write to a value `route.query` answers made has settled, every
value `route.query` answers MUST read under 30.41, and a write to one MUST rewrite under 30.44, the
address that `navigate` goes to, and `route.url` otherwise.

# 31. Reading and writing by name

31.1 Inside a `.abide` file a name bound to a `Reactive` MUST be read wherever 31.3 does not hold it.

31.2 A read by name MUST be live.

31.3 A name MUST hold the `Reactive` only where the declared type of its position is a `Reactive`: an
annotated binding, an annotated return, a `Reactive`-typed parameter, a member of an object literal
passed where a parameter's type declares that member a `Reactive`, a `bind:` operand, an `await` operand — or where 31.13
holds it.

31.4 Assignment to such a name MUST be a write, and the assigned value MAY be settled, a load, or a
`Reactive`.

31.5 A property access on such a name MUST reach the value, except a member the name's type
declares that the value's type does not — one the `Reactive` type declares, which MUST reach that
member bound to the `Reactive`, or one a type built on the `Reactive` adds, which MUST reach that
member as written.

31.6 A call on such a name MUST reach the `Reactive` API where 31.5 reaches the `Reactive`'s
member, and the value's method otherwise.

31.7 `s` and `s.set` MUST keep compiling inside a `.abide` file.

31.8 A write through a member path into plain data MUST copy down that path and then write, and the
copy MUST NOT be optimized away.

31.9 A call of an array's mutator through a member path MUST be a write per 31.8, run on a copy of
the receiver, and MUST be resolved from the type of the receiver rather than from the member name.
Arguments that suspend — an `await`, a `yield` — MUST be evaluated before the copy is taken.

31.10 A template-local binding MUST shadow a name bound to a `Reactive` for the body it is bound in.

31.11 A read spelled `foo()` MUST take no arguments, and an argument MUST be a compile error.

31.12 A destructuring pattern or a spread over such a name MUST read it once.

31.13 A name MUST hold the `Reactive` where the declared type of its position is a `Selection`, or a
type parameter constrained by one.

31.14 A write through a member path that reaches a value which is not plain data — anything but an
array or an object whose prototype is `Object.prototype` or `null` — MUST assign on that value itself, MUST NOT
copy it or any level above it, and MUST NOT wake a reader.

31.15 Inside a `.abide` file a property access or an element access whose declared type is a
`Reactive` MUST be read and written as a name bound to a `Reactive` is, per 31.1 to 31.7, save an
access on a `Reactive`, which 31.5 governs. The declared type is the access's in the program as it
runs, where a member inferred from a name 31.1 reads holds that name's value.

31.16 `abide check` MUST hold a write through a member path — an assignment, a compound assignment
or an update, at any depth and through a computed key — to the type of the member it writes, on the
`.abide` line.

31.17 A name a destructuring pattern binds to a `Reactive` — in an object or an array pattern,
renamed, defaulted or nested, under `const`, `let` or `var` — MUST be read and written as a name a
declaration binds to it is, per 31.1 to 31.7, save a name a `props` pattern binds (33.4).

31.18 `abide check` MUST hold a write to such a name — an assignment, a compound assignment or a
logical assignment — to the type its `Reactive`'s `set` takes, an object literal written as the
value refused a property that type does not declare, on the `.abide` line.

31.19 An operand of `??`, `||` or `&&`, and an arm of a conditional, MUST stand in the position of
the expression it is part of, for 31.3.

31.20 Assignment of a `Reactive` to such a name, or to an access 31.15 governs, MUST bind it to that
`Reactive` where it holds `undefined`, and MUST be the write 31.4 makes where it holds a `Reactive`.

31.21 A read of such a name, or of an access 31.15 governs, whose declared type admits `undefined` or
`null` MUST read `undefined` where it holds no `Reactive`.

# 32. Templating

32.1 `{expr}` MUST render reactive text, escaped.

32.2 `{raw(...)}` MUST render raw HTML.

32.3 A `name={expr}` attribute or property expression MUST be reactive, whole or interpolated.

32.4 `on<event>` MUST bind a native listener on an element, a function or an `EventListenerObject`
alike, and MUST be an ordinary prop on a component.

32.5 `bind:value` MUST read the property and write it back on input or change, through the member
path where its operand is a path into a value (31.8), a computed step's key read at each write.

32.6 `bind:prop` on a component MUST hand the child the caller's `Reactive`, or its `{ get, set }` pair,
as that prop's write path.

32.7 A boolean bind MUST mirror a boolean DOM property as a boolean attribute, and MUST NOT write a
string.

32.8 `bind:group` MUST compare against the input's own value, and MUST NOT emit a `group` attribute.

32.9 `bind:element` MUST accept a `Reactive` of an element, a callback returning an optional
`Disposer`, or a list of such callbacks, each handed the element in the list's order and each
`Disposer` run where the element's nodes leave.

32.10 `class:name` and `style:prop` MUST set one class or one style property.

32.11 `{...expr}` MUST spread props on a component and attributes on an element.

32.12 `{#if}` MUST render one branch.

32.13 `{#for}` with neither a `key` of its own nor one 32.32 reads off its value MUST be positional.

32.14 `{#for}` without a key over a stateful body and a subject that reads a `Reactive` or calls a
function MUST warn in development.

32.15 `{#for}` over an async iterable that is not also iterable MUST render each item as it
arrives, and MUST append rather than reconcile.

32.16 `{#try}` MUST be a render-time boundary over a region: a failure MUST replace the whole body
with its `{:catch}` arm, and its first load (32.96) MUST replace the whole body with its `{:pending}`
arm where it has one.

32.17 A capitalized tag `<Name/>` MUST be a component invocation.

32.18 `<slot/>` MUST render children, and a fallback MUST render where none were passed.

32.19 An interpolated `style` attribute MUST lower to `style:prop` under a static property name, and
MUST NOT be built as a string.

32.20 An interpolation in a URL-typed attribute MUST be scheme-checked, and a scheme outside
`http:`, `https:`, `mailto:`, `tel:`, `blob:`, `data:`, `abide-bridge:` (44.40) or a relative
reference MUST be dropped and warned on `abide:render`, naming the attribute and not the value.

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
that value's `key`, where it declares one.

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

32.56 A `{:pending}`, a `{:catch}` or a `{:finally}` anywhere but directly inside a `{#try}` MUST be
a build error.

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
On any `<select>`, an option added after the value was written MUST be selected where it holds it.

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

32.68 A `bind:element` value MUST be handed its element after a region's build has put that element
in the region, and after every block and component inside the element has built, so a callback
reading layout, querying its descendants or calling `focus()` acts on a connected, whole node.

32.69 `bind:element` on a component MUST be a build error.

32.70 Markup the client parses for a slot holding a value branded by `raw`, a `{#if}` arm or a
`{#for}` row MUST be parsed as the document's parser parses it inside the element it goes into, and
an element the client builds — a component's own, or children a caller hands one — MUST take the
namespace the document's parser gives it there, as MUST an attribute the client writes on it.

32.71 A `class` or `style` attribute beside a `class:name` or `style:prop` MUST keep moving (32.3)
and MUST write only its own classes or declarations; a class either of them holds MUST stay on the
element, and a style property MUST resolve as the server's merged attribute does — the attribute's
declarations first, then each directive's in the tag's order.

32.72 An element MUST be a build error where a `bind:` and something else both write its value: the
attribute a `bind:name` names, `checked` beside `bind:group`,
an `<option selected>` inside a `<select bind:value>`, or text inside a `<textarea bind:value>`.

32.73 `bind:files` MUST hold a list of the input's files, with or without `multiple`, MUST write the
files picked back on change, and MUST hand the input a list written to it; the server MUST write
nothing for it.

32.74 A `bind:` on an element naming none of `value`, `checked`, `open`, `group`, `files` and
`element` MUST be a build error.

32.75 A `bind:` on an element MUST write its operand before any `on<event>` listener on that
element, written or spread, runs for the same event, wherever the two are written in the tag.

32.76 A `bind:` whose operand is a path into a value that takes an optional step (`?.`) MUST be a
build error.

32.77 A slot holding a value branded by `raw` MUST write its markup as given, with no element or
attribute in it removed and no URL in it scheme-checked.

32.78 `abide check` MUST hold the `set` of a `bind:` on an element to what the element writes back:
a boolean for `bind:checked` and `bind:open`, a list of files for `bind:files`, and for a
`bind:value` `number | undefined` on an `<input>` whose `type` is `number` or `range`, and otherwise,
on an `<input>` or a `<textarea>`, a string where the bound value holds no number,
`number | undefined` where it holds nothing else, and all three where it holds both (32.58). A
`<select>` MUST be held as an `<input>` is, save that where the bound value holds strings it writes
those strings, and a `<select multiple>` a list of the strings its value's items hold, or of any
string where they hold none. A `type` or a `multiple` written as an expression, or absent beside a
spread, MUST be held to the union of what each value of it writes.

32.79 `elementSize` MUST write the `width` and `height` of the element's box 32.90 names, as one
record, at each observation of a size its target does not already hold.

32.80 `elementVisible` MUST write whether the element is in view, as 32.112 reads it, of the viewport
or of the root 32.89 names, at each observation.

32.81 Every `elementSize` and every `elementRect` in a document, and the anchor and the popover
50.26 places again when either changes size, MUST be observed for resizes by one shared observer,
and every `elementVisible` measured against one root with one `rootMargin` and one `threshold` by
one other per root, margin and threshold, the viewport being one root.

32.82 An `elementSize` or an `elementVisible` MUST NOT write its target before the first
observation of its element, and MUST NOT read the element's layout to write it.

32.83 The `Disposer` the element binding of an `elementSize`, an `elementVisible` or an
`elementRect` hands back MUST stop observing its element.

32.84 `elementRect` MUST write the element's rectangle in the viewport — `x`, `y`, `top`, `left`,
`right`, `bottom`, `width` and `height`, as `getBoundingClientRect` reports them — as one record,
after a resize of the element, a scroll of the document or of any element in it, or a resize of the
window, where its target does not already hold that rectangle.

32.85 `elementRect` MUST be written for a move of its element that no resize of the element, scroll
or resize of the window accompanies, in the frame after the move.

32.86 Every `elementRect` in a document MUST share one scroll listener and one window resize
listener, added with the first `elementRect` and removed with the last.

32.87 The triggers 32.84 names that arrive before the next animation frame MUST be answered by one
read of every `elementRect` element's rectangle in that frame, every read before any write, and
`elementRect` MUST NOT read an element's rectangle outside such a frame.

32.88 What observes an `elementRect` element for 32.85 MUST NOT be made in a frame a scroll event
preceded, and MUST be made again only in a frame whose read found the element moved or the viewport
resized since it was made. A frame a scroll preceded MUST ask for the frame after it, which answers
that scroll under 32.87, so the observers stand again once the scroll is over. It MUST cost no work
while neither moves.

32.89 The `root` option of `elementVisible` MUST name the root it measures against, the viewport
where it is absent, and its `rootMargin` and `threshold` MUST be handed to the observer as
`IntersectionObserver` takes them. A `Reactive` there MUST be watched, so a change of what it holds observes the element
against the new root, and while it holds no root the element MUST NOT be observed and the target
holds what it last held. A root's observer MUST be disconnected when the last element measured
against it stops being observed.

32.90 The `box` option of `elementSize` MUST observe the element in the box `ResizeObserver` names
by it — `"content-box"`, where it is absent, `"border-box"` or `"device-pixel-content-box"` — and
write that box's `width` and `height`, the last in device pixels. Each MUST be the physical axes
whatever the element's writing mode, and a `Reactive` there MUST be watched, so a change of the box
observes the element again.

32.91 A `bind:size`, a `bind:visible` or a `bind:rect` on an element, or a `visibleIn` or a `sizeBox`
attribute, MUST be a build error naming the `elementSize`, `elementVisible` or `elementRect` that
measures it.

32.92 An `elementSize`, an `elementVisible` or an `elementRect` bound to an element that another of
the same name is observing MUST throw.

32.93 In a browser, a slot rendering a value branded by `raw` into the document the runtime loaded in
MUST create no node but those its markup parses to, whatever was parsed before it.

32.94 A `style:prop` whose value is `null`, `undefined` or empty up to its first `;` MUST declare
nothing, whether the server writes it or the browser does.

32.95 An `on<event>` listener that is an `EventListenerObject`, written or spread, MUST be added with
its `capture`, `once`, `passive` and `signal` as the listener's options.

32.96 A `{#try}`'s first load MUST last from where its region is first rendered until its body first
renders with no read in it, outside any `{#try}` it holds, aborted by a `NotLanded` (2.12), and MUST
NOT begin again.

32.97 The compiler MUST warn on a `{#for}` subject that falls back to an empty list where a reactive
read in it has not landed — `x.ready() ? x : []`, `x || []`, or `x ?? []` where 14.17 does not warn —
naming 32.22.

32.98 The observers 32.81 shares for resizes and for `elementVisible` against the viewport MUST
each be made by the first of its kind bound while it observes no element,
from the `ResizeObserver` or `IntersectionObserver` the document holds then.

32.99 A function, a `Reactive` or a list a `{...expr}` spread onto an element carries under
`bind:element` MUST be handed that element as `bind:element` hands it (32.9, 32.68), bound again when
the value carries another, and MUST NOT be written as an attribute; and every `bind:element` an
element carries, written or spread, MUST be handed the element, in source order, none replacing
another.

32.100 Where the `once` option of `elementVisible` is `true`, the part MUST stop observing the
element, and stop watching a `Reactive` its `root` holds, in the delivery that writes `true`, and
MUST NOT write its target again.

32.101 `scrollEdges` MUST write on the element it is bound to a `data-scrollable` attribute holding,
space-separated in the order `top`, `bottom`, `start`, `end`, each edge of the element that a pixel
or more of the content it scrolls lies beyond, MUST remove the attribute where no edge does, and
MUST NOT write the attribute where it already holds what a read finds.

32.102 The `start` of `scrollEdges` MUST be the edge the element's horizontal scroll position is
measured from — its left in a left-to-right element and its right in a right-to-left one — and its
`end` the edge opposite.

32.103 `scrollEdges` MUST read its element again after a scroll of the element, a resize of the
element, a `load` event at a node inside it, and a node added to or removed from its subtree, text in
it changed or an attribute in it written, save its own `data-scrollable`.

32.104 The element `scrollEdges` is bound to MUST be observed for resizes by the observer 32.81
shares, and `scrollEdges` MUST NOT observe a node inside it for resizes.

32.105 `scrollEdges` MUST listen for its element's scrolls passively.

32.106 The reads 32.103 owes before the next animation frame MUST be made in that frame, one per
element, every read before any attribute is written, and `scrollEdges` MUST NOT read an element
outside such a frame.

32.107 The `Disposer` `scrollEdges`'s element binding hands back MUST stop observing its element and
remove its `data-scrollable`.

32.108 `scrollEdges` bound to an element it is already bound to MUST throw.

32.109 Every `on<event>` listener an element carries, written or spread, MUST be added to it, none
replacing another of its event: the written ones first, then each spread's in source order.

32.110 An `elementSize`, an `elementVisible` or an `elementRect` called with no target MUST hand back `host`, the part to spread, beside each
field of what it writes read by name — `visible`'s boolean as `visible` — each field `undefined`
until the first write 32.79, 32.80 or 32.84 makes, and each a value of its own, so a write that
changes one field MUST NOT wake a reader of only another.

32.111 A `{#for}` row's index MUST read the position the row stands at now, in a row a reconcile
moved as in one it made.

32.112 An element `elementVisible` measures MUST be in view where it intersects its root by at least
the smallest share its `threshold` names, and where it intersects at all where none is named.

32.113 A `value` an expression or a spread writes to an `<input>` or a `<textarea>`, a `checked` to
an `<input>`, and a `selected` to an `<option>` MUST also be written by the browser into the
element's property of that name — `value` as the attribute's text, or `''` where 32.37 makes it
absent, and `checked` and `selected` as whether it is present — where that differs from what the
expression or the spread last wrote, and only there. It MUST NOT be written while the property
already holds it, nor, for a `value`, while the property's text already reads as the number its
text reads as (32.59's reason).

32.114 The server MUST render a `value` an expression or a spread writes to a `<textarea>` as its
text, as well as its attribute: a spread's where the `<textarea>` has no text of its own, and the
last spread's that carries one where two do.

32.115 A `<textarea>` with a `value={expr}` and text of its own MUST be a build error.

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
dropped wherever it stands. Whitespace here and in 33.18 is HTML's ASCII whitespace: a no-break
space renders, and a run holding one is text.

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

33.27 A name `props` binds MUST hold a `Reactive` wherever 31.3 or 31.13 has a name hold its
`Reactive` or 31.5 has it reach its `Reactive`'s member, and that `Reactive`'s probes MUST answer for
every `Reactive` the caller's expression read.

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

34.17 An `export` in a `<script>`, however the language spells it, and one in a `<script server>`
other than of one name a `const`, `let`, `var` or `function` declares, MUST be a compile error.

34.18 A write a `<script>` makes outside any function to a `let` or `var` its file's
`<script module>` declares, holding no `Reactive`, MUST be warned on.

34.19 A `<script server>` block MUST be module scope run on a server alone, and the module a browser
loads MUST NOT carry it.

34.20 A `<script server>` in a `.abide` file of the app's own under a `public` directory MUST be a
compile error.

34.21 A file a script block imports `with { type: 'text' }`, a `.abide` and a file whose name has no
extension among them, MUST be imported as its text and typed a `string`, on a server, in a browser
and to the checker alike.

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

34.31 A selector whose rightmost compound is a `::view-transition…` pseudo-element with nothing ahead
of it MUST NOT carry the scope token.

34.32 A `NotLanded` a component `<script>` setup or a branch-local `<script>` throws MUST reach its
caller as an error naming the setup's read, and MUST NOT reach it as a `NotLanded`.

34.33 A name a `<script module>` exports MUST be a named export of its `.abide`, holding the binding
the file's component reads, to a `.abide` and a `.ts` importing it, on a server as in a browser and
to `abide check`.

34.34 An `export default` in a `<script module>`, however the language spells it, MUST be a compile
error.

34.35 An `export … from` in a `<script module>`, `export *` among them, MUST be a compile error.

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

35.18 A document an `error.abide` answers MUST NOT be hydrated as the page its address names, and a
navigation from it MUST load the document it asks for.

35.19 A page route MUST answer a request whose `sec-fetch-dest` names neither a destination fetch
calls a navigation request's nor `empty` with a bodiless 404, and MUST NOT set up its page.

35.20 `outlet.into` MUST move the element it is spread on into the element `outlet.host` of its name
is spread on, for as long as it is bound, and the elements of one name MUST stand in that host in
the order they were bound, after what the host's own markup holds.

35.21 An element `outlet.into` is spread on MUST be written by the server where it is written,
`hidden`, and hydration MUST adopt it there; it MUST stay `hidden` until a host of its name stands.

35.22 Of the elements `outlet.host` is spread on under one name, the last standing MUST hold that
name's elements, and each MUST carry `data-empty` while it holds none.

35.23 An element `outlet.into` moved MUST be removed from the document once it is unbound.

35.24 An `outlet.into` whose name no `outlet.host` stands under a task after it is bound MUST warn
once, on `abide:outlet`.

# 36. Environment and files

36.1 `PORT` MUST default to 3000, and a command's own port flag MUST override it by declaring it.

36.2 `APP_URL`'s origin MUST be what both origin gates compare against.

36.3 `NODE_ENV` MUST be read verbatim, and MUST be defaulted from the command where unset.

36.4 `APP_DATA_DIR` MUST be a path, and abide MUST NOT create it save as 47.2 states.

36.5 `ABIDE_PRINCIPAL_SECRET` MUST accept a comma-separated list.

36.6 `ABIDE_APP_TOKEN` and `ABIDE_APP_URL` MUST be read by the remote CLI only.

36.7 A closed surface — `/__abide/openapi.json` or `/__abide/mcp` (20.7), or `/__abide/bridge`
(44.19) — MUST answer 404.

36.8 `ABIDE_LOG_FORMAT` unset MUST follow the TTY.

36.9 `NO_COLOR` MUST beat `FORCE_COLOR`.

36.10 A module MUST be importable from either graph unless it is a server file, per 16.29,
whatever imports it.

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

36.19 Where `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set and `OTEL_SDK_DISABLED` is not `true`, the server MUST
send every `LogRecord` it writes with no `span` as an OTLP log record, and every one with a `span`, a
request's 24.10 names whether or not `abide:request` is enabled, as an OTLP span, as OTLP/HTTP JSON,
and MUST send nothing where none is set; a request's span exported while `abide:request` is closed
MUST NOT be written.

36.20 36.19's sends MUST go to the signal's own endpoint where one is set, and otherwise to
`/v1/logs` or `/v1/traces` under `OTEL_EXPORTER_OTLP_ENDPOINT`, carrying the headers
`OTEL_EXPORTER_OTLP_HEADERS` names.

36.21 An exported `LogRecord` MUST carry its trace as its `traceId`, its level as OTLP's severity, and
an exported span its id, its parent, its kind and its attributes, with an `error` status as OTLP's
error and any other left unset.

36.22 Every export MUST name the app as `service.name` — `OTEL_SERVICE_NAME`, or else `APP_NAME` —
and `APP_VERSION` as `service.version`.

36.23 An export MUST NOT hold back an answer or a stop past sending what is queued, MUST give up a
send the collector has not answered within OTLP's default 10 seconds, MUST keep no more than 4096
records waiting, dropping the oldest — counting those a collector has not yet taken while one send is
out — and MUST report a failed send on stderr once until a send succeeds, and never through `log`.

# 37. Lifecycle hooks

37.1 A lifecycle hook MUST be filed at the route of the `.abide` or the handler file that called it,
one under a `lib` directory at the route of the directory holding that one, and at the
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

37.7 `onConfig`, `onPrincipal`, `onStart`, `onStop`, `onHealth`, `onPairing` and `onReport` MUST each compose
every hook filed, by route depth, then by route, then in the order called — the answers of `onConfig` and
`onPrincipal` merged, a later one's member over an earlier one's.

37.8 Under `abide start` and `abide dev`, a rejection nothing handled and a throw nothing caught MUST
reach `onError` as 37.5's error does.

37.9 Under `abide dev`, a rejection nothing handled and a throw nothing caught MUST NOT end the
process.

37.10 Under `abide start` and the executable's `start`, a rejection nothing handled and a throw
nothing caught MUST stop the app through `App.stop`, and the process MUST then exit with 1 — save
37.28's abort, which MUST NOT stop it.

37.11 Under `abide start` and the executable's `start`, `SIGTERM` and `SIGINT` MUST stop the app
through `App.stop`, and the process MUST then exit with 0.

37.12 A second `SIGTERM` or `SIGINT` while the app is stopping MUST end the process at once.

37.13 A lifecycle hook called in a module of the app's own that is neither a `.abide` nor a handler
file MUST be a build error naming the module and the hook.

37.14 A `Failed` a `middleware` rung returns MUST be answered in the lane the rung is filed over: by
the nearest `error.abide` per 35.2 over a page, as 15.21 states over a handler, and, for a rung filed
at the root route, painted as a page's failure where the request prefers `text/html` over
`application/json` and as 15.21 states otherwise, the way 15.22 paints its 405.

37.15 A `middleware` rung outside one that returned a `Failed` MUST be handed 37.14's answer from
`next`, and MUST NOT be handed the `Failed`.

37.16 An `onError` called in a component's `<script>` MUST be filed in the browser for as long as
that component stands, and MUST file nothing where that `<script>` runs for a server's render.

37.17 In a browser, a throw nothing caught, a rejection nothing handled and what 12.6 hands
`onError` MUST each reach every `onError` 37.16 filed, the last filed first, and once — a throw
12.6 handed MUST NOT be handed again where 12.7 surfaces it.

37.18 In a browser, an `onError` that throws MUST be written to `abide:lifecycle`, and MUST NOT keep
any other `onError` from being handed the error.

37.19 A `middleware` rung MUST be handed as `ctx.lane` the `Lane` that answers the request it is
handed, a request a rung handed `next` included: `handler` where a handler answers its method at its
address, a private handler and one abide mounts included; `file` a file under a `public` directory;
`openapi`, `mcp` and `bridge` that address of abide's own; `socket` the upgrade to the socket mux;
`abide` every other address under `/__abide`; and `page` every other address, one nothing answers
included.

37.20 A `middleware` rung MUST be handed the request addressed below the path `APP_URL` names, as
the route table reads it.

37.21 An `onError` from `@abide/abide` called anywhere but a component's `<script>` being set up in a
browser or rendered by a server — a `<script server>`, a server module, a module's top level, a
callback that runs later — MUST throw, naming `@abide/abide/server`'s as the server's.

37.22 An `onRefusal` MUST be filed, and MUST file nothing, where 37.16 has an `onError` filed and
file nothing.

37.23 An `onRefusal` called anywhere 37.21 has an `onError` from `@abide/abide` throw MUST throw.

37.24 In a browser, every `Failed` an `Rpc` call is answered with over http — one its handler
returned, one anything between the browser and the handler answered with, 16.79's, and one a call
`outbox` sends is answered with — MUST reach every `onRefusal` 37.22 filed, the last filed first,
and once, handed the call's method and URL beside it, and the trace id the answer's `traceresponse`
names.

37.25 A call whose `signal` aborted MUST NOT reach `onRefusal`.

37.26 In a browser, an `onRefusal` that throws MUST be handled as 37.18 has an `onError` that throws.

37.27 An `onRefusal` MUST NOT change the `Failed` the call refuses with, nor keep the call from
refusing with it.

37.28 A `DOMException` named `AbortError` that 37.5, 37.8, 37.17 or 12.6 would hand `onError` MUST
NOT reach it, on a server as in a browser: an abort is asked for, as 37.25's aborted call is, and is
no failure.

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

38.10 `abide compile` and `abide native` MUST produce a standalone artifact.

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

## The native app

38.70 The executable `abide native` writes, started on macOS with no command, MUST open a window on
the app rather than 38.53's shell, and given a command MUST answer it as 38.50 does.

38.71 The window `abide native`'s executable opens MUST show the launcher page where nothing is
remembered and 38.182 starts nothing, offering to start the app in the process and to connect to
one running at a URL.

38.72 The launcher's start form MUST ask for each field the `onConfig` schema's JSON Schema
declares, or each field `onConfig`'s defaults return where the schema has none, and MUST boot the
app with its values as the environment, showing a refusal by field.

38.73 The launcher MUST remember a connect's URL, or of a start's values each that differs from the
value its form offers as that start is made, the start a launch makes included, under
`APP_DATA_DIR`, and MUST start or connect the same way at the next launch, with each value it did
not remember as the app then offers it.

38.74 The `disconnect` role MUST stop the app the launcher serves, forget what 38.73 remembered, and
show the launcher page.

38.75 The app `abide native`'s launcher serves MUST listen on loopback alone, on the port the last
launch served it on where that port is free.

38.76 Quitting the launcher MUST stop the app it serves through `App.stop` before the process exits.

38.77 `abide native` MUST refuse on a platform other than macOS, naming `abide compile`.

38.78 `abide native` given no `--out` MUST write the `.app` into the directory it was run from, named
as 38.87 names the app.

38.79 `abide native` MUST give the `.app` the icon the public file answered at `/icon.icns` holds,
or one drawn at every size from the one at `/icon.png` where there is no `.icns`.

38.80 The native app MUST read what the `onLauncher` `src/native/launcher.abide` calls answers as it
launches, and MUST refuse to launch on a key it does not take, or a value of a type the key does not
take.

38.81 `LauncherOptions` MUST NOT admit turning off both `start` and `connect`, and the native app
MUST refuse to launch on an `onLauncher` answer that does.

38.82 Where the app's `src/native/launcher.abide` has markup of its own, the launcher MUST render it
through `render`, bound to the `Launch` it would show, in place of its own page; one holding script
blocks alone MUST leave the launcher's own page standing.

38.83 A form `onLauncher` turns off MUST have no address in `Launch`, MUST NOT be
answered, and MUST NOT be done again at launch, and turning `connect` off MUST take the `connect`
item out of the default menu bar.

38.84 The page `src/native/launcher.abide` renders MUST carry its own `<style>` in the head of the
document it renders into.

38.85 A `src/native/launcher.abide` that fails to render MUST reach `onError`, and the launcher MUST
show its own page in its place.

38.86 The window MUST open at the `width` and `height` `onLauncher` answers where no launch
before it left a size, and MUST NOT be resized below its `minWidth` and `minHeight`.

38.87 The app's `APP_NAME`, as the defaults of every `onConfig` and the environment `abide native`
runs in give it before any schema, or else its package name as 38.46 names the executable, MUST name
the app in its bundle's name and display name, its menu bar, its window and its `Launch`; the
package name, as 38.46 names it, MUST name the bundle's executable and identifier.

38.88 The native app's menu bar MUST be the application, File, Edit, View and Window menus, with
the items every `onMenu` filed by the layouts and the page the window shows answers, outermost
first: a menu whose `label` names one already standing appends its
items to that one — to the application menu as a group of their own below About and the `update`
item, after any grown before them — and any other stands before Window.

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
`abide native` runs, and the platform's own accent where the icon gives none; `Launch` MUST carry
the accent and the icon to `src/native/launcher.abide`.

38.102 The launcher's own page MUST show the app's icon, its name and a button for each form
`onLauncher` leaves on. A button whose form asks for anything MUST open it in a modal dialog,
a start that asks for nothing MUST start at once, a refused start or connect MUST show its dialog
open on the refusal, and the `connect` menu role MUST show the connect dialog open.

38.103 The project `abide scaffold` writes MUST carry a `check` script that runs `abide check`.

38.104 The project `abide scaffold` writes MUST carry instructions for a coding agent that import the
ones the installed package holds, and those MUST name where the installed package holds the
documentation, the registry and the rulebook.

38.105 Every clause an `abide check` diagnostic or a refusal cites MUST resolve in a rulebook the
published package holds.

38.106 The documentation named by the instructions a project `abide scaffold` writes imports (38.104)
MUST be every page as one markdown file, in reading order.

38.107 `onLauncher` called anywhere but `src/native/launcher.abide` MUST be a build error naming that file.

38.108 `abide routes` MUST print every route with each method it answers and the file answering
it, every private handler with its address and its file, every matcher a route names with the
pattern it takes a part by, and every hook with the file that filed it; with `--json` it MUST print
the same as one JSON document.

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
it, after what the body already holds, MUST hydrate it there with that component's browser module,
and MUST run every effect the hydration woke before it settles; its `Mounted`'s stop MUST remove what
it rendered; it MUST throw where the component was not imported from a `.abide` and bound, or where
the process has no DOM.

38.120 Under `bun test` with `@abide/abide/test` preloaded, an app that declares no
`ABIDE_PRINCIPAL_SECRET` MUST seal and verify the principal cookie with a secret the preload
supplies, and `abide start` MUST NOT supply that secret.

38.121 Under `mount`, a call the component's browser module makes to a private handler MUST be
answered in the test's process by the handler the component's server module declares.

38.122 The project `abide scaffold` writes MUST NOT install a dependency's peer dependencies.

38.123 A command `abide` builds, checks or boots the app for MUST be refused where the bun running it
is outside the range abide's `engines.bun` names, and the refusal MUST name that bun's version and
the range.

38.124 The project `abide scaffold` writes MUST carry a `bench` script that runs `harness-bench`.

38.125 `abide format` MUST hand each `<script>` block and each `<style>` of every `.abide` named, of
every one under the directories named, or under the app where none are, to `bun fmt` as TypeScript
and as CSS, under the options `bun fmt` reads for that file, and MUST leave as written a file those
options' `ignorePatterns` name.

38.126 `abide format` MUST hand each expression a slot, an attribute, a spread, a `{#if}`, a
`{:else if}` or a `{#for}` holds to `bun fmt` as an expression, and MUST keep one as written where
the printed expression would end the attribute value it stands in.

38.127 `abide format` MUST indent the markup by its element and block nesting, and MUST NOT change
the template the file parses to: a run 33.17 drops between two nodes MUST NOT gain indentation, and
the body of a `<pre>`, a `<textarea>` and a markup `<script>` MUST stay as written. A code
block's import statements are part of that template as the set of modules they load and bindings
they make, and in no order.

38.128 `abide format` MUST leave as written a file the parser refuses, a file whose formatted text
would parse to a different template (38.127), and a piece `bun fmt` refuses, MUST report each on its
line, MUST go on formatting the rest, and MUST exit non-zero where it reports one.

38.129 `abide format --check` MUST write nothing, and MUST exit non-zero where a file would change.

38.130 `abide lsp` MUST answer a formatting request with what `abide format` makes of the text the
editor holds.

38.131 The project `abide scaffold` writes MUST carry Tailwind wired: `bun-plugin-tailwind` declared
in its `bunfig.toml` (38.43), and a stylesheet importing `tailwindcss` that its root layout imports.

38.132 The project `abide scaffold` writes MUST carry a Dockerfile whose image holds the executable
`abide compile` writes and nothing else of the app.

38.133 Under `bun test` with `@abide/abide/test` preloaded, each test file after the first in a
process MUST start as a bare `invalidate` (13.6) leaves the values the files before it loaded.

38.134 A prop a test hands a component it binds for `mount` as an own getter MUST be read through
that getter on each read the component makes, and any other prop but a `Reactive` (38.207) MUST be
the value it held when the component was bound.

38.135 `abide routes` MUST print beside each handler every rung its declaration's `middleware`
names, as written — an entry by the function it calls or the name it refers to, a spread by what it
spreads, an inline function as `<inline>`, and a value that is no array as one entry — and MUST say
where that declaration's options are not an object written inline.

38.136 `abide dev`, `abide start`, the executable's `start` and the app 38.53 serves MUST listen on
the interface `--hostname` names alone, and on every interface where it names none.

38.137 `abide format` MUST leave as it is a file it has formatted: a second run over what a run
wrote MUST write the same text, a block comment's lines in a script block, a style and an expression
at any nesting included.

38.138 `abide check` MUST check each arm of an `{#if}`, and every body nested in one, under what its
condition and the conditions of the arms before it established, as TypeScript checks nested `if`
statements — a value a branch-local `<script>` declares, or a prop an inline component's pattern
binds (32.40), as much as one the file's `<script>` declares — and MUST NOT carry what a condition
established past a write of the value, nor into a function the arm declares.

38.139 A refusal that stops `abide build`, or the build 38.100 makes, MUST be printed as `abide check`
prints it and fail the command, and MUST NOT be printed as a stack.

38.140 The window `abide native`'s executable opens, and the menu bar extra's panel, MUST append
`abide-native/` and the version of the app it was built from, then a comment holding the name 38.87
gives it, to the user agent of every request each makes.

38.141 `native` MUST answer the version and the name 38.140 names in the user agent of the request
being served, and in a browser those named in its own, and MUST answer `undefined` where the user agent names
none or no request is being served.

38.142 The native app given an `update` by `onLauncher` MUST read the feed under that address as
it launches, when the `update` role is picked, an hour by the wall clock after the last read, a
minute after a read that could not reach the feed — doubling with each that follows, up to the
hour — and when the Mac wakes or the app comes to the front five minutes or more after the last
read. It MUST go on reading the feed with an update staged, MUST stage only a version
`Bun.semver.order` places after both the version it was built from and the one staged, and MUST
log one line per read naming what it found.

38.143 The native app MUST NOT stage an update whose feed the key `abide native` built into it did
not sign, or whose zip's digest is not the one the feed names, and MUST report one it refuses
through `onError`.

38.144 The native app MUST put a staged update in its own place as it quits, only after `App.stop`
has returned (38.76), and MUST leave itself in place where that fails.

38.145 Picking the `update` role with an update staged, or calling `StagedUpdate.install`, MUST quit
the native app (38.144) and open the update.

38.146 `abide native` MUST write an `updates` directory beside the `.app`, holding the `.app` zipped
after it is signed and a feed naming the zip, its digest, its version, whether `--required` was given
and the text of the file `--notes` names.

38.147 `abide native` MUST sign the feed with the key `ABIDE_UPDATE_KEY` holds, or else with one it
made the first time it built the app and reads every time after, and MUST print where it made
one.

38.148 `pendingUpdate` MUST hold the update the native app has staged in the page its window or the
menu bar extra's panel shows, and MUST be `undefined` on a server and in a page neither shows.

38.149 The `update` role MUST stand in the application menu where `onLauncher` answers an `update`,
and MUST NOT stand there otherwise.

38.150 The window MUST NOT be resized above the `maxWidth` and `maxHeight` `onLauncher` answers.

38.151 The native app MUST refuse to launch on an `onLauncher` answer whose `maxWidth` or
`maxHeight` is below its `minWidth` or `minHeight`.

38.152 Where `onLauncher` answers a `titlebar` of `hidden` or `inset`, the page MUST fill the window
under a transparent titlebar that shows no title, with the window's controls where the platform puts
them, and `inset` MUST be the taller titlebar of a window with a unified toolbar.

38.153 The window MUST set `--abide-titlebar-height` and `--abide-titlebar-inset` on the root element
of every page it loads, as the height of the titlebar the page is drawn under and the width the
window's controls take from its start edge, and MUST set both to `0px` where the `titlebar` is
`standard` or the window is in full screen.

38.154 Where `onLauncher` answers a `vibrancy`, the window MUST draw that material behind the page,
and MUST draw no background of its own between the material and the page.

38.155 A primary press on an element inside a `data-abide-titlebar` element MUST move the window with
the pointer, and a double press MUST zoom or minimize the window as the platform's titlebar setting
names, unless the press lands on a link, a control or a focusable element inside it.

38.156 Where `onLauncher` answers no `vibrancy`, the window MUST take its background from the
opaque background of the page's root element, or of its body where the root's is not opaque, after
each load and each change of `prefers-color-scheme`, and MUST open on the last one taken at the next
launch.

38.157 The native app MUST draw in the `appearance` `onLauncher` answers, and `system` MUST follow
the platform's.

38.158 The window MUST NOT be resizable where `onLauncher` answers `resizable: false`.

38.159 The window MUST NOT enter full screen where `onLauncher` answers `fullScreen: false`.

38.160 The window MUST stand above other apps' windows where `onLauncher` answers
`alwaysOnTop: true`.

38.161 The window MUST cast no shadow where `onLauncher` answers `shadow: false`.

38.162 Where `onLauncher` answers `rememberFrame: false`, the window MUST open centered at the
`width` and `height` it answers at every launch.

38.163 Where `onLauncher` answers `inspector: false`, the page MUST NOT be open to Web Inspector. The
menu bar extra's panel MUST NOT be open to it whatever `inspector` answers, since the inspector takes
the key the panel closes on losing (38.171).

38.164 The launcher's own page MUST carry a `data-abide-titlebar` element across its top as tall as
`--abide-titlebar-height`.

38.165 Where `onLauncher` answers `dock: false`, the native app MUST show neither a Dock icon nor a
menu bar.

38.166 Where `onLauncher` answers `menuBarExtra: true`, the native app MUST put an item in the
platform's menu bar, drawn from the public file at `/icon-menubar.png` as a template image, else from
the one at `/icon.png`, else as the app's name.

38.167 `src/native/menubar.abide` MUST be a page answered at `/__abide/menubar` below the app's mount,
and MUST NOT be rendered through any layout.

38.168 A primary click on the menu bar extra, where the window shows an app that answers 38.167's
page, MUST open that page in a panel `panelWidth` wide and `panelHeight` tall hung under the item,
and MUST close the panel where it is open.

38.169 A primary click on the menu bar extra, where the window shows no app or one that does not
answer 38.167's page, MUST bring the window to the front, and MUST hide it where it is in front.

38.170 A secondary click on the menu bar extra MUST open a menu of an item of the `window` role named
for the app, then the menus the page the window shows filed with `onMenu`, outermost first, a menu
whose `label` is that name listing its items in its place, then an item that quits the app, a
separator between them where there are any.

38.171 The menu bar extra's panel MUST close when it stops being the key window, save to a sheet of
its own (38.178).

38.172 Where `onLauncher` answers `menuBarExtra: true`, closing the window MUST hide it rather than
quit the app.

38.173 Activating the app `abide native` writes from the Dock MUST bring its window to the front
where it is hidden.

38.174 The window `abide native`'s executable opens, and its menu bar extra's panel, MUST hand a
navigation to a scheme other than `http`, `https`, `about`, `blob`, `data` and `file` to the system
to open, and MUST NOT load it.

38.175 An app the launcher of `abide native`'s executable starts that declares no
`ABIDE_PRINCIPAL_SECRET` MUST seal and verify the principal cookie with a secret the launcher minted
once and keeps under `APP_DATA_DIR` beside what 38.73 remembers, and that 38.74 does not forget.

38.176 A page in the window `abide native`'s executable opens, or in its menu bar extra's panel, asking
for a new window onto an address under the app the window shows MUST have that address shown in the
window, bring the window to the front and close the panel, rather than hand it to the system.

38.177 Picking the `window` role MUST bring the window to the front, showing it where it is hidden.

38.178 A page's `alert`, `confirm` and `prompt` in the window `abide native`'s executable opens, or
in its menu bar extra's panel, MUST show as a sheet on that window or panel, `prompt`'s with a field
holding the text it was given and answering what the field holds, or `null` where it is cancelled,
and what checking for an update finds as one on the window, brought to the front.

38.179 The app `abide native`'s executable starts, its launcher's page and its timers MUST go on
answering while the window is resized, a menu of it is held open or a sheet of 38.178 is shown, and
the window MUST NOT wake while nothing reaches it.

38.180 The app `abide native`'s executable starts MUST run on a thread apart from the window's. Its
`process.exit` MUST end the executable with the code it was given, and a `SIGTERM` or `SIGINT` the
executable is sent MUST stop it through `App.stop` (38.76) and MUST NOT reach a handler the app
registered with `process.on`.

38.181 The executable `abide compile` or `abide native` writes MUST reach a host over a certificate
that either bun's own authorities or the authorities its machine trusts sign, however it was started.

38.182 Where `onLauncher` turns `connect` off and the start form asks for nothing, the launcher MUST
start the app at a launch where 38.73 does nothing, rather than show its page.

38.183 Where `onLauncher` answers `dock: 'window'`, the native app MUST show a Dock icon and a menu
bar from each time its window is brought to the front until the window is next closed, and neither
while it stays closed.

38.184 Where `onLauncher` answers `dock: 'window'`, the application menu's Quit item MUST close the
window (38.172) rather than quit the app.

38.185 `LauncherOptions` MUST NOT admit `dock: 'window'` without `menuBarExtra: true`, and the native
app MUST refuse to launch on an `onLauncher` answer that does.

38.186 The executable `abide native` writes, started on macOS with no command and with neither its
stdout nor its stderr on a terminal, MUST write both to `<name>.log` under `~/Library/Logs/<folder>`
from the moment the app's `onConfig` is filed, a failure to file it included, `<name>` the package
name 38.46 names the executable with and `<folder>` the last folder of the directory 38.73 remembers
under. The file MUST open with lines naming the app, its version, the time and the process, and how
a `log` line in it reads, and MUST be set aside as `<name>.1.log` at each launch and once it passes
5 MB, the files set aside before it each moved one older and none kept past `<name>.4.log`.

38.187 Where `onLauncher` answers `start: 'immediately'`, the launcher MUST start the app with the
values its start form offers at a launch where 38.73 does nothing, rather than show its page.

38.188 A page in the window `abide native`'s executable opens, or in its menu bar extra's panel, MUST
have `navigator.setAppBadge` and `navigator.clearAppBadge` as the W3C Badging API defines them, the
badge they set drawn on the native app's Dock icon as its count, as a mark with no number where none
is given, and as nothing where it is cleared, once the person has allowed the native app's
notifications per 38.190. The window showing the launcher's page MUST clear it.

38.189 A page's `print` in the window `abide native`'s executable opens, or in its menu bar extra's
panel, MUST open the platform's print panel on that page, as a sheet on that window or panel.

38.190 A page in the window `abide native`'s executable opens, or in its menu bar extra's panel, MUST
have a `Notification` whose `requestPermission` asks the person through the platform, for the badge
38.188 draws as well as alerts and sounds, and answers what they chose, and whose instance, once permission is `granted`, MUST show as the platform's
notification under the native app's name, replacing the one shown under the same `tag`, and MUST
dispatch `click` where the person clicks it, bringing the window to the front. Where permission is
not `granted` the instance MUST dispatch `error` and show nothing. `Notification.permission` MUST
start at what the person last chose for the native app, and at `denied` where the executable runs
outside a `.app`.

38.191 An element's `requestFullscreen` in the window `abide native`'s executable opens MUST show
that element over the whole screen.

38.192 A link marked `download` in the window `abide native`'s executable opens, or in its menu bar
extra's panel, and an answer that the web view cannot show or that is sent with a
`Content-Disposition` of `attachment`, MUST be saved to the person's Downloads folder under the
name it suggests, numbered where that name is taken, and the page MUST stay where it is. A download
that fails MUST be told on the window it was asked from.

38.193 A file input in the window `abide native`'s executable opens, or in its menu bar extra's
panel, MUST open the platform's open panel as a sheet on that window or panel, admitting several
files where the input is `multiple`.

38.194 A page's `navigator.mediaDevices` and `navigator.geolocation` in the window the `.app`
`abide native` writes opens MUST be present, and MUST reach the camera, the microphone and the
person's location only once the person allows it through the platform.

## Agent notes and upgrading

38.195 The `AGENTS.md` `abide scaffold` writes MUST state nothing of abide but where the installed
package holds the instructions 38.104 names.

38.196 `abide check` MUST warn at each paragraph of the `AGENTS.md` beside the app's `package.json`
that is, whitespace aside, one the `ABIDE.md` the installed package holds or one an earlier release's
`abide scaffold` wrote into `AGENTS.md`, save a heading and one the `AGENTS.md` it writes now holds,
and MUST warn at no other paragraph of it.

38.197 A paragraph of an `AGENTS.md` or an `ABIDE.md` that 38.196 reads MUST be a heading line, a
list item and the lines under it, a fenced block, or a run of lines between blank lines.

38.198 `abide upgrade` MUST apply, in the order of the releases they are keyed to, the migrations the
abide running it holds keyed to a release after the one `--from` names, and every one where `--from`
names none.

38.199 A migration `abide upgrade` applies MUST change only what is written in the form the release
it is keyed to replaced.

38.200 `abide upgrade` run over what it wrote MUST change nothing.

38.201 `abide upgrade` MUST print each file it changes as a unified diff, and `abide upgrade --check`
MUST print the same, write nothing, and exit non-zero where a file would change.

38.202 The migration keyed to 0.140.0 MUST remove from the `AGENTS.md` beside the app's
`package.json` every paragraph 38.196 warns at, and every heading below the file's first line it
leaves with no paragraph under it.

38.203 Where 38.202 removes a paragraph from a file holding none the `AGENTS.md` `abide scaffold`
writes opens with, it MUST put that one under the file's first line where that is a heading, and at
its top otherwise.

## Tests

38.204 `settled` MUST resolve only once no value that went loading since the test awaiting it began
is still loading and no effect is pending, and MUST NOT resolve before a turn of the event loop has
passed since it was called.

38.205 `settled` MUST throw where its timeout passes first, naming each value still loading — by the
method and address of the handler a call reached it through, where one did.

38.206 A value that goes loading MUST NOT be kept for `settled` in a process that has not loaded
`@abide/abide/test`.

38.207 A prop a test hands a component it binds for `mount` as a `Reactive` MUST reach the component
as 32.6 has a `bind:` hand it over.

38.208 `abide check` MUST hold a prop a `.ts` file calls a `.abide` file's component with to the
type its `props` call declares for it, or to a `Reactive` holding and taking that type.

38.209 `abide check` MUST report what the checker says of every file the app's `tsconfig.json`
includes inside the app's package, its source or not.

38.210 `abide check` MUST NOT report a file inside a package nested in the app's package.

38.211 `abide run` MUST import a `.abide` file as the compilation of the app's sources as they stand,
served before the script loads.

38.212 `abide check` MUST refuse, at its line, a `declare module` of an `@abide/` entry in a file of
the app's package that imports and exports nothing.

38.213 A `menuItem` whose `key` is set MUST, while a function its `on` filed is filed, run every such
function on a `keydown` in a browser page that `hotkeys` would match to that key with `cmd` read as
`mod`, and MUST NOT in the native app's window.

38.214 A function `MenuEntry.on` filed in a component's setup MUST be unfiled once that component is
disposed.

38.215 The migration keyed to 0.143.0 MUST rename to `memo` every `reactive` handed a function its
file writes in place or binds to the name it is handed, and MUST import `memo` where it does.

38.216 `abide call` given no `--method`, for a handler no build where it runs names, MUST call again
with the one method a `405` answer's `Allow` names besides `HEAD` and `OPTIONS`, and MUST NOT call
again where `--method` was given.

38.217 The migration keyed to 0.143.0 MUST rename to `key` the `by` dividing a `{#for}` head's
subject from its key, and every `by` property of an options object written in place as the second
argument of a `reactive` or a `memo`.

38.218 The `tsconfig.json` `abide scaffold` writes, and the default project 38.30 types an app
against, MUST read every `.ts` file as a module, one with no `import` or `export` among them.

38.219 The migration keyed to 0.144.0 MUST move the first argument of a `job` call handed an object
literal second into that object as its `name`, and MUST rename to `run` every `runNow` read as a
member.

38.220 The migration keyed to 0.144.0 MUST rename to `root` every `svg` read as a member of a name
its file binds to a `chart` call, and MUST NOT rename any other `svg`.

38.221 The migration keyed to 0.144.0 MUST rename `jump` to `autoscroll.jump`, `progress` to
`meter`, `overflow` to `menu`, `speed` to `toggleGroup`, and each member of `Carousel` to the same
member of `carousel`, where each is read as a member of a name its file binds, with `const`, `let`
or `var`, to a call of `chat`, `wizard`, `breadcrumbs`, `playback` and `lightbox` respectively, and
MUST leave the same member read off any other name.

38.222 The migration keyed to 0.144.0 MUST move the status, the message and the options handed
`refuse.named` after its name into one options object handed second, MUST drop an argument written
`undefined`, MUST spread options not written in place as an object literal, and MUST leave a call
handed an object literal second.

38.223 The migration keyed to 0.144.0 MUST rename to `computed` every `memo` handed a body written in
place that declares no parameter and given no option 11.81 refuses, MUST leave every other `memo`,
and MUST import `reactive.derived` where it renames one.

38.224 The migration keyed to 0.144.0 MUST hand to a `computed`, as its body's answer, the call of a `.abide` page's
`const` or `let` initialized by one call of a handler the page imports by default from a
`.handler.ts` file, or of `health`, and MUST import `reactive.derived` where it wraps one.

38.225 The migration keyed to 0.144.0 MUST rename `fetchData` to `fetchAndHandle` where a file
imports it from abide, at its import and at each use, and MUST leave a member of that name; MUST, where
a call's answer is declared to a name the file hands `isFailed`, catch the call's `FetchFailed` into
that answer; and MUST note, by 38.226, every other call in a file that calls `isFailed`, and every call
handed a `ttl`.

38.226 `abide upgrade` MUST print, after its diffs, each line a migration noted as changed in meaning
and not rewritten, as its path and line in the file the migrations left with what to do there.

38.227 The migration keyed to 0.144.0 MUST rewrite a `memo`'s or a handler's `poll` as a `ttl` of its
interval where it is a number or declares no `delay`, and MUST note, by 38.226, each `poll` it
rewrote, each it left, each `reactive` or `reactive.derived` given an option 11.81 refuses, and each
given options not written out in place, whose members it cannot read.

38.228 The migration keyed to 0.144.0 MUST spell every use of abide's `computed` as `reactive.derived`,
MUST import `reactive` where the file did not, and MUST drop `computed` from the import.

38.229 The migration keyed to 0.144.0 MUST turn the `reactive.share` calls of a literal key one file
alone uses into calls of one handle declared at that file's module level from the first call's
`create`, and MUST note, by 38.226, each call of a key several files use, each call whose key is no
literal, and each call whose `create` differs from its handle's.

38.230 The migration keyed to 0.144.0 MUST note, by 38.226, each handler declared over a name the app
declares as a `reactive` or a `reactive.derived`, in the file of the handler or in the app file it
imports the name from.

38.231 The migration keyed to 0.145.0 MUST rewrite each call of abide's `GET` as `rpc`, and each of
`POST`, `PUT`, `PATCH` and `DELETE` as `rpc` whose options' `methods` names that verb; MUST move each
`<name>.handler.ts` to `<name>.server.ts`, and every import specifier naming it with it, noting by
38.226 one whose server file is already there; and MUST export each `rpc` a `<script server>` binds.

# 39. Head and view transitions

39.1 A `<head>` element in a `.abide` file MUST contribute its children to the document head.

39.2 A `<head>` element MUST be top level, and MUST NOT appear inside a control block.

39.3 The build MUST hoist `<head>` contributions at compile time.

39.4 `<head>` contributions MUST be merged by key, and the deepest contributor MUST win. The shell's
`<head>` MUST be the outermost contributor.

39.5 A `<head>` contribution with no merge key MUST append, and MUST stand in its contributors'
order — each level's own, then its components' in the order they mounted, outermost level first — a
component mounted after its level included.

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
that made it leaves, and an equal one another contributor made MUST stay.

39.17 A `<script>` a `<head>` contribution writes in a browser MUST run when it is written, as the
one a server paints does, and MUST NOT run again while the same contributor writes it unchanged.

39.18 A `view-transition-name` transition a navigation starts MUST carry the type `back` or `forward`
for a history step in that direction, and `push` for any other navigation.

39.19 A browser whose view transitions take no types MUST run a navigation's `view-transition-name`
transition without them.

39.20 In a browser, a `<head>` contribution that throws when it is read — following what it reads
(39.13) or as the head is reconciled — MUST reach `onError` and warn as 12.6 has an `Effect`'s
throw, once, MUST stand as what it last read until the page, layout or component that made it
leaves, and MUST NOT keep the rest of the head from being reconciled.

39.21 A `<window>` or a `<document>` MUST stand at the top level of a `.abide` file as 39.2 has a
`<head>` stand, and MUST render nothing on the server or in a browser.

39.22 A `<window>` or a `<document>` holding anything but `on<event>={listener}` attributes MUST be
a build error.

39.23 In a browser, each `on<event>` on a `<window>` or a `<document>` MUST be added to the window or
the document as 32.4 and 32.95 add one to an element when the page, layout or component it is
written in mounts, and MUST be removed when that page, layout or component leaves.

# 40. Documentation

*Free-standing: these clauses govern the documentation system, which REGISTRY does not name — a
page's See also is not something an app writes.*

40.1 The documentation site MUST be the package at `packages/dogfood`.

40.2 The documentation site MUST give every REGISTRY `##` section a page of its own, listed under that
section's `#` group.

40.3 Every REGISTRY `##` section MUST document one export an app imports, one family of exports
sharing one signature, or one construct an app writes, and every function and constant a public
entry point exports MUST head a section of its own, save a class an app reads but never constructs,
which MAY be a row of the section of what hands it back.

40.4 A page MUST name in its `SITE` entry's `registry` the REGISTRY section it documents.

40.5 Every REGISTRY section MUST be named by exactly one page's `registry`.

40.6 Every row of `docs/REGISTRY.md` MUST be on exactly one page.

40.7 A documentation page MUST be an `index.abide` written by hand at its route, and its title, nav
label, description and `registry` MUST be its `SITE` entry's alone.

40.8 A page documenting an export MUST carry the export's name as its `SITE` entry's `title`.

40.9 A page documenting a section MUST render its Syntax, being the rows directly under its
section; a heading per `###` of its section, holding that heading's rows; its Examples; its Types;
its See also; its Tests; and its Rules — in that order, save that a page of an `authoring` group MUST
render its Examples first.

40.10 A page's rows MUST be read from REGISTRY as the page renders.

40.11 A page's Rules MUST list every clause its rows cite, once each in rulebook order, with the
clause's text, linked to the clause's anchor on `/rulebook`.

40.12 A page MUST carry at least one example, each a `<Section>` of its own holding one `<Code>`,
and an example MUST demonstrate exactly one behavior.

40.13 An example's `<Code>` MUST NOT carry code its proof does not need.

40.14 An example MUST be a fence written on its page, or a `.abide` file under its page's `lib` shown
as its fence, captioned with the side its code runs on, and MUST NOT be captioned with an address.

40.15 A slice of a file the site shows, an entry of a page's `tests` or a `show code` block, MUST
be named by a line prefix matching exactly once, and MUST run to the end of the construct that line
opens.

40.16 Several slice prefixes separated by an elision MUST render as one fence in file order, with the
gap marked rather than closed.

40.17 A slice's caption, language and spine MUST be derived from its `path`.

40.18 A prefix in a page's `tests` matching none or matching two MUST fail the page as it renders.

40.19 A page's `seeAlso` MUST name only routes of the site, and each MUST render as that page's nav
label and its description.

40.20 A page's description MUST read standalone, being what the home page's index lists under it, and
MUST NOT carry a relative link.

40.21 The voice, the vocabulary and the register of a title against a nav label MUST be
`docs/BRAND.md`'s, and MUST NOT be stated here.

40.22 A page's `.md` twin MUST be derived from what the page renders.

40.23 The documentation site MUST serve `docs/RULEBOOK.md` at `/rulebook`, read from the file as the
site builds, with each clause and each group anchored by its own number.

40.24 The documentation site MUST serve each feature directory of the example app at the address the
example app serves it at, with none of the site's chrome around its pages, and a request one of
those pages makes MUST be answered by the example app's own handlers.

40.25 The example app MUST be a package directly under the documentation site's `examples`, and MUST
pass its own tests and its own `abide check` run from its own directory.

40.26 The documentation site MUST serve the example app as a gzipped tarball at
`/examples/<app>.tar.gz`, holding every file of the app save its `node_modules` and `.abide`, with
each workspace dependency naming the published version it stands for.

40.27 The documentation site MUST put above every page a prompt that asks the visitor's Claude Code
through `provider.claudeCode`, with the site's own documentation tools as its only tools.

40.28 A `show` block in an answer — a fence whose info is `show` and what it names — MUST render, once
its fence closes, from the documentation tool that answers the model the same thing.

40.29 An answer MUST render the markup the model writes outside a `show` block as text, and MUST NOT
link to an address other than a page of the site, an anchor, a web address or a mail address.

40.30 The documentation site's native app MUST file every page in its menu bar through `onMenu`,
grouped as the sidebar groups them.

40.31 An example shown from a `.abide` file MUST mount that same file beneath its fence, and the
page's `.md` twin MUST carry the fence and nothing the file renders.

40.32 A page's Syntax and the headings under it MUST show each row's `Signature` cell in a short form
derived from REGISTRY's, and its Types MUST show every row carrying a `Signature` cell with the cell in
full, under the heading it sits under; a page whose section carries no `Signature` cell MUST NOT render
Types. Of the rows carrying a `Signature` cell directly under the section, the Syntax MUST show only
the name the page documents and every name that is not a type and is called, and a Syntax left with
no row MUST NOT be rendered. Where rows of one table share a name, the short form MUST keep the type of
the first parameter whose type differs between them, so no two of them read the same.

40.33 Where a row a page's Syntax or a heading under it shows declares, in its `Signature` cell, a
parameter whose type is a row of the same section spelling an object, or an intersection of objects
spelled there, rows of any section, or `Omit` of one, the page MUST show that object's members beneath
the row's table under the parameter's name and type, a row per member with its type in full, a later
part's member standing for an earlier one of its name, once per parameter and type.

40.34 An example MUST NOT call a name its fence neither imports nor declares, save a global of the
side its code runs on.

40.35 An example's relative import MUST name a file of the example app, and a name that file
exports.

40.36 Every page MUST say, in its header, where the name it documents is written and on which side
it runs, and a page whose name runs on one side only MUST carry a mark naming that side beside its
nav label. A page documenting a name `@abide/abide/server` exports and `@abide/abide` does not MUST
say it runs on the server, and a page documenting a name `@abide/abide` exports MUST NOT.

40.37 A group MAY list its pages in runs, each under the label its pages' `SITE` entries name as
their `subgroup`, and the pages of one run MUST be adjacent in the group.

40.38 A REGISTRY section MUST NOT be filed under `Element behaviors` where its rows cite 49.6 or
49.8: a name carrying a WAI-ARIA pattern or binding a value is a headless component, filed under
`Headless components`, and `Element behaviors` is one behavior added to an element the app already
has.

40.39 A group MAY open with a guide: a page of `SITE` documenting no REGISTRY section, which MUST say how its
group's names work together, MUST render its own sections and its See also alone, and MUST be
linked from its group's heading in the nav rather than listed beneath it.

40.40 Every group MUST name a form in its `SITE` entry — `reference`, `authoring`, `anatomy`, `work`,
`exchange` or `transcript` — and a group whose pages document a construct an app writes MUST be
`authoring`.

40.41 An example of an `anatomy` group MUST show, beside its running frame, the markup the mounted
file made, read from the live document as the reader works it, and the CSS reaching that markup:
each part and state its `data-` attributes carry as a selector, and the example app's stylesheet's
rule for each class the file writes.

40.42 An example of a `work` group MUST show, under its running frame, the bindings, the effects and
the values the reader's last interaction with it ran, read from the counters 43.21 publishes.

40.43 An exchange MUST show a request a page names and the answer the example app gives it when the
page is loaded, sent to the site's own origin, with no header that changes between two answers.

40.44 A directory of the example app a page shows MUST list each file in it, what its place and its
name make that file, and the address it answers at, read from the example app's files as the page
renders, and MUST link each page whose address has no dynamic segment and answers a reader with
nothing more than the site gives them.

40.45 An example of a `transcript` group MUST show, after its fence, a command its page names and what
it printed and the code it exited with when the example app's directory ran it, aimed at the site's
own app, with no path or origin that changes between two sites.

40.46 The documentation site MUST run only the commands it lists, each as its argv with no shell, and
MUST list none that writes a file or calls a handler that changes what the example app holds.

40.47 `Headless components` MUST list every page but its guide in runs per 40.37, and only in
`Overlays`, `Inputs`, `Data`, `Navigation`, `Layout` and `Charts`, in that order.

40.48 A headless component MUST be filed under `Overlays` where what it shows opens over the page, or
where it is a bar of the controls opening what does.

40.49 A headless component MUST be filed under `Inputs` where what it holds is a value a form would
submit, any items it lists being choices for that value.

40.50 A headless component MUST be filed under `Data` where the app hands it content to show, and
what it holds — an order, what is expanded, what is picked — is how that content is viewed.

40.51 A headless component MUST be filed under `Navigation` where it decides which part of a page is
shown.

40.52 A headless component MUST be filed under `Layout` where it sizes or moves a view.

40.53 A headless component MUST be filed under `Charts` where it draws values as a figure.

# 41. Rendering and hydration

41.1 `render` MUST send nothing until the page and every layout around it are set up and built, and a
refusal or a throw before then MUST be answered at its own status by the nearest `error.abide`.

41.2 A render MUST start every asynchronous read up front and in parallel.

41.3 `render` MUST NOT be held for an unfinished stream: what the stream produced MUST go out
inline, and the rest MUST be picked up by the client's own request.

41.4 A render MUST continue past a value still in flight, opening the sink 3.4 opens.

41.5 Data MUST reach a browser by answering that browser's own `Rpc` call from the seed buffer, and
a document MUST NOT carry a copy of an answer.

41.6 Hydration MUST re-execute setup: every `<script>` and every `reactive.derived` body runs
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
key, and MUST NOT answer a call that carries a different value for any cookie its render read through
`cookies`.

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

41.26 An `Rpc` call answering a stream whose run had not closed when `render` built the markup from
it MUST NOT be waited for under 41.25.

41.27 An `Rpc` call `render` built the page's markup from in flight MUST be in flight as hydration
adopts the page, however early the browser made it or its answer arrived.

41.28 A `render` MUST let the turn's queued microtasks run between setting up a `<Name/>` whose setup
made an `Rpc` call, or whose markup reads a bare `busy` or `ready`, and building that component's
markup.

41.29 A `render` answering a request whose `sec-fetch-dest` is `empty` and whose `sec-fetch-mode` is not
`navigate` MUST NOT fill the seed buffer.

41.30 A `render` answering a request carrying `abide-keep` MUST write 41.20's script.

41.31 On a server, a bare `busy` or `ready` MUST answer over the loads set up before its component's
markup is built, and a load a component set up later, one only a pending value places, MAY have it
choose another arm at hydration under 41.24.

41.32 While a page hydrates, `online`, `media`, `pendingUpdate` and the visitor's zone (52.45) MUST
answer as the server does, and once it has hydrated each MUST be written with the browser's answer,
so an arm that answer changes is swapped as an update and not under 41.24.

41.33 An `Rpc` call answering a stream whose run had closed when `render` built the markup from it
MUST hold every chunk of that run, its run closed, as hydration adopts the page.

41.34 A `render` MUST build the instance 11.66 builds in its request of every `reactive` and `memo`
a module declared outside every request whose build there left a load in flight, before it sets up a
page or a layout.

41.35 A `render` MUST NOT build under 41.34 a `reactive` or a `reactive.derived` built in a component's setup or
in another `render`, nor one nothing reaches.

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

42.19 A `principal` on `App.run` MUST be the claims its scope's `principal` resolves from, through
`onPrincipal` as a sealed cookie's are, MUST NOT write the principal cookie, and MUST give the scope
a request where `request` is not given.

42.20 A `principal` on `App.fetch` MUST be the claims the request's `principal` resolves from, as
42.19 states for `App.run`, over any principal cookie the request carries.

42.21 A `caller` on `App.run` or `App.fetch` MUST be its scope's `principal.caller`, over any caller
cookie the request carries, MUST NOT write the caller cookie, and on `App.run` MUST give the scope a
request where `request` is not given.

42.22 Under `bun test`, `createApp` MUST keep no more of the app's builds than the four whose states of
its sources were most recently asked for, the one it boots among them.

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

43.17 `retainedPerRun` MUST report a batch mean, and MUST NOT report a count an exact integer can be
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

43.27 `testRows` MUST run each test file in a process of its own, MUST report a file whose
runner wrote no report as `broken` rather than as a result, and MUST stop a file still running ten
minutes after it started and report it as `broken`.

43.28 The DOM `@abide/harness/preload` registers MUST leave the runtime's own `fetch`, `Request`,
`Response`, `Headers`, `AbortController`, `AbortSignal`, `WebSocket`, `TransformStream` and
`WritableStream` the globals, and MUST make the global `Blob`, `File` and `FormData` subclasses of the
runtime's own whose `instanceof` takes every instance of the runtime's.

43.29 `runBenches` MUST run, as one bench each, every function a bench file exports other than
`CEILINGS`.

43.30 `runBenches` MUST NOT report a bench's A/A control as one of its arms.

43.31 `runBenches` MUST report an arm whose time per operation is over its `CEILINGS` entry.

43.32 `runBenches` MUST report a `CEILINGS` entry naming an arm its bench does not have, and one
naming a bench its file does not export.

43.33 `harness-bench` MUST exit non-zero where `runBenches` reports anything under 43.31 or 43.32.

43.34 `runBenches` given `only` MUST run only the bench files whose path below `root` holds it.

43.35 The DOM `@abide/harness/preload` registers MUST NOT fetch a stylesheet or a script a document
it parses names.

43.36 The DOM `@abide/harness/preload` registers MUST give an element `showPopover`, `hidePopover`
and `togglePopover`, MUST fire `toggle` on each change of state, MUST match `:popover-open` while one
is open, and MUST throw on an element with no `popover` attribute.

43.37 A `Blob` or `File` the global constructors build from strings, buffers or one another MUST be
taken by the DOM `@abide/harness/preload` registers wherever that DOM takes one of its own.

43.38 A `FormData` constructed from a form under `@abide/harness/preload` MUST carry that form's
entries, the files of each file input included.

43.39 The DOM `@abide/harness/preload` registers MUST NOT load the page an `iframe` names.

43.40 `atMost` MUST pass where every field it is given a ceiling for is at or under that ceiling, and
otherwise MUST fail naming each field over its ceiling with the value the record carries.

43.41 `atMost` MUST fail where a field it is given a ceiling for is absent from the record.

43.42 `atMost` MUST report its failure at the line that called it.

43.43 `measuresNamed` MUST hand back every measure of the trace carrying the name, in trace order.

43.44 `durationOf` MUST hand back the summed nanoseconds of every measure of the trace carrying the
name.

43.45 `durationOf` MUST throw where no measure of the trace carries the name.

43.46 `shares` and `batch` MUST read one frame from `THRESHOLDS`, and MUST NOT hold a frame of
their own.

# 44. The assistant

44.1 `assistant` MUST answer only through a handler that yields it, and MUST NOT mount an address
of its own.

44.2 `assistant` MUST yield each run of the model as the Messages API streams it, event for event
and unchanged save the tool name 44.50 names, and between runs a `tool_result` event for each call
that run made, the same sequence for one conversation whichever `Provider` ran it.

44.3 `assistant` MUST refuse 400, before any `Provider` is reached, a transcript whose last
`AssistantMessage` is not the user's.

44.4 `assistant` MUST hold no conversation between calls, and MUST take the whole transcript with
each one.

44.5 `provider.claudeCode` MUST send a transcript to Claude Code as one message, its earlier turns
folded above the last, each `tool_use` and `tool_result` block written out in words, and each other
`AssistantContent` block that is not words in its place.

44.6 With `tools`, the `Toolbox` `assistant` hands a `Provider` MUST list the tools `/__abide/mcp`
lists, and MUST call each as a request through the app answering the request.

44.7 A `Toolbox` call MUST carry the asking request's `cookie` and `authorization` headers, and MUST
NOT carry any other header of it.

44.8 `tools` over an app whose route table lists no handler for `/__abide/mcp` MUST throw.

44.9 `provider.claudeApi` MUST call the Messages API again with the tool results only while a turn
stops for `tool_use`, and MUST send each assistant turn's blocks back as they arrived.

44.10 `provider.claudeApi` MUST throw where no `apiKey` is given, and MUST NOT read a key from the
environment.

44.11 A run's usage and why it stopped MUST reach a page as its `message_start` and its
`message_delta` carry them under the Messages API's names, and a conversation reaching `maxTurns` with a
tool call pending MUST end after the run that called it, and MUST NOT run that call.

44.12 `provider.claudeApi` MUST send the results of one turn's tool calls back in one message.

44.13 `provider.claudeCode` MUST run a turn on the Claude Code of the bridge paired with the asking
browser, or of the native app's own bridge where 44.77 pairs it, and MUST refuse 409 where neither
is paired.

44.14 A code `provider.claudeCode.bridge` mints MUST pair one bridge with the browser that
asked for it, once, and MUST NOT pair once it has expired.

44.15 A bridge MUST run Claude Code in an empty directory removed when the run ends, and, save where
44.82 runs it full, with no MCP server but the bridge's own and the visitor's servers of the MCP tools
44.29 makes available to the turn, and with no built-in tool and no setting source the visitor did not
pass it after `--`.

44.16 A bridge MUST lay each option a site sets but `tools` (44.29) on as Claude Code's flag of that
name, MUST fail a turn whose config sets any option `ClaudeCodeConfig` does not name, and MUST lay
an option the visitor passed after `--` over the site's.

44.17 An MCP request a bridge's Claude Code makes MUST be answered from the `Toolbox` of the turn it
was made in.

44.18 `provider.claudeCode` MUST end a turn's run on the bridge when the caller hangs up.

44.19 `/__abide/bridge` MUST be closed until `provider.claudeCode` has minted a pairing code in that
process.

44.20 `provider.claudeCode.bridge` MUST yield a `BridgeStatus` whenever the asking browser's pairing
changes, and MUST yield a fresh command where the standing one's code expires or pairs.

44.21 A failure the Messages API reports to `provider.claudeApi`, or a bridge reports to
`provider.claudeCode`, MUST refuse 502.

44.22 A bridge a `provider.claudeCode.bridge` stream or a subscription to `/__abide/pairing` has
watched MUST be sent away once neither watches it and it has run no turn for 30 seconds.

44.23 A post to `/__abide/bridge` carrying a line that is not JSON MUST be refused 400, and none of
its lines MUST be relayed.

44.24 A bridge MUST answer an MCP request its Claude Code made with a failure where
`/__abide/bridge` sent no reply within 120 seconds.

44.25 A bridge whose stream from `/__abide/bridge` ends unasked MUST redial it with its pairing's
token, each wait twice the last, until it is refused or 60 seconds have passed.

44.26 `/__abide/bridge` MUST hold a pairing whose stream dropped for 60 seconds, and a `GET` bearing
its token within them MUST resume the stream with every frame the dropped one had not sent.

44.27 A bridge whose stream from `/__abide/bridge` carries no line for 45 seconds MUST end it and
redial it as 44.25 says.

44.28 A `Provider` MUST yield each event as it arrives: a tool call's `content_block_start` before
its input is written, and its `input_json_delta` events as they are.

44.29 A tool of the visitor's machine — built-in by its name, or an MCP tool as `mcp__<server>__<tool>`
— MUST be available to a turn only where the site's `tools` names it and the visitor's `--tools`
names it or, for an MCP tool, `mcp__<server>`, and an MCP tool only where 44.58 finds its server, save
where 44.82 runs the bridge full; it MUST NOT be approved without asking unless the visitor's
`--allowedTools` names it, and the bridge MUST say once each tool the site asked for that it cannot make
available.

44.30 A bridge stopped by `SIGTERM`, `SIGINT` or `SIGHUP` MUST end every Claude Code run it started
before it exits.

44.31 A conversation MUST write one `debug` line on `abide:assistant` when its events end, naming
its last run's stop reason, the transcript's length, the tool calls it made, the input and output
tokens of every run it finished and how long it took, and naming it `unfinished` where its events
ended before they did, followed by why — `aborted` where the signal 44.57 hands its provider
aborted, else `failed` where its provider threw, with the throw's message ending the line, else
`stopped` where its caller stopped reading.

44.32 A command `provider.claudeCode.bridge` mints with
`tools` MUST grant those tools after its `--` as `--tools`, and one minted without `tools` MUST
carry no `--`.

44.33 A pairing MUST be to the claims the principal was sealed with (26.11), or to none, where its
code was minted, and `provider.claudeCode` and `provider.claudeCode.bridge` MUST read it as absent
to a request from that browser carrying any other.

44.34 A `provider.claudeCode.bridge` stream MUST yield the pairing of whoever a `principal.set` or a
`principal.clear` made at its browser since it opened signs in, at the caller 26.9 rotates it to,
and the command it yields MUST pair that one.

44.35 A `Toolbox` call MUST hand as its `ToolAnswer`'s `content` the pieces `/__abide/mcp` carries
for the same call, `provider.claudeApi` MUST show the model those pieces as the call's result, and
the `tool_result` `AssistantEvent` MUST carry as its `content` the blocks the model was shown.

44.36 `assistant` MUST refuse 400, before any `Provider` is reached, a transcript holding an
`AssistantContent` image or document with no `source`, an image whose base64 `source` is not of
`image/png`, `image/jpeg`, `image/gif` or `image/webp`, or a document whose base64 `source` is not of
`application/pdf` or whose text `source` is not of `text/plain` — and MUST hand on as written any
other source and any search result.

44.37 `assistant` MUST refuse 400, before any `Provider` is reached, a transcript holding an
`AssistantContent` image, document or search result in a turn that is not the user's, and
`assistantMessage` MUST throw, naming it, on a file it is handed for a turn that is not the user's.

44.38 `provider.claudeApi` MUST send each `AssistantContent` block that is not words to the model
as it is, the Messages API's block, in its place in its turn — a `tool_use` and a `tool_result`
included.

44.39 `assistant` MUST hand a `Provider` each turn as its `AssistantContent` pieces, a turn's string
as one text piece.

44.40 A pairing `provider.claudeCode.bridge` mints MUST
carry, beside its command, a link in the `abide-bridge` scheme naming the same site, code, bridge
release and tools, and whether it asks for full access (44.85).

44.41 A bridge MUST open only a link of the `abide-bridge` scheme whose site is https or loopback and
whose release is a version alone, and MUST run the release it names, save as 44.89 runs a checkout.

44.42 A bridge opening an `abide-bridge` link MUST ask the visitor before it pairs, save where 44.62
pairs it unasked, naming the site, with the app's name `/__abide/bridge` gives (44.63) beside it and
never in its place, and what the tools the link asks for let it do (44.92) — or, where it asks for full access, that it does
and no tool; or, where `abide-bridge install` was run `--full`, that it gives everything
44.82 does — and the options and the names of the variables `abide-bridge install` kept (44.44).

44.43 `abide-bridge install` MUST write what opens links under the visitor's own home — Application
Support on macOS, `XDG_DATA_HOME` on Linux, `LOCALAPPDATA` on Windows — and register it with that
desktop for the visitor alone, and `abide-bridge uninstall` MUST unregister it and remove all install
wrote.

44.44 `abide-bridge install` MUST keep the Claude Code options after its `--`, each `--env
NAME=VALUE` and the `--full` it is given, and a bridge opening an `abide-bridge` link MUST run Claude
Code with those options ahead of the link's tools and with those variables set, and run `--full` where
install was, and a link MUST NOT set any of them, save as 44.87 runs it `--full`.

44.45 A bridge MUST say that `/__abide/bridge` did not take a report once, and not again until a
report is taken, and MUST NOT say it while it redials per 44.25.

44.46 A bridge MUST end a turn once `/__abide/bridge` did not take a report carrying it, and MUST
report that turn failed.

44.47 A bridge MUST reach `/__abide/bridge` over a certificate that either bun's own authorities or
the authorities its machine trusts sign, however the bridge was started.

44.48 An `AssistantEvent` MUST name the handler a call reached by nothing but its `tool_use` block's
`name`, the tool name 20.13 lists the handler under.

44.49 A `tool_result` `AssistantEvent` MUST carry as its `value` its `content`'s words read as
JSON where its call did not fail and its handler has a schema 19.21 derives, and MUST carry
`undefined` otherwise.

44.50 A `Provider` MUST name the tool of each `tool_use` block it streams as its `Toolbox` lists it.

44.51 `resultsOf` MUST hand back, in order, the value 44.106 reads for each call among the messages
it is given whose `tool_use` names the tool 20.13 lists the `Rpc` it is given under, and none for a
call that failed or answered no value.

44.52 `assistantMessage` MUST draw an image longer than 1568 pixels on its long side down to 1568,
and a JPEG and an image of a type 44.36 does not name at their own size, so a photo's metadata —
where it was taken — does not go with it, and MUST NOT draw a GIF.

44.53 An image `assistantMessage` draws MUST be a PNG where it was a PNG or a WebP, and a JPEG
otherwise.

44.54 `assistantMessage` MUST hand on as it is an image it does not draw or cannot, and MUST throw
where that image is of a type 44.36 does not name.

44.55 `assistantMessage` given a role and parts MUST make a message of that role, of a block per
part, in the order given: words where they hold more than whitespace as a text block, an image or a
HEIC or HEIF as an image 44.52 draws, a PDF as a base64 document, a file of `text/*`, of JSON or
named `.csv`, `.json`, `.md` or `.txt` as a text document, a document titled with its file's name
where it has one, a URL whose path ends `.pdf` as a document and one ending `.png`, `.jpg`, `.jpeg`,
`.gif` or `.webp` as an image, each of that URL, and a block as it is written — and MUST throw,
naming the file or the URL, on any other.

44.56 The `install` of a pairing `provider.claudeCode.bridge`
mints MUST run `abide-bridge install` at the bridge release its command runs.

44.57 `assistant` MUST hand its `Provider` a `limits.signal` that aborts once the `signal` its caller
passed does, and once the request's signal aborts — or, called outside a request or in the run of a
`global` value, which no request owns whichever request reached it first, once the signal
`abortSignal` answers there does —
and once that signal aborts MUST end the conversation without waiting for the provider to, refused
with `refuse.aborted` at status 499.

44.58 A bridge MUST find the visitor's MCP servers, at each turn, in each `--mcp-config` the visitor
passed after `--`, or where they passed none, in the user scope of their Claude Code configuration,
and MUST NOT find the bridge's own server's name there.

44.59 A `BridgeStatus` MUST carry a command and a link whether or not a bridge is paired, and a bridge
pairing by its code MUST take the place of the one paired.

44.60 A `BridgeStatus` MUST carry as `missing` each tool its pairing's code asked for that the paired
bridge last reported it cannot make available (44.29), and none while no bridge is paired.

44.61 A bridge MUST report to `/__abide/bridge` the tools its pairing's code asked for that it cannot
make available once it pairs, and again before a turn wherever they changed.

44.62 A bridge opening an `abide-bridge` link MUST pair without asking only where 44.88 kept its site
allowed for the holder `/__abide/bridge` names for its code (44.63), and then only where full access or
only the site's own tools was granted, or the link asks neither for full access nor for any tool beyond
those allowed.

44.63 `/__abide/bridge` MUST name, for a code minted and unspent, a holder without spending the code —
the same for every code minted to one sign-in, or signed out to one browser, and different for any
other — and the app's name, and the note the code was minted with where it was minted with one, and MUST
refuse 403 any other code.

44.64 A bridge opening an `abide-bridge` link on a desktop it cannot ask on MUST NOT pair.

44.65 A bridge opening an `abide-bridge` link MUST name, in the question 44.42 asks, the server of each
MCP tool the link asks for whose server 44.58 does not find.

44.66 `abide-bridge forget` MUST stop always allowing the site it names, or every site where it names
none.

44.67 `/__abide/pairing` MUST answer the asking browser's `BridgeStatus` as it stands, with the code
it answered last while that is unspent and unexpired, granting the tools `ABIDE_BRIDGE_TOOLS` names
separated by commas, and none where it names none, and minted as 44.85 mints one with `full` where
`ABIDE_BRIDGE_FULL` is on, and with the note `ABIDE_BRIDGE_NOTE` holds where it holds one.

44.68 `/__abide/pairing` MUST NOT be listed by `/__abide/mcp` or `/__abide/openapi.json`.

44.69 `pairing`'s `status` MUST hold `undefined` until `/__abide/pairing` first answers the browser,
MUST report `s.busy` true while that first read is in flight, and then MUST hold the last
`BridgeStatus` it answered; a read of it that failed MUST be taken as a refused write is (4.10, 2.3),
and where a server builds it `status` MUST hold `undefined` with nothing in flight.

44.70 `pairing`'s `start` MUST do nothing while `status` holds no `BridgeStatus`, and otherwise MUST
set `step` to `waiting` and navigate the page to the status's `link`.

44.71 2500 ms after `pairing`'s `start`, `step` MUST become `click` where the window blurred since,
or `status` is paired, and `install` otherwise.

44.72 `pairing`'s `copyInstall` MUST write `status`'s `install` to the clipboard through
`copyToClipboard`, and once written MUST hold `copied` true for 1200 ms and then set `copied` false and `step` to
`click`.

44.73 A `pairing` MUST, once its `stop` or its `[Symbol.dispose]` is called, or the component whose
setup built it is disposed, stop reading and following `/__abide/pairing` where no other `pairing`
reads it, remove the blur listener a `start` added, clear the wait a `start` set, and leave `copied`
and `step` where they stand.

44.74 `/__abide/pairing` MUST NOT grant a tool the request asking it names.

44.75 A subscription to `/__abide/pairing` MUST be sent a refresh whenever the asking browser's
pairing changes, and where the code it was last answered with expires or pairs.

44.76 The command and the install of every pairing `/__abide/pairing`,
`provider.claudeCode.bridge` answers MUST carry after a `--`,
behind the command's `--tools`, the arguments every `onPairing` answers in the asking request's
scope, each quoted where a shell would split or expand it, and the link MUST carry none of them.

44.77 A request from the window `abide native`'s executable opens onto the app it started, by the
credential 44.79 hands it, MUST read as paired with the native app's own bridge — this machine's
Claude Code, run in the app's process — whatever browser and sign-in it carries, with no code spent
and no question asked, wherever `claude` is on the `PATH` it runs with; a bridge paired by a code
MUST run the turn where both are.

44.78 The native app's own bridge MUST run every turn as 44.82 runs a bridge `--full`, with the
arguments every `onPairing` answers in the turn's request's scope as the visitor's options after
`--`, and a `BridgeStatus` it pairs MUST carry as `missing` each tool its `tools` names of an MCP
server 44.58 finds neither in the user scope nor in an `--mcp-config` those arguments name.

44.79 The native app MUST hand its window a credential minted at each launch, in a cookie `HttpOnly`
and `SameSite=Strict`, and MUST NOT read a request as from its window by anything else — its user
agent (38.141) included.

44.80 The native app MUST run with the `PATH` the visitor's login shell sets, where that shell says
one within 3 seconds.

44.81 A bridge MUST run Claude Code in its `auto` permission mode, save where the visitor's options
after `--` set another, with each permission prompt asked of an MCP server the bridge answers itself,
and `provider.claudeCode` MUST yield each prompt as a `permission` `AssistantEvent` naming the tool and
the input it asks to run; the tools of the bridge's own relayed server MUST be approved without asking.

44.82 A bridge run `--full` MUST run Claude Code with every built-in tool, setting source and MCP server
that `claude` run in the directory 44.15 names would read, and with the visitor's options after `--` as
they gave them, whatever `tools` the turn names.

44.83 `provider.claudeCode.permit` MUST answer a `permission` event only for a request from the
browser and sign-in its turn's bridge is paired to (44.33), only while it waits, and once, and MUST
refuse 404 otherwise; a prompt it allows MUST run with the input the event named.

44.84 A bridge MUST deny a permission prompt `/__abide/bridge` sent no answer to within 120 seconds,
or whose turn ended first.

44.85 A pairing `provider.claudeCode.bridge` mints with `full`
MUST carry `--full` in its command ahead of any `--`, and one minted without it MUST NOT.

44.86 A bridge opening an `abide-bridge` link that asks for full access or for any tool of the
visitor's machine, where `abide-bridge install` was not run `--full`, MUST offer the visitor to allow
only the site's own tools, and, so allowed, now or as 44.62 pairs it, MUST pair with no tool of the
visitor's machine.

44.87 A bridge opening an `abide-bridge` link MUST run `--full` only where `abide-bridge install` was
run `--full`, or the link asks for full access and the visitor allowed it, now or as 44.62 pairs it.

44.88 A bridge the visitor allowed to pair from a link MUST keep its site allowed for the holder
`/__abide/bridge` names for the link's code (44.63), with the tools the link asked for and whether they
granted full access or only the site's own tools, and MUST keep nothing where `/__abide/bridge` named no
holder.

44.89 `abide-bridge install` run from a copy of the bridge outside any `node_modules` MUST open every
`abide-bridge` link with that copy's handler as it stands when the link opens, and run that copy's
bridge, whatever release the link names.

44.90 A bridge asking per 44.42 MUST show the icon the site publishes at `/icon.png` where it is a
PNG of at most 1 MB answered within 3 seconds, and the desktop's own otherwise.

44.91 A bridge asking per 44.42 MUST show the note `/__abide/bridge` names for the link's code (44.63)
under the headline, after `From` and the app's name or the site, as one line of at most 200
characters, and MUST NOT show it in the headline.

44.92 A bridge opening an `abide-bridge` link MUST name, in the question 44.42 asks, the built-in tools
the link asks for by what they let the site do, one line per capability, and every MCP tool it asks for
on one line naming each server with how many of its tools are asked for, or all of them.

44.93 `provider.claudeCode.callTool` MUST call the MCP tool it names on the bridge paired with the
asking browser, or on the native app's own bridge where 44.77 pairs it, with no Claude Code run, and
MUST answer what the tool answered as a `Toolbox` call answers it (44.35), refusing 409 where neither
is paired.

44.94 A bridge MUST make a call only of an MCP tool 44.29 makes available to a turn whose `tools`
names that tool alone, and only where the visitor's `--disallowedTools` names none of the tool,
`mcp__<server>` or `mcp__<server>__*`, MUST NOT ask anything past that grant, and
`provider.claudeCode.callTool` MUST refuse 403 any other call, with what the bridge said of it.

44.95 A bridge MUST make a call on the server 44.58 finds for its tool, started for that call alone —
its command run in an empty directory removed when the call ends, or its http address sent the
headers its configuration names, overridden by those its `headersHelper` writes for that call, and no
other credential — and ended with the call, and MUST report
to `provider.claudeCode.callTool` a call it could not make, for 44.99 to make.

44.96 A bridge MUST say, as it pairs with `/__abide/bridge`, that it makes calls, and
`provider.claudeCode.callTool` MUST NOT send a call to a paired bridge that did not, making it as
44.99 does instead.

44.97 A bridge MUST make each call as `/__abide/bridge` sends it, without waiting on any other call or
turn.

44.98 `provider.claudeCode.callTool` MUST end its call on the bridge when the caller hangs up.

44.99 `provider.claudeCode.callTool` MUST make a call the paired bridge could not (44.95, 44.96) by a
turn granted that tool alone, telling the model the input and allowing the permission prompt for that
tool as 44.94 allows the call, MUST answer what the tool answered in that turn rather than what the
model said of it, MUST end the turn on the bridge once the tool has answered, and MUST refuse 502
where the turn ended without calling it.

44.100 `assistant` called outside a request, or in the run of a `global` value, in the app `abide
native`'s executable starts MUST run its conversation as a request carrying the `cookie` and
`authorization` headers of the latest request that carried the window's credential (44.79), through
the app that request reached, where such a request has come, and otherwise as a request carrying that
credential and no principal, through the app the executable booted last.

44.101 `assistant` called outside a request, or in the run of a `global` value, where 44.100 does not
run it, MUST run its conversation carrying no asker's credentials, and MUST throw where given `mcp`.

44.102 `pairing`'s `retry` MUST read the pairing again, over a read in flight.

44.103 `provider.claudeCode` MUST refuse 400, before the bridge is asked, a transcript holding an
`AssistantContent` block, or a block inside one, whose `cache_control` is not of `ttl` `'1h'`.

44.104 A `Provider` MUST NOT hold back a cited run of words: its citations reach a page as the
`citations_delta` events the Messages API streams them as, among its words.

44.105 `assistantMessage` given `'assistant'` and an answer's events MUST make the messages
they amount to as the Messages API's clients accumulate its stream: a `message_start` opens an
assistant message, a `content_block_start` puts its block at its index, a `text_delta` extends that
block's words, a `citations_delta` adds to its `citations`, a `thinking_delta` and a
`signature_delta` fill a thinking block, and a block's `input_json_delta` events, read as JSON at its
`content_block_stop`, are its `input` — or the words written, where they are not JSON. A `tool_result`
event MUST go into the user message after the run, every result of one run in one message. A
`tool_use` no `tool_result` answers, and an assistant message left with nothing in it, MUST be left
out.

44.106 A call's value MUST be the `value` of the `tool_result` event its `tool_result` block was
folded from (44.49), kept beside the block, which MUST carry nothing the Messages API does not take;
for a block no event was folded into, its words read as JSON, and `undefined` where they spell none;
and a call that failed, or that nothing has answered, MUST have none.

# 45. Offline

45.1 Where `ABIDE_OFFLINE` is on, a page `abide build` built MUST register the worker
`ABIDE_OFFLINE` turns on, and a page `abide dev` serves MUST NOT.

45.2 The worker `ABIDE_OFFLINE` turns on MUST be served below `/__abide`, and MUST be allowed the
scope of the app's mount.

45.3 The worker `ABIDE_OFFLINE` turns on MUST save an answer to a page, or to any other `GET` of the
app's own origin, only where its `cache-control` lets a private cache store it and names
`stale-if-error` or `immutable`.

45.4 The worker `ABIDE_OFFLINE` turns on MUST save only an answer of 200, to the address it asked
rather than one a redirect led to, that is neither a stream 16.32 frames nor a binary 16.34 types.

45.5 The worker `ABIDE_OFFLINE` turns on MUST save every file of the build's bundle as it installs.

45.6 The worker `ABIDE_OFFLINE` turns on MUST answer a file of the build's bundle from what it
saved.

45.7 The worker `ABIDE_OFFLINE` turns on MUST drop everything it saved, save an answer whose
`cache-control` is `public`, where an answer it is handed carries `abide-principal`, where
`principal` changes in any tab, and where a form is submitted.

45.8 The worker `ABIDE_OFFLINE` turns on, of a new build, MUST drop every answer the one before it
saved, and every file of a bundle neither the new build nor the build before it names, and MUST
answer a file of the bundle the build before named from what it saved.

45.9 The address of the worker `ABIDE_OFFLINE` turns on MUST answer a worker that drops what was
saved and unregisters itself, under `abide dev` and where `ABIDE_OFFLINE` is off.

45.10 The worker `ABIDE_OFFLINE` turns on that fails to register MUST warn on `abide:hydrate`.

45.11 The worker `ABIDE_OFFLINE` turns on MUST answer a page the network gives no answer for, and
that it saved no copy of, 503 with a page saying so.

45.12 A `navigate` 30.32 would leave standing MUST be left to the document where the worker
`ABIDE_OFFLINE` turns on saved its address's page.

45.13 The worker `ABIDE_OFFLINE` turns on MUST save, as it activates, the page of every window it
then controls.

45.14 `ABIDE_OFFLINE` MUST be on where `config` holds it as `true`, or as text reading `true` or `1`
in any case, and off otherwise.

45.15 Where `ABIDE_OFFLINE` is on and the app's public `/icon.png` is a PNG, every page MUST link a
web app manifest naming the app, with the app's mount as its scope and its start, and that icon at
the size it is drawn at.

45.16 The worker `ABIDE_OFFLINE` turns on MUST leave to the network the request 30.15 makes, a
request carrying `range`, and one accepting `text/event-stream`.

45.17 The worker `ABIDE_OFFLINE` turns on MUST answer a request that is not a navigation with the copy
it saved of its address, and not ask the network, while that copy is fresh by its `cache-control`.

45.18 The worker `ABIDE_OFFLINE` turns on MUST answer a request that is not a navigation with the copy
it saved of its address, and ask the network for the copy it saves next save where the request's
`cache` is `force-cache`, while that copy is stale by no more than its `stale-while-revalidate`.

45.19 The worker `ABIDE_OFFLINE` turns on MUST answer a request 45.17 and 45.18 leave to the network
with the network's answer, and with the copy it saved of that address where the network gives none
and that copy is stale by no more than its `stale-if-error`.

45.20 The worker `ABIDE_OFFLINE` turns on MUST answer a request whose `cache` is `no-cache`, `reload`
or `no-store` with the network's answer, and only a navigation among them, where the network gives
none, with the copy 45.19 has stand in.

45.21 The worker `ABIDE_OFFLINE` turns on MUST ask the network past the browser's own cache, save
for a navigation 45.25 has it ask as itself.

45.22 The worker `ABIDE_OFFLINE` turns on MUST mark an answer it gives from a copy it saved with an
`abide-kept` header naming that copy's `date`.

45.23 The worker `ABIDE_OFFLINE` turns on MUST ask for a page it saves with an `abide-keep` header,
save for a navigation 45.25 has it ask as itself.

45.24 The worker `ABIDE_OFFLINE` turns on MUST save the page of an address a `navigate` reached,
where it saved no copy of that address 45.19 would answer with, and MUST NOT save one of another
origin.

45.25 The worker `ABIDE_OFFLINE` turns on MUST answer a navigation 45.28 does not open from a copy with
the browser's navigation preload, and where the browser makes none, with the navigation's own
request, unchanged.

45.26 The worker `ABIDE_OFFLINE` turns on MUST drop the copy it saved of an address where the network
answers that address with an answer 45.3 or 45.4 does not let it save, save one at a status 15.19
counts transient.

45.27 The worker `ABIDE_OFFLINE` turns on MUST NOT answer a request of another origin, nor a
navigation whose destination is not `document`.

45.28 The worker `ABIDE_OFFLINE` turns on MUST answer a navigation of an address it saved a page of,
whose `cache` is none 45.20 names, with that copy while 45.19 has it stand in, before the network
answers, and MUST ask for that address's page behind it as 45.21 and 45.23 have it ask.

45.29 The worker `ABIDE_OFFLINE` turns on MUST navigate again the window a navigation 45.28 opened
from a copy, where the page asked for behind it answers other than 200, at a status 15.19 does not
count transient.

# 46. Outbox

46.1 `outbox` MUST answer, oldest first, every call queued in it that was neither delivered nor
discarded, narrowed to the handler a selection names and the args a pattern matches.

46.2 `outbox` MUST keep its calls across a reload, in IndexedDB where the browser has it.

46.3 `outbox` MUST send its calls oldest first, one at a time.

46.4 A call `outbox` sends that gets no answer, or an answer at 408, 425, 429, 502, 503 or 504,
MUST stay in `outbox`, and MUST hold back the calls after it until it is sent again.

46.5 A call `outbox` sends that is refused MUST stay in `outbox`, its `value` refused as the server
refused it, and MUST NOT hold back the calls after it.

46.6 A call `outbox` sends that is refused at 401 MUST hold back every call after it until
`principal` changes or a call's `retry` is called.

46.7 A call `outbox` delivers MUST leave it, and its `value` MUST take its answer as 3.11 has it.

46.8 `outbox` MUST send as a page loads, where `online` becomes true, where the page becomes visible,
and after a send that got no answer, waiting from one second to sixty, doubling.

46.9 Every tab of an app MUST show one `outbox`, and one tab at a time MUST send from it.

46.10 A call queued in `outbox` MUST carry one `idempotency-key` header on every send, its first
included.

46.11 A bare `busy` MUST be true while any call `outbox` sends is in flight.

46.12 A queued call's `retry` MUST send it again at once, and MUST clear its `value`'s refusal as a
write made here (3.10).

46.13 A queued call's `discard` MUST drop it from `outbox`, sent or not.

46.14 `outbox` MUST ask the browser to keep the app's storage once it queues a call.

46.15 On a server `outbox` MUST answer no calls.

46.16 `outbox` handed a handler MUST answer only the calls for that handler.

46.17 Reading `outbox` MUST subscribe the reader to the calls it answers.

46.18 Each call `outbox` answers MUST carry, as `value`, the `Reactive` its call settled, rebuilt from
what was kept where the page holds none.

46.19 A `value` 46.18 rebuilds MUST hold the stand-in its call settled to, where the browser could
keep it, as a write made here (3.10).

46.20 A page MUST NOT open the store 46.2 keeps `outbox` in where `outbox` held no call when it last
changed.

46.21 The wait 46.8 makes after a send 46.4 keeps that was answered with a `Retry-After` MUST last
at least until the time that header names.

# 47. Databases

47.1 `database` MUST open its database at the first call of the opener it returns, and every later
call MUST hand back that same `Database` until 47.10 or 47.16 closes it.

47.2 `database` MUST open the file `<name>.sqlite` in `APP_DATA_DIR` where given a name, and MUST
create the directory holding the file it opens where it does not exist.

47.3 `database` MUST open a string holding `/` or `.` as a path, resolved against the process's
working directory where relative, and `:memory:` as a database in memory, and MUST throw for a
value that is not a string, and for any other string that is empty or holds anything but letters,
digits, `_` and `-`.

47.4 Where `NODE_ENV` is `test`, `database` MUST open, in place of the file 47.2 and 47.3 name, the
file at that absolute path inside a scratch directory of its own per test file `bun test` runs.

47.5 `database` MUST open with the `WAL` journal, foreign keys enforced, and a busy timeout of 5000
milliseconds.

47.6 `database` MUST run, in the order given, each migration past the count the file's
`user_version` holds, and MUST then set `user_version` to the count of migrations.

47.7 The migrations `database` runs per 47.6 MUST run in one transaction, and one that throws MUST
leave the file as it was opened, and the opener MUST throw, naming the migration.

47.8 A migration MUST be run as SQL where it is a string, and MUST be called with the `Database`
where it is a function.

47.9 `database` MUST throw, and MUST NOT hand back the `Database`, where the file's `user_version`
exceeds its count of migrations, save as 47.13 states.

47.10 `database` MUST close the `Database` it opened inside `App.stop`'s teardown, filed as an
`onStop` per 37.4 and 37.7 that closes once the teardown it wraps has run.

47.11 An opener whose `Database` 47.10 or 47.16 closed, or whose open threw, MUST open it again when
next called.

47.12 `database` given a function MUST call it at each open, 47.4's included, and at no other call,
and read what it returns per 47.2 and 47.3.

47.13 `database` with `openNewer` MUST open a file whose `user_version` exceeds its count of
migrations, and MUST then run no migration and leave `user_version` as it was.

47.14 `database` with `strict`, `readonly` or `safeIntegers` MUST open its `Database` with that
option as `bun:sqlite` reads it.

47.15 `database` with `open` MUST call it with the `Database` at each open, after 47.5's pragmas and
before 47.6's migrations.

47.16 An opener's `close` MUST close the `Database` the opener holds, where it holds one.

47.17 An opener's `close` with `remove` MUST delete the file the opener last opened, with its `-wal`
and `-shm`, where the file is not `:memory:`, whether that `close` closed it or 47.10 or an earlier
`close` had.

47.18 `database` MUST NOT write to a file whose `user_version` equals its count of migrations as it
opens it.

47.19 Where `NODE_ENV` is `test`, `database` MUST delete, as it makes a process's first scratch
directory per 47.4, every scratch directory made by a process that no longer runs.

47.20 An opener called from a migration 47.6 runs MUST hand back the `Database` that migration is
called with, inside 47.7's transaction.

47.21 An opener called at any point of its own open but 47.20's MUST throw, and MUST NOT open a
second `Database`.

47.22 An opener's `changed` MUST increase where another connection, in this process or another, has
committed to the file since the `Database` the opener holds was last checked, checking it every 1000
milliseconds, and MUST NOT increase for a write made through that `Database`.

47.23 An opener's `changed` MUST be checked only while something reads it or asks its probes.

47.24 Checking an opener's `changed` MUST NOT open its `Database`.

47.25 A `table` called, and its `readable` and `writable` reached, MUST throw where the database
holds no table of that name.

47.26 `table` MUST record each insert, update and delete made to the table, by any statement and any
connection, in the transaction that made it, naming every column the table held when `table` first
reached it through that `Database`.

47.27 A `table`'s `readable` MUST hand on, in order, every change committed after it was first
reached, each as the row after and the row before.

47.28 A write rolled back MUST hand on no change.

47.29 A change to a table `table` was called for MUST refresh every value whose `tags` name the
table, as `invalidate` over those tags does.

47.30 Rows written to a `table`'s `writable` MUST be upserted by `key`, `id` where none is given,
and the rows written in one turn MUST be committed in one transaction.

47.31 `table` MUST keep no more than the last 10000 changes of a table its watch has passed.

47.32 An opener's `sql`, called as a tag, MUST bind every value interpolated as a parameter and
never as text, MUST prepare one statement per call site per `Database` and per length of each list
47.37 expands, and MUST answer, at once, the rows the statement returns.

47.33 A run that reads a table through `sql` or a `table` call MUST be refreshed, per 13.7, when that
table changes — by a write through the opener, or a commit any connection makes — the tables a
statement reads being those SQLite compiles it to read, and MUST NOT be refreshed by a change to a
table its last run did not read, nor where it is a mutation's run or wrote that table itself.

47.34 The writes made through `sql` in one turn MUST refresh what 47.33 refreshes once per table, as
the turn ends, and 47.29's watch MUST NOT refresh for them again.

47.35 A `table` called MUST answer every row of the table, or with `match` the rows whose every
column `match` names the value given matches per 47.36, and MUST throw for a column the
table does not hold.

47.36 A `match` value MUST be JSON, and MUST match a column: a value by equality; `null` by IS NULL;
an array by being one of its values, `null` among them matching a NULL and an empty array matching
no row; and an object by meeting every one of `gt`, `gte`, `lt`, `lte` and `ne` it names, `ne`
refusing only the value it names — `null` included, and no NULL it does not — and an object naming
none matching every row. A `match` MUST throw for any other key in an object, for `null` given to a
comparison other than `ne`, and for an array or an object nested where a value goes.

47.37 An array interpolated into `sql` MUST be bound as a parenthesized list of its values, written
`IN ${ids}` with no parentheses of the author's own, and an empty array MUST be a list of no row, so
`IN` matches nothing and `NOT IN` everything; an array nested in one MUST throw.

47.38 A database refusing 47.26's change log, a read-only one among them, MUST still be read by a
`table` call and by `sql`, its stopped watch said once per database, and the writes made through its
`sql` MUST then be all that refresh what reads it.

47.39 A change 47.33 hears to a table a handler's run read MUST reach every browser following that
handler as a tag naming the table would per 13.15, where the server holds no value of the handler
for the change to refresh.

47.40 An owner's `set` or `patch` of an entry holding the very rows a `table` call answered MUST write
them to the table in one transaction — each row added or changed upserted by `key`, each row no
longer there deleted, a patch made on a copy — MUST throw for a value that is not an array or a row
carrying no `key`, and MUST then refresh at once every run 47.33 refreshes for the table, the
entry's own among them, rather than hold the value written.

# 48. Problem reports

48.1 `report` MUST answer a `ReportDraft` holding among its `traces` the trace it was given, and the
trace id the `traceresponse` of the answer carrying the refusal it was given as `failure` named
(37.24), once each, and none where it was given neither.

48.2 A `ReportDraft` in a browser MUST hold the newest 200 of the page's `log.records`.

48.3 A `ReportDraft` on a server MUST hold the newest 200 of the server's `log.records` whose trace
is among its `traces`.

48.4 A `ReportDraft` in the window `abide native`'s executable opens MUST also hold the lines 48.3
names, handed to the window by the credential 44.79 names.

48.5 The server MUST NOT hand a line it wrote to a `ReportDraft` anywhere 48.4 does not name.

48.6 `ReportDraft.send` MUST hand the `Report` to every `onReport` filed, and MUST refuse 501 where
none is.

48.7 `Report.markdown` MUST be what the draft's `markdown` held as it was sent, save what 48.10 takes
out.

48.8 `ReportDraft.send` MUST refuse 502 where an `onReport` threw, once every other has been handed
the `Report`, and MUST leave the draft as it was.

48.9 `ReportDraft.open` MUST show the draft in a modal `<dialog>` over the page, its `markdown` shown
above its send, settling `true` once the draft is sent and `false` once the dialog is closed unsent,
and MUST throw outside a browser.

48.10 Neither a `Report` nor a line the server hands a `ReportDraft` MUST hold any secret
`ABIDE_PRINCIPAL_SECRET` lists (36.5) or the value of a `ConfigField` whose `input` is `password`,
four characters long or longer, each written in its place as `[redacted <name>]`.

48.11 A line a browser sends with a `Report` MUST reach `onReport` naming no trace.

48.12 Every `Report` sent from a `ReportDraft` MUST carry the draft's `id`, and a `Report` a browser
sends naming no `id` of 1 to 64 letters, digits, `_` or `-` MUST reach `onReport` under one the
server mints.

48.13 `ReportDraft.send` MUST settle the draft's `id`, and where a send of the draft is in flight or
has settled it MUST settle that same `id` without handing the `Report` to any `onReport` again.

# 49. Headless components

49.1 A headless component MUST write each state a caller can style an element by as a `data-` attribute on
the part for the element the state is about, valued where the state has more than two values, and
present only while it holds where it has two.

49.2 A headless component MUST NOT write a `class`.

49.3 Every part a headless component hands back for an element MUST carry, naming the element, a `data-`
attribute named for the headless component — its name in kebab case, `data-sortable-table` for
`sortableTable`, and its namespace's for a `host`, `data-prompts` for `prompts.host`.

49.4 `@abide/abide` MUST NOT ship a stylesheet.

49.5 A headless component MUST write a `style` property only for a value it computes as it runs, or one a
clause of its own requires.

49.6 A headless component for a widget WAI-ARIA gives a pattern for MUST carry the roles and the states
that pattern names.

49.7 A headless component MUST, in development, warn once on `abide:parts` for each attribute among its
parts that names by id an element the document does not hold, and for each of its parts whose role
stands outside the role WAI-ARIA requires around it, and a build MUST NOT carry the check.

49.8 Every option of a headless component an app binds — a `Reactive` the parts read and write — MUST be
optional, and the parts MUST hand back what they read and write as a `Reactive` member under the
option's name, the app's where one is given and one of their own from its default where none is; an
id a headless component writes MUST be optional with one made where none is given, and readable among its
parts; its `key` and `label` MUST be optional where an item is a string or a number, which is then
its own key and label; and its `key` MUST be optional where an item carries an `id`, which, written
as text, is then its key.

49.9 A headless component MUST hand back an element there is one of as a member naming that element —
save one whose parts are one element's alone, which MUST hand back that element's part itself — an
item with one element as a function of the item answering that element's attributes, and an item
with more than one element, or with data of its own, as a function of the item answering that item's
parts and data together; what a part reads that changes MUST be a `get` accessor, and no function
among the parts MUST take an optional argument that changes what it answers, or take none to answer
a value.

49.10 Every option of a headless component that is a value — save a `Reactive` it binds, and one that
takes a function of its own meaning — MUST take the value or a function answering it.

49.11 A headless component MUST read each of its options where it uses it, save its `id`, a `multiple`,
a `range`, a `debounce`, a `rowHeight` and a size a measurement replaces, which it MUST read once.

49.12 What `@abide/abide` does to an element an app writes MUST be handed out as a part, carrying
under `bind:element` what needs the element in a browser (32.99), and MUST NOT be a function an
app hands `bind:element` itself.

49.13 A listener a headless component hands back or takes for an element's event MUST be named `on`
followed by that event's name, and every option or part key `@abide/abide` names beginning `on`
MUST be lowercase.

49.14 A headless component among whose parts is a popover, or a part inside one, MUST, in development,
warn once on `abide:parts` where that popover is drawn while it is closed, and a build MUST NOT carry
the check.

49.15 A click on a button among a headless component's parts that leaves that button disabled MUST, where
it held focus, move focus on: `carousel`'s and `pagination`'s `previous` and `next` to the other, `wizard`'s
`next` to its `previous` and its `previous` to its `next`, and `spinbutton`'s `increment` and `decrement`
to its `input`.

49.16 A headless component over a list MUST take the list's items, telling them apart by its `key` (49.8),
and MUST NOT take a list of their keys in their place; and a part it hands back for one item MUST be
a function of the item (49.9), not of its key.

49.17 A part a headless component hands back MUST carry `data-current` while it carries
`aria-current`, and `data-open` while it carries `aria-expanded="true"`.

49.18 A headless component built on another MUST merge that component's part for an element into its
own part for the same element, the part carrying both components' `data-` attributes (49.3), and
MUST hand back that component's parts for elements it hands no part for whole, as a member named for
that component, each carrying that component's own `data-` attribute.

49.19 A headless component whose write to a `Reactive` it binds is refused (4.18) MUST leave as it
stood every state of its own that the gesture making the write would have changed, MUST NOT move
focus for that gesture, and MUST NOT call a callback it was handed for that gesture.

49.20 49.19 MUST NOT hold the `save` `inlineEdit` calls before it writes `value` (56.25).

# 50. Dialogs, toasts and popovers

50.1 `dialog`'s part MUST hold the `<dialog>` it is spread on open while `open` is true, with
`showModal`, or with `show` where `modal` is `false`, and closed while `open` is false.

50.2 Every close of a `dialog`'s `<dialog>`, whatever closed it, MUST write `false` to `open` and then call
`onclose` with the `returnValue` that close set, and `''` where it set none, save that a close
reported after the dialog has opened again MUST leave `open` true, and a close whose write `open`
refuses MUST show the dialog again and call no `onclose` (49.19).

50.3 Escape, a click on a `dialog`'s backdrop, and a click whose target is the element its `backdrop`
part is spread on MUST close it where `dismissible` is true, and MUST NOT where it is false.

50.4 A `dialog`'s `<dialog>` MUST focus the element inside it carrying `autofocus` as it opens.

50.5 `prompts.confirm`, `prompts.alert` and `prompts.prompt` MUST queue their prompt behind every prompt not yet
answered.

50.6 `prompts.host` MUST show the first prompt of the queue through its `dialog` part, `dialog`'s
part with the role `alertdialog`, and the next once that one is answered.

50.7 A string handed to `prompts.confirm`, `prompts.alert` or `prompts.prompt` MUST be the
prompt's `body`.

50.8 `prompts.confirm` MUST settle `true` where its prompt closed by the confirming button, and
`false` where it closed any other way.

50.9 `prompts.alert` MUST settle once its prompt closes, however it closed.

50.10 `prompts.host` MUST keep its `confirm` part disabled for a prompt carrying `mustType` until the
text typed, trimmed, matches `mustType`, trimmed, ignoring case.

50.11 `prompts.confirm`, `prompts.alert` and `prompts.prompt` MUST throw where `isServer` is true.

50.12 A `notices` list's `notify` MUST add its notice to the end of its `list` and hand back its
id, save that a notice whose id the list holds already MUST NOT be added, nor its timer started nor
its `onclose` kept, and its id MUST be handed back all the same; and `initial` MUST hold no id
twice, by the same rule.

50.13 A notice MUST leave its `list` once its `timeout` has passed, and a `timeout` of `Infinity`
MUST keep it there.

50.14 A notice's `timeout` MUST default to its list's `timeout`, and where that is not given to
3000 milliseconds, and to 10000 where its tone is `error`.

50.15 A `notices` list's `dismiss` MUST take the notice holding its id out of its `list`, and MUST
NOT write that `list` where no notice of it holds the id.

50.16 A `notices` list's `notify` MUST throw where `isServer` is true.

50.17 A `notices` host's `notices` MUST be its list's `list` in order, less each notice whose key its
`store` remembers per 50.69 and each notice whose `expires` has passed, and its `region` part MUST
carry the role `status`.

50.18 A notice's action MUST take the notice out of its `list` and then call its `run`.

50.19 An anchored layer — the element carrying `tooltip.host`'s `hint` part while it shows a hint,
an element `popover` is bound to and the element carrying `combobox`'s `popup`
part — MUST sit on the side 50.20 takes, `offset` pixels from its anchor, lined up along it as
`align` names.

50.20 An anchored layer MUST take `side` where it leaves the room the layer needs there — its height
on `top` and `bottom`, its width on `left` and `right` — else the side opposite where that one does,
and else the side of the four leaving the most room past what the layer needs there, of two leaving
the same the first of `side`, its opposite, `top` or `left`, and `bottom` or `right`.

50.21 An anchored layer MUST stay at least `margin` pixels inside the viewport on both axes, its
start edge kept where it does not fit.

50.22 Placing an anchored layer MUST read every box it is placed by before it writes the layer's
place.

50.23 `tooltip.tip` MUST describe the element it is spread on by its text, through an
`aria-description` among its part's attributes.

50.24 `tooltip.tip` MUST open its hint as a `popover` given an `openOnHover` of `delay` milliseconds
and `openOnFocus` opens (50.55, 50.75).

50.25 `tooltip.tip` MUST close its hint on an Escape no one prevented, as the top layer of `dismissible`'s
stack while it shows (53.14, 53.15), once it is unbound, and as a `popover` given a `closeOnLeave`
of `0` closes for a leave and for a blur (50.56, 50.76).

50.26 The element carrying `tooltip.host`'s `hint` part while it shows a hint, a `chart`'s `tip`,
an element `popover` is bound to and the element carrying `combobox`'s `popup`
part MUST open in the top layer as a popover placed against their anchor as 50.19-50.21 state, and
MUST be placed again while open whenever anything scrolls, the window resizes, or the anchor or the
popover changes size — and for a change of size, before the frame that lays that size out is
painted.

50.27 The element carrying `tooltip.host`'s `hint` part while it shows a hint, a `chart`'s `tip`,
an element `popover` is bound to and the element carrying `combobox`'s `popup`
part MUST write the side it took as `data-side`, how far along its facing edge the anchor's middle
falls as the `--arrow-offset` custom property, and the anchor's width as `--anchor-width`.

50.28 A `menu` MUST focus its first menu item as it opens, or its last where ArrowUp on its trigger
opened it, and nothing in its menu where a pointer's rest or focus opened it (50.55, 50.75).

50.29 The menu items of a `menu` MUST be the descendants of its menu carrying `role="menuitem"`,
`role="menuitemcheckbox"` or `role="menuitemradio"` that are not disabled.

50.30 In an open `menu`, ArrowDown and ArrowUp MUST move focus to the next and the previous menu
item, wrapping, and Home and End to the first and the last.

50.31 Escape in an open `menu`, and a click on one of its items carrying `role="menuitem"` and no
`aria-haspopup`, MUST write `false` to its `open` and return focus to its trigger, save as 50.79 has a
submenu's click do.

50.32 ArrowDown and ArrowUp on a `menu`'s trigger MUST open it, save as 50.77 has a menu opening to a
side.

50.33 `prompts.prompt` MUST settle with the text in its input where its prompt closed by the
confirming button, and `undefined` where it closed any other way.

50.34 `prompts.host`'s `typing` MUST hold for a prompt asked by `prompts.prompt` or carrying
`mustType`, and its `input` part MUST start from the prompt's `value`, and `''` where it has none.

50.35 An anchored layer MUST keep its `--arrow-offset` at least `arrowInset` pixels from each end of
its facing edge, and MUST put it at that edge's middle where the edge is shorter than both.

50.36 One hint MUST show at a time. The hint, the notices, the prompts and the message `announce`
gives MUST each show in the last `tooltip.host`, `host` of its `notices` list, `prompts.host` and
`announce.host` of those standing, the others showing none, and a hint, a notice, a prompt or a
message asked for with none standing MUST warn once, on `abide:tooltip`, `abide:notices`,
`abide:prompts` and `abide:announce`.

50.37 A `menu`'s parts MUST be a `popover`'s, given every option the `menu` was, with `align`
`start` and `offset` `4` where none is given: its `trigger`, `anchor` and `menu` that popover's
`trigger`, `anchor` and `popover`, and its `open` that popover's `open`.

50.38 A `menu`'s parts MUST carry every attribute its trigger and its menu need as the server writes
them: the menu `role="menu"` and an `aria-labelledby` naming its trigger's `id`, and the trigger
`aria-haspopup="menu"`.

50.39 A click on a menu item carrying `role="menuitemcheckbox"` or `role="menuitemradio"` MUST leave
its `menu` open.

50.40 A printable key in an open `menu` MUST move focus to the next menu item whose text starts with
the keys typed within 500 milliseconds of each other.

50.41 A `notices` host's `notice` part of a notice MUST carry each attribute the notice's
`attributes` names, under its `data-notices` and `data-tone`.

50.42 A notice's `onclose` MUST be called once, as the notice leaves its `list`, with `timeout`
where its timeout or its `expires` took it, `action` where its action did, and `dismissed` otherwise.

50.43 A prompt whose `signal` aborts MUST leave the queue, showing or waiting, and settle as one closed
other than by the confirming button, and a prompt whose `signal` is aborted already MUST NOT be
queued.

50.44 `prompts.host`'s `dialog` part MUST open a prompt whose `modal` is `false` as `dialog`'s part
opens one whose `modal` is `false`.

50.45 The confirming button of a prompt carrying `run` MUST call `run` with the text typed, and while
that call is in flight MUST keep the prompt showing, disabled, with `data-busy` on the dialog; the
prompt MUST settle as confirmed once the call resolves, and stay showing with the rejection's message
in its `error` part once it rejects.

50.46 The element carrying a `chart`'s `tip` MUST open against the chart's crosshair for as long as
the crosshair stands, and the chart's `root` part MUST name it in `aria-describedby` while it does.

50.47 The element carrying `tooltip.host`'s `hint` part, and a `chart`'s `tip`, MUST NOT be the
target of a pointer event, so a hint open over its anchor never takes the pointer from it.

50.48 `popover`'s `popover` part MUST carry `popover="manual"` among its attributes, and MUST show
its element against the element its `trigger` or its `anchor` is spread on while `open` holds, and
hide it once `open` does not or it is unbound.

50.49 `announce` MUST make its text the one message `announce.host`'s `said` answers, in place of
the message before it, read `polite` unless its `politeness` says `assertive`.

50.50 `announce` MUST throw where `isServer` is true.

50.51 `announce.host`'s `polite` and `assertive` parts MUST each be a live region of that
politeness, and its `said` MUST answer the message for the region its politeness names and nothing
for the other.

50.52 `announce.host`'s `said` MUST answer a message saying the words of the one before it as a
message of its own.

50.53 `tooltip.host`'s `hint` part MUST carry every attribute its element needs as the server writes
it: `role="tooltip"` and `popover="manual"`, with `data-open` present while a hint shows there.

50.54 `tooltip.host`'s `text` MUST be the text of the hint showing in that host, and absent while none
does.

50.55 A `popover` given `openOnHover` MUST open once a mouse or a pen has rested on its trigger or its
anchor that many milliseconds, and MUST NOT open from a touch's resting.

50.56 A `popover` a pointer opened, by a rest or a click, given `closeOnLeave`, MUST close once the
pointer has been off its trigger or its anchor and the popover that many milliseconds, and a
`popover` opened any other way MUST NOT close for a leave.

50.57 While a `menu` of a `group` is open, a pointer entering the trigger of another `menu` of that
`group`, or ArrowLeft or ArrowRight in its menu or a submenu of it that 50.77 does not take, MUST close
it and open the other — for the keys, the
one before or after it in the document order of their triggers, going round.

50.58 A `menu` a `group` switches to MUST carry `data-from` naming the side the one it switched from
stands on, `start` or `end`, until it closes, and the one it switched from MUST carry `data-to` naming
the side of the one it switched to, until it opens again.

50.59 `popover`'s `trigger` MUST open the popover on a click while it is shut, and shut it on a click
while it is open, or while it was open as the press began; its `anchor` MUST NOT open it.

50.60 An open `popover` MUST be a layer `dismissible` stacks, writing `false` to `open` on an Escape
and on a press outside it and outside its `trigger` or `anchor`, save where its `escape` or its
`outside` is `false`.

50.61 `drawer`'s `drawer` part MUST be `dialog`'s `dialog` part, given every option the drawer was,
with a `resizable`'s `panel` part laid over it, and MUST carry `data-side` naming `side`, `end` where
none is given; its `backdrop` part MUST be that `dialog`'s `backdrop` part.

50.62 `drawer`'s `handle` part MUST be that `resizable`'s `handle`, sizing the drawer across `side`
and growing it as the handle moves away from the edge `side` names.

50.63 A pointer let go of `drawer`'s `handle`, where `stops` is given, MUST set `size` to the one of
`stops`, as shares of the viewport's extent across `side`, nearest the size the drag would rest at
carried on by its speed for 150 milliseconds, and MUST write `false` to `open` where no stop is nearer
that size than none.

50.64 A pointer let go of `drawer`'s `handle`, where no `stops` is given, MUST leave `size` where the
drag set it and `open` as it was.

50.65 `lightbox`'s `carousel` MUST be a `carousel` given every option the lightbox was, and its
`dialog` and `backdrop` parts a `dialog`'s, opened and closed by `open`.

50.66 ArrowLeft and ArrowRight in `lightbox`'s `dialog` MUST do what a click on its carousel's
`previous` and `next` does, and nothing where that button is disabled.

50.67 `lightbox`'s `show` MUST set its carousel's `selected` to the key it is handed and write `true`
to `open`.

50.68 A notice of one `notices` list MUST NOT enter another's `list`, nor show in another's `host`.

50.69 A notice that leaves a `notices` list given a `store`, by its action or by a dismissal, MUST
be remembered in that `store` under its key until `ttl` milliseconds after it left.

50.70 A `notices` list's `list` MUST start holding its `initial` notices in the order given, on a
server too.

50.71 A notice's id MUST be the `id` it was given, and where it was given none a hash of the notice
as JSON, its id left out; and the key a dismissal is remembered by MUST be a hash of what its list's
`key` answers for it, and where the list is given none, of its id.

50.72 A notice MUST leave its `list` once its `expires` has passed, as 50.13 has it leave at its
`timeout`.

50.73 A write to a `notices` list's `store` MUST NOT hold a key whose remembering has ended.

50.74 `toasts` MUST be a `notices` list built with no options.

50.75 A `popover` given `openOnFocus` MUST open at once when its trigger or its anchor takes focus that
matches `:focus-visible`, and MUST NOT open for focus that does not.

50.76 A `popover` focus opened MUST close once focus moves to an element outside its trigger or its
anchor and the popover.

50.77 A `menu` whose `side` is `left` or `right` MUST open from its trigger on the arrow key pointing
to that side, in place of ArrowDown and ArrowUp, and MUST close, returning focus to its trigger, on
the arrow key pointing back.

50.78 A `menu` whose trigger is a menu item of another `menu` MUST be a submenu of that menu, and its
menu items MUST NOT be that menu's, wherever its menu stands.

50.79 A click on a menu item of a submenu carrying `role="menuitem"` and no `aria-haspopup` MUST close
it and every `menu` it is a submenu of, returning focus to the trigger of the outermost.

50.80 A `menu` closing MUST close every submenu of it.

50.81 A `menu` MUST leave a key on its menu that a handler before it prevented the default of.

50.82 Tab in an open `menu` MUST close it and every `menu` it is a submenu of.

# 51. Lists and tables

51.1 `listbox` MUST keep active the option a pointer holds active as 51.94 names, and otherwise the
option whose key it last moved to, for as long as the options hold that key.

51.2 `listbox` MUST make the first option active where the options do not hold the key it last moved
to.

51.3 `listbox` MUST make no option active where the options are empty.

51.4 `listbox` MUST make the next option active on ArrowDown, and the previous on ArrowUp.

51.5 `listbox` MUST make the first option active on Home, and the last on End.

51.6 `listbox` MUST go from the last option to the first on ArrowDown, and from the first to the
last on ArrowUp, save where `wrap` is `false`.

51.7 `listbox` MUST cancel the default of each key it acts on.

51.8 `listbox` MUST call `onpick` with the active option on Enter.

51.9 `listbox` MUST call `onescape` on Escape.

51.10 `Listbox`'s `idOf` MUST derive an option's id from `id` and the option's key, a different id
for each key.

51.11 `Listbox`'s `activeId` MUST be the id `idOf` derives for the active option's key, and
`undefined` where no option is active.

51.12 `listbox` MUST scroll an option its keys make active into view.

51.13 `combobox` MUST open its list when its input is typed in.

51.14 `combobox` MUST open its list on ArrowDown, and on ArrowUp without Alt, in its input while the list
is shut.

51.15 `combobox` MUST list the items `search` answers for its input's text, where `search` is given.

51.16 `combobox` MUST list each of `options` whose `label` holds its input's text, ignoring case,
where `search` is not given.

51.17 `combobox` MUST NOT call `search` while its list is shut.

51.18 `combobox` MUST hold a call of `search` back until its input's text has stopped changing for
`debounce` milliseconds, where `debounce` is given.

51.19 `combobox` MUST keep listing the items it last listed while a call of `search` is in flight.

51.20 `combobox` MUST keep and move its active item as a `listbox` over the items it lists does, save
on Home and End.

51.21 `combobox` MUST leave Home and End to its input's caret.

51.22 `combobox` MUST pick the active item on Enter.

51.23 `combobox` MUST pick an item whose option is clicked.

51.24 A pick in a `combobox` MUST set `value` to the item picked.

51.25 A pick in a `combobox` MUST shut its list.

51.26 `combobox`'s input MUST hold the text typed in it since the last pick, and the `label` of
`value` where none has been typed.

51.27 `combobox` MUST shut its list on Escape where the list is open.

51.28 `combobox` MUST clear `value` and the typed text on Escape where its list is shut and its
input holds text, and MUST NOT prevent the default of an Escape where its list is shut and its
input is empty.

51.29 `combobox` MUST shut its list when its input loses focus.

51.30 `combobox` MUST write `data-open` on its `root` part while its list is open.

51.31 `combobox` MUST write `data-busy` on its `root` part while its open list waits on a call of
`search`.

51.32 `combobox` MUST write `data-active` on the active item's option.

51.33 `combobox` MUST write `data-selected` on the option of `value`.

51.34 `tabs` MUST select the first of `keys` where `selected` names none of them.

51.35 `tabs` MUST select a tab that is clicked, writing its key to `selected`.

51.36 `tabs` MUST select the next tab on ArrowRight and the previous on ArrowLeft, going round the
ends.

51.37 `tabs` MUST select the first tab on Home, and the last on End.

51.38 `tabs` MUST move focus to a tab a key selects.

51.39 `tabs` MUST give the selected tab a `tabindex` of `0`, and every other tab a `tabindex` of
`-1`.

51.40 A tab's own panel `tabs` hands back MUST be hidden while another tab is selected and MUST keep
what it holds, and the one shared panel MUST take the id the selected tab's `aria-controls` names and
be labelled by that tab; a tab MUST name its panel by `aria-controls` only while it is selected.

51.41 `tabs`'s parts MUST carry every attribute its tabs and panels need as the server writes them,
`role`, `aria-selected`, `aria-controls` and `aria-labelledby` included.

51.42 `tabs` MUST write `data-selected` on the selected tab.

51.43 `sortBy` MUST order `items` by the value `value` answers for each, ascending unless
`direction` is `descending`.

51.44 `sortBy` MUST keep items of equal value in the order `items` holds them, in either direction.

51.45 `sortBy` MUST put an item whose value is blank — `undefined`, `null`, `''`, `NaN` or an
invalid `Date` — after every item whose value is not, in either direction.

51.46 `sortBy` MUST compare two numbers, two bigints or two booleans by value, two dates by time,
and any other pair as text in the `en-US` locale, the numerals in it compared by value.

51.47 `sortableTable` MUST sort by a `Column`'s `value` where it has one, and by the row's field its
`key` names otherwise.

51.48 `sortBy` MUST hand back a new array, and MUST leave `items` in the order it holds them.

51.49 `sortableTable`'s `rows` MUST answer its rows in the order `sortBy` hands back for the value
of the column `sort` names, and in the order its `rows` hold them where `sort` is `undefined` or
names no column.

51.50 A press on `sortableTable`'s `sort` part for a column MUST turn the direction round where `sort`
names that column, and MUST otherwise sort by the column in its `firstDirection`, ascending where it
has none.

51.51 `sortableTable`'s `header` part MUST write the direction of `sort` as `aria-sort` on the sorted
column's header, and on no other header.

51.52 `sortableTable`'s `header` part MUST write the direction of `sort` as `data-sort` on the sorted
column's header, and on no other header.

51.53 `sortableTable`'s `text` MUST give as a cell's text what the column's `format` hands back
where the column has one, and otherwise the value's own text, or none for a blank value.

51.54 `sortableTable`'s `header` and `cell` parts MUST write a `Column`'s `align` as `data-align`.

51.55 A `combobox` whose `value` is an array MUST add an item picked to it, or take the item out
where it holds it already, MUST keep its list open and clear the typed text on a pick, MUST write
`data-selected` on the option of every item it holds, and MUST NOT clear it on Escape.

51.56 Backspace in the empty input of a `combobox` whose `value` is an array MUST take out the last
item it holds.

51.57 `combobox`'s `popup` part MUST open the element it is spread on against its input as `popover`
opens one, and a press inside it MUST NOT take focus from its input.

51.58 `virtualList`'s `shown` MUST be its `items` from `overscan` rows before the first row its
scroller shows to `overscan` rows past the last, each with the item, its index and its key.

51.59 `virtualList` MUST take a row to hold as many items as fit across its `host` at the width of an
item measured, the host's column gap counted, and to be as tall as the items measured are on average,
the host's row gap counted.

51.60 `virtualList` MUST read nothing as its `host` is bound, and MUST answer its first `initial`
items as `shown` until its first measurement, on a server as in a browser.

51.61 `virtualList` MUST follow the nearest ancestor of its `host` whose overflow scrolls, or the
window where none does.

51.62 `virtualList`'s `host` MUST carry, as its block padding, the height of the rows before `shown`
and of the rows after it.

51.63 `virtualList`'s `scrollTo` MUST scroll the row holding `index` to the top of its scroller, past
the scroller's scroll padding, and `shown` MUST hold that item before the scroll lands.

51.64 `virtualList`'s `sections` MUST answer each label `section` writes, in the order its first item
stands, with that item's index — or, where `labels` is given, each of `labels` in order, with `-1` for
one no item stands in — and MUST answer as `current` the label of the section the first item its
scroller shows stands in.

51.65 `commandPalette` MUST turn `open` on and off on `hotkey`, wherever focus is, its own input
included; its `dialog` part MUST be `dialog`'s, opened modal by `open`, with focus in its input.

51.66 `commandPalette` MUST list each of `commands`, in the order given, whose `label` and
`keywords` together hold every word typed in its input, ignoring case.

51.67 `commandPalette` MUST keep and move its active command as a `listbox` over the commands it lists
does, its input naming the active command as its `aria-activedescendant`.

51.68 `commandPalette` MUST run a command chosen by Enter or a click after turning `open` off, so
focus is back where it stood when the palette opened before the command moves it, and MUST NOT run
it where `open` refuses turning off (49.19).

51.69 `commandPalette`'s input MUST leave Escape to the dialog it is in, which shuts on it, and Home
and End to its caret.

51.70 `commandPalette` MUST NOT bind a command's `key`.

51.71 `commandPalette` MUST list every command again, its input emptied, each time `open` turns on.

51.72 `sortableTable`'s `select` part MUST be a checkbox named for its row by the first column's
text and checked while `selected` holds the row's key, and its `row` part MUST write `data-selected`
on such a row.

51.73 A press on `sortableTable`'s `select` part MUST add its row's key to `selected` or take it
out, `selected` keeping the order of `rows`.

51.74 A press with Shift on `sortableTable`'s `select` part MUST check or clear, as it turns, every
row from the row whose checkbox was pressed last to it, in the order the rows show.

51.75 `sortableTable`'s `selectAll` part MUST be a checkbox checked while every row is selected and
mixed while some are, whose press selects every row or, where every row is, none.

51.76 `sortableTable` MUST write a change of the selection it makes to `selected`.

51.77 `tree` MUST give its tree `role="tree"`, each node's item `role="treeitem"` with the node's
depth as `aria-level` and its count and place among its siblings as `aria-setsize` and
`aria-posinset`, and the element holding a node's children `role="group"`.

51.78 `tree` MUST write `aria-expanded` on the item of a node with children, `true` while the node is
expanded, and on no other item.

51.79 `tree` MUST put exactly one item in the page's tab order: the one last focused while it shows,
else the first one selected that shows, else the first.

51.80 `tree` MUST move focus on ArrowDown and ArrowUp to the next and the previous item that shows,
stopping at the ends, and on Home and End to the first and the last.

51.81 `tree` MUST, on ArrowRight, expand a collapsed node and move focus to an expanded one's first
child, and, on ArrowLeft, collapse an expanded node and move focus to the parent of any other.

51.82 `tree` MUST move focus on a printable key to an item that shows whose `label` starts with what
was typed, as `menu` moves among its items (50.40).

51.83 A click on an item of a `tree` not given `multiple` `true`, and Enter or Space on the one
focused, MUST set `selected` to that item's node's key, and Enter on the focused item of one given
`multiple` `true` MUST set `selected` to that key alone; a click MUST pick only the item it lands
in, and `tree` MUST write `aria-selected` on each item and `data-selected` on each one selected.

51.84 `tree` MUST hide the element holding a node's children while the node is collapsed.

51.85 `slider` given `range` MUST hand back a `role="group"` named by `label` and two thumbs, each
`role="slider"` named by its entry of `labels`, with its value as `aria-valuenow`, what `format`
writes for it as `aria-valuetext`, and the bounds the other thumb leaves it as `aria-valuemin` and
`aria-valuemax`.

51.86 `slider` MUST keep each thumb at a whole number of `step`s from `min`, within `min` and `max`,
and a range's low thumb at most at its high thumb and its high thumb at least at its low.

51.87 A thumb of a `slider` MUST step up by `step` on ArrowUp and ArrowRight and down on ArrowDown
and ArrowLeft, by a tenth of the way on Page Up and Page Down, and to the least and the greatest
value it can take on Home and End, as a `chart`'s crosshair steps (52.69).

51.88 A press on a `slider`'s track MUST move the thumb nearer it to the value nearest the press and
focus it, and the thumb MUST follow the pointer until it lets go.

51.89 `slider` MUST write each change it makes to `value`.

51.90 `slider` MUST write `data-dragging` on its root part while a pointer holds a thumb, and place its
thumbs, and the fill part from `min` to its one thumb or between a range's two, as `style`.

51.91 `slider` given `name` MUST submit its value, or a range's low and then its high value, with a
form its field parts are in, each as a field of that name.

51.92 A press on `combobox`'s input MUST open its list where it is shut, save where `search` is given
and the input holds no text, and MUST shut it where it is open; focus reaching the input MUST NOT open
it.

51.93 Alt+ArrowDown in `combobox`'s input MUST open its list where it is shut, and Alt+ArrowUp MUST
shut it where it is open, and each MUST leave its active item where it stands.

51.94 `Listbox`'s `option` MUST answer the option of a key with the id `idOf` derives for it,
`data-active` saying whether that key is the active one, `aria-selected` saying whether it is
`selected` where `multiple` is not `true`, and a pointer moving over it making that key active
without moving to it — active until the `listbox` next moves to a key or `selected` is written.

51.95 A jump a `Sections` hands back MUST carry `aria-current` while its section is `current`.

51.96 A jump `virtualList`'s `sections` hand back for a section no item stands in MUST be
disabled.

51.97 `virtualList` MUST stop following its scroller once its `host` is unbound.

51.98 A `listbox` or a `tree` given `multiple` `true` MUST hold every key selected as `selected`,
write `aria-multiselectable="true"` on its `listbox` or `tree` part, and write on each option or item
`aria-selected` saying whether its key is in `selected`, and `data-selected` while it is.

51.99 A click on an option of a `listbox`, or on an item of a `tree`, given `multiple` `true` MUST set
`selected` to its key alone, MUST instead add its key to `selected` or take it out where the key 53.3
matches `mod` by is held, and MUST instead select the run 51.100 names to it where Shift is held.

51.100 A run of a `listbox` or a `tree` MUST be every key from the anchor to the key it reaches, in
the order the options or the items that show are listed, the anchor being the key the last pick or
toggle of 51.99 or 51.102 landed on, or the active option's or the focused item's key where that key
is not listed.

51.101 `mod+a`, as `hotkeys` matches it, in a `listbox` given `multiple` `true` MUST set `selected` to
every option's key, and in a `tree` given `multiple` `true` to every node's key.

51.102 Space in a `listbox` or a `tree` given `multiple` `true` MUST add the active option's or the
focused item's key to `selected` or take it out, and Shift+Space MUST select the run 51.100 names to
it.

51.103 ArrowDown, ArrowUp, Home or End with Shift held, in a `listbox` or a `tree` given `multiple`
`true`, MUST select the run 51.100 names to the option or the item it moves to.

51.104 A `listbox` not given `multiple` `true` MUST hold as `selected` the key 51.1 names as last
moved to, and MUST take a key written to `selected` as that key.

51.105 A click on an option of a `listbox` not given `multiple` `true` MUST make its key active and
call `onpick` with its option.

51.106 `combobox`'s `runs` MUST answer an item's `label` cut into runs in order, the first stretch of
it holding the input's text as 51.16 finds it carrying the `match` part, whether or not `search` is
given.

51.107 `CommandParts`'s `runs` MUST answer the command's `label` cut into runs in order, the first
stretch of it each word typed is found in as 51.66 finds it carrying the `match` part, stretches that
overlap or touch carrying it as one run.

51.108 `toggle`'s `button` part MUST flip `pressed` on a click.

51.109 `toggle`'s `button` part MUST carry `aria-pressed` naming `pressed`, or, where `role` is
`switch`, `role="switch"` and `aria-checked` naming it, and MUST carry `data-pressed` while `pressed`
holds.

51.110 A `toggleGroup` that is `multiple` MUST answer each key's `item` with a `toggle`'s `button`
part whose `pressed` holds while `value` holds the key, and whose flip adds the key to `value` or
takes it out.

51.111 A `toggleGroup` that is not `multiple` MUST answer each key's `item` with `role="radio"`, and
`aria-checked` naming whether `value` is that key, carrying `data-pressed` while it is.

51.112 A click on the `item` of a `toggleGroup` that is not `multiple` MUST set `value` to its key,
and MUST NOT clear `value` where it is that key already.

51.113 In a `toggleGroup` that is not `multiple`, ArrowRight and ArrowDown MUST set `value` to the
next key and ArrowLeft and ArrowUp to the one before, going round, and Home and End to the first and
the last, each moving focus to that key's `item`.

51.114 Of the items of a `toggleGroup` that is not `multiple`, the one of `value`, or the first
where `value` is no key, MUST be the only one in the page's tab order.

51.115 `toggleGroup`'s `group` part MUST carry `role="radiogroup"`, or `role="group"` where it is
`multiple`, and `aria-label` naming `label` where one is given.

51.116 `disclosure`'s `button` part MUST flip `open` on a click, and MUST carry `aria-expanded`
naming `open` and `aria-controls` naming its `region`'s id.

51.117 `disclosure`'s `region` part MUST carry `hidden="until-found"` while `open` does not hold, and
no `hidden` while it does.

51.118 A `beforematch` on `disclosure`'s `region` MUST write `true` to `open`.

51.119 `disclosure`'s `button` and `region` parts MUST carry `data-open` while `open` holds.

51.120 `accordion`'s `item` MUST answer each key with a `disclosure`'s parts whose `open` holds while
the accordion's `open` holds the key, and whose flip opens or closes that key.

51.121 An `accordion` that is not `multiple` MUST hold at most one key open, opening one closing the
one open, and closing it leaving `open` `undefined`.

51.122 `clamp`'s `text` part MUST show at most `lines` lines while `open` does not hold, and all of
its text while it does.

51.123 `clamp`'s `overflowing` MUST hold where its text, cut to `lines` lines, has more than they
show, measured as the text resizes while `open` does not hold.

51.124 `clamp`'s `button` part MUST be a `disclosure`'s `button` over its `text`, flipping `open`.

51.125 `pagination`'s `items` MUST hold the same number of entries whatever `page` is: every page, in
order, where there are no more than `2 × around + 5`, and else exactly that many — the first page,
the last, and a run of pages around `page`, with a `gap` where the pages between two of them are
left out. The run MUST be the `2 × around + 1` pages centered on `page`, save where that would leave
a gap standing for one page or none at an end, where the run MUST instead reach that end and hold
`2 × around + 3` pages.

51.126 A click on `pagination`'s `link` of a page MUST write that page to `page`, and where `href` is given
the link MUST carry `href` naming that page's address.

51.127 `pagination`'s `link` of the page `page` names MUST carry `aria-current="page"`.

51.128 A click on `pagination`'s `previous` or `next` MUST write the page before or after to `page`, and
each MUST be disabled where there is no such page.

51.129 `pagination`'s `nav` part MUST carry `aria-label` naming `label`, `Pages` where none is given.

51.130 While `playing` holds, `playback` MUST move `at` forward each frame by the milliseconds since
the frame before times `rate`, and MUST ask for no frame while it does not.

51.131 `playback` reaching `duration` MUST set `at` to `0` and keep playing where `loop` holds, and
otherwise MUST leave `at` at `duration` and write `false` to `playing`.

51.132 `playback`'s `play` part MUST be a `toggle`'s `button` over `playing`, and pressing it to play
where `at` is at `duration` MUST set `at` to `0` first.

51.133 `playback`'s `scrubber` part MUST be an `<input type="range">` from `0` to `duration` whose
value is `at`, and its `input` MUST move `at` to its value, kept from `0` to `duration`.

51.134 `playback`'s `toggleGroup` MUST be a `toggleGroup` over `rates`, each key the rate as text,
picking `rate`.

51.135 On `playback`'s `root`, Space MUST press `play`, and ArrowLeft and ArrowRight MUST move `at`
back and forward by `step`, kept from `0` to `duration`, as `hotkeys` binds them.

51.136 `breadcrumbs`' `items` MUST be every crumb of `trail`, in order, where it holds no more than
`max`, and otherwise its first crumb, an `overflow`, and its last `max` less one.

51.137 `breadcrumbs`' `folded` MUST be the crumbs of `trail` `items` leaves out, in order.

51.138 `breadcrumbs`' `link` of a crumb MUST carry `href` naming the address `href` answers for it,
and the link of the last crumb of `trail` MUST carry `aria-current="page"`.

51.139 `breadcrumbs`' `menu` MUST be a `menu`'s parts, and its `menuItem` of a crumb MUST carry
`role="menuitem"` and `href` naming the crumb's address.

51.140 `breadcrumbs`' `nav` part MUST carry `aria-label` naming `label`, `Breadcrumb` where none is
given.

51.141 `wizard`'s `current` MUST be the key `current` was handed, or the first of `steps` where that is
no step's.

51.142 `wizard`'s `next` MUST move to the step after the one on, and MUST be disabled on the last and
where `valid` answers `false` for the one on; its `previous` MUST move to the step before, and MUST be
disabled on the first.

51.143 `wizard`'s `step` of the step on MUST carry `aria-current="step"`, and of each step before it
`data-done`, a click on which MUST move to that step; a click on a step after it MUST move nowhere.

51.144 `wizard`'s `meter` MUST be a `meter`'s parts, whose `value` is the place of the step on among
`steps`, counted from one, and whose `max` is how many steps there are.

51.145 `sortableList`'s `sorted` MUST be `items` in the order `order` names their keys, any item
`order` does not name following, in the order given, save as 51.179 finds and leaves them for a list
of a `group`.

51.146 A pointer pressed on an item's `handle` and moved MUST place the items 51.147 names after
every other item whose middle, as it stood when the pointer was pressed, is above the pointer, and
each of them MUST carry `data-grabbed` on its `item` part until the pointer is let go.

51.147 The items `sortableList` moves MUST be every key of `selected`, in the order put, where it is
`multiple` and the item pressed or active is selected, and that item alone otherwise, placed
together.

51.148 Alt with ArrowUp or ArrowDown on `sortableList`'s `list` MUST move the items 51.147 names one
place before or after the others, kept to the list's ends, and every other key but those 51.180 takes
MUST be the `listbox`'s.

51.149 `sortableList` moving items MUST `announce`, for one item, its `label` and its place among the
items, and for several, how many and the places they span.

51.150 `sortableList`'s `list` part MUST be a `listbox`'s `listbox` part over `sorted`, given `multiple`
and `selected`, in the tab order and naming the active option as its `aria-activedescendant`, and each
item's `item` part MUST be that listbox's `option` part.

51.151 An item's `handle` part MUST carry `aria-hidden="true"` and MUST NOT stand in the tab order.

51.152 A click on `spoiler`'s `cover` part MUST write `true` to `open`, and MUST move focus to its
`content` part.

51.153 `spoiler`'s `content` part MUST carry `hidden` while `open` does not hold, and no `hidden`
while it does.

51.154 `spoiler`'s `cover` part MUST carry `hidden` while `open` holds, and no `hidden` while it does
not.

51.155 `spoiler`'s `content` part MUST carry `data-open` while `open` holds.

51.156 `tree`'s `shown` MUST be the nodes that show, in the order they render: each root, and after
each node that shows and is expanded, its children.

51.157 `jsonInspector` MUST hold a row for `value` and for every entry of every object and array
within it, each told apart by its JSON Pointer, the root's `''`.

51.158 `jsonInspector`'s `tree` part and each row's `item` part MUST be `tree`'s, each row a node
whose children are its entries in the order `value` holds them.

51.159 `jsonInspector`'s `rows` MUST be `tree`'s `shown` (51.156) over its rows.

51.160 A row of a `jsonInspector` MUST match a `query` that is not blank where its key, or its value
where that is not an object or an array, written as text, holds `query`, ignoring case; `matches`
MUST be every row that matches, in the order `value` holds them; and the `item` part of each row
that matches MUST carry `data-match`.

51.161 While `query` is not blank, the rows of a `jsonInspector` that show MUST be those that match,
those holding one, and every entry of a row that matches, and each row holding a match MUST be
expanded until it is collapsed while that `query` stands; a row expanded or collapsed while `query`
is not blank MUST NOT be written to `expanded`.

51.162 A row's `keyRuns` and `valueRuns` MUST be its key's and its value's text cut into runs as
`highlight` cuts them (52.110), each match carrying the `match` part, and a row whose value is an
object or an array MUST have no `valueRuns`.

51.163 `jsonInspector`'s `search` part MUST be an input of type `search` that writes what is typed to
`query`, shows `query`, and names the tree's element with `aria-controls`.

51.164 `jsonInspector`'s `inspected` MUST be the row whose pointer `selected` holds, showing or not.

51.165 A `jsonInspector` given no `expanded` MUST start with its root expanded.

51.166 A click on a jump `virtualList`'s `sections` hand back MUST scroll as `scrollTo` does to its
section's first item.

51.167 A pointer pressed on the `host` of a `Sections` whose `scrub` is `true` and moved MUST click,
each time the jump nearest the pointer among those not disabled changes from the one it was pressed
on or last clicked, that jump, and MUST click none while `scrub` is not `true`.

51.168 The `host` of a `Sections` MUST capture the pointer and carry `data-scrubbing` from the first
click 51.167 makes until that pointer is released.

51.169 `scrollSpy`'s `current` MUST be the key of the item whose element — the one whose id is its
key — stands last at or above where its scroller lands it, its `scroll-margin-top` and its scroller's
`scroll-padding-top` counted, and the first item's key where none does, on a server as in a browser.

51.170 `scrollSpy`'s `current` MUST be the key of the item whose element stands last in its scroller
while its scroller is scrolled to its end, where it scrolls at all.

51.171 `scrollSpy` MUST follow the nearest ancestor of the first of its items' elements whose
overflow scrolls, or the window where none does.

51.172 `scrollSpy` MUST NOT read an element's layout as its scroller scrolls.

51.173 `scrollSpy` MUST measure where its items' elements stand a frame after its `host` is bound,
after `items` changes, and after its scroller, the window or an element holding one of them resizes.

51.174 A jump `scrollSpy` hands back MUST link to `#` followed by its item's key.

51.175 A click on a jump `scrollSpy` hands back with no modifier held MUST scroll its scroller as
`behavior` names to where it lands that item's element, and MUST be left to the browser where a
modifier is held or the document holds no element of that id.

51.176 A click on a jump `scrollSpy` hands back that scrolls as 51.175 names MUST replace the
address's fragment with the item's key.

51.177 `scrollSpy` MUST stop following its scroller once its `host` is unbound.

51.178 Items moved out of a `sortableList` into another of its `group` MUST leave the first's `order`
naming its `sorted` keys without them, and MUST set the other's `order` to its keys with them placed
together as the move names.

51.179 The `sorted` of a `sortableList` of a `group` MUST hold, for a key its `order` names that no
item of its `items` answers, the item of that key among the `items` of another list of its `group`, and
MUST NOT hold an item its `order` does not name that the `order` of another list of its `group` names.

51.180 Alt with ArrowLeft or ArrowRight on the `list` of a `sortableList` of a `group` MUST move the
items 51.147 names into the list of that `group` before or after it, in the document order of their
`list` parts, after as many of that list's items as stood ahead of them, and MUST move focus to that
list's `list` part; where no list stands there it MUST move nothing, and in either case MUST prevent
the browser's default.

51.181 A pointer pressed on an item's `handle` in a `sortableList` of a `group` and moved MUST move the
items 51.147 names into the list of that `group` whose `list` part's box, as it stood when the pointer
was pressed, holds the pointer, placed among that list's items as 51.146 places them, and MUST keep
them in the list they were last in while no such box holds it.

51.182 Items moved into another `sortableList` MUST make the first of them its active option, and
those of them `selected` in the list they left MUST leave that list's `selected` and, where the list
they enter is `multiple`, join its `selected`.

51.183 Items moved into another `sortableList` MUST be announced as 51.149 names, naming that list
after `moved to` by its `aria-label`, else the text of the elements its `aria-labelledby` names, else
as `another list`.

51.184 `slider` not given `range` MUST hand back one thumb, `role="slider"` named by `label`, with its
value as `aria-valuenow`, what `format` writes for it as `aria-valuetext`, and `min` and `max` as
`aria-valuemin` and `aria-valuemax`.

51.185 `toolbar`'s `toolbar` part MUST carry `role="toolbar"`, or `role="menubar"` given that `role`,
named by `label`, with its `orientation` as `aria-orientation`.

51.186 Of the elements carrying a `toolbar`'s `item` part, exactly one MUST carry `tabindex="0"` and
every other `tabindex="-1"`, the one being the item focus reached last while it stands, and the
first in document order otherwise.

51.187 An arrow key along a `toolbar`'s `orientation`, Home or End on one of its items MUST move focus
to the next, the previous, the first or the last of its items that is not disabled, going round its
ends unless `wrap` is false.

51.188 A `toolbar` MUST leave a key on its item where a handler before it prevented the key's
default, or where the item is a field the key types into.

51.189 A `toolbar`'s `item` part MUST carry `role="menuitem"` given `role: 'menubar'`, and no role
otherwise.

51.190 `combobox` given `create` MUST list last, while its list is open, the item `create` answers
for its input's text with the whitespace at either end taken off, where that leaves any text and no
item it lists or holds carries that text as its `label`, ignoring case.

51.191 `combobox`'s `creating` MUST be the item 51.190 lists, and `undefined` where it lists none.

# 52. Formatting, markdown and charts

52.1 Each formatter of `format` MUST write `—` for a value it cannot format.

52.2 Each formatter of `format` MUST write in the `en-US` locale where its caller names no `locale`.

52.3 `format.date` MUST write a time in the zone `format.timeZone` pins where its caller names no
`timeZone`, and in the visitor's zone (52.45) where none is pinned.

52.4 `format.duration` MUST write a length in the largest unit it fills and the unit after it,
leaving out a unit at zero.

52.5 `format.relative` MUST measure a time from the `now` its caller passes, and from the current
time where it passes none.

52.6 A formatter of `format` MUST build at most one `Intl` formatter per set of options in a process.

52.7 `format.bytes` MUST write a size in the largest unit it fills at least one of, each unit 1,000
of the one below it.

52.8 `markdown` MUST escape every character of its source that HTML reads as markup, save the tags
52.46 writes.

52.9 `markdown` MUST write a link whose address has a scheme outside `schemes` as its text alone.

52.10 `markdown` MUST render an image as a link to its address.

52.11 `markdown` MUST mark the `code` of a fenced block with the fence's language as a
`data-language` attribute.

52.12 `markdown` MUST render a source that ends inside an unclosed fence, emphasis or link as the text
it has so far, save what 52.50 leaves out.

52.13 `markdown` MUST write each address a link keeps as what `href` answers for it, where its caller
passes `href`.

52.14 `markdown` MUST write a link `href` answers `undefined` for as its text alone.

52.15 `markdown` with `inline` MUST render its source as one line's inline marks, with no block
element around them.

52.16 `markdown` MUST render a heading of one `#` at the level `headingLevel` names, and each further
`#` one level deeper, no deeper than 6.

52.17 Each section `markdown.incremental` answers that is not a block MUST carry as `html` the
markup `markdown` renders for that section of `source`, given the options it is passed.

52.18 `markdown.incremental` MUST answer the same object for every section of its `source` that text
appended to the `source` leaves unchanged.

52.19 `chart.ticks` MUST answer values a step of 1, 2 or 5 times a power of ten apart, the first at or
below `min` and the last at or above `max`.

52.20 `chart.scale` MUST map every value to the middle of the range where the domain has no width.

52.21 `chart.path` MUST break the path at each value that is `null`, `undefined` or not finite.

52.22 `chart.path` MUST close each run of values down to `baseline`, where its caller passes one, and
back along its points where `baseline` holds one per x.

52.23 `chart.nearest` MUST answer the index of the position nearest `x`, the earlier of two equally
near, and `-1` where there are no positions.

52.24 `chart` MUST draw the series `series` answers, in that order with the first at the back, each
mark carrying its series' index in that order as `data-series`.

52.25 `chart` MUST draw a `data-chart="zero"` line at zero inside its plot, where `zero` is set.

52.26 `chart` MUST draw a crosshair at the x position nearest the pointer while a pointer is over it,
and MUST open a readout of every series' value wherever its crosshair stands (50.46).

52.27 `chart` MUST open its readout on the side of the crosshair that has more of the plot.

52.28 `chart` MUST carry `data-hovering` on its root while its readout is open.

52.29 `chart`, `pie` and `sparkline` MUST carry `role="img"` and take their accessible name from
`label`.

52.30 `chart`, `pie` and `sparkline` MUST draw every mark in `currentColor`.

52.31 `sparkline` MUST carry `data-trend` on its root, `up`, `down` or `flat` by its last present
value against its first.

52.32 `format.relative` MUST write in the `style` its caller passes, and in `long` where it passes
none.

52.33 `sparkline` given `kind: 'bar'` MUST draw each present value as a bar from zero, each in a
band of equal width, with zero on its scale, and MUST draw no line, area or dot.

52.34 `chart` and `sparkline` declaring `zero` MUST take zero into the range of their values, and
MUST draw a series whose every present value is zero along the bottom of that range.

52.35 `format.money` and `format.percent` given a `signDisplay` of `always` or `exceptZero` MUST write
a negative value's sign as `−` (U+2212), and MUST NOT otherwise.

52.36 `format.dateParts` MUST answer the pieces whose values joined in order are what `format.date`
writes for the same value and options.

52.37 `chart` MUST draw a series whose `kind` is `column` as a `data-chart="bar"` rect per present
value, take zero into its range where it draws one, and stand the columns of an x side by side in
its slot, one band per stack of columns and one per column in none.

52.38 A click on a `chart` MUST call `onpick` with the index of the x position nearest it, and a click
on a slice of a `pie` with that slice's index, save where `disabled` holds for that index.

52.39 `chart` MUST write `data-disabled` on each bar, and on the readout, of an index `disabled`
holds for, and `pie` on each such slice.

52.40 `markdown` MUST write a link `href` answers with a `LinkTarget` with its `href` as the address,
and its `target` and `rel`, where it carries them, as the link's attributes.

52.41 `markdown` MUST write a reference link — `[text][label]`, `[text][]` or `[label]` — whose label
a definition in its source names, compared without case and with runs of whitespace as one space,
as a link to that definition's address, MUST write one naming no definition as it is written, and
MUST render a definition as nothing.

52.42 `markdown` MUST render a fenced block whose info starts with a name `blocks` holds as what that
function answers for the block's source and the rest of its info, written as it is.

52.43 `markdown.incremental` MUST answer a section that is one closed fenced block, and nothing else,
whose info starts with a name `blocks` holds, as a `block` carrying that name, the block's `source`
and the rest of its `info`, and MUST answer the block as code while its fence is open. A code fence
opening unindented MUST be a section of its own, with or without a blank line above or below it.

52.44 `format.timeZone` MUST hold the zone the app pins, `undefined` until it pins one, one value per
request on a server.

52.45 The visitor's zone MUST be `UTC` on a server and while a page hydrates, and the zone the
browser resolves once it has.

52.46 `markdown` MUST write a `<br>` in its source as a line break, and each of `b`, `i`, `u`, `s`,
`em`, `strong`, `del`, `ins`, `mark`, `small`, `sub`, `sup` and `kbd` opened with no attribute and
closed later on its line as that element around its text, and MUST escape any other tag.

52.47 `markdown` MUST write a numeric character reference outside code, and a named one of the
markup, space, typographic, arrow, comparison and currency names it holds, as the character it names.

52.48 `markdown` MUST render a list item opening with `[ ]` or `[x]` as a disabled checkbox,
checked for `[x]`, before the rest of the item, its `li` carrying `data-task` of `open` or `done`.

52.49 `markdown` MUST keep math as its TeX, escaped, in an element carrying `data-math` of `inline`
or `display`: `$…$`, `\(…\)`, `$$…$$` and `\[…\]` on a line, and lines of `$$` or `\[` alone opening a
block a line of `$$` or `\]` alone closes; a `$` opens math only before a non-space and closes it only
after a non-space and before no digit.

52.50 `markdown` given `streaming` and `markdown.incremental` given `streaming` MUST leave out the end
of the last section a later chunk may still change, as far back as 160 characters of its last line:
a closing fence half written, a last line that is a block's marker alone, a table's rows until the
delimiter under its head is whole and its last row until the line ends, and the end of the last line
from an opening of code, emphasis, a link or a tag nothing closes yet.

52.51 `chart` MUST draw a series whose `kind` is `line` as a `data-chart="line"` path through its
present values.

52.52 `chart` MUST draw a series whose `kind` is `area` as a `data-chart="area"` path closed onto
the top of what is stacked under it, through a value it is missing, and, where it is in no stack,
down to zero or the edge of the plot nearer zero.

52.53 `chart.stack` MUST pile the values of the series sharing a stack up from zero at each x in
series order, a positive value up from the stack's positive total so far and a negative value down
from its negative total so far.

52.54 `chart.stack` MUST put a series whose `stack` is `false` in no stack, one naming a stack in that
stack, and one naming none in a single stack shared with the others naming none where `stack` is set,
and in no stack where it is not.

52.55 `chart.stack` MUST count a missing value as zero toward its stack.

52.56 `chart.stack` given `normalize` MUST answer each stacked value as its share of the sum of the
magnitudes of its stack's values at that x, and as zero where that sum is zero.

52.57 `chart.stack` given `normalize` MUST stack as it does given `stack`.

52.58 `chart` MUST draw each series where `chart.stack` places it given its own `stack` and
`normalize`.

52.59 `chart` declaring `normalize` MUST write its y ticks as percentages.

52.60 `chart` MUST read each series' own value in its readout, and, where `normalize` is set, a
stacked value's share of its stack beside it.

52.61 `chart` MUST span each axis `bounds` gives a range for over that range, in place of the range
of its values.

52.62 `chart` and `pie` MUST keep each mark's element across a change of the values it draws.

52.63 `chart` MUST write a column's place and size as its `x`, `y`, `width` and `height`, and `pie`
a slice's sweep as `style` properties.

52.64 `pie` MUST draw each slice as a `data-pie="slice"` arc sweeping its value's share of the sum of
the slices' values, clockwise from the top in the order given, its index as `data-series`.

52.65 `pie` MUST draw no slice for a value that is missing, zero or negative.

52.66 `pie` MUST leave a hole at its center `inner` of its radius across.

52.67 `pie` MUST open a hint for a slice as `tooltip` does, reading its label, its value and its
share, placed against the box of that slice's own arc rather than the whole ring's.

52.68 `chart` MUST draw its plot over the whole box its root part is drawn at — its x positions and
its y range spanning it, and its gridlines, its zero line and its crosshair across it — and MUST hand
back its y ticks as `data-chart="tick"` labels ending at the plot's left edge and its x ticks as
labels at its bottom edge, each at its value, keeping no room inside the box for either.

52.69 `chart` MUST take focus, and while it has it, ArrowRight and ArrowLeft MUST move its crosshair
one x position, from none to the first and the last, stopping at either end, and Home and End to the
first and the last; an Escape no one prevented, and focus leaving the chart, MUST put the crosshair
away.

52.70 Enter on a `chart` MUST call `onpick` with the index of the x position its crosshair stands at,
save where `disabled` holds for that index.

52.71 `chart` MUST `announce` the x its crosshair stands at and every series' value there each time a
key moves the crosshair, and MUST NOT for a move of the pointer.

52.72 `time`'s `text` of a value MUST be `format.relative` of it, and its `time` part of a value
MUST carry it as an ISO string as `datetime` and `format.date` of it in the `dateTime` style as
`title`; where the value names no time, the text MUST be `—` and the part MUST carry neither
attribute.

52.73 Every `time` part bound to an element in a browser MUST be ticked by one timer, set for the
soonest moment any of their labels next reads differently, and no timer MUST stand while none is
bound.

52.74 A `time`'s label MUST be ticked when `format.relative` next writes it differently: half a unit
past where its rounded count stands, or where its unit turns, and, under a minute either side of
now, once a minute has passed.

52.75 No `time`'s timer MUST stand while the page is hidden, and the time MUST be read again as the
page is shown.

52.76 A tick MUST write only the labels it changed.

52.77 A `time` MUST write its label from the time it renders at on a server and from the time it
hydrates at in a browser, a label a boundary passed between the two being written as changed text and
not as a hydration mismatch.

52.78 `chart` MUST hand back a point for each present value of each series, at the x its part `x`
answers for its position — the value its option `x` holds at its index, or the index where that
option is not given — and the y `y` answers for the value it is drawn at, and none for a missing
value; and its part `x` MUST map any value in those units as it maps a position.

52.79 `chart`'s crosshair part MUST carry the same binding at every x position it stands at, and
its `tip` MUST be placed again against the crosshair at each x the crosshair moves to.

52.80 `pie` MUST keep a slice's hint binding while the slice's hint reads the same, however its sweep
changes.

52.81 `chart`, `pie` and `sparkline` MUST hand back as parts every mark, attribute and handler they
draw with, and every clause saying what one of them draws MUST hold of what it hands back where an
app spreads it.

52.82 Each of `calendar`'s `months` MUST hand back as its `weeks` the whole weeks its month falls
in, each seven consecutive days from the week's first day, and a day of another month among them
MUST carry `data-outside`.

52.83 `calendar` MUST count its days the same in every zone the code runs in, dropping and repeating
none where a daylight-saving change falls in the month.

52.84 `calendar`'s today MUST be the day it is in the zone its `timeZone` names, and where it names
none in the zone `format.date` writes in (52.3), and today's cell MUST carry `data-today` and an
`aria-current` of `date`.

52.85 The first month `calendar` shows MUST be the `month` written where it is one, else the
selected day's or a range's start's, else today's.

52.86 Exactly one of `calendar`'s day cells MUST be in the page's tab order: the active day's, being
the day focused last, else the selected day or a range's start, else today, whichever is first in a
month shown, and the first month's first day where none is; focus put on a day's cell by any means
MUST make that day the active one.

52.87 `calendar`'s `weekdays` MUST be the seven days in the order a week runs, named in its `locale`,
and a week MUST start on the `firstDay` given, else on the day `Intl.Locale` gives for the locale,
else on Sunday.

52.88 On `calendar`'s grid, ArrowRight and ArrowLeft MUST move focus a day on and back, ArrowDown and
ArrowUp a week on and back, and Home and End to the first and last day of the active day's week.

52.89 On `calendar`'s grid, PageDown and PageUp MUST move focus a month on and back, and a year with
Shift, to the same day of the month where that month has it and its last day where it does not.

52.90 A key moving `calendar`'s active day out of the months shown MUST show the month it moved into,
paging the months shown by as few as do.

52.91 Enter and Space on `calendar`'s grid MUST pick the active day, as 52.97 picks one in a range.

52.92 A click on one of `calendar`'s day cells MUST pick its day, as 52.97 picks one in a range, and
make it the active one.

52.93 `calendar`'s `previous` and `next` MUST page the months shown a month back and on, MUST name
every grid shown in their `aria-controls`, and MUST NOT move focus.

52.94 Each of `calendar`'s `months` MUST hand back as its `label` its month and year in the
calendar's `locale`, and its grid MUST be labelled by its `heading`.

52.95 A selected day's cell MUST carry `data-selected` and an `aria-selected` of `true`, and every
other day's cell an `aria-selected` of `false`.

52.96 `calendar` MUST show `months` months from the first shown, one after another and a grid each,
and one where `months` is not given; a day of another month in one grid whose own month another grid
shows MUST carry no `id` and no `tabindex` there.

52.97 `calendar` given a `range` of `true` MUST hold what it picks as `[start, end]`: a pick while
nothing is picked or while an end is MUST make its day the start with no end, and a pick while a
start has no end MUST make the earlier of the two days the start and the later the end.

52.98 In a range, every day from its start to its end MUST be selected as 52.95 states, its start
alone while it has no end, its start's cell MUST carry `data-range-start` and its end's
`data-range-end`, and every grid MUST carry an `aria-multiselectable` of `true`.

52.99 While a range has a start and no end, every day from the start to the day last pointed at in
a grid, else to the day focused last, MUST carry `data-preview`, and no day MUST otherwise.

52.100 `calendar`'s `active` MUST be the day 52.86 puts in the tab order, and its `idOf` MUST answer
the id of the cell 52.96 gives the day it is handed.

52.101 `format.date`'s `'input'` style MUST write a time as the clocks of its zone read it, as
`YYYY-MM-DDTHH:MM`, the same in every `locale`.

52.102 `instantAt` MUST answer the epoch milliseconds at which the clocks of the zone its `timeZone`
names — else the zone `format.date` writes in (52.3) — read the wall clock it is handed, a
`YYYY-MM-DD` being its midnight, and MUST answer `undefined` for a string that is no `YYYY-MM-DD`,
`YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` on the calendar.

52.103 Where the zone's clocks read a wall clock twice, `instantAt` MUST answer the earlier instant,
and where they skip it, the instant the length of the skip later — `Temporal`'s `compatible`.

52.104 `chart.path` given `curve` MUST draw each run of three or more values as a curve through every
one of its points that stays, between two neighbouring points, within the values of those two, and
MUST close a run back along a `baseline` of one point per x by the curve those points draw.

52.105 `chart` MUST draw a series whose `kind` is `line` or `area` declaring `curve` by 52.104, and
`sparkline` declaring `curve` MUST draw its line and its area by it.

52.106 `meter`'s `meter` part MUST carry `role="meter"`, or `role="progressbar"` where `role` is
`progressbar`, and `aria-valuenow`, `aria-valuemin` and `aria-valuemax` naming `value`, `min` and
`max`, and `aria-label` naming `label` where one is given.

52.107 A `meter` whose `value` is `undefined` MUST carry no `aria-valuenow` on its `meter` part, and
MUST carry `data-indeterminate` there.

52.108 `meter`'s `fill` part MUST be as wide, as a share of the meter, as `value` falls from `min` to
`max`, kept from none to all of it.

52.109 `meter`'s `meter` part MUST carry `data-level`, where `low` or `high` is given, as `low` where
`value` is below `low`, `high` where it is above `high`, and `middle` otherwise.

52.110 `highlight` MUST answer `text` cut into runs in order, the first stretch of it holding `query`,
found ignoring case, carrying the `match` part — or, where `words` is set, the first stretch holding
each word of `query` — stretches that overlap or touch carrying it as one run.

52.111 `highlight` given a `query` that is blank MUST answer `text` as one run carrying no `match`.

52.112 `format.money`, `format.percent`, `format.number` and `format.bytes` MUST hand
`Intl.NumberFormat`, `format.list` `Intl.ListFormat`, and `format.date` and `format.dateParts`
`Intl.DateTimeFormat`, every option their caller names, under its own name, over the defaults each
formatter keeps, MUST NOT refuse a caller naming one bound of the fraction digits for the default of
the other, and MUST NOT refuse a caller naming a part of a date beside a `style` `Intl` writes whole.

52.113 `format.date`, `format.dateParts`, `format.relative` and `time` MUST read a value that is a
`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` string, the last with or without a
fraction of a second, as that wall clock in the zone they write in (52.3) — the one `timeZone`
names where their caller names one — as `instantAt` reads it (52.102), a day alone being its
midnight; and a string with a `Z` or an offset as the instant it names.

52.114 `format.number` given a `unit` MUST write its value in that unit, as `unitDisplay` names it.

52.115 `format.date`'s `'dateTime'` style MUST hand the date it writes the options naming a part of a
date, the time it writes those naming a part of a time, and both the rest.

52.116 Each part `chart` hands back for a point, a column, a tick, a gridline, the zero line or the
crosshair, and `sparkline`'s `dot`, MUST carry in its `style` where it is drawn as `--x` and `--y`,
and a column its size as `--width` and `--height` besides, each a percentage of the box its root
part is drawn at, a line across the plot carrying only the one of `--x` and `--y` it is drawn at; and
`chart`'s MUST carry none while its root part is bound to an `<svg>`.

52.117 `meter`'s `meter` part MUST carry in its `style` as `--fraction` the share of the meter
52.108 fills, and no `style` where `value` is `undefined`.

52.118 `chart` MUST write a series' value in its readout by the series' `format`, given the value and
its index, where the series gives one, and by `yFormat` where it does not.

52.119 `chart` and `sparkline` given `pad` MUST widen the range of their values by `pad` times its
span below it and above it — by a pair's first below and its second above — before taking zero into
the range (52.34, 52.37) and before `chart.ticks` rounds it, and MUST NOT widen a range with no width
or a range `bounds` gives.

# 53. Keys, element behaviors and chat

53.1 `hotkeys` MUST run at most one binding per `keydown`: the first, in the order the bindings are
written, whose key and modifiers match it.

53.2 `hotkeys` MUST call `preventDefault` on a `keydown` it ran a binding for, save one whose
`prevent` is `false`, and MUST NOT on any other.

53.3 A `hotkeys` binding holding `mod` MUST match ⌘ on an Apple platform and Ctrl on any other,
reading the platform off the user agent of the request being served on a server, off the server's
own platform where it serves no request, and off `navigator.userAgent` in a browser.

53.4 A `hotkeys` binding MUST NOT match a `keydown` holding Ctrl, ⌘ or Alt where the binding does not
hold it, nor one lacking a modifier the binding holds.

53.5 A `hotkeys` binding whose key is a symbol MUST match whether shift is held or not, save where it
holds `shift`, and any other binding MUST match shift as a modifier.

53.6 A `hotkeys` binding MUST match its key against `KeyboardEvent.key` case-blind, and a letter or a
digit by `KeyboardEvent.code` where the press typed no printable ASCII character.

53.7 `hotkeys` MUST NOT run a binding for a `keydown` whose target `isEditableTarget` holds for, save
a binding whose `editable` is `true`.

53.8 `hotkeys` MUST NOT run a binding for a `keydown` already `defaultPrevented`, or one an input
method is composing.

53.9 `hotkeys` and `keyLabel` MUST read `control` as `ctrl`, `cmd` and `command` as `meta`, and
`option` as `alt`, MUST throw where a binding holds a modifier other than those and `ctrl`, `meta`,
`alt`, `shift` and `mod`, and a `MenuItem`'s `key` MUST read the same modifiers, `mod` as `cmd`.

53.10 `isEditableTarget` MUST hold for a textarea, a select, an input that takes text and an element
`contenteditable` makes writable, and MUST NOT hold for any other target.

53.11 `keyLabel` MUST write `mod` as ⌘ where 53.3 matches it as ⌘, and as Ctrl where 53.3 matches it
as Ctrl.

53.12 `dismissible` MUST call its callback on a `pointerdown` landing outside the element its `host`
is spread on and outside every element its `inside` is spread on, save where `outside` is `false`.

53.13 `dismissible` MUST NOT call its callback for a `pointerdown` dispatched when its element was
bound.

53.14 `dismissible` MUST call its callback on an Escape `keydown` not already `defaultPrevented`, and
MUST call `preventDefault` on it, save where `escape` is `false`.

53.15 Elements `dismissible` is spread on at once, the anchor of the hint `tooltip.tip` shows, and
the crosshair of a `chart`'s open `tip`, MUST stack in the order they were bound or opened: an
Escape dismissing the top one alone, and a press dismissing each from the top that it lands outside
until the first it lands in.

53.16 `dismissible`'s `Disposer` MUST take its element off the stack, and the last one MUST remove
the document's listeners.

53.17 `dropzone`'s `host` MUST carry `data-dragging` while a drag carrying files is over its element,
and MUST NOT once the drag leaves or drops.

53.18 `dropzone` MUST refuse the default of a `dragover` and a `drop` carrying files, whatever
`accept` takes.

53.19 `dropzone` MUST take the files a drop carries that `accept` takes, the first alone where
`multiple` is `false`, handing them to `onfiles`, and MUST NOT call `onfiles` where it takes none.

53.20 `dropzone` with `paste` MUST take a `paste` carrying files `accept` takes as a drop, and MUST
leave a paste carrying none to the browser.

53.21 `copy` MUST write its value to the clipboard through `copyToClipboard` on a click of its
element, calling a function it was given at the click.

53.22 `copyToClipboard` MUST copy through a selected textarea where `navigator.clipboard` or `ClipboardItem`
is absent or refuses, laying every string its value holds on the `copy` event under its type.

53.23 `copy` MUST write `data-copied` on its element once a copy lands, and MUST remove it
`copiedFor` milliseconds after the last.

53.24 `chat` MUST show a message's blocks in order — words a message holds as a string as one
text block — and MUST NOT show its `tool_result` blocks among them.

53.25 `chat`'s `tool` part for a `tool_use` block MUST read its status from the `tool_result`
block naming its id: `running` before there is one, `failed` where it is an error, `done` otherwise.

53.26 `chat` MUST hold a `permission` event as one of its `permissions`, its `allowed`
`undefined`, until the next answer starts.

53.27 `chat`'s `stop_reason` MUST be the `stop_reason` of the latest answer's last `message_delta`.

53.28 `chat` MUST NOT show as the person's a user message holding only `tool_result` blocks, and
MUST leave out of its messages, once an answer ends, what 44.105 leaves out.

53.29 A `chat` message's `ends` MUST be true where it is an assistant message followed by nothing,
or by a message the person wrote.

53.30 `chat`'s `permissions`, `stop_reason` and `failed` MUST be the parts' own, and none of them
written to its messages.

53.31 `chat` MUST call `ask` for every answer it asks for — to a question sent, to one queued once
the answer before it ends, and to a `retry` — with its messages as they then stand, the question
among them as a user message, and with a `signal` of its own.

53.32 `chat` MUST fold each event `ask` streams into its messages once, as it arrives, as 44.105
accumulates it, extending the block it lands in in place.

53.33 `chat`'s `input` part MUST send on Enter, and MUST NOT on Shift+Enter or on an Enter an input
method is composing.

53.34 `chat` MUST NOT send while `disabled` is `true`, or while `draft` holds nothing 53.107 sends,
and what it is sent while an answer streams MUST be queued, shown in its composer until it is
cancelled or the answer ends, and asked once the answer ends.

53.35 `chat`'s `stop` part MUST abort the `signal` it handed `ask`, keeping what arrived and
setting `stop_reason` to `stopped`.

53.36 `chat` MUST set `failed` to the message of what `ask` threw, save where its `stop` part
aborted it.

53.37 `chat` MUST take each file its `dropzone` takes as the blocks `attach` answers for it — the
blocks `assistantMessage` makes of it where no `attach` is given — and MUST hand `onreject`, and
hold as `rejected` until the next drop, paste or pick carrying files, each file its `dropzone` turns
away (53.45) and each file `attach` throws on, adding no block for it.

53.38 `chat` MUST answer a permission prompt through `permit` with the prompt's id and the
visitor's answer, and MUST disable the prompt's buttons where `permit` is absent or the prompt is
answered.

53.39 `chat`'s `autoscroll` MUST be an `autoscroll`'s parts, and its `dropzone` a `dropzone`'s given
`accept`, every file 44.55 makes a block of where none is given, and a `paste` of `true`.

53.40 `chat`'s `transcript` part MUST carry `role="log"` and `aria-live="polite"`.

53.41 `pairing`'s `step` MUST be one of `connecting`, `slow`, `offline`, `unavailable`, `click`,
`waiting`, `install` and `paired`.

53.42 `pairing`'s `step` MUST be `paired` once `status` reports the bridge paired, `unavailable` while
`status` is failed, and `connecting` before `status` has landed.

53.43 `copy` given `selector` MUST copy on a click inside its element on an element matching
`selector`, handing that element to its function and writing `data-copied` on it, and MUST copy
nothing for a click on no such element.

53.44 `copy` MUST call `oncopied` once a click's copy has landed or failed, with whether it
landed and the element clicked.

53.45 `dropzone` MUST hand `onreject`, and hold as `rejected`, the files a drop, a paste or a pick
carries that it does not take,
`accept` refusing them or `multiple` being `false`, and MUST NOT call it where it takes every one. A
transfer whose `files` hold none carries the files in its `items`, for what it takes and turns away
alike.

53.46 A `chat` message's `retry` MUST drop every message after the last one the person wrote at or
before it, and ask again for an answer to what is left.

53.47 `chat` MUST show the messages `messages` holds, and MUST write every message it adds and
every event it folds to `messages`.

53.48 `pairing`'s `step` MUST be `slow` once it has been connecting for `slowAfter` milliseconds, and
`pairing`'s `retry` MUST take it back to `connecting`.

53.49 `pairing`'s `step` MUST be `offline` while `online` is false, whatever its status.

53.50 `autoscroll`'s `host` MUST keep the element it is spread on scrolled to its bottom as what the
element holds changes, while `following` is true.

53.51 `keyLabel` writing for an Apple platform MUST write Enter as ↩, Escape as ⎋, Backspace as ⌫,
Delete as ⌦ and Tab as ⇥.

53.52 `keyLabel.parts` MUST answer each modifier and the key `keyLabel` writes for the same binding
and options, apart and in the order `keyLabel` writes them.

53.53 `keyLabel` and `keyLabel.parts` MUST write for an Apple platform where `apple` is `true`, and
for any other where it is `false`, whatever 53.3 reads.

53.54 `copyToClipboard` MUST write a string as `text/plain`, and a record as one clipboard item holding each
MIME type the record names.

53.55 `copyToClipboard` MUST settle `false` for a value holding no string where 53.22 copies.

53.56 What a drop, a paste or a pick `dropzone` takes MUST replace its `files`, and one taking none
MUST leave them as they are.

53.57 A pick through `dropzone`'s `input` MUST be taken as a drop is, and the input MUST be emptied
after it.

53.58 `autoscroll` MUST set `following` to false when the reader scrolls its `host` further than
`threshold` pixels from the bottom, and to true when they scroll back within it.

53.59 `autoscroll`'s `jump` part MUST be hidden while `following` is true, and MUST carry
`data-unseen` once what the `host` holds changes while `following` is false, until `following` is
true again.

53.60 `Autoscroll`'s `toBottom` MUST scroll the `host` to its bottom as `behavior` names, and MUST
set `following` to true.

53.61 `carousel` MUST rest on the item `selected` names, and on its first item where `selected` names
none of them.

53.62 `carousel`'s `host` MUST align the item the carousel rests on at once when it is bound and
whenever it goes from having no box to having one, and as `behavior` names whenever the item it rests
on changes after.

53.63 `Carousel`'s `current` MUST be the key of the item the carousel rests on, until a scroll of the
`host`, `scrollTo` or `reset` sets it, and again whenever the item it rests on changes or 53.62
aligns it on the `host` getting a box.

53.64 A scroll of `carousel`'s `host` MUST set `current` to the key of the item whose point 53.99
aligns is nearest the host's point it aligns to, measured at most once a frame, save where 53.66 sets
it.

53.65 While a scroll `scrollTo`, `reset` or a change of the item `carousel` rests on started is on its
way, what the `host`'s scrolling passes MUST NOT set `current`, until it reaches where aligning that
item leaves the host or a `scrollend` arrives.

53.66 Once `carousel`'s `host` has dispatched a `scrollsnapchanging` or a `scrollsnapchange`,
`current` MUST be set from those events alone, to the key of the item whose element is, holds or is
held by the event's snap target.

53.67 `carousel`'s `previous` and `next` MUST scroll as `scrollTo` does to the nearest item before
and the nearest item after the current one that aligning leaves the `host` somewhere other than
aligning the current one does, and MUST be disabled where there is no such item. Where `loop` holds,
the item before the first MUST be the last and the item after the last the first.

53.68 `Carousel`'s `scrollTo` MUST set `current` to the key it is handed and align that key's item
as `behavior` names, and `reset` MUST do so for the item the carousel rests on.

53.69 `carousel`'s `item` MUST carry `data-current` while it is current, and `data-selected` while
`selected` names it.

53.70 `carousel`'s `host` MUST carry `role="region"` and `aria-roledescription="carousel"`, and its
`item` MUST carry `role="group"`, `aria-roledescription="slide"` and its label as `aria-label`.

53.71 While `carousel` rotates, it MUST step to the item `next` steps to every `autoplay`
milliseconds, counted afresh whenever `current` changes.

53.72 Where `next` is disabled when 53.71's time comes, `carousel` MUST write `false` to `playing`
rather than step.

53.73 `carousel` MUST rotate only while `playing` holds, `autoplay` is given, and its `host` is bound
and has a box, save where 53.74 holds it still.

53.74 `carousel` MUST NOT rotate while a pointer is over, or focus is inside, its `host`, `previous`
or `next`.

53.75 `Carousel`'s `playing`, where none is given, MUST start as whether `autoplay` is given.

53.76 `carousel` MUST write `false` to `playing` whenever `media('(prefers-reduced-motion: reduce)')`
comes to hold, and at once where it holds already.

53.77 `carousel`'s `play` part MUST be a `toggle`'s `button` over `playing`, and pressing it to play
where `next` is disabled MUST scroll to the first item first.

53.78 `carousel`'s `host` MUST carry `aria-live="off"` while it rotates, and no `aria-live` otherwise.

53.79 `copy` given no `value` MUST copy the element clicked as one item holding its `textContent` as
`text/plain` and its `innerHTML` as `text/html`.

53.80 `resizable`'s `panel` part MUST be `size` pixels along `axis` where `size` is a number, and MUST
write no size where it is `undefined`.

53.81 A pointer pressed on `resizable`'s `handle` and moved MUST move `size` by as far as the pointer
moved along `axis`, growing the panel as the handle moves away from it toward `edge`.

53.82 `resizable` MUST keep `size` no less than `min`, no more than `max`, and, where `keep` is
given, no more than the panel's parent holds along `axis` less `keep`, measured as a drag or a key
begins.

53.83 On `resizable`'s `handle`, the arrow keys along `axis` MUST move `size` by `step` as the handle
would move, Home and End MUST set it to the least and the most 53.82 allows, and the arrow keys
across `axis` MUST NOT move it.

53.84 Enter on `resizable`'s `handle` MUST set `size` to `min`, and the next Enter MUST set it back to
what it was.

53.85 A double click on `resizable`'s `handle` MUST write `undefined` to `size`.

53.86 `resizable`'s `handle` part MUST carry `role="separator"`, `aria-orientation` across `axis`,
`aria-controls` naming the panel's id, `aria-valuenow`, `aria-valuemin` and `aria-valuemax` naming
`size`, `min` and `max`, `tabindex="0"`, and `data-dragging` while a pointer drags it.

53.87 `shrinkImage` MUST answer a `File` no larger than `maxEdge` on its longer edge, turned as its
EXIF says, written as `type`, or as the file's own type where that is JPEG or WebP and as JPEG where
it is not, under the file's name with that type's extension, alike where Bun runs and in a browser.

53.88 `shrinkImage` given `maxBytes` MUST lower the quality it writes at and then its size until it
takes no more than `maxBytes`, save for PNG, whose size it MUST NOT lower for bytes.

53.89 `shrinkImage` MUST answer a file already within `maxEdge` and `maxBytes`, of `type`, and
carrying none of the metadata 53.102 names as it is, written again by nothing.

53.90 `download` MUST save `data` as a file named `name`, as a click on a link to it in the
document with that `download` would, text written as `type`, the link's address standing until the
save has read it.

53.91 `download` MUST throw where `isServer` is true.

53.92 `panZoom`'s `content` part MUST move its element by `view`'s `x` and `y` and magnify it by its
`k`, about its top left corner.

53.93 A wheel on `panZoom`'s `surface` with Ctrl or ⌘ held MUST magnify by the wheel about the
pointer, the content under the pointer staying under it, and a wheel without MUST move it by the
wheel's deltas; each MUST prevent the wheel's default.

53.94 One pointer pressed on `panZoom`'s `surface` and moved MUST move it as far as the pointer moved,
and two MUST magnify it by the change in the distance between them about their middle, and move it as
their middle moved.

53.95 `panZoom` MUST keep `view`'s `k` from `min` to `max`.

53.96 On `panZoom`'s `surface`, `+` and `=` MUST magnify it a step and `-` shrink it a step about the
surface's middle, the arrow keys MUST move it, and `0` MUST set `view` to no move and no
magnification.

53.97 `panZoom`'s `fit` MUST set `view` so the box it is handed fills the surface less `margin` on
each side, centered, its magnification kept from `min` to `max`.

53.98 A double click on `panZoom`'s `surface` MUST magnify it twice about the pointer.

53.99 `carousel` MUST align an item by scrolling its `host` until the item's start, center or end,
as `align` names and as the host's direction reads them, meets the same point of the host's box less
its border, its scrollbar and its `scroll-padding`, or as near that as the host scrolls.

53.100 A scroll or a snap of `carousel`'s `host` MUST NOT set `current` to an item that aligning
leaves the host where aligning the current one does.

53.101 A scroll that `scrollTo`, `reset` or a change of the item `carousel` rests on starts, and that
leaves the `host` where it already is, MUST NOT be on its way in 53.65's sense.

53.102 `shrinkImage` MUST answer a `File` carrying none of the EXIF, XMP, IPTC, comment or text
metadata of the file it is handed.

53.103 `copyToClipboard` MUST settle `true` once its value is on the clipboard, and `false` where
`navigator.clipboard` and 53.22's copy both leave it off, and MUST NOT reject for a refusal.

53.104 `copyToClipboard` MUST reject where `isServer` is true.

53.105 `chat`'s `input` part MUST show the text blocks of `draft` that `attach` did not make, a line
break between each two, and an edit of it MUST write its text to `draft` as one text block standing
where the first of those stood, or last where there was none, leaving every other block of `draft`
where it stood.

53.106 `chat` MUST append the blocks `attach` answers for a file to the end of `draft` as they land,
file after file in the order taken, and its `attached` MUST be every block of `draft` its `input`
part does not show.

53.107 `chat` MUST send `draft` — through its composer, an Enter (53.33) and `submit` alike — as a
user message of its blocks in order, less each text block holding only whitespace, once it has set
`draft` to a user message holding no block, and MUST send nothing where `draft` refuses that write
(49.19).

53.108 `chat`'s `attaching` MUST be true while an `attach` call has not settled, and a send while it
is true MUST be held, and made once every call has settled.

53.109 `chat`'s `calls` of an `Rpc` MUST be the calls 44.51 finds in its messages for that `Rpc`, in
order, each with its `tool_use` block's `input` as it stands, the value 44.106 reads, whether its
result is an error, and `streaming` while an answer streams and no `tool_result` answers it.

# 54. Guards, fetches and jobs

## Rungs

54.1 `signedIn` MUST answer a caller whose `principal.authenticated` is false with a refusal named
`SignedOut`, at status 401, and MUST hand any other caller to `next`.

54.2 `authorize` MUST answer a caller whose `principal.resolved` is not authenticated as
`signedIn` does, before it reads anything else of it.

54.3 `authorize` given an object MUST admit a caller whose `principal.resolved` holds it as 13.12
reads holding, and given a function MUST admit a caller whose `principal.resolved` it answers true
for.

54.4 `authorize` MUST answer an authenticated caller it does not admit with a refusal named
`Forbidden`, at status 403, carrying the `message` it was given.

54.5 `readOnly` MUST hand a `GET`, a `HEAD` or an `OPTIONS` request to `next`, and MUST answer a
request of any other method with a refusal named `ReadOnly`, at status 403, save one 54.6 admits.

54.6 `readOnly` MUST hand to `next` a request addressed to the `rpc.address` of a handler its
`allow` lists.

## Fetches

54.7 `fetchAndHandle` MUST abort an attempt not answered within `timeout` milliseconds,
10000 where none is given.

54.8 `fetchAndHandle` MUST ask again, up to `retries` times, after an attempt that threw,
that 54.7 aborted, or that was answered at a status 15.19 counts transient, and MUST NOT ask again
after an attempt answered at any other status.

54.9 `retries` MUST default to 2 for a method RFC 9110 defines as idempotent, and to 0 for any
other.

54.10 A retry under 54.8 MUST wait `backoff` milliseconds, 250 where none is given, doubled for each
retry before it — or, where `backoff` is a function, what it answers given the retry's number counted
from 1 — or the time the answer's `Retry-After` names, in seconds or as an HTTP date, where that is
later, and MUST NOT be made where that wait is longer than `timeout`.

54.11 An abort of the `signal` a caller passes `fetchAndHandle` MUST be thrown as its
reason, and MUST NOT be asked again.

54.12 `fetchAndHandle` MUST reject with a `FetchFailed` at status 502 where it gives up, carrying the
status the last attempt was answered at, or null where none answered, and why, and MUST reject with
nothing else but 54.11's abort.

54.13 `fetchAndHandle` MUST read a 2xx body as 54.26, 54.28 and 54.29 say, save where `as` names a
reading — `json` parsed as JSON, `text` as its text, `blob` as a `Blob`, whatever
its type says — and MUST settle to a `FetchFailed` for the reason `shape` where its `schema` refuses
what was read.

## Jobs

54.14 A `job` MUST look whether a run is due every `every` milliseconds where `every` is a number
under a minute, and every minute otherwise, each look that long after the one before it ended, from a
first look made where `App.listen` or `abide dev` opens the app, and MUST stop looking where
`App.stop` begins, before it drains what is in flight.

54.15 A look MUST start a run of a `job` given `every` where no run has ended, or where `every` milliseconds have
passed since the last one ended, or since it started under 54.25.

54.16 `Job.run`, and a look, MUST join a run of the `job` in flight, and MUST NOT start a second; the
input a `Job.run` that joined one was called with MUST NOT reach any run.

54.17 A `job` given a `store` MUST keep its status there, and MUST read it once, on its first look,
reading the `lastRun` it holds as a run that ended then.

54.18 `Job.status` MUST be one `global` `memo` entry the job writes, as a run starts and as it ends.

54.19 A run that throws MUST be written through `log.error` under the namespace `log.named` builds
from `job` and, where it is given, the job's `name`, and its message MUST stand as `lastError`
until a run ends without throwing.

54.20 A run whose signal 54.22 aborted MUST NOT move `lastRun` or `lastError`.

54.21 A `job` whose `every` is not a positive number MUST start no run from a look, and its
`nextRun` MUST be null while it is not.

54.22 `run` MUST be handed the input the `Job.run` that started it was called with, and `undefined`
where a look started it, and a run's signal MUST be one aborted where 7.20's is, and where `Job.stop`
is called.

54.23 `Job.stop` MUST settle once a run in flight has ended, and a `job` it stopped MUST start no
run, from a look or from `Job.run`, and MUST hold `nextRun` null.

54.24 `authorize` given `status: 404` MUST answer an authenticated caller it does not admit with
the refusal 15.7 answers an address nothing serves, naming the path and method of the request.

54.25 A `job` given `from: 'start'` MUST measure `every` from when its last run started, and its
looks MUST be spaced from when each started rather than from the end of the run it started.

54.26 `fetchAndHandle` MUST answer a 2xx response with its body read as its `content-type` says: JSON, or
a type ending `+json`, as its parsed value, and a type 54.28 and 54.29 do not name as a `Blob`.

54.27 `fetchAndHandle` MUST reject a response outside 2xx with a `FetchFailed` carrying its status, the
reason `status`, and as its `cause` its body read as 54.26 and 54.29 read one — a stream, and JSON
that does not parse, as its text — where the body is 65,536 bytes or fewer, and no `cause` where it is
longer; and MUST reject a 2xx response whose JSON does not parse with one for the reason `shape`
whose `cause` is what the parse threw.

54.28 `fetchAndHandle` MUST answer a JSON Lines or event stream response with an async iterable of its
chunks, each yielded as the frame carrying it completes.

54.29 `fetchAndHandle` MUST answer a `text/` type, and a response naming no type, as its text, and a
204 or a response with no body as `undefined`.

54.30 A `FetchFailed` that `fetchAndHandle` rejects with for a thrown attempt MUST carry what
was thrown as its `cause`, one for an attempt answered outside 2xx the body 54.27 reads, and Problem
Details MUST NOT carry a `cause`.

54.31 `trustedIdentity` MUST sign in, for the request it runs in, the caller its `header` names on a
request from one of its `proxies`, as the claims `claims` makes of the header's value, as `App.run`'s
`principal` does (42.19).

54.32 `trustedIdentity` MUST read the peer a request came from as `request.ip` answers it, and MUST
ignore its `header` on a request from a peer none of its `proxies` names, and on one made in
process.

54.33 `trustedIdentity` MUST seal no cookie, and MUST pass a request whose `header` is absent or
empty as it came.

54.34 A look MUST NOT start a run of a `job` while its `paused` reads true, and `Job.run` MUST run
it all the same.

54.35 A `job`'s run MUST run outside every request and every `memo` run, whichever started it, and
`abortSignal` called in it, outside every run 7.22 and 7.24 name and every request entered in it,
MUST answer the run's signal 54.22 names.

54.36 A look MUST start a run of a `job` given `cron` once a time `cron` names has passed since its
last run ended, or since its first look where no run has ended, and MUST start one run however many
such times have passed; such a `job` MUST look every second, and its `nextRun` MUST be the first time
`cron` names after the last run ended, or after its first look.

54.37 A `job` MUST read `cron` in the zone `timeZone` names, and in the server's own where it names
none.

54.38 `job` MUST throw a `TypeError` where it is given both `every` and `cron`, or neither, and MUST
throw where `cron` is not an expression `Bun.cron.parse` reads.

54.39 `Job.run` MUST reject with what the run it started or joined threw, or with the refusal it
answered, and a run answering a refusal MUST be written and logged as one that threw (54.19).

54.40 `fetchAndHandle.isError` MUST answer whether a caught failure is a refusal named as it is given, and
MUST narrow it to a `FetchFailed` where it is.

54.41 A run of a `job` that ends MUST record in its status how long it took, in milliseconds, and a run
that did not fail MUST record what it answered as `lastResult`, which a failed run MUST leave as it
was; a run told to stop MUST record neither.

54.42 A `job` opening on a status its `store` kept MUST read it as no run going, and MUST keep the
`lastResult` and `lastError` it holds.

54.43 `App.stop` MUST wait on the run each `job` has in flight, once the requests in flight have
drained, before `onStop` runs and within 42.17's deadline.

54.44 A `job` given `delay` MUST make its first look `delay` milliseconds after the app opens, rather
than as it opens.

# 55. Worker files

55.1 An import of a worker file MUST answer each export with a function running that export in the
file's thread, on a server, in a browser and in the executable `abide compile` writes alike.

55.2 An argument or an answer the structured clone algorithm refuses MUST reject its call, and MUST
NOT end the thread.

55.3 A worker file exporting anything but an `async function` or an `async function*` declaration
MUST be a build error naming the file and the export.

55.4 Every call to a worker file's export MUST run in a thread of its own, started for that call.

55.5 A call to an `async function*` export MUST answer an async generator running the export's
generator one chunk for each chunk read, and returning what it returned.

55.6 An `AbortSignal` among a call's arguments MUST reach the export as a signal aborted whenever, and
from whenever, the one passed is.

55.7 A consumer ending a stream before it is done MUST end the export's generator, its `finally`
included.

55.8 A thread MUST end where the signal `abortSignal` answers where its call was made aborts, 7.20's
among them, rejecting its call with that abort.

55.9 A thread that fails outside its export MUST reject its call.

55.10 A worker file imported in a thread MUST be the module itself.

55.11 A thread MUST end once its call has settled, or once its stream has ended.

55.12 A call to an `async function` export MUST settle as the export's promise settles: to its value,
or rejected with what it rejected with.

55.13 A worker file no module of the browser's graph imports MUST NOT be built into the client bundle.

55.14 A worker file's import MUST answer each export with a function declaring a parameter where the
export declares one, and carrying the literal defaults 11.29 reads off the export's.

# 56. Forms

56.1 `form` MUST read the args of a submit off the `<form>` submitted as a post carries them, a name
given more than once a list, each coerced as 19.7 coerces text args.

56.2 A submit of a `form` MUST check the args 56.1 reads against its handler's args document (19.28),
and MUST NOT call the handler where the check finds an issue.

56.3 A `form` whose handler has no args document MUST call it unchecked.

56.4 A `form`'s issues MUST be what its last check found, or, where no check has run since it last
called its handler, the issues of that call's `ValidationError` (15.8).

56.5 A submit of a `form` while its last call is in flight MUST NOT call its handler again.

56.6 A `form` MUST move focus to the first field of its `<form>`, in document order, whose name has a
message, at a submit its check refuses and once a call it made is refused.

56.7 An edit of a `form` showing issues MUST check its fields again, and its issues MUST become what
that check finds.

56.8 A `form` over a `POST` MUST write `method="post"` on its `<form>`, and the handler's address as
its `action`.

56.9 The `input` of a `form`'s `field` MUST carry `aria-invalid="true"` while its field has a message,
and MUST name the element its `error` writes the id of in `aria-describedby`.

56.10 The `error` of a `form`'s `field` MUST be `hidden` while its field has no message, and the
form's own `error` while the form has none.

56.11 `form`'s `submit` MUST be disabled while the form's last call is in flight.

56.12 A `form` whose `<form>` holds a file in a field MUST throw at its submit, naming the field.

56.13 A `form`'s `message` MUST be the first of its issues no field owns, those under `''`, and a
`field`'s `message` the first of that field's.

56.14 A `form`'s baseline for a field MUST be what a reset of its `<form>` restores the field to: its
`value` attribute, its `checked` attribute, or the option its options' `selected` attributes choose.

56.15 A `form` MUST read a field rendered with no `value` attribute as having a blank baseline, and
the field cleared as equal to it.

56.16 A `form`'s `dirty` MUST be whether any field of its `<form>` differs from its baseline, and a
`field`'s `changed` whether a field posting under its name does.

56.17 A `form`'s `changes` MUST be the args 56.1 reads, holding only the members whose field differs
from its baseline.

56.18 A `form` MUST read its fields against their baseline again at each edit, and MUST read none as
differing once its `<form>` is reset.

56.19 A call a `form` makes that answers without a failure MUST move each field's baseline to what the
field held when the call was made.

56.20 The `form` part of a `form` MUST carry `data-dirty` while the form is dirty.

56.21 The `input` of a `form`'s `field` MUST carry `data-changed` while its field is changed.

56.22 A `form`'s `reset` MUST be a reset button, disabled while the form is not dirty.

56.23 An edit of a `form` MUST NOT wake a reader of `dirty`, or of a `field`'s `changed`, whose answer
the edit leaves.

56.24 A click on `inlineEdit`'s `view` MUST start an edit: `editing` holding, the `view` hidden and the
`input` shown, holding `value`, focused and its text selected.

56.25 Enter in `inlineEdit`'s `input`, and the input losing focus, MUST end the edit by calling `save`
with its text, waiting on a promise it answers, and only then writing the text to `value`; a text
that is `value` already MUST end it without calling `save`.

56.26 A `save` that rejects MUST leave `inlineEdit` editing and `value` as it was, with `error` naming
the rejection's message; while a `save` is in flight, `busy` MUST hold and the `input` MUST be
disabled.

56.27 Escape in `inlineEdit`'s `input` MUST end the edit without calling `save` or writing `value`.

56.28 An edit of `inlineEdit` ending MUST move focus to its `view`.

56.29 `spinbutton`'s `input` part MUST carry `role="spinbutton"`, `aria-valuenow` naming `value`,
`aria-valuemin` and `aria-valuemax` naming `min` and `max` where each is given, and `value` as its
text.

56.30 In `spinbutton`'s `input`, ArrowUp and ArrowDown MUST move `value` by `step`, PageUp and PageDown
by ten steps, and Home and End to `min` and `max` where each is given, kept from `min` to `max`.

56.31 `spinbutton`'s `increment` and `decrement` MUST move `value` by `step`, MUST stand outside the tab
order, and MUST be disabled where `value` is at `max` and at `min`.

56.32 A `change` of `spinbutton`'s `input` MUST set `value` to the number its text holds, kept from `min`
to `max` and to a whole number of steps from `min`, or from `0` where `min` is not given, and MUST
write `value` back as the input's text, a text that is no number leaving `value` as it was.

56.33 An `input` of `spinbutton`'s `input` MUST set `value` to the number its text holds where 56.32
would keep that number as it is and would write back the text as it stands, and MUST otherwise leave
both `value` and the text as they are until a `change`.

# 57. Pipes

57.1 `pipe` MUST hand an item to its first step, and each later step what the step before it
answered.

57.2 A step that is a list MUST hand each of its members the same input, run them at once, and
answer the list of their answers in its members' order, or the first refusal one of them answered.

57.3 `pipe` MUST throw at construction where a step that is a list holds a list.

57.4 A `pipe` step that answers an async iterable MUST hand each value it yields to the steps after
it as an item of its own, in the order yielded.

57.5 A `Pipe` called MUST answer a promise of its last step's answer, or where a step 57.4 reads
ran, of the list of every answer its last step made, in order; a step answering a refusal, or
rejecting with one, MUST end the item and reject the promise with that refusal, and a step that threw
past 57.9 MUST end it and reject the promise with what it threw.

57.6 A `pipe` MUST run at most `concurrency` items at once, 1 where none is given, starting a
waiting item in the order it came.

57.7 Where `group` is given, 57.6's count MUST be kept for each group `group` answers.

57.8 A `pipe` MUST count every item it runs under 57.6, whether called by an app or as a step of
another `pipe`.

57.9 An attempt of a step that throws, that answers a refusal 15.19 counts transient, or that 57.12
aborts MUST be made again, up to `retries` times, 0 where none is given; any other answer MUST NOT
be.

57.10 A step's attempt made again under 57.9 MUST wait as 54.10 has a fetch's retry wait, from the
step's `backoff`.

57.11 A refusal with a `Retry-After` MUST keep its step from starting an attempt, for every item of
the `pipe`, until the time it names.

57.12 An attempt MUST be aborted once it runs past `timeout` milliseconds.

57.13 A step MUST be handed a signal that aborts where its attempt is aborted, where the signal the
`Pipe` was called with aborts, where `stop` is called, and where the signal `abortSignal` answers
where its call was made aborts.

57.14 A `pipe` step 57.4 reads MUST NOT be attempted again once it has yielded.

57.15 On a `Pipe`'s `readable`, an item 57.5 would reject MUST leave as a refusal at status 500
carrying the message it threw, and the stream MUST run on.

57.16 Where `ordered` is true, the default, a `Pipe`'s `readable` MUST hand on each item's answers
in the order the items were written.

57.17 While `paused` reads true a `pipe` MUST start no attempt, and attempts in flight MUST run on.

57.18 `stop` MUST abort every attempt in flight, refuse every item not yet run and every later call,
and settle once the attempts in flight have ended.

57.19 Closing a `Pipe`'s `writable` MUST close its `readable` once every item written has left.

57.20 A write to a `Pipe`'s `writable` MUST settle only once the item has started under 57.6.

57.21 `status` MUST be one `global` `memo` entry counting the items waiting, running, done and failed, and
whether `paused` reads true.

# 58. Ledgers

58.1 Each call to `ledger` MUST answer a `Ledger` of its own, sharing entries with another only
through a `store` both were given.

58.2 `append` MUST keep its entry after every entry kept before it, numbered one past the last, and
settle to that number.

58.3 An entry a `ledger`'s `schema` refuses MUST be kept nowhere, and `append` MUST reject.

58.4 `append` given a `key` an entry still kept was appended under MUST keep nothing, and settle to
that entry's number.

58.5 A `Ledger` called MUST answer a stream handing on, in order, every entry numbered past `from`, 0
where none is given, and past the last entry MUST wait for the next rather than end.

58.6 A `Ledger` called with a `cursor` MUST start past the entry the cursor was last moved past, and MUST move
the cursor past an entry once its reader asks for the next.

58.7 An entry written to a `Ledger`'s `writable` MUST be appended as `append` appends it.

58.8 A `ledger` MUST NOT read its `store` before it is appended to or read, and MUST NOT hold a copy
of the entries its `store` keeps.

58.9 A `ledger` given a `store` MUST keep its entries and its cursors there, and `store.sqlite`,
`store.indexedDB` and `store.redis` MUST each keep one record per entry, and MUST each make an
`appendAt` that finds the last number moved from the one it expected append nothing.

58.10 Where `retain` is given, an append MUST let go of every entry but the last `retain`.

58.11 `ledger` given a `retain` under 1 MUST throw at construction.


58.12 A `ledger` whose `store` reports a change through its `watch` MUST read its last entry's
number again, and MUST hand its waiting reads what the change appended.

58.13 `store.redis` MUST look up an append's key, number its entry and keep it as one step on the
server.

58.14 Where `ttl` is given, an entry MUST be let go once `ttl` milliseconds have passed since it was
appended, and a read MUST NOT hand on an entry let go.

58.15 A read that would hand on an entry numbered more than one past the last it handed on MUST
error with a refusal at status 410 naming the entries it missed; a read from 0, or from a cursor
never moved, MUST start at the oldest entry kept.

58.16 An entry a `ledger` lets go MUST take the key it was appended under with it.

# 59. Options

*Free-standing: these clauses govern every option, of every name that takes one, which no one
REGISTRY row names.*

59.1 An option given `undefined` MUST be read as an option not given.

59.2 Every option's type MUST accept `undefined`.
