---
title: Follow a request across services
nav: Tracing
intent: One id on every line of one request, and the header that carries it to the next service.
covers:
  - `trace`
  - `trace.span`
  - `trace.sampled`
  - `trace.headers`
  - `traceresponse`
  - `server-timing`
---

Every log line an abide app writes carries a `trace`. It is the id of the operation the work
belongs to, so the twelve lines one request produced are twelve lines you can select rather
than twelve lines interleaved with everybody else's.

## `trace()` is built on first ask and held

There is nothing to start and nothing to pass down. The id is built the first time something
asks for it and held for the request, so a rung, a handler and a component rendering on the
server all read the same one.

A request arriving with a `traceparent` continues that trace rather than starting a new one,
which is what makes the id useful across a service boundary at all.

## `trace.sampled()` carries the caller's decision verbatim

The upstream decided whether this trace is sampled, and abide **carries that decision through
unchanged**. It does not re-decide, and it does not sample on its own.

That is the only behaviour that composes. A service that re-decides produces traces with holes
in them — a sampled parent whose child chose not to be, which is a trace you cannot read and
did not save anything by not having.

Read it where the cost of recording something is worth avoiding:

```ts server
if (trace.sampled()) log.debug('cache table', { entries: cache.size })
```

## `trace.span` wraps a body and returns what it returned

```ts server
const rows = await trace.span('database.search', () =>
    database.invoices.search(query, limit),
)
```

`trace.span` hands back **exactly what its body returned**, so wrapping a call in one is not a
refactor: the value, the type and the timing are the body's, and removing the wrapper later
changes nothing but the record.

A span **is a `LogRecord`**, not a second feed. That is the decision worth knowing: there is one
stream of things that happened, so a span and a log line are read by the same tooling, gated by
the same namespaces and tailed by the same command. A separate span feed would be a second thing
to ship, a second thing to configure, and a second place for a correlation id to go wrong.

Each carries `startedAt` as ISO-8601 and its duration as a **monotonic** measurement — a wall
clock can go backwards, and a negative duration is a metric nobody can act on.

Read on: [Logging](record-what-happened.md)

## `trace.headers()` is what an outbound request carries

```ts server
const answer = await fetch(billing, { headers: trace.headers() })
```

It carries `traceparent` naming the **current span** as parent, so the next service's trace
hangs off the work that called it rather than off the request as a whole. Merge it into
whatever headers the call already has; it is a plain record.

`traceresponse` comes back the other way, on the response, so a caller can record which trace
answered it without the callee having to log on the caller's behalf.

Read on: [Handler URLs](../server/find-the-url-a-handler-answers-on.md)

## `server-timing` is what the browser's network panel reads

Every handler answer carries `server-timing` with **the handler's own duration**, which is the
number the request's own timing hides. A call that took 900 ms because the service it reached
out to took 850 shows the 850 on the handler, not somewhere in the transfer.

The metric's name says which run the time is from, since the row already names the handler:

* `Direct` — the handler ran for this request.
* `Seeded` — the page's render had already fetched it, and the duration is how long that run
  took. It would otherwise look exactly like a fresh call that happened to be fast.
* `Cached` — a `global` value already held answered it, and nothing ran.
* `Started` — a stream, timed to its first chunk, which is what the response waited for.

Where `middleware` ran — the app's, the handler's, or both — their time is **`Middleware`**, and
`Direct` is the handler's body alone. A slow guard and a slow query no longer read as one number.

A span joins them where you ask it to. Its name becomes the metric, so it has to be a plain
token — no spaces:

```ts server
const rows = await trace.span(
    'search',
    () => database.invoices.search(query, limit),
    { timing: true },
)
```

Only what finished **before the head went out** can be in it. A page sends its head before it
renders, so a page's entry is its `Middleware` and nothing from the render; the render's calls
show their own time as `Seeded` on the requests that follow. A span is opt-in because its name
is visible to anyone with the network panel open.

## Next

* [Logging](record-what-happened.md) — the records a trace threads through
* [Health](tell-a-load-balancer-you-are-healthy.md) — the other thing an operator scrapes
* [Ambient values](../reference/ambient-values.md) — `trace` beside the rest
