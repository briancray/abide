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
decision the rest of this page explains: **the document is not held for the data.** The head
goes out as soon as it is known, the markup follows, and the values that were still in flight
fill the places they were read.

| | Stage | What runs |
| --- | --- | --- |
| 1 | the request arrives | your app's own route, then the middleware onion |
| 2 | the route resolves | the `page.abide` at that path, inside its layouts |
| 3 | the render starts | every load the page reads, all of them at once |
| 4 | the first bytes leave | the head, then the markup as far as it goes |
| 5 | the values land | each one fills the hole it left |
| 6 | the browser takes over | the same setup runs again, against the nodes already there |
| 7 | the next navigation | the browser renders it, and shared layouts are not rebuilt |

The seven sections below are those seven rows, in that order and under the same names. Where each
file in `src/` runs is a separate question, and the map for it is the last section.

## 1. The request arrives

`#server/app.ts` default-exports a route of your own, and it is asked first — a `robots.txt`, a
webhook, anything you would rather answer without a page. Return nothing and the request carries
on to the router.

```ts #server/app.ts
import { middleware, csp, onStart } from 'abide'

middleware(csp(), requireAuth())
onStart(async (start) => { await database.migrate(); await start() })

export default (request: Request) =>
  new URL(request.url).pathname === '/robots.txt'
    ? new Response('User-agent: *')
    : undefined
```

*1 file, 3 declarations* — a rung stack, a startup hook and a route, in the one place an app
owns before the router.

Each `middleware` rung runs per request, and they run **before** the route resolves — so a rung has
the request and nothing else. Anything that needs to know which row is being asked for is a
handler's own rung instead, where the arguments exist.

Everything abide serves goes through those rungs, `/__abide/**` included. Three things do not,
and each says why: the built assets, served in front of the pipeline; `/__abide/health`, because
a load balancer presents no credentials; and `/__abide/principal`, whose answer is composed from
the caller's own cookie.

