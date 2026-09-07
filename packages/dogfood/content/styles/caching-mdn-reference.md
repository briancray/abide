---
title: memo() keyed form (MDN reference)
nav: Caching, MDN reference
intent: The caching guide as a web platform reference entry — and what a reference does to a subject with no single name.
examples:
  - packages/dogfood/examples/caching
---

> **Style — MDN reference.** Web platform documentation. A fixed section order that every page
> repeats, so a reader who has read one page can navigate all of them. The prose describes the
> interface rather than a use case, and the reader is assumed to know which name they came for.

The **`memo()`** function creates a `Reactive` whose value is produced by a body. Where that body
declares a parameter, the memo is **keyed**: it maintains one cache entry per set of arguments,
computed on the first read of that key and held until it is invalidated, expires, or its scope
ends.

This page documents the keyed form. For the tracked, unkeyed form see
[Derived values](../values/derive-a-value-from-other-values.md).

## Syntax

```ts server
memo(body)
memo(body, options)
```

### Parameters

* `body` — a function producing the value. A body declaring **no** parameter makes an unkeyed,
  tracked memo. A body declaring **one** parameter of type `Args` makes a keyed, untracked memo,
  and that parameter is the cache key.
* `options` (optional) — an object carrying the properties below, all of them optional.

The properties of `options` relevant to the keyed form:

* `options.ttl` — milliseconds after which an entry is stale. `Infinity` means the lifetime of the
  cache's scope, not forever.
* `options.global` — `true` to place entries in a process-wide cache shared by every caller,
  rather than one built and dropped with the calling scope. Server only in effect; see
  [Description](#description).
* `options.tags` — an array of strings, or a function receiving the memo's args and returning one.
  Entries carry their tags, and `invalidate` selects on them.

### Return value

Where the body is unkeyed, a `Reactive<T>`.

Where the body is keyed, a callable: `(args: Args) => Reactive<T>`. The probes and the triggers
belong to the returned `Reactive`, so it is `customerById({ id }).pending()` and never
`customerById.pending()`.

### Exceptions

Reading a request-scoped ambient inside a `global` body is a **build error**, not a runtime one.
`request()`, `principal`, `cookies()`, `csp.nonce()` and `route` each fail this way, and the error
names the ambient.

## Description

### Keys

`Args` is a `Record<string, JsonValue>`. An args object is converted to a key by canonical
serialization, which is the same canonicalization the transport applies when it sends the same
arguments over the wire:

| Argument | Key |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` |
| `{ id: '42', after: undefined }` | `{"id":"42"}` |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` |

Keys are sorted, `undefined` members are dropped, and `Date` is written ISO. The key is therefore
structural: two calls with equal-valued but distinct args objects address the same entry.

Arguments that cannot be keyed are exactly the arguments that cannot be sent, so both fail in the
same place.

### Cache scope

A non-global cache belongs to the calling scope. On a server that scope is one request; in a
browser it is the tab's process.

| | Server | Browser |
| --- | --- | --- |
| A caller is | one request | one session |
| Built | when the request arrives | when the app starts |
| Dropped | when the response is sent | when the tab closes |
| `ttl: Infinity` | to the end of that request | to the end of that session |

Coalescing follows scope. Two reads of the same key within one scope share one execution of the
body; two concurrent scopes execute it twice.

### Global memos

`global: true` places entries in a cache that outlives every request. It is the only mechanism by
which two callers share one execution of a body.

A `GET` transport over a global memo derives its `cache-control` from the memo's `ttl`, answering
`private, max-age=<ttl in seconds>` where an ordinary rpc answer is `private, no-store`. The
directive stays `private`: `global` says the answer does not vary by caller, which is a different
question from whether a shared cache may hold it. An open endpoint says `public` in its own
`ResponseInit`.

A global cache is bounded by `ttl` and by explicit invalidation, and by nothing else. There is no
byte ceiling and no eviction count.

### Tags

Tags are the only selector that reaches across memos. An entry carries the tags its memo declared,
and `invalidate({ tags: [...] })` matches every entry carrying one, in any module.

The function form receives the memo's args, which allows a tag to name the row rather than the
query.

Tags are scoped as the cache is: a request cannot invalidate another request's entries.

## Examples

### A keyed memo

{% snippet caching src/server/rpc/customers.ts const customerById %}

### Two readers sharing one entry

{% snippet caching src/ui/components/Plan.abide const customer %}

### A cache shared across callers

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

### Tagging an entry by row

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

### A complete page

{% example caching %}

## Usage notes

* A keyed memo is untracked. It does not re-run because a value its body read changed; its ways
  back are `ttl`, `invalidate`, `refresh` and eviction.
* A reactive value in an argument position is **read** at call time. Making the call follow that
  value is the job of an enclosing unkeyed memo.
* A global memo over a streaming body requires `tail: Infinity`, or a reader that arrives
  mid-stream replays one chunk and then goes live.

## Specifications

`memo`, `Args`, `global` and `tags` are specified in [Reactive](../reference/reactive.md).

## See also

* [Caching](../values/load-once-per-set-of-arguments.md)
* [Derived values](../values/derive-a-value-from-other-values.md)
* [Reloading](../values/decide-when-a-value-reloads.md)
* [Authorization](../server/decide-who-may-call-what.md)
* [Response types](../server/answer-with-something-other-than-json.md)
