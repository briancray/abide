---
title: Caching (wire copy)
nav: Caching, wire copy
intent: The inverted pyramid again, in journalism voice — the A/B that separates structure from prose.
examples:
  - packages/dogfood/examples/caching
---

> **Style — wire copy.** Inverted pyramid structure, journalism prose. This page holds the section
> order of [Caching, inverted pyramid](caching-inverted-pyramid.md) fixed and changes only the
> writing: one idea per sentence, active voice, a named actor, no em dashes, no second person, no
> evaluative aside, and every term defined at first mention. The pair isolates voice from
> structure.

Two components that need the same data make one request instead of two.

A memo is a value abide computes from a body rather than one an application writes. A memo whose
body takes arguments is keyed. It holds one cache entry for each set of arguments. abide computes
an entry on the first read of its key and then keeps it.

A sidebar and a panel that both need customer 42 therefore share one load. Neither is told about
the other. Nothing is lifted to a common parent, and nothing is threaded back down as a prop.

{% example caching %}

*1 request, 2 readers.*

## The cache key

Two reads share an entry when their arguments serialize the same way.

`Args` is the type of a keyed body's parameter. It is a `Record<string, JsonValue>`. abide turns an
args object into a key by serializing it, and it uses the serialization the transport already uses
to send those same arguments.

| Argument | Key |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` |
| `{ id: '42', after: undefined }` | `{"id":"42"}` |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` |

abide sorts the members by name. Argument order never splits an entry.

abide drops a member whose value is `undefined`. An explicitly absent option lands on the same
entry as an omitted one.

abide writes a `Date` in ISO 8601 form.

Key equality is structural. A body that builds a fresh args object on every run still lands on the
same entry.

## Keyed and unkeyed memos

The parameter is the discriminant. A body that takes arguments is keyed. A body that takes none is
unkeyed.

{% snippet caching src/server/rpc/customers.ts const customerById %}

A keyed memo is untracked. It does not re-run when a value its body read changes.

Four things bring a keyed entry back: `ttl`, an explicit `invalidate`, an explicit `refresh`, and
eviction.

An unkeyed memo is the tracked one. The two are separate shapes rather than one shape with an
option.

## Where the probes live

Calling a keyed memo returns a `Reactive` for that key. The probes and the triggers belong to that
result.

An application writes `customerById({ id }).pending()`. `customerById.pending()` does not exist.

{% snippet caching src/ui/components/Plan.abide const customer %}

A reactive value in an argument position is read at the moment of the call. An enclosing unkeyed
memo is what makes the call follow that value. The snippet above is one.

## Cache scope

A cache belongs to a caller. A server counts one request as a caller. A browser counts one
session.

| | Server | Browser |
| --- | --- | --- |
| A caller is | one request | one session |
| Built | when the request arrives | when the app starts |
| Dropped | when the response is sent | when the tab closes |
| `ttl: Infinity` | to the end of that request | to the end of that session |

A cache cannot grow without bound, because it dies with its scope. One caller's answer never
reaches another caller.

Coalescing follows the same boundary. Two reads inside one request share one load. Two concurrent
requests are two scopes, and they load twice.

## Global memos

`global: true` places entries in a cache that outlives every request. It is the only option that
makes two callers share one load.

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

The example loads a second customer when the reader switches customers. It never reloads the
rate.

## The request-scope restriction

abide rejects a global body that reads a request-scoped ambient. `request()`, `principal`,
`cookies()`, `csp.nonce()` and `route` each fail this way. The rejection is a build error, and it
names the ambient.

A global entry outlives the request that created it. abide then serves that entry to every caller
after it. A request ambient inside the body would bake the first caller's request into every
later answer.

An application puts caller-specific values in the `Args`. A value there keys an entry rather than
hiding inside one.

## Derived cache-control

An rpc answer carries `private, no-store` by default.

A `GET` transport over a global memo carries `max-age` instead, and abide derives the number from
the memo's `ttl`. The two are one duration. An application that wrote it twice, in two units, would
eventually write two different numbers.

The rung decides `public` or `private`. A rung is the authorization a handler is mounted behind.
`global` does not decide it.

A handler with no rung is already reachable without a sign-in, so `public` grants a shared cache
nothing the endpoint withholds. A handler with a rung answers `private, max-age=60` from the same
derivation. A browser may hold that answer. A CDN may not hand it to a caller who never signed in.

The restriction above is what makes the derivation safe. A global answer cannot be about who asked,
because a body that read who asked does not compile.

## Tags

`tags` is the only selector that reaches across memos. An entry carries the tags its memo declared,
and `invalidate` matches on them.

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

The function form receives the memo's args. A tag can therefore name a row rather than a query.

`invalidate({ tags: ['customer:42'] })` then clears every entry about customer 42. The caller names
no memo. Any memo that declares the same tag joins the selection, in any file.

abide scopes a tag the way it scopes a cache. One request cannot invalidate another request's
entries.

## The size of a global cache

`ttl` and explicit invalidation are the only bounds on a global cache. abide enforces no byte
ceiling and no entry count.

Measuring an arbitrary value costs a walk proportional to its size. An LRU policy would evict an
entry that a reader is still streaming.

`global: true` with `ttl: Infinity` is an unbounded cache. The application asked for one, and the
application is what knows the bound.

## Global memos over streams

A global memo over a streaming body needs `tail: Infinity`.

Without it, a reader who subscribes after the first chunk replays one chunk and then goes live.
That reader receives a truncated answer rather than an error.

## Next

* [Reloading](../values/decide-when-a-value-reloads.md) — `ttl`, `invalidate`, `refresh` and selections
* [Throttle & debounce](../values/slow-down-a-value-that-changes-too-fast.md) — capping how often an entry revalidates
* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` over a memo you named yourself
