---
title: Keep the last few values
nav: Recent values
intent: A log pane, a chat scrollback, the last n readings — an array the value holds, trimmed where it is appended to.
covers:
  - `ABIDE_MAX_STREAM_BUFFER_SIZE`
examples:
  - packages/dogfood/examples/tail-window.json
  - packages/dogfood/examples/tail-undo.json
---

A chat pane wants the last fifty messages. A log viewer wants the last five hundred lines. A
sensor readout wants the last twenty samples. In each case something keeps arriving and the page
wants a window onto the recent past — not the latest one, and not all of them.

The window is an array the value holds. You append to it and trim it in one `patch`, and how much
it keeps is a line of your code rather than an option of ours.

## A window is an array trimmed in the patch that appends

{% example tail-window %}

*1 patch, 2 lines in it* — the push and the trim, against the array the hand-written arm trims and
the list it rebuilds per token.

`patch` hands you the held array and mutates it in place (5.7), so the push and the trim are one
write and readers wake once for both. abide puts no cap on the array, so the trim is the condition
you write: a count here, an age or a byte total wherever that is what bounds it. The latest value is
`token.at(-1)`, and `{#for line of token}` is the window.

`by: 'at'` is what keeps the trim cheap. A keyed `{#for}` moves the rows it keeps (32.29), so a token
adds one row and drops one, and the three in between are not touched. Without `by` the rows are
positional (32.13): a `shift` moves every value up one place, and every row is rewritten. Give each
value an id when it is appended, and declare `by` on the value that holds them.

Read on: [Patching a list](patch-a-list-from-a-live-feed.md) ·
[Lists](../templates/repeat-markup-over-a-list.md)

## A value keeps no past of its own

Every `Reactive` holds its standing value and nothing before it. Where you want the ones before it,
hold them: make the value the array, and append where you write.

A reader cannot build the window for you. `for await` over a value hands back the standing value
once per turn, and a burst of writes in one turn is one step (2.6), so a window a reader assembles
misses whatever landed in the same turn. The writer sees every value, which is why the window is
built where the write is.

A channel is this same shape with many writers — a `reactive` over an array that everyone connected
reads, trimmed the same way.

Read on: [Channels](let-anything-publish-and-anything-read.md)

## An undo stack is history the app keeps

{% example tail-undo %}

A window is the recent past of a list many readers follow. An undo stack is the private past of one
value, walked by the one reader typing into it, and the value itself stays a string. The past is an
array the app pushes into — here from a `watch` over the draft. abide leaves the stack to you,
because what a stack should coalesce, discard and restore differs per app.

Two things decide how you build it.

Each entry has to be a distinct object, or every restore hands back the value already on screen.
A string already is one. A record is one when it is written through a member path, because that
write copies down the path (31.8).

And **an undo is itself a write**, so the `watch` pushes it onto the same array — walk backwards
through an array you are also appending to and the second step reads the first one back. So the
position lives over a snapshot: take one when a run begins and move an index over it, which is the
`run` and `at` pair in `undoStack.ts`.

Read on: [Watching values](do-something-when-a-value-changes.md) ·
[Values by name](../templates/read-and-write-a-value-by-name.md)

## A copy per write is the wrong shape for a stream of items

A write through a member path copies down that path and then sets, so the reference moves and
readers wake (31.8). It costs a copy per write, so it is the wrong shape for items arriving one at a
time:

```ts shared
for (const row of incoming) rows.push(row)   // O(n²) — a copy per row
```

`patch` is the escape. It mutates the array it already holds rather than copying it (5.7), so a
batch is one call — `rows.patch((list) => list.push(...incoming))` — and one wake, however many rows
it brought.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md) ·
[Patching a list](patch-a-list-from-a-live-feed.md)

## `ABIDE_MAX_STREAM_BUFFER_SIZE` caps a transcript in memory

A window is counted in values. The thing that can actually run away is bytes, and one variable caps
it wherever a stream's transcript is held:

| | |
| --- | --- |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | bytes, default `Infinity` |

It governs a seed buffer entry's transcript: an entry past it stops holding the stream, and the
browser's call runs the handler again and says so on `abide:hydrate` (36.18).

A seed buffer entry needs no other bound: it is single-use and lives seconds, so the exposure is
request rate multiplied by transcript size, and size is the only dimension that can grow. A count
ceiling would evict an entry a document in flight is about to claim, which is the one failure the
buffer exists to avoid.

Read on: [Configuration](../reference/configuration.md) ·
[Streaming HTML](../pages/send-the-page-before-the-data-lands.md)

## Next

* [Channels](let-anything-publish-and-anything-read.md) — the same window, written by many
* [Streaming data](../server/send-data-as-it-arrives.md) — where chunks come from
* [Watch a channel](../ship/watch-a-room-from-the-terminal.md) — a channel followed from a shell
