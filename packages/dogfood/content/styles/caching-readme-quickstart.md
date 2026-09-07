---
title: Caching — README quickstart
nav: Caching, README quickstart
intent: The caching guide as a package README — code first, prose only where the code is not obvious.
examples:
  - packages/dogfood/examples/caching
---

> **Style — README quickstart.** The shape a package README has: install, one working snippet
> above the fold, a short API list, a gotchas section, links out. Optimised for time-to-first-line,
> and it explains nothing it can show instead.

Load it once, however many components ask.

{% snippet caching src/server/rpc/customers.ts const customerById %}

Two components, same args, one request:

{% snippet caching src/ui/components/Plan.abide const customer %}

## Quick reference

| You write | You get |
| --- | --- |
| `memo(() => …)` | unkeyed, tracked — re-runs when what it read changes |
| `memo(({ id }) => …)` | keyed, untracked — one entry per args key |
| `m({ id })` | the `Reactive` for that key |
| `m({ id }).pending()` | probes live on the result, not on the memo |
| `{ ttl: 30_000 }` | entry is stale after 30s |
| `{ ttl: Infinity }` | for the life of the scope, not forever |
| `{ global: true }` | one cache for every caller, outliving requests |
| `{ tags: ['invoice'] }` | tag the query |
| `{ tags: ({ id }) => [...] }` | the function form — tag the row |
| `invalidate({ tags: ['customer:42'] })` | clear across every memo carrying it |

## Keys are the canonical wire form

| You write | The key |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` |
| `{ id: '42', after: undefined }` | `{"id":"42"}` |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` |

Sorted, `undefined` dropped, `Date` ISO. Structural, so a fresh object is the same entry.

## Scope

| | Server | Browser |
| --- | --- | --- |
| A caller is | one request | one session |
| Built | request arrives | app starts |
| Dropped | response sent | tab closes |

## Share across callers

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

`GET` over it derives the header — `public, max-age=60` from `ttl: 60_000`, written once:

{% snippet caching src/server/rpc/rates.ts export const getRate %}

## Invalidate across memos

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

```ts server
invalidate({ tags: ['customer:42'] })
```

## Gotchas

* **A keyed memo does not track.** It re-runs on `ttl`, `invalidate`, `refresh` or eviction, never
  because something its body read changed. Wrap it in an unkeyed memo to follow a value.
* **Probes are on the result.** `m({ id }).pending()`, not `m.pending()`.
* **`ttl: Infinity` is not forever** — it is the life of the scope, which on a server is one
  request.
* **Two concurrent requests load twice.** Coalescing is within a scope. Use `global` to cross one.
* **A global body cannot read `principal`, `request()`, `cookies()`, `csp.nonce()` or `route`.**
  Build error. Put caller-specific values in the args.
* **A global cache has no size limit.** `ttl` and `invalidate` are the only bounds; `ttl: Infinity`
  plus `global` is unbounded.
* **A global memo over a stream wants `tail: Infinity`**, or a late reader gets one chunk and then
  live.

## Full example

{% example caching %}

## Docs

* [Caching](../values/load-once-per-set-of-arguments.md)
* [Reloading](../values/decide-when-a-value-reloads.md)
* [Reading data](../server/read-data-without-writing-an-api.md)
