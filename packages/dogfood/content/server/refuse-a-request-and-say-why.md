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
  - `Failures`
  - `return myError(data)`
  - `myError(data)` DISCARDED
  - `rpc.isError`
  - `s.isError`
examples:
  - packages/dogfood/examples/refuse-narrowed
  - packages/dogfood/examples/refuse-write
---

"That invoice is not yours" and "the database is down" are different answers, and a caller
that gets `500` cannot tell them apart. Neither can a template deciding what to render, nor a
model deciding whether to re-plan or retry. A refusal here is a **declared value with a name
and data**: declared once, returned from the handler, narrowed by name wherever it lands.

## The two forms of a refusal

| You write | What you get |
| --- | --- |
| `refuse.typed(name, status?, message?, options?)` | a factory for a refusal a caller can name and narrow |
| `refuse(status, message?)` | an undeclared refusal at a status, thrown |

`refuse.typed` hands back a factory, and the factory carries the type, so there is no registry
to consult and nothing to keep in step. Its status defaults to **400** rather than 500, a
declared refusal being by construction an expected answer. `options.schema` checks the data
synchronously at construction, and a `message` given as a function runs there too. Declaring
in `#shared` lets a page and a handler use the same names.

`refuse(status)` is for where the status *is* the answer. It carries no data and has no options
bag to put any in, data undeclared having no type on the other side. It throws and is declared
`never`, so a bare `refuse(404)` stands as a guard and the returned form costs the type
nothing. The message defaults to the status registry's phrase, which makes `refuse(404)` a
whole refusal on its own. Every signature is in the
[Refusals](../reference/refusals.md) reference.

## A refusal is narrowed by name, where the value is read

{% example refuse-narrowed %}

*2 refusals, 0 names to keep in step* — the arm matches the same two strings, and nothing tells
it when one of them changes.

The refusal lands in the `Failures` of the `Reactive` that produced it, so it is read where the
value is read rather than caught somewhere else. On a handler that read is `rpc.isError`,
**narrowed by what that handler declared**: matching the name gives back `.data` with the
schema's type on it, plus `.status` and `.name`. Reaching for a sibling value's `isError` is a
compile error where the unions differ.

A handler refuses by **returning**, and that is the one spelling. Construction is inert —
`notYours(data)` builds a `Failed` and does not throw — which puts the refusal in the handler's
return type honestly, rather than by `never` vanishing from a union. `Rpc`'s third type
parameter picks it up from there. `throw notYours(data)` refuses identically and loses only the
caller's ability to name it.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[Conditionals](../templates/show-markup-conditionally.md)

## A refusal the page made itself is read the same way

{% example refuse-write %}

A refusal resolves on both sides, so a `transform` in `#ui` refuses a write exactly as a
handler refuses a request, and it fills the same `Failures`. `s.isError` is `Reactive`'s own,
on every value; `rpc.isError` is that member narrowed by one handler's declarations.

A refused write stores nothing, so the record keeps the value it had and the reason sits beside
it rather than in place of it. The next write that is accepted clears the standing failure.

What you refuse with decides which gate you reach for. A `schema` refuses as a
`ValidationError` carrying the messages; a `transform` refuses as a name you declared, which is
the only way a refusal arrives under its own name with its own data.

Read on: [Local state](../values/show-a-value-that-changes.md) ·
[Schemas](check-what-callers-send-you.md)

## A `Failed` built and discarded is a compile error

Because construction is inert, the line below would fall through and pay the invoice anyway:

```ts server
if (!invoice.mine)
    notYours({ owner: invoice.owner })
```

So an expression statement whose type is `Failed` is refused at compile time, naming the two
repairs: `return` it, or `throw` it. Detectable in syntax, which is why the guard form does not
have to be given up to make construction inert.

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

Structural, because a caller catches a shape rather than a class it imported. Over the
wire a refusal serializes as `{ name, message, data }` and hydrates back into that shape, the
status coming from the response.

## abide's own names: two you can narrow, and one you cannot

Both built with `refuse.typed` like any other:

| | Status | Returned where |
| --- | --- | --- |
| `notFound` | 404 | no route matched, or no handler is mounted at that address and method |
| `validationError` | 422 | a schema refused the arguments |

`notFound` carries `{ path, method }`, so an error page can say which address. `validationError`
carries `Issues<Args>`, keyed by path, and `rpc.isError(e, 'ValidationError')` narrows `e.data` to it with
nothing declared.

`HttpError` is the third name and the last. It is what `refuse(status)` raises: undeclared,
entering no `Failures` union, and nothing can narrow to it. It is still a name a caller reads,
in a wire body, an OpenAPI default response and an MCP error entry, and that name is
http-shaped because those are the only places it surfaces. In a browser `refuse` throws the way
`config()` does — a status is a response's business. The rest of what abide raises — 403 on an
origin mismatch, 413 over-size, 504 on a timeout — has no data to narrow **to**, so it stays
`HttpError` at its status.

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
