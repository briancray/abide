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
  - packages/dogfood/examples/read-invoice
---

You have a database and a page that needs a row. Most stacks make that four artifacts: a
handler, a route registration, a client function, and a shared type nothing enforces. Three
exist only because the halves are in different processes.

Here you write the handler.

## Declaring a handler under `#server/rpc`

Anything under `#server/rpc/**/*.ts` is callable. Wrap it in `GET` and export it.

{% example read-invoice %}

`GET` derives the argument and result schemas from the annotations you already wrote, and the
address from the file path and export name:

| File | Export | Answers at |
| --- | --- | --- |
| `#server/rpc/invoices.ts` | `getInvoice` | `/__abide/rpc/invoices/getInvoice` |
| `#server/rpc/name.ts` | `default` | `/__abide/rpc/name` |

You never write that address down. It is there so a log line or a network tab tells you which
export you are looking at.

## Calling the handler from a page

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

## What the browser receives

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

`getInvoice({ id })` hands back the same `Reactive` that `state`, `memo` and `channel` do.

```abide #ui/pages/invoices/[id]/page.abide — excerpt
{#if invoice.pending()}
    <p>Loading…</p>
{:else if invoice.error()}
    <p>Could not load that invoice.</p>
{:else}
    <p>{invoice.total} due {invoice.dueOn}</p>
{/if}
```

So `refreshing()` tells a reload from a first load, `await invoice` waits, `invoice.refresh()`
reloads. See [Loading states](../values/show-a-value-that-isnt-there-yet.md).

## Two callers, one load

The `memo` wrapper is not ceremony. A `memo` is identity per arguments: two components asking
for invoice `42` are one request, and the second gets the value the first is waiting on.

Hand `GET` the memo directly to name the caching yourself:

```ts #server/rpc/invoices.ts
const invoiceById = memo(({ id }: { id: string }) => database.invoice.find(id), {
  ttl: 30_000,
})

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

Fill in `description`. It rides onto every surface the handler generates, and it is what an
agent reads to decide whether this is the call it wants.

## A `GET` must not write

The one rule the framework cannot enforce for you.

The session cookie is `SameSite=Lax`, so a top-level navigation from another site sends it. A
`GET` that writes is reachable from an `<a href>` on a page you do not control, with your
user's credentials attached.

If it writes, declare it with [`POST`](change-something-on-the-server.md).

## Next

* [Failures](refuse-a-request-and-say-why.md) — when the row is missing, or not theirs
* [Schemas](check-what-callers-send-you.md) — declaring the shape instead of deriving it
* [Authorization](decide-who-may-call-what.md) — a rung in front of this
