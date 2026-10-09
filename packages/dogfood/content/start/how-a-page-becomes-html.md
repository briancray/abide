---
title: How a page becomes HTML
nav: Request to paint
intent: What abide does between a request arriving and a browser having something to look at.
covers:
  - `src/**`
  - `src/ui/**`
  - `src/server/**`
  - `src/shared/**`
---

A request lands, and bytes start leaving before anything it needs has arrived. That is the one
decision the rest of this page explains. **The document is not held for the data.** It goes out
once the page is set up and built, and the values that were still in flight fill the places they
were read.

| | Stage | What runs |
| --- | --- | --- |
| 1 | the request arrives | your app's own route, then each `middleware` rung |
| 2 | the route resolves | the `page.abide` at that path, inside its layouts |
| 3 | the render starts | every load the page reads, all of them at once |
| 4 | the first bytes leave | the head, then the markup as far as it goes |
| 5 | the document closes | as soon as the walk is done |
| 6 | the browser takes over | the same setup runs again, against the nodes already there |
| 7 | the next navigation | the browser renders it, and shared layouts are not rebuilt |

The seven sections below are those seven rows, in that order and under the same names. Where each
file in `src/` runs is a separate question, and the map for it is the last section.

## 1. The request arrives

`#server/app.ts` registers the rungs every request passes before anything is routed, and
default-exports a route of your own — a `llms.txt`, a webhook, anything you would rather answer
without a page. That route is asked only where no page, handler or public file answered, and
returning nothing hands the request on to the 404.

```ts server
import { csp, middleware, onStart } from 'abide/server'

middleware(csp(), requireSignIn())
onStart(async (start) => { await database.connect(); await start() })

export default (request: Request) =>
    new URL(request.url).pathname === '/llms.txt'
        ? new Response('# abide')
        : undefined
```

*1 file, 3 declarations* — a rung stack, a startup hook and a route, in the one place an app
owns before the router.

Each `middleware` rung runs per request, and they run **before** the route resolves — so a rung has
the request and nothing else. Anything that needs to know which row is being asked for is a
handler's own rung instead, where the arguments exist.

Everything abide serves goes through those rungs — `/__abide/**`, the built assets and
`/__abide/health` included. A rung that refuses a caller with no credentials has to let the
health check and the assets through by address.

