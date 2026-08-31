---
title: Data from the server
nav: Overview
intent: A file under #server/rpc is callable, and the method you declare it with is the difference.
---

A file under `#server/rpc/**` is callable. The method you declare it with is the whole
difference between a read and a write.

| You declare | Means |
| --- | --- |
| `GET(…)` | a read any surface may call, addressed by its arguments |
| `POST` / `PUT` / `PATCH` / `DELETE` | a mutation, retaining nothing by default |
| `channel()` behind a `socket(…)` | a room many callers share |

```ts #server/rpc/invoices.ts
export const listInvoices = GET(() => database.invoice.all())
export const payInvoice = POST(({ id }: { id: string }) => database.invoice.pay(id))
```

## Reading data from a page

The import is real: the name, the argument type and the return type are the ones you
wrote on the server. There is no route to register and no client to generate.

Read on: [Reading data](read-data-without-writing-an-api.md)

## Mutations, and coalescing a double-click

A mutation retains nothing by default, and a double-click is one write rather than two.

Read on: [Mutations](change-something-on-the-server.md)

## Refusals that carry typed data

A refusal is a named value carrying data, not a status code and a sentence — so a
template and a model on the far side of a request narrow it the same way.

Read on: [Failures](refuse-a-request-and-say-why.md)

## Streaming data and pushed rooms

One handler can serve the whole result and the data as it arrives. A room goes
further: many callers on one subject, pushed rather than polled.

Read on: [Streaming data](send-data-as-it-arrives.md) ·
[Rooms & sockets](keep-a-room-of-callers-in-sync.md)

## Validation, authorization and ceilings

Validation, authorization and ceilings all sit in front of the handler, and run before
it parses anything.

Read on: [Schemas](check-what-callers-send-you.md) ·
[Authorization](decide-who-may-call-what.md) ·
[Limits](put-a-ceiling-on-a-request.md) · [CORS](let-another-origin-call-you.md)

## Responses that are not JSON

A document, a redirect or a file, each with the caching headers it should carry — and
the address a handler answers on, for the caller that is not a page.

Read on: [Response types](answer-with-something-other-than-json.md) ·
[Handler URLs](find-the-url-a-handler-answers-on.md)
