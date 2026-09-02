---
title: Put a ceiling on a request
nav: Limits
intent: Bound how long a call may run and how much a caller may send.
covers:
  - `timeout`
  - `maxBodySize`
  - `ABIDE_RPC_TIMEOUT`
  - `ABIDE_MAX_REQUEST_BODY_SIZE`
---

An upload endpoint with no ceiling will one day be handed a four-gigabyte file. A report that
usually takes two seconds will one day take four hundred, holding a connection the whole time.

Both are one option each, on the handler that has the exposure.

```ts #server/rpc/imports.ts
export const importLedger = POST(ingest, {
    maxBodySize: 8 * 1024 * 1024,
    timeout: 30_000,
})
```

*2 lines, 0 reverse-proxy rules* — and the ceiling lives beside the handler it is about, so
moving the handler moves it.

## `maxBodySize` is checked before buffering

The largest request body a mutation will accept, in bytes. An over-size **declared**
`content-length` is `413` before anything is read into memory, so a caller announcing four
gigabytes is refused without being given four gigabytes of attention.

A body with no declared length is bounded as it streams, and cut off at the same number.

Only a mutation carries a body, so this option means nothing on a `GET`.

Read on: [Mutations](change-something-on-the-server.md)

## `timeout` is milliseconds without progress

Not wall-clock from the first byte. On a handler that yields, it is **per chunk** — which is
what makes one number right for both shapes: a report that produces a row every second runs for
an hour under `timeout: 30_000`, and the same number still catches a source that has stopped
producing.

A call that exceeds it fails with `504`. That is an undeclared refusal — `name: 'HttpError'`,
no data — since a timeout has nothing to narrow **to**.

Read on: [Failures](refuse-a-request-and-say-why.md) · [Streaming data](send-data-as-it-arrives.md)

## `ABIDE_RPC_TIMEOUT` and `ABIDE_MAX_REQUEST_BODY_SIZE` set the floor

| | Default | What it bounds |
| --- | --- | --- |
| `ABIDE_RPC_TIMEOUT` | `Infinity` | ms a call may go without progress |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `Infinity` | bytes of a mutation's body |

Both default to no ceiling, which is the honest default: abide cannot know that your slowest
report is legitimate. Set them per deployment to catch what a handler forgot; the handler's own
option is the real knob, being the one that knows what the work costs.

Read on: [Config](../app/configure-the-app.md)

## A `signal` aborts one reader, not the load

A ceiling protects the server. The caller has its own way out, and it is reader-local:

```ts browser
const rows = memo(() =>
    salesByRegion({ year: 2026 }, { signal: controller.signal }),
)
```

`signal` detaches **this** reader and rejects **this** read. The shared load runs to completion
for the other readers, and still populates the memo entry when every reader has left — so the
next reader gets it free. An aborted read never becomes the memo's `error()`.

Read on: [Caching](../values/load-once-per-set-of-arguments.md)

## Neither ceiling is a rate limit

Neither option is a rate limit, and abide ships none. A caller making ten thousand well-formed,
fast, small requests passes both ceilings — that is a rung, and middleware is where it goes.

Read on: [Authorization](decide-who-may-call-what.md)

## Next

* [Authorization](decide-who-may-call-what.md) — the rung a rate limit belongs in
* [Streaming data](send-data-as-it-arrives.md) — why `timeout` counts per chunk
* [Config](../app/configure-the-app.md) — reading these values back at runtime
