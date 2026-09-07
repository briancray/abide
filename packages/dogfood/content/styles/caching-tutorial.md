---
title: Load a customer once (tutorial)
nav: Caching, tutorial
intent: The caching guide as a hands-on tutorial — numbered steps, one path, a request count you can watch.
examples:
  - packages/dogfood/examples/caching
---

> **Style — tutorial (Diátaxis).** Learning-oriented. The reader is a beginner being taken
> somewhere, so there is one path and no alternatives, every step produces something visible, and
> nothing is explained beyond what the next step needs. Completeness is not the goal; a first
> success is.

In this tutorial you will build a customer page with two components that both need the same
customer, and watch them make one request instead of two. Then you will add a second cache that is
shared by every visitor, and finish by invalidating both.

You will write about thirty lines. It should take fifteen minutes.

## What you will need

* A project created with `abide new`, and `abide dev` running.
* The network tab of your browser open. You are going to be counting requests.

## Step 1 — Add a handler

Create `src/server/rpc/customers.ts` and give it a memo whose body takes an argument:

{% snippet caching src/server/rpc/customers.ts const customerById %}

Then export it as a handler:

{% snippet caching src/server/rpc/customers.ts export const getCustomer %}

The argument is the important part. A body that takes arguments gets one cache entry for each set
of them.

## Step 2 — Read it from a page

Create `src/ui/pages/customers/[id]/page.abide`:

{% snippet caching src/ui/pages/customers/[id]/page.abide const customer %}

And show the name:

{% snippet caching src/ui/pages/customers/[id]/page.abide <h1> %}

Open `http://localhost:3000/customers/42`. You should see the customer's name, and **one** request
in the network tab.

## Step 3 — Add a second component that needs the same customer

Create `src/ui/components/Plan.abide`. Give it an `id` prop and have it ask for the customer
itself — do not pass the customer down:

{% snippet caching src/ui/components/Plan.abide const customer %}

Show the plan:

{% snippet caching src/ui/components/Plan.abide <p>Plan: %}

Mount it on the page:

```abide abide
<Plan id={route.params.id}/>
```

Reload and count the requests again. There is still **one**.

Stop here for a moment, because this is the whole point. Both components asked for customer `42`
independently. They asked with the same arguments, so they addressed the same cache entry, and the
second reader joined the load already in flight. Nothing was lifted to a common parent and nothing
was threaded back down.

## Step 4 — Watch the key do the work

Add links that switch between two customers:

{% snippet caching src/ui/pages/customers/[id]/page.abide <nav class="switch"> %}

Click **Customer 43**. One new request. Click back to **42** — no request at all, because that
entry is still held.

Different arguments, different entry. Same arguments, same entry. That is all a key is.

## Step 5 — Share a cache between visitors

The customer cache belongs to whoever asked for it. On a server that means one request; a second
visitor gets their own. That is what you want for customer data, and not what you want for an
exchange rate every visitor needs.

Create `src/server/rpc/rates.ts` with `global: true`:

{% snippet caching src/server/rpc/rates.ts const exchangeRate %}

Read it on the page beside the customer:

{% snippet caching src/ui/pages/customers/[id]/page.abide const rate %}

Now switch customers again. The customer loads; the rate does not. It was loaded once, for
everybody.

Look at the response headers for the two handlers in the network tab. The customer answers
`private, no-store`. The rate answers `public, max-age=60` — the same sixty seconds you wrote as
`ttl: 60_000`, converted for you rather than written twice.

## Step 6 — Invalidate everything about one customer

Add a second memo about the same customer, and tag it with the row:

{% snippet caching src/server/rpc/customers.ts const invoicesForCustomer %}

Now one call clears both:

```ts server
invalidate({ tags: ['customer:42'] })
```

You did not have to name the memos. Any memo declaring that tag, in any file, joins the selection.

## What you built

{% example caching %}

## What you learned

* A memo whose body takes arguments is **keyed**: one cache entry per set of arguments.
* Two components asking with the same arguments share one load, with nothing lifted or threaded.
* A cache belongs to its caller — one request on a server, the process in a browser.
* `global: true` shares one cache across every caller, and its `ttl` becomes the answer's
  `cache-control`.
* `tags` reach across memos, so an invalidation can name a row instead of a query.

## Next steps

* [Caching](../values/load-once-per-set-of-arguments.md) — the same ground, explained rather than walked
* [Reloading](../values/decide-when-a-value-reloads.md) — the rest of what `invalidate` selects
* [Mutations](../server/change-something-on-the-server.md) — where an invalidation usually goes
