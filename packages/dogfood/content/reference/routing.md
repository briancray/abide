---
title: Routing
nav: Routing
intent: File patterns, precedence, head merging and render.
enumerates:
  - Pages
  - Mount paths
  - render
  - Sinks
---

Every address an abide app answers on comes from a **file path**. A page is a `page.abide`
under `src/ui/pages`, a handler is an export under `src/server/rpc`, and a socket is an export
under `src/server/sockets` — so there is no route table, and nothing to keep in step with the
filesystem.

## Page patterns

| Path | Meaning |
| --- | --- |
| `<head>` | A page's contribution to the document head. |
| `view-transition-name` | What turns view transitions on, in the app's own stylesheet. |
| `[name]` | A required dynamic segment. |
| `[[name]]` | An optional segment. |
| `[...name]` | A rest segment, terminal. |
| `/__abide/**` | Every endpoint abide controls. |

A directory named `[id]` matches exactly one segment and is a required key of `Params`. `[[tab]]`
matches one segment or none, and an omitted one is **absent** from `Params` rather than empty.
`[...rest]` matches what is left and is terminal, there being nothing a later segment could
match against.

## Mount paths

| File | Export | Served at |
| --- | --- | --- |
| `server/rpc/name.ts` | `default` | `/__abide/rpc/name` |
| `server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` |
| `server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` |
| `server/sockets/chat.ts` | `default` | `/__abide/socket/chat` |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

A `default` export takes the file's own name and a named export appends its name, so a file with
one handler reads as an address and a file with five reads as five. A directory nests the
address and changes nothing else.

A path is owned by **exactly one** handler. `server/rpc/users.ts` exporting `getUser` and
`server/rpc/users/getUser.ts` exporting `default` mount at the same address, and that is a build
error naming both files rather than whichever won at the first request.

## `render`

| Name | Signature | Meaning |
| --- | --- | --- |
| `Component` | `interface Component {}` | A component bound to its props. |
| `render` | `(component: Component, shell?: Shell) => AsyncGenerator<Uint8Array>` | What produces a document. |
| `Shell` | `string \| URL \| undefined` | The document a render renders into. |

### Parameters

* `component` — a `Component`, which is a component **already bound to its props**:
  `Invoice({ invoice })`, not `Invoice` and a props object beside it.
* `shell` (optional) — a `Shell`. A `string` is a document inline, a `URL` is one to read, and
  omitting it uses `src/ui/app.html`.

### Return value

An `AsyncGenerator<Uint8Array>` — the document as bytes, produced as the render reaches them.
That is what the page pipeline streams, and what `page()` takes directly.

## Sinks

| Spelling | Sink | Filled |
| --- | --- | --- |
| `href={await x}`, any attribute | the element | the attribute or property |
| `class:`, `style:`, `bind:` | the element | the class, the style property, the bound property |
| `<title>{name}</title>` | `<title data-abide-sink="…">` | `.textContent` |
| `<textarea>{v}</textarea>` | the `<textarea>` | `.defaultValue` |

A sink is an addressable hole in the output stream that a value still in flight fills later.
An attribute sink fills **on the element**, not by re-emitting markup around it. A sink inside
RCDATA — a `<title>`, a `<textarea>` — fills through the element's own property, markup not
parsing there.

The batching unit of a fill is the **flush**, not the production: a value that produces ten
times before the next flush is one write.

## Description

### Resolution order

A page is resolved by longest static match first, so a literal segment beats a dynamic one at
the same depth. `layout.abide` and `error.abide` are both resolved **nearest-ancestor**, which
is what lets a section answer for itself and the app answer for the rest.

### The head

`<head>` contributions are hoisted at compile time and merged **by key**, deepest contributor
winning. A contribution with no key appends in tree order. Nothing in the head holds the flush
by default, and on a client navigation the incoming page's keyed contributions replace the
outgoing page's while a layout's do not move.

## Examples

### A route with a required and an optional segment

```abide #ui/pages/invoices/[id]/[[tab]]/page.abide — excerpt
<script>
import { route } from 'abide'

const { id, tab = 'summary' } = route.params
</script>

<h1>Invoice {id} — {tab}</h1>
```

### A document rendered outside the page pipeline

```ts #server/rpc/previews.ts — excerpt
export const previewInvoice = GET(async ({ id }: { id: string }) =>
    page(render(Invoice({ invoice: await database.invoice.find(id) }))),
)
```

## See also

* [Routes](../pages/add-a-page.md) — the guide to page files
* [Manual rendering](../pages/render-a-document-yourself.md) — `render` in use
* [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) — what a sink is for
