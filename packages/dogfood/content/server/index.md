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

```ts #server/rpc/invoices.ts — excerpt
export const listInvoices = GET(() => database.invoice.all())
export const payInvoice = POST(
    ({ id }: { id: string }) => database.invoice.pay(id),
)
```

## Reading data

{% lead server/read-data-without-writing-an-api %}

Read on: [Reading data](read-data-without-writing-an-api.md)

## Mutations

{% lead server/change-something-on-the-server %}

Read on: [Mutations](change-something-on-the-server.md)

## Failures

{% lead server/refuse-a-request-and-say-why %}

Read on: [Failures](refuse-a-request-and-say-why.md)

## Streaming data

{% lead server/send-data-as-it-arrives %}

Read on: [Streaming data](send-data-as-it-arrives.md)

## Sockets

{% lead server/keep-a-room-of-callers-in-sync %}

Read on: [Sockets](keep-a-room-of-callers-in-sync.md)

## Schemas

{% lead server/check-what-callers-send-you %}

Read on: [Schemas](check-what-callers-send-you.md)

## Authorization

{% lead server/decide-who-may-call-what %}

Read on: [Authorization](decide-who-may-call-what.md)

## CORS

{% lead server/let-another-origin-call-you %}

Read on: [CORS](let-another-origin-call-you.md)

## Limits

{% lead server/put-a-ceiling-on-a-request %}

Read on: [Limits](put-a-ceiling-on-a-request.md)

## Response types

{% lead server/answer-with-something-other-than-json %}

Read on: [Response types](answer-with-something-other-than-json.md)

## Handler URLs

{% lead server/find-the-url-a-handler-answers-on %}

Read on: [Handler URLs](find-the-url-a-handler-answers-on.md)
