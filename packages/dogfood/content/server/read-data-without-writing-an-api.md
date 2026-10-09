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
  - `abide-version`
examples:
  - packages/dogfood/examples/rpc-call.json
  - packages/dogfood/examples/rpc-reactive.json
  - packages/dogfood/examples/rpc-follow.json
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

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<script>
import { reactive, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = reactive(() => getInvoice({ id: route.params.id }))
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

`getInvoice({ id })` hands back the same `Reactive` every `reactive` does — so
the probes and the triggers are on the **result** of the call, and a promise's one answer is not
what a button waiting on it needs.

`busy()` beside `ready()` tells a reload from a first load, `await invoice` waits, and
`invoice.refresh()` reloads. That is why the reminder button above stays live across the second
load, and goes back to disabled only when there is genuinely nothing held. The hand-written arm
tracks two variables of its own to say the same thing, because a promise answers once and
everything after that is the caller's to remember.

See [Loading states](../values/show-a-value-that-isnt-there-yet.md).

## A `GET` over a `global` value follows the server

{% example rpc-follow %}

*1 import, 0 sockets* — the arm opens a socket of its own, names a version and re-renders from the
frames by hand.

A browser that reads a `GET` stays subscribed to it over one web socket the whole page shares. When
the handler serves a `global` value, a change the server makes — a `set`, a `patch`, a reload —
reaches every browser holding it, and the list above moves with nothing on the page asking.

The first read and the socket are two paths, and a change landing between them would be lost. So
the answer names the version it carried in `abide-version`, the browser names that version when it
subscribes, and the server sends the value only if it has moved since.

A trigger reaches browsers too, for any `GET`: `getContact.invalidate({ id })` inside a handler
marks every browser's copy of that contact stale, whether or not the value is `global`. A `GET`
declaring `middleware` is followed for its triggers alone, and each browser re-reads through the
rungs, which a value pushed down the socket would have skipped.

## Two callers asking for one invoice are one request

The `reactive` wrapper is not ceremony. A keyed value is identity per arguments: two components
asking for invoice `42` are one request, and the second gets the value the first is waiting on.

Hand `GET` the keyed value directly to name the caching yourself:

```ts #server/rpc/invoices.ts — excerpt
const invoiceTotals = reactive(
    ({ id }: { id: string }) => database.invoice.totals(id),
    { ttl: 30_000 },
)

export const getInvoiceTotals = GET(invoiceTotals, {
    description: "One invoice's totals, by id. Cached for 30 seconds.",
})
```

`GET` accepts three things:

| Target | Meaning |
| --- | --- |
| a keyed value | identity per args — coalescing, `ttl`, `invalidate` |
| one `Reactive` | that value, a channel among them — a client reading it follows every production (18.17) |
| a plain function | sugar: `GET(fn)` **is** `GET(reactive(fn))` |

So there is no uncached endpoint to reason about.

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
