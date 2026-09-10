---
title: Read data without writing an API
nav: Reading data
intent: Call a server function from a page. No route, no fetch, no client.
covers:
  - `GET`
  - `Rpc`
  - `Value`
  - rpc › `Args`
  - `description`
  - `server/rpc/name.ts`
  - `server/rpc/users.ts`
  - `src/server/rpc/**/*.ts`
examples:
  - packages/dogfood/examples/rpc-call
  - packages/dogfood/examples/rpc-reactive
---

You have a database and a page that needs a row. Most stacks make that four artifacts: a
handler, a route registration, a client function, and a shared type nothing enforces. Three
exist only because the halves are in different processes.

Here you write the handler.

## Anything under `#server/rpc` is callable

{% example rpc-call %}

*2 files, 0 API between them* — against a route, a fetch, a client wrapper and a type kept in
step by hand.

Wrap it in `GET` and export it. `GET` derives the argument and result schemas from the annotations
you already wrote, and the address from the file path and export name:

| File | Export | Answers at |
| --- | --- | --- |
| `#server/rpc/invoices.ts` | `getInvoice` | `/__abide/rpc/invoices/getInvoice` |
| `#server/rpc/name.ts` | `default` | `/__abide/rpc/name` |

You never write that address down. It is there so a log line or a network tab tells you which
export you are looking at.

## A page reaches the handler through an ordinary import

```abide #ui/pages/invoices/[id]/page.abide
<script>
import { memo, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = memo(() => getInvoice({ id: route.params.id }))
</script>

<h1>Invoice {invoice.number}</h1>
<p>{invoice.total} due {invoice.dueOn}</p>
```

The import is real — name, argument type and return type are the ones you just wrote. No
`fetch`, no loading boilerplate, no `await` in the markup.

The page reads `invoice`, which starts the load. The document goes out immediately with holes
where the values are. The holes fill when the row lands.

## The browser receives a generated client, not your module

Not `#server/rpc/invoices.ts` — the browser never sees it. The build **generates** a separate
client module with one export per handler, carrying:

* the HTTP method
* the mount-relative address
* the description

Nothing else. Your database import and any module-level work in `invoices.ts` were never part
of the module the browser got — so "no server code shipped" is how the build works, not
something an optimiser is trusted to have achieved.

Import a non-handler from `#server/**` and you get a compile error naming it. Never a stub
that silently does nothing.

## You get a `Reactive`, not a promise

{% example rpc-reactive %}

`getInvoice({ id })` hands back the same `Reactive` that `state`, `memo` and `channel` do — so
the probes and the triggers are on the **result** of the call, and a promise's one answer is not
what a button waiting on it needs.

`refreshing()` tells a reload from a first load, `await invoice` waits, and
`invoice.refresh()` reloads — which is why the reminder button above stays live across the second
load and only goes back to disabled when there is genuinely nothing held. The hand-written arm
tracks two variables of its own to say the same thing, because a promise answers once and
everything after that is the caller's to remember.

See [Loading states](../values/show-a-value-that-isnt-there-yet.md).

## Two callers asking for one invoice are one request

The `memo` wrapper is not ceremony. A `memo` is identity per arguments: two components asking
for invoice `42` are one request, and the second gets the value the first is waiting on.

Hand `GET` the memo directly to name the caching yourself:

```ts #server/rpc/invoices.ts — excerpt
const invoiceById = memo(
    ({ id }: { id: string }) => database.invoice.find(id),
    { ttl: 30_000 },
)

export const getInvoice = GET(invoiceById, {
    description: 'One invoice, by id. Cached for 30 seconds.',
})
```

`GET` accepts three things:

| Target | Meaning |
| --- | --- |
| a `memo` | identity per args — coalescing, `ttl`, `invalidate` |
| a `channel` | the read-only view of a room |
| a plain function | sugar: `GET(fn)` **is** `GET(memo(fn))` |

So there is no un-memoized endpoint to reason about.

Fill in `description`. It rides onto every surface the handler generates, and an agent reads it to
decide whether this is the call it wants.

## A `GET` must not write

The one rule the framework cannot enforce for you.

The principal cookie is `SameSite=Lax`, so a top-level navigation from another site sends it. A
`GET` that writes is reachable from an `<a href>` on a page you do not control, with your
user's credentials attached.

If it writes, declare it with [`POST`](change-something-on-the-server.md).

## Next

* [Failures](refuse-a-request-and-say-why.md) — when the row is missing, or not theirs
* [Schemas](check-what-callers-send-you.md) — declaring the shape instead of deriving it
* [Authorization](decide-who-may-call-what.md) — a rung in front of this