Read on: [Auth & principal](../app/know-who-is-calling.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## 2. The route resolves

The path picks a `page.abide`, and the layouts above it in the directory tree wrap it. All of
that renders into one document, and `#ui/app.html` is that document. `<slot></slot>` is where the
outermost layout goes; everything around it is yours, and it is served as written.

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
step 4 can flush the head before the body has been walked.

Read on: [Head & metadata](../pages/set-the-title-and-social-preview.md) ·
[Layouts](../pages/give-pages-the-same-chrome.md) ·
[Manual rendering](../pages/render-a-document-yourself.md)

## 3. The render starts

Rendering a page runs its setup: the `<script>` blocks, the `state` calls, the `memo`
bodies the markup reads. Each read that needs the server starts its work immediately, so the
loads on a page are in flight together rather than in the order the markup happens to mention
them.

The total time is the slowest one, not the sum — and the first byte does not wait for any of
them.

## 4. The first bytes leave

The head goes first, then the markup. A read of a value still in flight renders nothing and
opens a **sink**: an addressable slot the value fills when it lands. The markup after it keeps
going out.

```abide #ui/pages/invoices/[id]/page.abide
<script>
import { memo, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = memo(() => getInvoice({ id: route.params.id }))
</script>

<h1>Invoice {invoice.number}</h1>
<p>{invoice.total} due {invoice.dueOn}</p>
```

Three sinks, one document, no loading branch.

Waiting is the opt-in, and `await` is how it is asked for:

| You write | The document |
| --- | --- |
| `{invoice.total}` | flushes now, fills later |
| `{await invoice.total}` | holds until the value lands |
| `{#await invoice then { total }}` | holds, the same way |
| `{#await invoice}{:then { total }}` | flushes now, with a pending body to swap |

`await` governs the expression, not the name. `{await invoice}` holds for the whole row,
`{await invoice.total}` holds for the one field, and `{await a.x + b.y}` holds for both values —
every reactive read under an `await` blocks, so there is no form of it to learn separately.

Where `then` sits is what decides the `{#await}` block. On the opening tag it is the blocking
form, and it mounts once with a value. As a `{:then}` branch it is not: the pending body goes out
now and is swapped for the branch when the value lands.

A `then` takes a name or a pattern, and both bind the **resolved value** — `then row` names the
whole invoice, `then { total }` takes the one field off it. The names stay live, so a
reload updates the body rather than rebuilding it.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## 5. The values land

A document is a one-way stream, so a value cannot be written back at the position it was read
from. What goes out at that position is an **address**, and when the row lands the fill is
appended wherever the stream has got to and routed back to it:

```
  the walk               the document, in the order it goes out
  ------------------     --------------------------------------
  head is known      ->  <head> manifest . bootstrap </head>
                         <body>
  read .number       ->  <h1>Invoice [3]</h1>                   <-+
  read .total .dueOn ->  <p>[4] due [5]</p>                     <-|
  the walk goes on   ->  <footer>...</footer>                     |
                         ...                                      |
  the row lands      ->  [3]=42  [4]=$120.00  [5]=Mar 3 -----------+
  document closes    ->  </body></html>
```

The walk never pauses at a read, nothing is buffered waiting for the row, and nothing is
re-sent. Appending the fill at the tail rather than at the hole is also what frees a value from
arriving somewhere it would be illegal — inside a `<title>`, between two `<tr>`s.

**The document closes on the last blocking sink, not on the last value.** A row still in flight
at that point is simply never filled, and the browser's own request picks it up instead.

**The cost is a client with no script.** Nothing filled after the first flush reaches it, because
filling is what the script does — so a page that must work without one uses `{await}` from step 4
and pays the delay to first byte deliberately.

## 6. The browser takes over

Markers and the bundle. Not a serialized tree to diff, and not a copy of your data in the
document — the client re-runs the same setup the server ran: every `<script>`, every `state`,
every `memo` body, again.

That sounds like paying twice, and for the loads it is not. `memo(() => getInvoice(…))` runs a
second time in the browser and makes the same call — one the browser already issued before the
bundle loaded. The render **buffered what it fetched**, so that call is answered from the buffer
rather than from the database. One code path on both sides.

What that saves is the **handler's work**, not the request — the bootstrap issues real fetches, and
what the buffer answers instead of is the database hit. They go out of the head ahead of the bundle,
so on a first visit the bundle load covers them and they cost nothing. On a repeat visit the bundle
is cached and arrives at once, so the fetches are exposed — which is why a handler that answers
`public, max-age` is worth declaring: the second visit is served from the browser cache and costs
nothing again.

Binding happens against the nodes that are already there. A marker whose content does not match
rebuilds its own block, not the page.

**What is genuinely paid twice** is a `memo` body that is expensive and is not a load — there is
nothing to seed for a pure computation. That is the case that belongs behind a handler, where it
runs on the server and arrives as data.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Sockets](../server/keep-a-room-of-callers-in-sync.md)

## 7. The next navigation

Once the page has hydrated, the browser does the rendering. A navigation fetches what the next
page reads rather than a new document, and the layouts a route shares with the one before it are
never rebuilt — a header with an open menu in it stays exactly as it was.

Read on: [Links & navigation](../pages/link-to-another-page.md) ·
[View transitions](../pages/animate-from-one-page-to-the-next.md)

## The wire carries the same seven steps

`/invoices/42`, against the page in step 4. This is what actually leaves the server.

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
holding the slot's id, and the filler script beside it.

```html browser
<h1>Invoice
<template data-abide-sink="3"></template><script>/* fill 3 */</script></h1>
<p><template data-abide-sink="4"></template><script>/* fill 4 */</script>
due <template data-abide-sink="5"></template><script>/* fill 5 */</script>
</p>
```

Those filler scripts are **byte-identical** — every one of them, in every document abide serves.
Each reads the `<template>` next to it, which is where everything specific to the slot lives.
That is what lets one build-time hash cover them all, and what keeps a per-request nonce out of
the head.

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
