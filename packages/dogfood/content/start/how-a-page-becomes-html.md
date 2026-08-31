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

| Stage | What runs |
| --- | --- |
| the request arrives | your app's own route, then the middleware onion |
| the route resolves | the `page.abide` at that path, inside its layouts |
| the render starts | every load the page reads, all of them at once |
| the first bytes leave | the head, then the markup as far as it goes |
| the values land | each one fills the hole it left |
| the browser takes over | the same setup runs again, against the nodes already there |

## Three directories, and where each one runs

`src/` is the app. What decides where a file runs is which directory it is in, and the build
enforces it — a client graph that reaches into `#server/**` for anything but a handler is a
compile error naming the import, never a stub that quietly does nothing in a browser.

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

## What answers before the router does

`#server/app.ts` default-exports a route of your own, and it is asked first — a `robots.txt`, a
webhook, anything you would rather answer without a page. Return nothing and the request carries
on to the router.

```ts #server/app.ts
import { middleware, csp, onStart } from 'abide'

middleware(csp(), requireAuth())
onStart(async (start) => { await database.migrate(); await start() })

export default (request: Request) =>
  new URL(request.url).pathname === '/robots.txt' ? new Response('User-agent: *') : undefined
```

Each `middleware` rung runs per request, and they run **before** the route resolves — so a rung has
the request and nothing else. Anything that needs to know which row is being asked for is a
handler's own rung instead, where the arguments exist.

Everything abide serves goes through those rungs, `/__abide/**` included. Three things do not,
and each says why: the built assets, served in front of the pipeline; `/__abide/health`, because
a load balancer presents no credentials; and `/__abide/principal`, whose answer is composed from
the caller's own cookie.

Read on: [Auth & principal](../app/know-who-is-calling.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## The document a page renders into

`#ui/app.html` is your shell. `<slot></slot>` is where the page goes; everything around it is
yours, and it is served as written.

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
a page's `<title>` replaces its layout's. The positions are known at compile time, which is what
lets the head flush before the body has been walked.

Read on: [Head & metadata](../pages/set-the-title-and-social-preview.md) ·
[Layouts](../pages/give-pages-the-same-chrome.md) ·
[Manual rendering](../pages/render-a-document-yourself.md)

## Every load starts at once, and nothing waits its turn

Rendering a page runs its setup: the `<script>` blocks, the `state` declarations, the `memo`
bodies the markup reads. Each read that needs the server starts its work immediately, so the
loads on a page are in flight together rather than in the order the markup happens to mention
them.

The total time is the slowest one, not the sum — and the first byte does not wait for any of
them.

## Holes the values fill later

A read of a value still in flight renders nothing and opens a **sink**: an addressable slot the
value fills when it lands. The markup after it keeps going out.

```abide #ui/pages/invoices/[id]/page.abide
<h1>Invoice {invoice.number}</h1>
<p>{invoice.total} due {invoice.dueOn}</p>
```

Three sinks, one document, no loading branch. If the row arrives before the document closes, the
holes are filled in place; if it does not, the browser's own request picks it up.

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

**The cost is a client with no script.** Nothing filled after the first flush reaches it, because
filling is what the script does — so a page that must work without one uses `{await}` and pays
the delay to first byte deliberately.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## What the browser is sent

Not a serialized tree to diff, and not a copy of your data in the document. The client gets
markers — the sink and block boundaries the render emitted — plus the bundle, and it runs the
same setup the server ran: every `<script>`, every `state`, every `memo` body, again.

That sounds like paying twice, and for the loads it is not: the render **buffers what it
fetched**, and the calls the re-run makes are answered from that buffer instead of going back
over the network. One code path on both sides, and no round trip to reproduce what is already on
screen.

Binding happens against the nodes that are already there. A marker whose content does not match
rebuilds its own block, not the page.

**What is genuinely paid twice** is a `memo` body that is expensive and is not a load — there is
nothing to seed for a pure computation. That is the case that belongs behind a handler, where it
runs on the server and arrives as data.

Read on: [Reading data](../server/read-data-without-writing-an-api.md) ·
[Rooms & sockets](../server/keep-a-room-of-callers-in-sync.md)

## Every navigation after the first

Once the page has hydrated, the browser does the rendering. A navigation fetches what the next
page reads rather than a new document, and the layouts a route shares with the one before it are
never rebuilt — a header with an open menu in it stays exactly as it was.

Read on: [Links & navigation](../pages/link-to-another-page.md) ·
[View transitions](../pages/animate-from-one-page-to-the-next.md)

## Next

* [Templates](../templates/index.md) — the markup half, in full
* [Reactive values](../values/index.md) — what a read actually returns
* [Pages and navigation](../pages/index.md) — routes, layouts and error pages
