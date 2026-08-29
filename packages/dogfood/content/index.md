---
title: abide
nav: Overview
intent: Type-safe async interfaces for humans and machines. One container, both sides, no API layer.
---

Most of a web app is plumbing between two computers. A value lives on the server; you want it
on screen. So you write a route, a handler, a fetch, a loading flag, an error branch, a cache
key, and a type you keep in sync by hand.

abide deletes all six. You declare what a value *is*; reading it is what loads it.

{% example read-invoice %}

## Reactive values

Four ways to declare a value. **One container type back** — every one of them is a `State`,
so everything below reads the same on all four.

| Declaration | The value comes from |
| --- | --- |
| `state(0)` | you |
| `memo(() => a + b)` | other values |
| `memo(() => getThing({ id }))` | your server |
| `channel()` | a push — chat, presence, a feed |

```ts
const draft = state('')
const words = memo(() => draft.split(' ').length)
```

A `channel` is keyed by its arguments, so you call the one you declared to reach a room —
`chat({ id })` — and what comes back is a `State` with a `publish` on it.

Read on: [Owned values](values/show-a-value-that-changes.html) ·
[Derived values](values/derive-a-value-from-other-values.html) ·
[Loading states](values/show-a-value-that-isnt-there-yet.html)

## Templates

Inside a `.abide` file you read a container **by name**. The explicit form is what a `.ts`
file writes, and it keeps compiling in a `.abide` script too — the sugar is over it rather
than instead of it.

| In markup | In .ts | Gives you |
| --- | --- | --- |
| `{invoice}` | `invoice()` | the value |
| `{await invoice}` | `await invoice` | the value, once it lands |
| `{#for await row of rows}` | `for await (…of rows)` | each value as it arrives |
| `{#if invoice.pending()}` | `invoice.pending()` | a first load, nothing to show yet |

```abide
<h1>{invoice.number}</h1>
{#if invoice.pending()}
    <p>Loading…</p>
{/if}
```

Those four rows are the part you write every day, not the whole grammar.

Read on: [State by name](templates/read-and-write-state-by-name.html) ·
[Conditionals](templates/show-markup-conditionally.html) ·
[Lists](templates/repeat-markup-over-a-list.html)

## Data from the server

A file under `#server/rpc/**` is callable. The method you declare it with is the whole
difference between a read and a write.

| Declaration | Means |
| --- | --- |
| `GET(…)` | a read any surface may call, addressed by its arguments |
| `POST` / `PUT` / `PATCH` / `DELETE` | a mutation, retaining nothing by default |
| `channel()` behind a `socket(…)` | a room many callers share |

```ts #server/rpc/invoices.ts
export const listInvoices = GET(() => database.invoice.all())
export const payInvoice = POST(({ id }: { id: string }) => database.invoice.pay(id))
```

Read on: [Reading data](server/read-data-without-writing-an-api.html) ·
[Mutations](server/change-something-on-the-server.html) ·
[Rooms & sockets](server/keep-a-room-of-callers-in-sync.html)

## Pages and navigation

A file is a route. The parts of the path in brackets become values you can read.

| File | Serves |
| --- | --- |
| `#ui/pages/invoices/page.abide` | `/invoices` |
| `#ui/pages/invoices/[id]/page.abide` | `/invoices/42`, as `route.params.id` |
| `#ui/pages/layout.abide` | the chrome for everything below it |
| `#ui/pages/error.abide` | where a failure renders, 404 included |

```abide
<a href={url('/invoices/[id]', { id })}>See more</a>
```

Read on: [Routes](pages/add-a-page.html) · [Layouts](pages/give-pages-the-same-chrome.html) ·
[Links & navigation](pages/link-to-another-page.html)

## The running app

The things every app needs, as containers rather than as a framework object you thread
around.

| | |
| --- | --- |
| `config()` | typed settings, validated at start — and it throws in a browser |
| `principal.authenticated` | whether this caller presented something the server accepted |
| `health` | what a load balancer reads, before your auth runs |
| `log.info(…)` | structured logs, on channels you turn on one at a time |

```abide
{#if principal.authenticated}<a href="/account">Account</a>{/if}
```

Read on: [Config](app/configure-the-app.html) ·
[Auth & principal](app/know-who-is-calling.html) · [Logging](app/record-what-happened.html)

## Shipping

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | a new app |
| `abide dev` | the dev loop |
| `abide check` | type-checks the templates as well as the TypeScript |
| `abide build` then `abide start` | what you deploy |
| `abide compile` | one binary with the app inside it |

Read on: [Scaffold](ship/start-a-new-app.html) · [Checks](ship/catch-mistakes-before-you-ship.html) ·
[Build & start](ship/build-and-serve-the-app.html)

## Start here

* [Why abide](start/what-abide-is-for.html) — the idea, and who it fits
* [First page](start/your-first-page.html) — something on screen
* [Reading data](server/read-data-without-writing-an-api.html) — the guide most people want first

> **These docs run ahead of the code.** abide is documented before it is built, on purpose: a
> capability that cannot be explained as a problem an app author has is not ready to be a
> capability. Pages marked *stub* have a decided title and intent, and no prose yet, and an
> example's Result, Compiled, Bench and Tests panels are written by hand until there is a
> compiler and a harness to produce them. Files and Download are real.
