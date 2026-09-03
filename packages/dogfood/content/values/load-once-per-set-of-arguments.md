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
  - packages/dogfood/examples/caching
---

A sidebar shows a customer's name. A panel below it shows their plan. Both need customer `42`,
neither knows about the other, and the usual repair is to lift the fetch somewhere both can reach
and thread it back down as a prop.

A keyed memo is that repair with nothing lifted: **identity per arguments**.

{% example caching %}

*1 request, 2 readers* — against lifting the fetch to a common parent and threading it back down.

`Plan` asks for the same id and gets the load already in flight:

{% snippet caching src/ui/components/Plan.abide const customer %}

## A memo's cache is one entry per args key

There is a cache at all because the body takes args, and the discriminant is exactly that: a body
that **takes args** is keyed, and gets one entry per args key, computed on the first read of that
key and held.

{% snippet caching src/server/rpc/customers.ts const customerById %}

A keyed memo is **untracked**. It does not re-run because something its body read moved — its
ways back are `ttl`, an explicit `invalidate` or `refresh`, and eviction. An unkeyed memo is the
tracked one, and the two are different shapes rather than one shape with an option.

Calling it hands back a `Reactive` for that key, so the probes and the triggers are on the result:
`customerById({ id }).pending()`, not `customerById.pending()`.

Read on: [Derived values](derive-a-value-from-other-values.md) ·
[Reloading](decide-when-a-value-reloads.md)

## Two reads share an entry when their args canonicalize the same

Which is the cache's whole question, and the answer is the wire. `Args` is a
`Record<string, JsonValue>`, serializable by contract, because **the key is the wire form**. An
args object becomes a key by its canonical serialization — keys sorted, `undefined` members
dropped, `Date` written ISO — which is the same canonicalization the transport uses.

| You write | The key it lands on |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` — sorted, so argument order never splits an entry |
| `{ id: '42', after: undefined }` | `{"id":"42"}` — dropped, so an absent option is the same entry as an omitted one |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` — ISO |

One canonicalization rather than two: args that cannot be keyed are exactly args that cannot be
sent, so both fail in the same place.

The key is therefore **structural**. `memo(() => getCustomer({ id }))` builds a fresh object on
every run and still lands on the same entry, which makes the identity cutoff hold — a
recompute onto a key already held wakes nobody and shows no spinner.

Args are always plain args. A reactive value in an argument position **reads**; making the call
follow that value is the enclosing unkeyed memo's job, which is what the wrapper in the first
snippet is doing.

## A memo's cache is request-local on a server, process-local in a browser

One scope is one caller on both sides, and what differs is only what a caller is there.

| | server | browser |
| --- | --- | --- |
| a caller is | one request | the one person at the tab |
| the cache is built | when the request arrives | when the app starts |
| and dropped | when the response is sent | when the tab closes |
| `ttl: Infinity` means | to the end of that request | to the end of that session |

It follows that it is built and dropped with its scope. `ttl: Infinity` means to the end of that
scope rather than forever, the cache cannot grow without bound, and one caller's answer can never
be served to another.

Coalescing is within a scope, too. Two calls inside one request share one load; two concurrent
requests are two scopes and load twice.

## `global` shares one cache across callers

`global: true` opts into a process-wide cache that outlives every request, and it is the only
thing that makes two callers one load — which is what it is for where the load is expensive.

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

The page above reads it beside the customer, and that read is the difference the example is
showing: switching customers loads a second customer and never touches the rate.

`global` also decides what the answer says about caching, and the `ttl` above is where it says it.
An rpc answer is `private, no-store` by default; a `GET` over a global memo answers
`max-age=<the ttl>` instead, because those are one number and writing it twice in two units is how
they come apart. Compare the two responses in the Requests panel.

**`public` or `private` is the rung's to decide, not `global`'s.** This handler has no
authorization on it, so its answer is reachable unauthenticated already and `public` gives a shared
cache nothing the endpoint would not. Put a rung on it and the same derivation answers `private,
max-age=60` — a browser may still hold it, and a CDN may not hand it to someone who never signed
in.

Read on: [Authorization](../server/decide-who-may-call-what.md) ·
[Response types](../server/answer-with-something-other-than-json.md)

{% snippet caching src/ui/pages/customers/[id]/page.abide const rate %}

Two costs, and both are yours rather than abide's.

**A global body may not read the request scope.** `request()`, `principal`, `cookies()`, `csp.nonce()`
and `route` are a build error inside one, and the error names the ambient. An entry outlives the
request that built it and is served to every caller after it, so a request ambient in the body
bakes the first caller's request into everybody's answer — which is why anything caller-specific
belongs in the `Args`, where it keys an entry instead of hiding in one.

That refusal is also what lets the `cache-control` above be derived rather than trusted: the answer
is not about who asked because the shape that would make it so does not compile.

And a global memo is bounded by its own `ttl` and the app's `invalidate` and by nothing else.
There is no byte ceiling and no eviction count: measuring an arbitrary value costs an O(size)
walk, and an LRU would evict an entry a reader is mid-flight on. `global: true` with `ttl:
Infinity` is an unbounded cache — unbounded because the app asked for it, the bound being a number
the app knows and abide does not.

A global memo over a stream fans one producer out to many readers, and the one thing it needs is
`tail: Infinity` — otherwise a reader arriving mid-stream replays one chunk and goes live, which
is a truncated answer rather than an error.

Read on: [History & tail](keep-the-last-few-values.md) ·
[Auth & principal](../app/know-who-is-calling.md)

## `tags` invalidate entries across memos

`tags` is the only thing that reaches **across** memos. An entry carries them, and a selection
matches on them:

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

The function form receives the memo's args, so a tag can name the **row** rather than the query.
That lets `invalidate({ tags: ['customer:42'] })` reach every entry about customer `42`
without knowing which memos those were — any other memo declaring the same tag joins the same
selection, in any file.

A tag is scoped the way a memo is: request-local on a server, process-local in a browser. One
request can never invalidate another's.

Read on: [Reloading](decide-when-a-value-reloads.md) ·
[Mutations](../server/change-something-on-the-server.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — `ttl`, `invalidate`, `refresh` and selections
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — capping how often an entry revalidates
* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` over a memo you named yourself
