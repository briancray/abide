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
  - packages/dogfood/examples/sse-wallboard.json
  - packages/dogfood/examples/jsonl-export.json
  - packages/dogfood/examples/bytes-csv.json
  - packages/dogfood/examples/stream-rows.json
---

A report of fifty thousand rows takes a while. The caller does not have to wait for the last
row to see the first — and you should not have to write a second endpoint so they do not.

Yield from the handler. What it produces is streamed as it arrives, and the same handler still
answers with the whole thing to anything that waits for the whole thing — one address, and no
second endpoint to keep in step with the first.

## The three framings

| The handler returns | The caller gets |
| --- | --- |
| an `AsyncGenerator` | **jsonl** — one JSON value per line, `application/jsonl` |
| `jsonl(values)` | the same, fixed: no `Accept` moves it |
| `sse(values)` | `text/event-stream` — the same transcript, `data: ` per line |
| `bytes(values)` | `application/octet-stream` — the chunks as they are, no framing |

Each takes `Values<T>`, and sse is reachable from jsonl without declaring it: send
`Accept: text/event-stream` to a jsonl address and the answer is reframed, which is why it
carries `vary: accept`. A helper fixes the framing, and nothing a caller asks for moves an answer
off it. Every signature is in the [Transports](../reference/transports.md) reference.

## An async generator streams as JSON Lines

A handler returning an `AsyncGenerator` is framed as **jsonl** — one JSON value per line,
`application/jsonl`, or `application/x-ndjson` for a reader that asks for NDJSON by name (16.44).
The body is written per `pull`, so back-pressure reaches your database
cursor rather than piling rows up in memory.

That is the default framing and not the only one.

## `sse` answers events whatever the caller asked for

{% example sse-wallboard %}

*1 helper, 0 lines of framing* — the arm writes `data: `, the blank line after it and the two
headers a proxy needs to leave the stream alone, by hand, per event.

The card's request carries no `Accept`, which is what a wallboard script or a `curl` sends, and
without `sse` that caller is answered jsonl. A caller that does ask — an `EventSource` sends
`Accept: text/event-stream` — gets the same events from a handler that never declared them: the
jsonl transcript reframed as `data: <json>` per line with a blank line after it, `no-cache` and
`X-Accel-Buffering: no`. That is one URL with two bodies, so it carries `vary: accept`. Declaring
`sse` is for the caller who cannot say what it wants. The `:` the card's answer opens on is a
comment, which sends the head before the first event exists.

Read on: [Response types](answer-with-something-other-than-json.md)

## `jsonl` sends a list a line at a time

{% example jsonl-export %}

*1 helper, 0 joins* — the arm serializes each row and writes the newline after it, and a
trailing one so the last line is whole to a reader that splits on them.

An array is a value, so returned bare it goes out as one JSON array (16.30) — a loader that reads
line by line gets one very long line. `jsonl` makes any `Values<T>` a stream, an array included,
and fixes the framing: a caller sending `Accept: text/event-stream` is still answered lines
(17.7).

## `bytes` writes a file as its rows are read

{% example bytes-csv %}

*1 helper, 0 stream controllers* — the arm hand-writes the `ReadableStream`: a pull per row, the
header line first, the close at the end.

Each chunk goes out as it is yielded, unframed, as `application/octet-stream`. A stream whose first
chunk is binary is answered that way without the helper (16.47); what `bytes` adds is saying so
before there is a first chunk. An export with no rows yields nothing to read the type from, and is
answered as an empty jsonl stream rather than an empty file.

## Every body helper takes `Values<T>`

```ts shared
type Values<T> = Iterable<T> | AsyncIterable<T> | ReadableStream<T>
```

One input type across `page`, `jsonl`, `sse` and `bytes`. A source that is already a
`ReadableStream` is not converted into an iterable to become one.

## The caller gets a `Reactive`, not a stream to manage

{% example stream-rows %}

*1 call, 0 line buffers* — the arm carries the tail of every chunk to the next one, a chunk
being a read of the socket rather than a row.

`salesByRegion({ year })` hands back the same `Reactive` shape the handler had, chunks
included (16.3). `rows` adopts it, so to a cursor, a guard and an await `rows` **is** that stream
(11.15), and the cursor walks on the caller's side exactly as it did on the server's:

| Spelling | Means |
| --- | --- |
| `{#for row of rows}` | every row the run has produced so far, and each one after as it lands (9.1) |
| `{rows}` | the **accumulation so far**, materialised on the read that asks for it (9.1) |
| `rows.busy()` | true until the stream **closes**; `ready()` is true from the first chunk (3.7, 3.8) |
| `await rows` on the value itself | the accumulation at close (2.7) |

Nothing copies the accumulation per chunk (9.2), and a reader is woken at most once per task
however many chunks landed in it (9.9).

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[Lists](../templates/repeat-markup-over-a-list.md)

## A reader arriving mid-run replays the run

There is no retention option on the transport and none is owed. What a late reader needs is the
answer being built, and a cursor over the stream hands it the run in flight from its start before
it goes live (2.5). So a reader arriving halfway through still paints every row.

## A stream is not a channel

Both change more than once, and how the producer produces separates them. A channel is an array
written by `patch`, and every patch leaves a whole array behind. A body that is or returns an async
generator is a stream, yielding chunks of one value (9.6), and no chunk is a whole anything. That is
why a stream is `busy()` until it closes (3.7), where a value with no producer is never busy (3.9).

What they share is keying. A `{#for}` over a stream's accumulation is positional unless something
names a key (32.13) — the block's own `by`, or a `by` the value declares (32.32) — and a row with an
identity of its own says which:

```abide #ui/pages/reports/page.abide — excerpt
{#for region of salesByRegion({ year: 2026 }) by region.code}
    <tr><td>{region.name}</td><td>{region.total}</td></tr>
{/for}
```

Read on: [Channels](../values/let-anything-publish-and-anything-read.md) · [Live updates](keep-a-room-of-callers-in-sync.md)

## A page in flight is not held for an unfinished stream

The document is **not held** for one — nothing holds it. What the stream produced by the time the
walk finished is already inline; the client's own request picks the rest up from where the render
reached, and the rows keep appending.

Seeding holds one transcript whichever framing the caller asked for — the stream's own chunks,
framed as jsonl or SSE when the browser's call takes them. `ABIDE_MAX_STREAM_BUFFER_SIZE` is the
ceiling on one, counted in jsonl bytes, and an entry past it is dropped: the browser's call runs
the handler again, and says so on `abide:hydrate`.

Read on: [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) ·
[Request to paint](../start/how-a-page-becomes-html.md)

## Next

* [Live updates](keep-a-room-of-callers-in-sync.md) — pushed rather than pulled, many callers on one channel
* [Limits](put-a-ceiling-on-a-request.md) — `timeout` is per chunk on a handler that yields
