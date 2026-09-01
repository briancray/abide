---
title: Your first page
nav: First page
intent: Put something on screen, change it, and see where the code that changed it lives.
---

A page is a file. Put a `page.abide` under `src/ui/pages` and the path it sits at is the address
it answers on — there is no route table to register it in, and no build step to tell about it.

```abide #ui/pages/page.abide
<script>
import { state } from 'abide'

const count = state(0)
</script>

<h1>Clicked {count} times</h1>
<button onclick={() => count += 1}>Click</button>
```

*1 file, 9 lines* — and the app serves `/`.

One file holds the value, the markup that shows it, and the
handler that changes it — there is no store to declare, no component to register, and no
re-render to ask for.

## Where the file goes decides the address

The directory is the path, and a `page.abide` is what makes that directory a page.

| File | Answers on |
| --- | --- |
| `#ui/pages/page.abide` | `/` |
| `#ui/pages/about/page.abide` | `/about` |
| `#ui/pages/invoices/page.abide` | `/invoices` |
| `#ui/pages/invoices/[id]/page.abide` | `/invoices/42`, with `42` readable as `route.params.id` |

`#ui/` is a **seam** — an import alias the build enforces, mapping onto `src/ui/`. It is the
form you write in an import, so it is the form these docs show a file at.

Read on: [Routes](../pages/add-a-page.md) ·
[Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md)

## The `<script>` block holds the setup

The `<script>` block is the page's setup: ordinary imports, ordinary TypeScript, run once for
this instance of the page. Everything after it is the markup, and the two share one scope — the
template resolves names against that script and nothing else.

`import { state } from 'abide'` is a real import. Nothing in a `.abide` file is ambient, so a
name in the markup is a name you can follow back to where it came from.

## `count` is read by name, and written by name

Inside a `.abide` file, a reactive value is read and written under its own name.

| You write | It means |
| --- | --- |
| `{count}` in the markup | read the current value, and follow it from here on |
| `count += 1` in a handler | write, and wake everything that read it |
| `count.pending()` | a probe — the `Reactive` API, on a member call |

Naming `count` in an expression **reads** it; the explicit `count()` and `count.set(v)` keep
compiling everywhere the sugar does, because the sugar is over those forms rather than instead
of them. A `.ts` file — which has no template around it — writes them out:

```ts #ui/counters.ts
import { state } from 'abide'

export const count = state(0)
count.set(count() + 1)
```

Reading `count` in the markup is also the whole subscription. There is nothing to register and
no dependency array to keep honest: the heading reads it, so the heading follows it.

Read on: [Local state](../values/show-a-value-that-changes.md) ·
[Values by name](../templates/read-and-write-a-value-by-name.md) ·
[Events](../templates/respond-to-a-click.md)

## Putting something from the server on the page

The same page reaches your database by importing the function that reads it. Anything exported
from `#server/rpc/**` is callable from a page under the name it was declared with.

```ts #server/rpc/invoices.ts
import { GET } from 'abide'
import { database } from '#server/database'

export const getInvoice = GET(({ id }: { id: string }) => database.invoice.find(id), {
  description: 'One invoice, by id.',
})
```

```abide #ui/pages/invoices/[id]/page.abide
<script>
import { memo, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = memo(() => getInvoice({ id: route.params.id }))
</script>

<h1>Invoice {invoice.number}</h1>
<p>{invoice.total} due {invoice.dueOn}</p>
```

No route, no `fetch`, no client module, and no second copy of the invoice type. The browser is
never sent `invoices.ts` — the build generates a client from the handler, so the database
import above was never in anything the page downloaded.

Reading `invoice` starts the load, and the document goes out before the row lands: the two
values are holes that fill when it does. That is the default, and it is why neither line above
has a loading branch in it.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## The script runs on both sides

The cost of one file per page is that its setup is not browser-only. abide renders the page on
the server and the client runs the same setup again, so a `<script>` block that reaches for
`document` at the top level fails on the first render rather than on the second.

Work that belongs to a real browser goes where there is one: an event handler, or a component's
own load hook.

Read on: [Request to paint](how-a-page-becomes-html.md) ·
[Scripts](../templates/run-code-when-a-component-loads.md)

## Running what you wrote

`abide scaffold my-app` writes a project with this page already in it, and `abide dev` keeps the
app up while you edit — one process, restarted on every change, with the browser reloading
behind it.

```
abide scaffold my-app
abide dev
```

Read on: [Scaffold](../ship/start-a-new-app.md) ·
[Dev server](../ship/run-the-app-while-you-work.md)

## Next

* [Request to paint](how-a-page-becomes-html.md) — what happened between the request and the pixels
* [Reading data](../server/read-data-without-writing-an-api.md) — the handler side, properly
* [Templates](../templates/index.md) — conditionals, lists, components and forms
