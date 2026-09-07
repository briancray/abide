---
title: Caching recipes (cookbook)
nav: Caching, cookbook
intent: The caching guide as a cookbook — each section a task, stated as Problem, Solution, Discussion.
examples:
  - packages/dogfood/examples/caching
---

> **Style — cookbook.** The O'Reilly *Cookbook* shape: **Problem**, **Solution**, **Discussion**,
> repeated. The reader arrives mid-task with a specific need, takes the solution, and reads the
> discussion only if the solution surprises them. Recipes are independent and deliberately
> overlap.

Recipes for loading something once. Each one stands alone; take the one that matches the task in
front of you.

## Recipe: stop two components loading the same thing twice

### Problem

A sidebar shows a customer's name and a panel below it shows their plan. Both need customer `42`,
neither knows about the other, and you do not want to lift the fetch to a common parent and thread
it back down as a prop.

### Solution

Give the memo a body that takes arguments, and let both components call it:

{% snippet caching src/server/rpc/customers.ts const customerById %}

{% snippet caching src/ui/components/Plan.abide const customer %}

### Discussion

A body that **takes args** is keyed, and a keyed memo holds one entry per args key. Both
components addressed the same key, so the second one joined the load already in flight rather than
starting a second.

The probes and the triggers belong to the result, not to the memo: `customerById({ id }).pending()`,
never `customerById.pending()`.

A keyed memo is untracked. It does not re-run because something its body read changed — its ways
back are `ttl`, an explicit `invalidate` or `refresh`, and eviction. The wrapper in the snippet
above is an unkeyed memo, and that is the tracked one: it is what makes the call follow the `id`
when the route changes.

### See also

* [Caching](../values/load-once-per-set-of-arguments.md)
* [Derived values](../values/derive-a-value-from-other-values.md)

## Recipe: make two calls land on the same cache entry

### Problem

Two call sites pass what you believe are the same arguments, and you are seeing two loads.

### Solution

Compare the canonical keys rather than the objects. Arguments are serialized the way the wire
serializes them:

| You write | The key it lands on |
| --- | --- |
| `{ id: '42' }` | `{"id":"42"}` |
| `{ page: 2, id: '42' }` | `{"id":"42","page":2}` — sorted |
| `{ id: '42', after: undefined }` | `{"id":"42"}` — dropped |
| `{ since: new Date(0) }` | `{"since":"1970-01-01T00:00:00.000Z"}` — ISO |

### Discussion

The key is **structural**, not by object identity, so a body that builds a fresh args object on
every run still lands on the same entry. That is what makes the identity cutoff hold, and what
stops a recompute onto a held key from showing a spinner.

Sorted keys mean argument order never splits an entry. Dropped `undefined` members mean an
explicitly absent option is the same entry as an omitted one. If two call sites still disagree,
what differs is a value, not a spelling.

One canonicalization rather than two: arguments that cannot be keyed are exactly the arguments
that cannot be sent, so both fail in the same place.

## Recipe: cache something across every visitor

### Problem

An exchange rate is the same for everybody and expensive to fetch, and you are fetching it once
per request.

### Solution

`global: true`:

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

### Discussion

An ordinary cache belongs to the caller — one request on a server, the process in a browser — so
it is built and dropped with that scope, cannot grow without bound, and can never serve one
caller's answer to another. `global` is the only thing that opts out of all four, and it is the
only thing that makes two callers one load.

Two costs come with it, and both are yours rather than abide's.

A **global body may not read the request scope**. `request()`, `principal`, `cookies()`,
`csp.nonce()` and `route` are a build error inside one. An entry outlives the request that built
it, so a request ambient would bake the first caller's request into everybody's answer. Anything
caller-specific belongs in the `Args`, where it keys an entry instead of hiding in one.

A **global cache is bounded by its `ttl` and nothing else**. There is no byte ceiling and no
eviction count: measuring an arbitrary value costs an O(size) walk, and an LRU would evict an entry
a reader is mid-flight on. `global: true` with `ttl: Infinity` is an unbounded cache, because the
app asked for one.

### See also

* [Auth & principal](../app/know-who-is-calling.md)

## Recipe: let a CDN cache an answer

### Problem

You want `cache-control` on a handler's response, and you do not want to write the same duration
twice in two units.

### Solution

Put the `ttl` on a global memo and serve it with `GET`. The header is derived:

{% snippet caching src/server/rpc/rates.ts export const getRate %}

### Discussion

An rpc answer is `private, no-store` by default. A `GET` over a global memo answers
`max-age=<the ttl>` instead, because those are one number, and writing it twice in two units is
how they come apart.

The directive stays `private`. `global` says the answer does not vary by caller; whether a shared
cache may hold it is a question about access, and abide cannot read that off a rung. So a browser
may hold it for the `ttl` and a CDN may not. An endpoint that really is open says `public` in its
own `ResponseInit`.

The derivation is trustworthy only because of the refusal in the previous recipe: the answer is
not about who asked, because the shape that would make it so does not compile.

### See also

* [Authorization](../server/decide-who-may-call-what.md)
* [Response types](../server/answer-with-something-other-than-json.md)

## Recipe: invalidate everything about one row

### Problem

A customer was updated. Three memos hold something about that customer, they live in different
files, and you do not want the mutation to know their names.

### Solution

Tag entries with the row, using the function form:

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

Then select on the tag:

```ts server
invalidate({ tags: ['customer:42'] })
```

### Discussion

`tags` is the only thing that reaches **across** memos. An entry carries them and a selection
matches on them, so any memo declaring the same tag joins the selection, in any file, without the
caller knowing which memos those were.

The function form receives the memo's args, which is what lets a tag name the **row** rather than
the query. A static array tags the query, which is the coarser and usually wrong choice here.

A tag is scoped the way a memo is: request-local on a server, process-local in a browser. One
request can never invalidate another's.

### See also

* [Reloading](../values/decide-when-a-value-reloads.md)
* [Mutations](../server/change-something-on-the-server.md)

## The whole thing, running

{% example caching %}
