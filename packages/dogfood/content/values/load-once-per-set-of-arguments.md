---
title: Load once per set of arguments
nav: Caching
intent: Two components asking for the same thing should be one load, not two.
covers:
  - memo › `Args`
  - `memo` body, keyed
  - `global`
  - `tags`
examples:
  - packages/dogfood/examples/cache-shared
  - packages/dogfood/examples/cache-canonical
  - packages/dogfood/examples/cache-tags
---

A tile shows the week's orders. Another below it shows the average. Both need the same seven days,
neither knows about the other, and the usual repair is to lift the fetch somewhere both can reach
and thread it back down as a prop. A keyed memo is that repair with nothing lifted: **identity per
arguments**.

## The two forms, and which one caches

There is a cache at all because the body takes args, and the discriminant is exactly that.

| You write | What you get |
| --- | --- |
| `memo(() => …)` | tracked, one value, re-run by what it read |
| `memo((args) => …)` | **untracked**, one entry per args key, held |

A keyed memo does not re-run because something its body read moved — its ways back are `ttl`, an
explicit `invalidate` or `refresh`, and eviction. The two are different shapes rather than one
shape with an option, and every signature is in the [`memo` reference](../reference/memo.md).

Calling it hands back a `Reactive` for that key, so the probes and the triggers are on the result:
`metricsFor({ range }).pending()`, not `metricsFor.pending()`.

## A memo's cache is one entry per args key

{% example cache-shared %}

*1 request, 2 readers* — against lifting the fetch to a common parent and threading it back down.

Neither tile can reach the other, and the range each is on is the whole of what decides whether
they share. On one range they are one entry, so the second tile to arrive there paints with no
load and the record's own count stays where it was; on two ranges they are two entries and each
pays for its own.

The first paint is the case a hand-written table usually gets wrong, and it is the one the reader
never causes: both tiles ask on the same tick, so the second gets **the load already in flight**.
Holding the answer stops a second load only once the first has landed. What goes into the table
has to be the entry, put there before the answer arrives.

Read on: [Derived values](derive-a-value-from-other-values.md) ·
[Reloading](decide-when-a-value-reloads.md)

## Two reads share an entry when their args canonicalize the same

{% example cache-canonical %}

Three spellings and one entry: the first two differ in argument order, the third writes out an
option that is absent. None of them is a second request, and the region beside them is what the
same rule looks like from the other side — a value that genuinely differs is a key that genuinely
differs, and coming back to `north` is the entry still held.

That is the cache's whole question, and the answer is the wire. `Args` is a
`Record<string, JsonValue>`, serializable by contract, because **the key is the wire form**. An
args object becomes a key by its canonical serialization, which is the same canonicalization the
transport uses.

| You write | The key it lands on |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` — sorted, so argument order never splits an entry |
| `{ id: '42', after: undefined }` | `{"id":"42"}` — dropped, so an absent option is the same entry as an omitted one |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` — ISO |

One canonicalization rather than two: args that cannot be keyed are exactly args that cannot be
sent, so both fail in the same place. The key is therefore **structural**, and
`memo(() => getMetrics({ range }))` builds a fresh object on every run and still lands on the same
entry — which is what makes the identity cutoff hold, so a recompute onto a key already held wakes
nobody and shows no spinner.

Args are always plain args. A reactive value in an argument position **reads**; making the call
follow that value is the enclosing unkeyed memo's job.

## A memo's cache is request-local on a server, process-local in a browser

One scope is one caller on both sides, and only what counts as a caller differs.

| | server | browser |
| --- | --- | --- |
| a caller is | one request | the one person at the tab |
| the cache is built | when the request arrives | when the app starts |
| and dropped | when the response is sent | when the tab closes |
| `ttl: Infinity` means | to the end of that request | to the end of that session |

It follows that it is built and dropped with its scope. `ttl: Infinity` means to the end of that
scope rather than forever, the cache cannot grow without bound, and one caller's answer can never
be served to another. Coalescing is within a scope too: two calls inside one request share one
load; two concurrent requests are two scopes and load twice.

## `global` shares one cache across callers

`global: true` opts into a process-wide cache that outlives every request, and it is the only
thing that makes two **callers** one load — which is its job where the load is expensive. No card
on this page shows it, because a card is one browser tab and the thing `global` changes is what a
second caller gets.

It also decides what the answer says about caching. An rpc answer is `private, no-store` by
default; a `GET` over a global memo answers `private, max-age=<the ttl>` instead, because those
are one number and writing it twice in two units is how they come apart.

**The directive stays `private`, and widening it is yours.** `global` guarantees the answer does
not vary by caller, a global body being unable to read the request scope. Whether a **shared**
cache may hold it is a different question — about who may reach the endpoint rather than about
what it returns — and abide cannot read that off a middleware rung. An endpoint that really is
open says `public` in its own `ResponseInit`.

Two costs, and both are yours rather than abide's.

**A global body may not read the request scope.** `request()`, `principal`, `cookies()`,
`csp.nonce()` and `route` are a build error inside one, and the error names the ambient. An entry
outlives the request that built it and is served to every caller after it, so a request ambient in
the body bakes the first caller's request into everybody's answer. Anything caller-specific belongs
in the `Args` instead, where it keys an entry rather than hiding in one. That refusal also lets the
`cache-control` be derived rather than trusted: the answer is not about who asked because the shape
that would make it so does not compile.

And a global memo is bounded by its own `ttl` and the app's `invalidate` and by nothing else. There
is no byte ceiling and no eviction count: measuring an arbitrary value costs an O(size) walk, and
an LRU would evict an entry a reader is mid-flight on. `global: true` with `ttl: Infinity` is an
unbounded cache — unbounded because the app asked for it, the bound being a number the app knows
and abide does not.

A global memo over a stream fans one producer out to many readers, and the one thing it needs is
`tail: Infinity` — otherwise a reader arriving mid-stream replays one chunk and goes live, which is
a truncated answer rather than an error.

Read on: [History & tail](keep-the-last-few-values.md) ·
[Auth & principal](../app/know-who-is-calling.md) ·
[Authorization](../server/decide-who-may-call-what.md) ·
[Response types](../server/answer-with-something-other-than-json.md)

## `tags` invalidate entries across memos

{% example cache-tags %}

`tags` is the only thing that reaches **across** memos. An entry carries them, and a selection
matches on them. The function form receives the memo's args, so a tag can name the **row** rather
than the query — which lets `invalidate({ tags: ['region:north'] })` reach every entry about that
region without knowing which memos those were. Any other memo declaring the same tag joins the same
selection, in any file.

So one press moves two numbers that came from two different handlers, and the row underneath does
not move at all: it declares `region:south`, and a selection is as much what it leaves alone.

The hand-written arm is where that costs something. An entry table alone cannot answer "everything
about north", so the tags are a second index beside it, and every entry has to be added to both or
a later invalidate quietly misses it.

A tag is scoped the way a memo is: request-local on a server, process-local in a browser. One
request can never invalidate another's.

Read on: [Reloading](decide-when-a-value-reloads.md) ·
[Mutations](../server/change-something-on-the-server.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — `ttl`, `invalidate`, `refresh` and selections
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — capping how often an entry revalidates
* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` over a memo you named yourself
