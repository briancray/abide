---
title: Caching (inverted pyramid)
nav: Caching, inverted pyramid
intent: The caching guide as newspaper wire copy — the whole story in the first sentence.
examples:
  - packages/dogfood/examples/caching
---

> **Style — inverted pyramid.** News writing. The lede carries the entire story; every section
> below it is ordered by descending importance and can be cut from the bottom without breaking
> what remains. Nothing refers backwards, because a reader may have entered anywhere.

Two components that ask for the same thing are **one load**. A memo whose body takes arguments
is keyed: one cache entry per set of arguments, computed on the first read of that key and held.
A sidebar and a panel that both need customer `42` therefore share the request already in
flight, with nothing lifted to a common parent and nothing threaded back down.

{% example caching %}

*1 request, 2 readers.*

## Two reads share an entry when their arguments canonicalize the same

That is the cache's whole question, and the answer is the wire. `Args` is a
`Record<string, JsonValue>`, and an args object becomes a key by its canonical serialization —
the same canonicalization the transport uses.

| You write | The key it lands on |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` — sorted, so argument order never splits an entry |
| `{ id: '42', after: undefined }` | `{"id":"42"}` — dropped, so an absent option is the same entry as an omitted one |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` — ISO |

The key is therefore **structural**, so a body that builds a fresh args object on every run still
lands on the same entry.

## A body that takes arguments is keyed

The discriminant is exactly that. A keyed memo gets one entry per args key; an unkeyed one is the
tracked shape. They are two shapes rather than one shape with an option.

{% snippet caching src/server/rpc/customers.ts const customerById %}

A keyed memo is **untracked**: it does not re-run because something its body read moved. Its ways
back are `ttl`, an explicit `invalidate` or `refresh`, and eviction.

## The probes and the triggers are on the result

Calling a keyed memo hands back a `Reactive` for that key, so it is
`customerById({ id }).pending()` and never `customerById.pending()`.

{% snippet caching src/ui/components/Plan.abide const customer %}

A reactive value in an argument position **reads**. Making the call follow that value is the
enclosing unkeyed memo's job, which is what the wrapper above is doing.

## A cache is request-local on a server and process-local in a browser

One scope is one caller on both sides, and what differs is only what a caller is there.

| | server | browser |
| --- | --- | --- |
| a caller is | one request | the one person at the tab |
| the cache is built | when the request arrives | when the app starts |
| and dropped | when the response is sent | when the tab closes |
| `ttl: Infinity` means | to the end of that request | to the end of that session |

So the cache cannot grow without bound, and one caller's answer can never be served to another.
Coalescing is within a scope too: two calls inside one request share one load, and two concurrent
requests load twice.

## `global: true` shares one cache across callers

It is the only thing that makes two callers one load, which is what it is for where the load is
expensive.

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

Switching customers in the example loads a second customer and never touches the rate.

## A global body may not read the request scope

`request()`, `principal`, `cookies()`, `csp.nonce()` and `route` are a build error inside one, and
the error names the ambient. An entry outlives the request that built it, so a request ambient in
the body would bake the first caller's request into everybody's answer. Anything caller-specific
belongs in the `Args`, where it keys an entry instead of hiding in one.

## A global memo's `cache-control` is derived from its `ttl`

An rpc answer is `private, no-store` by default. A `GET` over a global memo answers
`max-age=<the ttl>` instead, because those are one number and writing it twice in two units is how
they come apart.

**The directive stays `private`.** `global` says the answer does not vary by caller; whether a
shared cache may hold it is a question about access, and no rung can be read for it. A browser may
hold it for the `ttl` and a CDN may not, and an open endpoint says `public` for itself.

That derivation is trustworthy only because of the refusal above: the answer is not about who
asked, because the shape that would make it so does not compile.

## `tags` invalidate entries across memos

`tags` is the only thing that reaches **across** memos. An entry carries them, and a selection
matches on them:

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

The function form receives the memo's args, so a tag can name the **row** rather than the query.
`invalidate({ tags: ['customer:42'] })` then reaches every entry about customer `42` without
knowing which memos those were, in any file.

A tag is scoped the way a memo is, so one request can never invalidate another's.

## A global cache is bounded by its `ttl` and nothing else

There is no byte ceiling and no eviction count: measuring an arbitrary value costs an O(size)
walk, and an LRU would evict an entry a reader is mid-flight on. `global: true` with
`ttl: Infinity` is an unbounded cache, because the app asked for it — the bound being a number the
app knows and abide does not.

## A global memo over a stream needs `tail: Infinity`

Otherwise a reader arriving mid-stream replays one chunk and goes live, which is a truncated
answer rather than an error.

## Next

* [Reloading](../values/decide-when-a-value-reloads.md) — `ttl`, `invalidate`, `refresh` and selections
* [Throttle & debounce](../values/slow-down-a-value-that-changes-too-fast.md) — capping how often an entry revalidates
* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` over a memo you named yourself