Read on: [Auth & principal](../app/know-who-is-calling.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## 2. The route resolves

The path picks a `page.abide`, and the layouts above it in the directory tree wrap it. All of
that renders into one document, and `#ui/app.html` is that document. `<slot></slot>` is where the
outermost layout goes; everything around it is yours, and it is served as written — a root-absolute
`href` or `src` in it moved below the app's path when `APP_URL` names one.

```html #ui/app.html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <slot></slot>
</body>
</html>
```

A `src` or `href` naming a build entry is rewritten to what the build actually wrote, and the
CSS the client graph imported is linked in for you — so a content hash never appears in anything
you maintain. Leave `#ui/app.html` out entirely and abide serves its own minimal shell.

A page's `<head>` elements are merged into that document by key, deepest contributor winning, so
a page's `<title>` replaces its layout's. The positions are known at compile time, which is why
merging them costs step 4 no second walk of the body.

Read on: [Head & metadata](../pages/set-the-title-and-social-preview.md) ·
[Layouts](../pages/give-pages-the-same-chrome.md) ·
[Manual rendering](../pages/render-a-document-yourself.md)

## 3. The render starts

Rendering a page runs its setup: the `<script>` blocks, the `reactive` calls, the bodies
the markup reads. Each read that needs the server starts its work immediately, so the
loads on a page are in flight together rather than in the order the markup happens to mention
them.

The total time is the slowest one, not the sum — and the first byte does not wait for any of
them. The markup waits one turn, so a load that answers without waiting on anything is painted
rather than left as a hole.

## 4. The first bytes leave

The head goes first, then the markup. A read of a value still in flight renders nothing and opens
a **sink**, and the hole fills when the value lands. The markup after it keeps going out.

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<script>
import { reactive, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = reactive(() => getInvoice({ id: route.params.id }))
</script>

<h1>Invoice {invoice.number}</h1>
<p>{invoice.total} due {invoice.dueOn}</p>
```

Three sinks, one document, no loading branch.

There is no waiting form at all:

| You write | The document |
| --- | --- |
| `{invoice.total}` | flushes now, fills later |
| `{#if invoice.ready()}` | flushes now, with the `{:else}` to swap |

Neither of them waits, and there is no third row that does. The document is a stream, and a value
that is not there yet is a hole in it rather than a reason to hold it back.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## 5. The document closes

The document closes as soon as the walk is done. A value still in flight at that point is left
as a hole, and nothing is written after the markup to fill it. The browser's own call for that
value fills the hole once the page has taken over, and the buffer below answers that call.

Nothing is written after the markup to fill a hole. The one script the page carries is the
early-call script in the head, and it starts requests rather than writing values.

**The cost is a client with no script.** A hole stays empty for it, because the script does the
filling. A page that must work without one is a page whose values have to be there when the walk
passes them, which is the server's business rather than the template's.

## 6. The browser takes over

Markers and the bundle. Not a serialized tree to diff, and not a copy of your data in the
document — the client re-runs the same setup the server ran: every `<script>`, every
`reactive` call, every body, again.

That sounds like paying twice, and for the loads it is not. `reactive(() => getInvoice(…))` runs
a second time in the browser and makes the same call — one the page **already started** while it
was still arriving. Once setup has run, the render writes one small script into the head, and it
sends each call the page made as its own request. The bundle is still downloading at that point,
so by the time it runs, the answers are usually there, and hydration takes them without asking
again.

The render **buffered what it fetched**, so each of those requests is answered from the buffer
rather than from the database. The handler runs once. The request still shows in the network
panel like any other, with its address, its status and a `Seeded` entry under `server-timing`
saying it was answered from the render's run and how long the handler took.

That saves the **handler's work** and a round trip after the bundle. On a slow connection the
bundle is the long wait, and the calls ride inside it rather than after it.

Binding happens against the nodes that are already there. A marker whose content does not match
rebuilds its own block, not the page.

**A body that is expensive and is not a load is genuinely paid twice** — there is nothing
to seed for a pure computation. That is the case that belongs behind a handler, where it runs on
the server and arrives as data.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Sockets](../server/keep-a-room-of-callers-in-sync.md)

## 7. The next navigation

Once the page has hydrated, the browser does the rendering. A navigation fetches what the next
page reads rather than a new document, and the layouts a route shares with the one before it are
never rebuilt — a header with an open menu in it stays exactly as it was.

A navigation the page already standing matches — another query, or another `[id]` of the same
route — rebuilds nothing at all. `route.url` and `route.params` move, and what reads them follows:
`reactive(() => getInvoice({ id: route.params.id }))` loads the next invoice while a search box
keeps its focus and the scroll stays where it was (30.23, 30.25).

Read on: [Links & navigation](../pages/link-to-another-page.md) ·
[View transitions](../pages/animate-from-one-page-to-the-next.md)

## The wire carries the same seven steps

`/invoices/42`, against the page in step 4. This actually leaves the server.

**Steps 1–4, the head.** Nothing was awaited to produce it. Two of its elements are abide's: the
seed manifest, naming the calls this render is making, and the bootstrap that issues them.

```html browser
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script type="application/json" data-abide-seed>
[["GET","/__abide/rpc/invoices/getInvoice",{"id":"42"}]]
</script>
<script>/* issues each call, stashes each Promise under its key */</script>
<link rel="stylesheet" href="/_abide/app.7f3c9a1e.css">
</head>
<body>
```

The manifest is `(method, address, args)` — what to fetch, never what was fetched. So the browser
has the request in flight before the bundle exists, and before the body it will fill has been
written.

**Step 4, the markup.** The row has not landed, so each read leaves a sink: a `<template>`
holding the hole's id, and the filler script beside it.

```html browser
<h1>Invoice
<template data-abide-sink="3"></template><script>/* fill 3 */</script></h1>
<p><template data-abide-sink="4"></template><script>/* fill 4 */</script>
due <template data-abide-sink="5"></template><script>/* fill 5 */</script>
</p>
```

Those filler scripts are **byte-identical** — every one of them, in every document abide serves.
Each reads the `<template>` next to it, which is where everything specific to that hole lives.
That lets one build-time hash cover them all, and keeps a per-request nonce out of the head.

**Step 5, a fill.** Written at the current end of the document, finding the hole by id. Where an
element genuinely cannot go, the id rides on the owning element instead and the filler writes one
property.

```html browser
<template data-abide-sink="3" data-abide-fill>42</template>
<script>/* fill 3 */</script>
```

**Step 6.** The bundle loads and re-runs the setup. `getInvoice` is called again and answered
from the buffer, and binding happens against the nodes above.

## The directory a file is in decides where it runs

`src/` is the app, and the build enforces the split — a client graph that reaches into
`#server/**` for anything but a handler is a compile error naming the import, never a stub that
quietly does nothing in a browser.

| Directory | Runs | Reached as |
| --- | --- | --- |
| `src/ui/**` | the browser, and the server that renders it | `#ui/…` |
| `src/server/**` | the server only | `#server/…` |
| `src/shared/**` | both sides | `#shared/…` |

Two files in there are addresses rather than names, and both are optional:

| File | What it is |
| --- | --- |
| `#server/app.ts` | the app's own route, and where app-wide lifecycle hooks are registered |
| `#ui/app.html` | the document pages are served in |

Read on: [Config](../app/configure-the-app.md) ·
[Lifecycle](../app/run-code-at-start-and-stop.md)

## Next

* [Templates](../templates/index.md) — the markup half, in full
* [Reactive values](../values/index.md) — what a read actually returns
* [Pages and navigation](../pages/index.md) — routes, layouts and error pages
