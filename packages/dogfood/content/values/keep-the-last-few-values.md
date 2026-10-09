---
title: Keep the last few values
nav: History
intent: A log pane, a chat scrollback, the last n readings — bounded, and cheap to append to.
covers:
  - `history`
  - `s.history`
  - `History<Stored>`
  - `for await (… of s)`
  - `s[Symbol.asyncIterator]`
  - `ABIDE_MAX_STREAM_BUFFER_SIZE`
examples:
  - packages/dogfood/examples/tail-window.json
  - packages/dogfood/examples/tail-cursor.json
  - packages/dogfood/examples/tail-undo.json
---

A chat pane wants the last fifty messages. A log viewer wants the last five hundred lines. A
sensor readout wants the last twenty samples. In each case something keeps arriving and
the page wants a window onto the recent past — not the latest one, and not all of them.

`history` is that window, and it is a number on the value rather than an array you maintain beside
it.

## `history` decides how far back a value's past goes

{% example tail-window %}

*1 number, 0 arrays* — the ring is appended to and trimmed by the value, and what a reader asks
for is capped by the value rather than by the reader.

## `history` is an option on every value but a stream

Every `Reactive` holds its standing production. With no `history` it retains none before it
(6.16), so a cursor over it replays that one and goes live (2.5). `history: n` keeps n more beside
it, and a value you write, a derived value and a keyed value all take it (11.39). A keyed value
keeps one ring per entry (9.28).

`s.history(n)` is a member of every `Reactive`, so the cursor is spelled the same whatever keeps the
past. A value adopting another forwards it to the value it adopted (9.15).

A stream keeps its finished runs. A run enters the ring when it **closes**, as the accumulation at
close (6.17), so `history` means the same thing on one as everywhere else. So does `ttl`: its clock
starts at that close, and never reaches the run in flight (6.22). A run that failed or
that a trigger replaced enters nothing (6.20), and a replay ends at the last run that closed
(6.21). A reader
arriving mid-run gets the run in flight from its start, which is what a cursor over it does (2.7).

Read on: [Caching](load-once-per-set-of-arguments.md)

## The unit is the value, not the piece

`history` counts `Stored`, and on a channel that is a message (6.3). `{ history: 100 }` keeps a
hundred past messages beside the latest, whether a `publish` or a `set` produced them.

Which is why `history` on a value of `Row[]` retains a hundred **arrays**, not a hundred rows.
Pushing into an array is not a production — it is a mutation of one value — so where you want a
past over items, **publish the item**.

A chunk is a piece of one value rather than a past one, so it is not what history is made of. A
ring of chunks would replay a fragment of one answer and no answer at all. `Produced` is a fourth
parameter on `Reactive` and defaults to `Stored`, so nothing that is not a stream ever writes it
— and where it comes apart, it types the live cursor rather than the ring.

Read on: [Streaming data](../server/send-data-as-it-arrives.md) ·
[Sockets](../server/keep-a-room-of-callers-in-sync.md)

## `s.history(n)` replays the ring; a bare cursor goes live

{% example tail-cursor %}

`s.history(n)` is always called, and hands back a `History<Stored>` — `Iterable` **and**
`AsyncIterable`, with nothing allocated until one of the two is pulled. The synchronous face is
the snapshot, now; the asynchronous one replays that snapshot and then goes live.

`n` is **replay depth and nothing else** — `min(n, retained)`, defaulting to everything retained.
It says how far back a reader starts and says nothing about what the reader goes on to accumulate.
`history(0)` replays nothing and goes live. Those are two different numbers, and the card has both:
`history: 200` on the value bounds what may be replayed, `history(3)` in the block is where that reader
started.

Both readers on the card see every arrival after they opened, which is the part worth being clear
about — a bare cursor is not a smaller window onto the past, it is **no** window onto it.

A bare `for await (… of s)` is the **live** cursor. It yields the production in flight from its
start and then what follows it, and it replays no past value at all. Spell `s.history(n)` where you
want the ring first.

The two walk different units. The ring holds past `Stored` values and the bare cursor yields
`Produced`, which is why `Produced` is a type parameter of its own.

