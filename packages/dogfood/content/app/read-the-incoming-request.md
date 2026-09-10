---
title: Read the incoming request
nav: Request
intent: Headers, the raw Request, and the response being built back.
covers:
  - `request`
  - `response`
  - `server`
---

Three ambient values, all server-side, all **request-local**: the request being served, the
response being built for it, and the listening server. Nothing hands them to you, and there is
no context object to thread through a call stack to reach one.

## `request()` is the real `Request`

```ts #server/rpc/invoices.ts — excerpt
const locale = request().headers.get('accept-language') ?? 'en'
```

It is the platform's own `Request`, not a wrapper — so everything you already know about one
applies, and anything that takes a `Request` takes this.

**On an rpc route the body belongs to `ctx.args()`.** A body reads once, so `request().json()`
in a rung takes it and every rung after that one, and the handler, get nothing. That is the
whole reason `ctx.args()` exists rather than being a convenience over the request: there is no
second way in on that lane.

Headers, the URL, the method and the signal are all fine to read. The body is the one part with
an owner.

Read on: [Authorization](../server/decide-who-may-call-what.md) ·
[Schemas](../server/check-what-callers-send-you.md)

## `response()` is the response being built

```ts server
response().headers.set('x-invoice-run', runId)
```

It hands back the status and headers **as they stand**, before the body has been decided. That
is what lets a rung deep in the stack contribute a header without becoming the thing that
returns the response — the alternative is every layer passing a partial response outward and
the outermost one assembling it.

A handler that returns a whole `Response` decides its own; `response()` is for the case where
you want to add to whatever the handler is going to send.

Read on: [Response types](../server/answer-with-something-other-than-json.md)

## `server()` is the listening server

The `Bun.Server` the app is running on, typed by its `WebSocketData`. It is the escape hatch: a
`server().upgrade()` for a protocol abide does not carry, `server().requestIP()` for a rate
limiter that needs one.

Reaching for it is a signal worth noticing. Most of what an app wants from the server is
already a name — a socket is `socket`, an address is `rpc.url` — so a `server()` call is either
something genuinely outside the framework or a name that has not been found yet.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md)

## Request-local means request-local

Each of these is scoped to the request being served, and there is no moment at which one
request's is visible to another's. That is not a convention to be careful about — it is what
"ambient" means on a server, and it is the same scoping `principal`, `route` and `config` are
under.

In a browser there is no request, so `request()` and `response()` are not there to read. That
is the one place these three differ from the ambients that answer on both sides.

Read on: [Ambient values](../reference/ambient-values.md)

## Next

* [Authorization](../server/decide-who-may-call-what.md) — the lane that reads these first
* [Auth & principal](know-who-is-calling.md) — who the request is from
* [Ambient values](../reference/ambient-values.md) — the whole set, in one table
