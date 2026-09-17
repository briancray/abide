---
title: Send data as it arrives
nav: Streaming data
intent: Show the first of it before the last one exists, from one handler that also serves the whole.
covers:
  - `jsonl`
  - `sse`
  - `bytes`
  - `Values<T>`
examples:
  - packages/dogfood/examples/stream-rows
---

A report of fifty thousand rows takes a while. The caller does not have to wait for the last
row to see the first — and you should not have to write a second endpoint so they do not.

Yield from the handler. What it produces is streamed as it arrives, and the same handler still
answers with the whole thing to anything that waits for the whole thing — one address, and no
second endpoint to keep in step with the first.

## The two framings

| The handler returns | The caller gets |
| --- | --- |
| an `AsyncGenerator` | **jsonl** — one JSON value per line, `application/jsonl` |
| `sse(values)` | `text/event-stream` — the same transcript, `data: ` per line |

Both take `Values<T>`, and the second is reachable from the first without declaring it: send
`Accept: text/event-stream` to a jsonl address and the answer is reframed, which is why it
carries `vary: accept`. Every signature is in the
[Transports](../reference/transports.md) reference.

## An async generator streams as JSON Lines

A handler returning an `AsyncGenerator` is framed as **jsonl** — one JSON value per line,
`application/jsonl`. The body is written per `pull`, so back-pressure reaches your database
cursor rather than piling rows up in memory.

That is the default framing and not the only one.

## `sse` frames the same stream as events

Two ways to get `text/event-stream` out of the same handler:

```ts #server/rpc/reports.ts — excerpt
import { sse } from 'abide'

export const ticks = GET(() => sse(marketFeed()))
```

Or send `Accept: text/event-stream` to the address above and get the jsonl transcript reframed
— `data: <json>` per line with a blank line after it, plus `no-cache` and
`X-Accel-Buffering: no`. One URL with two bodies, so the answer carries `vary: accept`.

Read on: [Response types](answer-with-something-other-than-json.md)

## Every body helper takes `Values<T>`

```ts shared
type Values<T> = Iterable<T> | AsyncIterable<T> | ReadableStream<T>
```

One input type across `page`, `json`, `jsonl` and `sse`. A source that is already a
`ReadableStream` is not converted into an iterable to become one, and `page(render(Component))`
needs no adapter between the two.

## The caller gets a `Reactive`, not a stream to manage

{% example stream-rows %}

*1 call, 0 line buffers* — the arm carries the tail of every chunk to the next one, a chunk
being a read of the socket rather than a row.

`salesByRegion({ year })` hands back the same `Reactive` shape the handler had, chunks
included (16.3). `rows` adopts it, so to a cursor, a guard and an await `rows` **is** that stream
(11.15), and the cursor walks on the caller's side exactly as it did on the server's:

| Spelling | Means |
| --- | --- |
| `{#for row of rows}` | every row the run has produced so far, and each one after as it lands (9.2) |
| `{rows}` | the **accumulation so far**, materialised on the read that asks for it (9.2) |
| `rows.busy()` | true until the stream **closes**; `ready()` is true from the first chunk (3.7, 3.8) |
| `{await rows}` | hold for the whole thing — the accumulation at close (2.8) |

Nothing copies the accumulation per chunk (9.3), and a reader is woken at most once per task
however many chunks landed in it (9.23).

`{:catch}` on that `{#for}` renders **after** the rows already painted rather than in place of
them — what the run produced before it failed is still what it produced.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[Lists](../templates/repeat-markup-over-a-list.md)

## A reader arriving mid-run replays the run, not a ring

There is no retention option on the transport and none is owed. `history` on a streaming producer
retains **finished runs** — a run enters the ring at its close (6.17) — and says nothing about the
run being built now. What a late reader needs is the
answer being built, and a cursor over the stream hands it the run in flight from its start before
it goes live (2.7). So a reader arriving halfway through still paints every row.

Read on: [History](../values/keep-the-last-few-values.md)

## A stream is not a channel

Both produce more than once, and what the producer declared separates them — not something
a runtime sniffs. A channel is written by `publish`, and every publish is a whole message (9.6). A
body declared `async function*` is a stream, yielding chunks of one value (9.20), and no chunk is a
whole anything. That is why a stream is `busy()` until it closes (3.7), where a channel is never
busy where it is published (3.9).

The practical consequence is keying: every production of a wired channel carries a sequence number
(18.10), which a `{#for}` over its cursor uses as the default key (18.16). A jsonl stream has none, so rows are positional unless the block spells
`by`:

```abide #ui/pages/reports/page.abide — excerpt
{#for region of salesByRegion({ year: 2026 }) by region.code}
    <tr><td>{region.name}</td><td>{region.total}</td></tr>
{/for}
```

Read on: [Channels](../values/let-anything-publish-and-anything-read.md) · [Sockets](keep-a-room-of-callers-in-sync.md)

## A page in flight is not held for an unfinished stream

The document is **not held** for one. What the stream produced by the time every blocking hole
had filled is already inline; the client's own request picks the rest up from where the render
reached, and the rows keep appending.

Seeding holds the jsonl transcript whichever framing the caller asked for — SSE is that
transcript with `data: ` in front of each line, so the reframe happens at replay and the buffer
stays a byte count. `ABIDE_MAX_STREAM_BUFFER_SIZE` is the ceiling on one.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Request to paint](../start/how-a-page-becomes-html.md)

## Next

* [Sockets](keep-a-room-of-callers-in-sync.md) — pushed rather than pulled, many callers on one channel
* [Limits](put-a-ceiling-on-a-request.md) — `timeout` is per chunk on a handler that yields
* [History](../values/keep-the-last-few-values.md) — retention, cursors and replay in full
