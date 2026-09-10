---
title: Keep a handler off a surface
nav: Withholding a surface
intent: One record decides which of the four surfaces carry a handler — and none of it is access control.
covers:
  - `Clients`
  - rpc › `clients`
  - socket › `clients`
  - Generated surfaces › `clients`
---

A handler declared once is reached four ways: imported by a page, listed in an OpenAPI
document, offered to a model as a tool, and callable from the CLI. `clients` decides which of
those four **carry** it.

```ts shared
type Clients = { ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }
```

```ts #server/rpc/admin.ts — excerpt
export const rebuildSearchIndex = POST(rebuild, {
    clients: { ui: false, mcp: false },
})
```

## Every key defaults to true

A handler you declare is on every surface unless you say otherwise. That is the right default
because the alternative — opting each handler into each surface — is four decisions per handler
and a fifth surface later that nothing is on.

Every surface is **derived from the route table** rather than authored beside it, so a handler
added is a handler listed, and there is no second file to keep in step.

## `clients` decides what is generated, never who may call

**`clients` is not access control.** A handler with `mcp: false` is absent from the tool list
and answers on its http address exactly as it did. Nothing about withholding a listing
withholds the endpoint.

That separation is deliberate and worth stating plainly, because the shape invites the other
reading. A listing is a **catalogue**; who may call is a **rung**. An app that treated a missing
catalogue entry as a lock would have security that depends on nobody guessing an address, which
is the failure mode this design refuses to make available.

The rule falls out of it: a handler whose own middleware would refuse a caller is **still
listed**, and still refused on the call. The catalogue describes the app, and the rung answers
the question.

Read on: [Authorization](../server/decide-who-may-call-what.md)

## `ui: false` is the one that reaches the compiler

`ui: false` generates no client wrapper, and importing that handler from `#ui` or a `.abide`
file is then a **compile error**. That is the difference between it and the other three: the
others withhold a listing, and this one withholds a name.

It is what an admin-only mutation wants. The compile error is not a security boundary, and the
rung is still the answer. But a handler no page should call is a handler no page should be able
to *name*, and finding that out at build beats finding it out in review.

## The same option, on a socket

`clients` on a `socket` decides which surfaces carry that room, and reads the same way. A feed
served to browsers and withheld from the tool list is `{ mcp: false }` on the socket, and the
room itself is untouched — a transport option never reaches the producer.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md)

## A `Response` turns two of them off by default

`clients.mcp` and `clients.cli` default to **false** on a handler that returns a whole
`Response`, a `Response` having no output schema to publish. Turn them back on where the body
is JSON you wanted a header on.

Read on: [Response types](../server/answer-with-something-other-than-json.md)

## Next

* [OpenAPI](describe-your-api-without-writing-a-spec.md) — the surface `openapi` gates
* [MCP](let-a-model-call-your-handlers.md) — the surface `mcp` gates
* [Authorization](../server/decide-who-may-call-what.md) — where access control actually goes