In a template the cursor is the block's subject. `{#for item of source}` reads the value like
any name; `{#for item of source.history(n)}` replays the ring and then goes live, and `history(0)` goes
live without replaying. `by` keys it exactly as over a list — a wired value's default key being
the production's own `seq` (18.16).

The block holds what the value retains and nothing more: a row leaves once the value's retention
drops its production, so `history` is both how far back a block replays and the bound on what it
paints.

Read on: [Lists](../templates/repeat-markup-over-a-list.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## An undo stack is history the app keeps

{% example tail-undo %}

A channel is live state many readers follow. An undo stack is the private past of one value, walked
by the one reader typing into it, and `history` is not how it is built. The value holds its latest,
and the past is an array the app pushes into — here from a `watch` over the draft. abide leaves the stack to you, because what a stack should coalesce, discard and restore
differs per app.

Two things decide how you build it.

Each entry has to be a distinct object, or every restore hands back the value already on screen.
A string already is one. A record is one when it is written through a member path, because that
write copies down the path.

And **an undo is itself a write**, so the `watch` pushes it onto the same array — walk backwards
through an array you are also appending to and the second step reads the first one back. So the
position lives over a snapshot: take one when a run begins and move an index over it, which is the
`run` and `at` pair in `undoStack.ts`.

Read on: [Watching values](do-something-when-a-value-changes.md) ·
[Values by name](../templates/read-and-write-a-value-by-name.md)

## A copy per write is the wrong shape for a stream of items

A write through a member path copies down that path and then sets, so the reference moves and
readers wake. It costs a copy per write, so it is the wrong shape for items arriving one at a time:

```ts shared
for (const row of incoming) rows.push(row)   // O(n²) — a copy per row
```

Two escapes, and which one is right depends on what you wanted. `rows().push(row)` is the
unlifted O(1) form — a read hands back the array, and pushing to it plainly wakes nobody. And
where you wanted a past over the rows, publish the row to a value that declares `history`.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md) ·
[Patching a list](patch-a-list-from-a-live-feed.md)

## Retention costs nothing that scales with `history`

Retention is **append-only**: a ring of the standing production and `history` more, a version bump for readers to subscribe
to, and the snapshot materialised on the read that follows.

That shape is the point of the design rather than an implementation note. Rebuilding an
accumulating value to signal a change — `concat` per chunk — is O(n²) over a stream, so the signal
is separated from the payload: push into the ring, bump the version, materialise on read. Raising
`history` from 50 to 5000 does not make a write dearer (6.2), and that is the one timing claim that stays
honest across substrates, being a ratio between two sizes of the same structure.

`ttl` expiry costs nothing per write either. Entries past it are dropped on the read that follows
— no timer per entry, no version bump — and a live cursor delivers **arrivals**, so it never sees
an expiry and is right not to. Retention bounds what a **later** subscriber can replay, and
a later subscriber is the only reader an expiry is visible to.

Read on: [Reloading](decide-when-a-value-reloads.md)

## `ABIDE_MAX_STREAM_BUFFER_SIZE` caps a transcript in memory

`history` counts productions. The thing that can actually run away is bytes, and one variable caps it
wherever a transcript is held:

| | |
| --- | --- |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | bytes, default `Infinity` |

It governs a seed buffer entry's transcript: an entry past it stops holding the stream, and the
browser's call runs the handler again and says so on `abide:hydrate`.

A seed buffer entry needs no other bound: it is single-use and lives seconds, so the exposure is
request rate multiplied by transcript size, and size is the only dimension that can grow. A count
ceiling would evict an entry a document in flight is about to claim, which is the one failure the
buffer exists to avoid.

Read on: [Configuration](../reference/configuration.md) ·
[Streaming HTML](../pages/send-the-page-before-the-data-lands.md)

## Next

* [Streaming data](../server/send-data-as-it-arrives.md) — where chunks come from
* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — where messages come from
* [Watch a channel](../ship/watch-a-room-from-the-terminal.md) — the same cursor from a shell
