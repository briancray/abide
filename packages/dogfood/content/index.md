---
title: abide
nav: Overview
intent: Type-safe reactive async interfaces for humans and machines. One type, both sides, no API layer.
examples:
  - packages/dogfood/examples/read-invoice
---

Most of a web app is plumbing between two computers. A value lives on the server; you want it
on screen. Today that means a route, a handler, a fetch, a loading flag, an error branch, a
cache key, and a type you keep in sync by hand.

In abide it is the handler, and a page that reads it. You declare what a value *is*, and
reading it is what loads it — there is nothing in between for you to write.

{% example read-invoice %}

## Reactive values

{% lead values/index %}

Read on: [Reactive values](values/index.md) ·
[Local state](values/show-a-value-that-changes.md) ·
[Loading states](values/show-a-value-that-isnt-there-yet.md) ·
[Sockets](server/keep-a-room-of-callers-in-sync.md)

## Templates

{% lead templates/index %}

Read on: [Templates](templates/index.md) ·
[Values by name](templates/read-and-write-a-value-by-name.md) ·
[Conditionals](templates/show-markup-conditionally.md) ·
[Lists](templates/repeat-markup-over-a-list.md)


## Data from the server

{% lead server/index %}

Read on: [Data from the server](server/index.md) ·
[Reading data](server/read-data-without-writing-an-api.md) ·
[Mutations](server/change-something-on-the-server.md) ·
[Sockets](server/keep-a-room-of-callers-in-sync.md)


## Pages and navigation

{% lead pages/index %}

Read on: [Pages and navigation](pages/index.md) ·
[Routes](pages/add-a-page.md) · [Layouts](pages/give-pages-the-same-chrome.md) ·
[Links & navigation](pages/link-to-another-page.md)


## The running app

{% lead app/index %}

Read on: [The running app](app/index.md) ·
[Config](app/configure-the-app.md) ·
[Auth & principal](app/know-who-is-calling.md) · [Logging](app/record-what-happened.md)


## For machines

{% lead machines/index %}

Read on: [For machines](machines/index.md) ·
[OpenAPI](machines/describe-your-api-without-writing-a-spec.md) ·
[MCP](machines/let-a-model-call-your-handlers.md)


## Shipping

{% lead ship/index %}

Read on: [Shipping](ship/index.md) ·
[Scaffold](ship/start-a-new-app.md) · [Checks](ship/catch-mistakes-before-you-ship.md) ·
[Build & start](ship/build-and-serve-the-app.md) ·
[Call a handler](ship/call-a-handler-from-the-terminal.md)


## Reference

{% lead reference/index %}

Read on: [Reference](reference/index.md) · [Reactive](reference/reactive.md) ·
[Transports](reference/transports.md) · [`.abide` files](reference/abide-files.md) ·
[CLI](reference/cli.md)


## Start here

* [Why abide](start/what-abide-is-for.md) — the idea, and who it fits
* [First page](start/your-first-page.md) — something on screen
* [Reading data](server/read-data-without-writing-an-api.md) — the guide most people want first

> **These docs run ahead of the code.** abide is documented before it is built, on purpose: a
> capability that cannot be explained as a problem an app author has is not ready to be a
> capability. Pages marked *stub* have a decided title and intent, and no prose yet, and an
> example's Result, Compiled, Bench and Tests panels are written by hand until there is a
> compiler and a harness to produce them. Files and Download are real.
