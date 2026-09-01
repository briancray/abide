---
title: Load once per set of arguments
nav: Caching
intent: Two components asking for the same thing should be one load, not two.
covers:
  - memo › `Args`
  - `memo` body, keyed
  - `global`
  - `tags`
---

A sidebar shows a customer's name. A panel below it shows their plan. Both need customer `42`,
neither knows about the other, and the usual repair is to lift the fetch somewhere both can reach
and thread it back down as a prop.

A keyed memo is that repair with nothing lifted: **identity per arguments**.

```abide #ui/pages/customers/[id]/page.abide
<script>
import { memo, route } from 'abide'
import { getCustomer } from '#server/rpc/customers'

const customer = memo(() => getCustomer({ id: route.params.id }))
</script>

<h1>{customer.name}</h1>
<Plan id={route.params.id}/>
```

*1 request, 2 readers* — against lifting the fetch to a common parent and threading it back down.

`Plan` asks for the same id and gets the load already in flight.

## Declaring a keyed memo

The discriminant is the body's parameter. A body that **takes args** is keyed: one entry per args
key, computed on first read of that key and held.

```ts #server/rpc/customers.ts
const customerById = memo(({ id }: { id: string }) => database.customer.find(id), {
    ttl: 30_000,
})
```

A keyed memo is **untracked**. It does not re-run because something its body read moved — its
ways back are `ttl`, an explicit `invalidate` or `refresh`, and eviction. An unkeyed memo is the
tracked one, and the two are different shapes rather than one shape with an option.

Calling it hands back a `Reactive` for that key, so the probes and the triggers are on the result:
`customerById({ id }).pending()`, not `customerById.pending()`.

Read on: [Derived values](derive-a-value-from-other-values.md) ·
[Reloading](decide-when-a-value-reloads.md)

## What makes two calls the same call

`Args` is a `Record<string, JsonValue>`, serializable by contract, because **the key is the wire
form**. An args object becomes a key by its canonical serialization — keys sorted, `undefined`
members dropped, `Date` written ISO — which is the same canonicalization the transport uses.

One canonicalization rather than two: args that cannot be keyed are exactly args that cannot be
sent, so both fail in the same place.

The key is therefore **structural**. `memo(() => getCustomer({ id }))` builds a fresh object on
every run and still lands on the same entry, which is what makes the identity cutoff hold — a
recompute onto a key already held wakes nobody and shows no spinner.

Args are always plain args. A reactive value in an argument position **reads**; making the call
follow that value is the enclosing unkeyed memo's job, which is what the wrapper in the first
snippet is doing.

## Where the cache lives

A memo without `global` is **request-local on a server and process-local in a browser** — one
scope is one caller on both sides, and what differs is only what a caller is there.

It follows that it is built and dropped with its scope. `ttl: Infinity` means to the end of that
scope rather than forever, the cache cannot grow without bound, and one caller's answer can never
be served to another.

Coalescing is within a scope, too. Two calls inside one request share one load; two concurrent
requests are two scopes and load twice.

## Sharing one cache across callers with `global`

`global: true` opts into a process-wide cache that outlives every request, and it is the only
thing that makes two callers one load — which is what it is for where the load is expensive.

```ts #server/rpc/rates.ts
const exchangeRate = memo(({ pair }: { pair: string }) => fetchRate(pair), {
    global: true,
    ttl: 60_000,
})
```

Two costs, and both are yours rather than abide's.

`principal` does not bound a global memo, so **anything caller-specific belongs in its `Args`**.
An entry keyed on nothing that identifies the caller is an entry every caller is served.

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

## Tagging entries across memos

`tags` is the only thing that reaches **across** memos. An entry carries them, and a selection
matches on them:

```ts #server/rpc/invoices.ts — excerpt
const invoiceById = memo(({ id }: { id: string }) => database.invoice.find(id), {
    tags: ({ id }) => ['invoice', `invoice:${id}`],
})
```

The function form receives the memo's args, so a tag can name the **row** rather than the query —
which is what lets a mutation that touched invoice `42` invalidate every entry about invoice `42`
wherever it was declared, without knowing which memos those were.

```ts shared
invalidate({ tags: ['invoice:42'] })
```

A tag is scoped the way a memo is: request-local on a server, process-local in a browser. One
request can never invalidate another's.

Read on: [Reloading](decide-when-a-value-reloads.md) ·
[Mutations](../server/change-something-on-the-server.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — `ttl`, `invalidate`, `refresh` and selections
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — capping how often an entry revalidates
* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` over a memo you named yourself
