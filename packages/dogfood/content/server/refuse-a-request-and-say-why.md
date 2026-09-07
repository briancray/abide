---
title: Refuse a request and say why
nav: Failures
intent: Turn a refusal into something the caller can name, narrow and render — not a 500 and a guess.
covers:
  - `refuse`
  - `refuse.typed`
  - `notFound`
  - `validationError`
  - `Failed<Name, Data>`
  - `return myError(data)`
  - `myError(data)` DISCARDED
  - `rpc.isError`
  - `s.isError`
---

"That invoice is not yours" and "the database is down" are different answers, and a caller
that gets `500` cannot tell them apart. Neither can a template deciding what to render, nor a
model deciding whether to re-plan or retry.

A refusal here is a **declared value with a name and data**. Declare it once, return it from
the handler, narrow it by name wherever it lands.

```ts #shared/failures.ts
import { refuse } from 'abide'

export const notYours = refuse.typed<
    'NotYours',
    { invoice: string; owner: string }
>('NotYours', 403, 'That invoice belongs to someone else.')
```

```ts #server/rpc/invoices.ts — excerpt
export const getInvoice = GET(async ({ id }: { id: string }) => {
    const invoice = await database.invoice.find(id)
    if (!invoice) return refuse(404)
    if (invoice.owner !== principal.id)
        return notYours({ invoice: id, owner: invoice.owner })
    return invoice
})
```

*2 files, 0 error codes to look up* — the name and its data are the type, on both sides of
the wire.

## `refuse.typed` declares a refusal once

It hands back a factory, and the factory carries the type. There is no registry to consult and
nothing to keep in step:

| `refuse.typed(name, status?, message?, options?)` | |
| --- | --- |
| `name` | what `isError` matches on, and what a model reads |
| `status` | defaults to **400** |
| `message` | the human sentence, resolved where the refusal is declared |
| `options.schema` | checks the data synchronously, at construction |

The status defaults to 400 rather than 500, because a *declared* refusal is by construction an
expected answer and 500 is the one status certainly wrong for it. A generated client reads it as
a server fault, a model retries instead of re-planning, the CLI exits `7` instead of `8`, and
whatever is watching the app alerts on it.

Declaring in `#shared` lets a page and a handler use the same names. A refusal resolves
on both sides, so a `transform` in `#ui` refuses a write exactly as a handler refuses a request.

Read on: [Local state](../values/show-a-value-that-changes.md)

## Returning refuses

One spelling for every refusal: a handler **returns** it.

```ts server
return notYours({ invoice: id, owner: invoice.owner })
```

Construction is inert — `notYours(data)` builds a `Failed` and does not throw — which is what
puts the refusal in the handler's return type honestly, rather than by `never` vanishing from a
union. `Rpc`'s third type parameter picks it up from there.

`throw notYours(data)` refuses identically and loses only the caller's ability to name it.

## A `Failed` built and discarded is a compile error

Because construction is inert, the line below would fall through and pay the invoice anyway:

```ts server
if (invoice.owner !== principal.id)
    notYours({ invoice: id, owner: invoice.owner })
```

So an expression statement whose type is `Failed` is refused at compile time, naming the two
repairs: `return` it, or `throw` it. Detectable in syntax, which is why the guard form does not
have to be given up to make construction inert.

## A refusal is narrowed where the value is read

The refusal lands in the `Failures` of the `Reactive` that produced it — one place, whether a
handler refused a request or a `transform` refused a write. So it is read where the value is
read, not caught somewhere else:

```abide #ui/pages/invoices/[id]/page.abide — excerpt
{#if invoice.isError(invoice.error(), 'NotYours')}
    <p>
        Invoice {invoice.error().data.invoice} belongs to
        {invoice.error().data.owner}.
    </p>
{:else if invoice.error()}
    <p>Could not load that invoice.</p>
{:else}
    <p>{invoice.total} due {invoice.dueOn}</p>
{/if}
```

`s.isError` is `Reactive`'s own, on every value. On a handler it is `rpc.isError`, **narrowed
by what that handler declared** — matching the name gives back `.data` with the schema's type
on it, plus `.status` and `.name`. Reaching for a sibling value's `isError` is a compile error
where the unions differ.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[Conditionals](../templates/show-markup-conditionally.md)

## `Failed<Name, Data>` is the one refusal type

In-process and over a wire alike. There is no second, http-shaped one:

```ts shared
type Failed<Name, Data> = Error & {
    name: Name
    status: number
    message: string
    data: Data
}
```

Structural, because what a caller catches is a shape rather than a class it imported. Over the
wire a refusal serializes as `{ name, message, data }` and hydrates back into that shape, the
status coming from the response.

## `refuse(status)` throws where there is nothing to narrow to

Where there is nothing to narrow to, the status *is* the answer:

```ts server
if (!invoice) return refuse(404)
```

`refuse` **throws** and is declared `never`, so a bare `refuse(404)` also stands as a guard and
the returned form costs the type nothing. The message defaults to the status registry's phrase,
so `refuse(404)` is a whole refusal. It carries no data, and there is no options bag to put any
in — data undeclared has no type on the other side, which is what `refuse.typed` is for.

In a browser it throws the way `config()` does. A status is a response's business.

The refusal it raises is undeclared: `name` is `'HttpError'`, no data. That name is http-shaped
because this instance only ever surfaces where http is the vocabulary — an OpenAPI default
response, a wire body, an MCP error entry.

## abide's own names: two you can narrow, and one you cannot

Both built with `refuse.typed` like any other:

| | Status | Returned where |
| --- | --- | --- |
| `notFound` | 404 | no route matched, or no handler is mounted at that address and method |
| `validationError` | 422 | a schema refused the arguments |

`notFound` carries `{ path, method }`, so an error page can say which address. `validationError`
carries `Issues<Args>`, keyed by path, and `rpc.isError(e, 'ValidationError')` narrows `e.data` to it with
nothing declared.

`HttpError` is the third name and the last. It is undeclared, meaning it enters no `Failures`
union and nothing can narrow to it — but it is still a name a caller reads, in a wire body, an
OpenAPI default response and an MCP error entry. The rest of what abide raises — 403 on an origin
mismatch, 413 over-size, 504 on a timeout — has no data to narrow **to**, so it stays `HttpError`
at its status.

Three and no more. A name is public surface forever.

Read on: [Schemas](check-what-callers-send-you.md)

## A bare failure narrows through the factory's own `is`

`error.abide` receives a bare failure as a prop, so there is no value to hang `s.isError` off.
Every factory carries its own `is` for exactly that:

```abide #ui/pages/error.abide — excerpt
{#if notFound.is(failure)}
    <h1>No such page</h1>
    <p>Nothing answers {failure.data.method} {failure.data.path}.</p>
{:else if notYours.is(failure)}
    <h1>Not yours</h1>
{/if}
```

The factory carries the type, so this needs no registry either.

Read on: [Error pages](../pages/show-a-page-when-something-fails.md)

## Next

* [Schemas](check-what-callers-send-you.md) — where `validationError` comes from
* [Error pages](../pages/show-a-page-when-something-fails.md) — the page a refusal renders in
* [Authorization](decide-who-may-call-what.md) — refusing before the handler runs
