---
title: Caching FAQ
nav: Caching, FAQ
intent: The caching guide as a question list — every heading a question somebody actually asked.
examples:
  - packages/dogfood/examples/caching
---

> **Style — FAQ.** Support-desk shape. Every heading is a question in the reader's own words, the
> answers are independent and unordered, and the list grows by accretion rather than by design.
> What nobody asks about does not appear, however important it is.

Questions that come up about loading something once.

{% example caching %}

## What makes a memo cached?

Its body taking arguments. A body that takes args is **keyed** and gets one entry per args key,
computed on the first read of that key and held. A body that takes none is the unkeyed, tracked
shape.

{% snippet caching src/server/rpc/customers.ts const customerById %}

## Why are two components loading the same customer twice?

They are not, if they asked with the same arguments. Two reads share an entry when their arguments
canonicalize the same, so the second reader joins the load already in flight:

{% snippet caching src/ui/components/Plan.abide const customer %}

If you are seeing two loads, the two arg objects differ in a value.

## Do I have to pass the loaded value down as a prop?

No, and that is the point. Both components ask for what they need, and the cache is what makes
that one request. Nothing is lifted to a common parent and nothing is threaded back down.

## How are arguments turned into a key?

By canonical serialization — the same one the transport uses:

| You write | The key it lands on |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` |
| `{ id: '42', after: undefined }` | `{"id":"42"}` |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` |

Keys are sorted, `undefined` is dropped, and `Date` is ISO.

## Does a fresh args object make a new entry?

No. The key is **structural**, not by object identity, so a body that rebuilds its args on every
run lands on the same entry — which is what keeps a recompute onto a held key from waking anybody
or showing a spinner.

## Why is `pending()` not on my memo?

Because a keyed memo is a callable, and the `Reactive` is what it hands back. It is
`customerById({ id }).pending()`, not `customerById.pending()`.

## Why does my keyed memo not re-run when its data changes?

A keyed memo is **untracked** by design. Its ways back are `ttl`, an explicit `invalidate` or
`refresh`, and eviction. If you want the call to follow a reactive value, wrap it in an unkeyed
memo — that is the tracked shape, and it is what the snippet in the second question is doing.

## How long does a cache live?

As long as its caller. On a server that is one request; in a browser it is the tab.

| | Server | Browser |
| --- | --- | --- |
| A caller is | one request | one session |
| Built | when the request arrives | when the app starts |
| Dropped | when the response is sent | when the tab closes |
| `ttl: Infinity` | to the end of that request | to the end of that session |

So `ttl: Infinity` does not mean forever, and one caller's answer is never served to another.

## Do two simultaneous requests share a load?

No. Coalescing is within a scope, and two concurrent requests are two scopes. Two calls inside
**one** request share one load.

## How do I cache something across all my visitors?

`global: true`. It is the only thing that makes two callers one load:

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

## Why can I not read `principal` inside a global memo?

Because the entry outlives the request that built it and is served to every caller after it, so a
request ambient in the body would bake the first caller's request into everybody's answer.
`request()`, `principal`, `cookies()`, `csp.nonce()` and `route` are all a build error there, and
the error names the ambient.

Anything caller-specific belongs in the `Args`, where it keys an entry instead of hiding in one.

## Where does the `cache-control` header come from?

From the memo's `ttl`, on a `GET` over a global memo. An ordinary rpc answer is
`private, no-store`; that one answers `max-age=<the ttl>` instead, because they are one number and
writing it twice in two units is how they come apart.

It stays `private`. `global` says the answer is the same for every caller, and whether a shared
cache may keep it is a question about access instead — which abide cannot read off a rung. An
endpoint that really is open says `public` itself.

## How big can a global cache get?

As big as you let it. A global memo is bounded by its own `ttl` and by explicit invalidation, and
by nothing else — no byte ceiling, no eviction count. Measuring an arbitrary value costs an
O(size) walk, and an LRU would evict an entry a reader is mid-flight on. `global: true` with
`ttl: Infinity` is an unbounded cache.

## How do I clear everything about one customer?

Tag the entries with the row and select on the tag:

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

```ts server
invalidate({ tags: ['customer:42'] })
```

`tags` is the only thing that reaches across memos, so any memo declaring that tag joins the
selection, in any file, without the caller naming them.

## Can one request invalidate another request's cache?

No. A tag is scoped the way a memo is.

## Anything to know about a global memo over a stream?

It needs `tail: Infinity`. Without it a reader arriving mid-stream replays one chunk and then goes
live, which is a truncated answer rather than an error.

## See also

* [Caching](../values/load-once-per-set-of-arguments.md)
* [Reloading](../values/decide-when-a-value-reloads.md)
* [History & tail](../values/keep-the-last-few-values.md)
