---
title: Keep the last few values
nav: History & tail
intent: A log pane, a chat scrollback, the last n readings — bounded, and cheap to append to.
covers:
  - state › `tail`
  - `s.tail`
  - `Tail<Produced>`
  - `Produced`
  - `for await (… of s)`
  - `s[Symbol.asyncIterator]`
  - `ABIDE_MAX_STREAM_BUFFER_SIZE`
examples:
  - packages/dogfood/examples/tail
---

A chat pane wants the last fifty messages. A log viewer wants the last five hundred lines. A
sensor readout wants the last twenty samples. In each case the value is a stream of things and
the page wants a window onto the recent past — not the latest one, and not all of them.

`tail` is that window, and it is a number on the value rather than an array you maintain beside
it.

{% example tail %}

*1 number, 0 arrays* — what was missed replayed, then live from where the replay ended, with no
gap and no duplicate.

{% snippet tail src/ui/pages/console/page.abide const records = memo( %}

## `tail` defaults to 1, so retention is asked for

Every `Reactive` retains **one** production by default — the latest, which is a snapshot and
nothing more. Set `tail` to keep more. Every reactive value takes one.

Leave it at the default on a room and a subscriber arriving late replays one message. Leave it at
the default on a `global` memo fanning one stream out and a late reader replays one chunk and goes
live — a truncated answer rather than an error, which is why `tail: Infinity` is spelled there
rather than inferred from the body having produced a stream.

Read on: [Caching](load-once-per-set-of-arguments.md)

## The unit is what the producer yielded

One rule, reading three ways. `Produced` is the type of it.

| The producer | Yields | So `tail(100)` retains |
| --- | --- | --- |
| a state — `set` | a value | the last 100 values |
| a room — `publish` | a message | the last 100 messages |
| an async-generator body | a chunk | the last 100 chunks |

Which is why a `tail` on a `Reactive<Row[]>` retains a hundred **arrays**, not a hundred rows.
Pushing into an array is not a production — it is a mutation of one value — so where a tail over
items is what you want, **the item has to be produced**:

{% snippet tail src/server/rpc/logs.ts const recent = memo( %}

`Produced` is a third parameter on `Reactive` and defaults to `Stored`, so nothing that is not a
stream ever writes it. For a streaming producer they come apart: `Stored` is the accumulation and
`Produced` is the chunk.

Read on: [Streaming data](../server/send-data-as-it-arrives.md) ·
[Sockets](../server/keep-a-room-of-callers-in-sync.md)

## `s.tail(n)` is `Iterable` and `AsyncIterable` both

`s.tail(n)` is always called, and hands back a `Tail<Produced>` — `Iterable` **and**
`AsyncIterable`, with nothing allocated until one of the two is pulled. The synchronous face is
the snapshot, now:

{% snippet tail src/ui/pages/console/page.abide function copyRecent() { %}

`n` is **replay depth and nothing else** — `min(n, retained)`, defaulting to everything retained.
It says how far back a reader starts and says nothing about what the reader goes on to
accumulate. `tail(0)` replays nothing and goes live. Those are two different numbers, and the
example above has both: `tail: 200` on the value is what may be replayed, `tail(50)` in the block
is where this reader started.

A bare `for await (… of s)` **is** `s.tail()`: `s[Symbol.asyncIterator]` is defined as it, so the
live cursor is not a second mechanism and the bare form cannot mean something the spelled-out call
does not.

In a template that is the same pair. `{#for await item of source}` over a bare name replays what
the value retained; name the depth to say otherwise, and `by` keys it exactly as `{#for}` does —
a room's default key being the message's own `seq`.

{% snippet tail src/ui/pages/console/page.abide {#for await line of records.tail(50)} … {#if line.text.includes(filter)} … {/for} %}

There is no cap on what the **block** then accumulates. A stream painting a hundred thousand rows
is yours to bound, exactly as a `{#for}` over a hundred thousand items is; conflating the two into
one number made a chat room's default retention render one message.

Read on: [Lists](../templates/repeat-markup-over-a-list.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## An undo stack builds on a state's own history

A state's productions are its past values, so a `tail` past the default is the history an undo
stack needs. abide gives you the history and not the stack, because what a stack should coalesce,
discard and restore differs per app.

{% snippet tail src/shared/undo.ts export function undoStack %}

Two things decide how you build it, and both are on this page already.

The copy-on-write below makes replay work at all: each retained entry has to be a
distinct object, or every restore hands back the value already on screen.

And **an undo is itself a write**, so it appends to the same ring — walk backwards through a ring
you are also appending to and the second step reads the first one back. So the position lives
outside the value: snapshot the history when a run begins and move an index over that array,
which is the `history` and `at` pair above.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md)

## A mutated value replays nothing

A write through a member path copies down that path and then sets, so the reference moves and
readers wake — and because the copy is a
distinct object, `structural` sees a change where mutating in place would have shown it none. The copy makes a tail
worth having: `doc.title = 'Draft'` copies down the path, so
each of those fifty entries is a distinct object. Mutate in place instead and the ring holds fifty
references to one value — replaying it replays nothing, with nothing thrown and nothing wrong in
the markup.

What it costs is a copy per write, so this is the wrong shape for a stream:

```ts shared
for (const row of incoming) rows.push(row)   // O(n²) — a copy per row
```

Two escapes, and which one is right depends on what you wanted. `rows().push(row)` is the
unlifted O(1) form — a read hands back the array, and pushing to it plainly wakes nobody. And
where the point was a tail over the rows, the row should be produced: a `Reactive` whose
value is the item, retained by `tail`.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md) ·
[Patching a list](patch-a-list-from-a-live-feed.md)

## Retention costs nothing that scales with `tail`

Retention is **append-only**: a ring of `tail` entries, a version bump for readers to subscribe
to, and the snapshot materialised on the read that follows.

That shape is the point of the design rather than an implementation note. Rebuilding an
accumulating value to signal a change — `concat` per chunk — is O(n²) over a stream, so the signal
is separated from the payload: push into the ring, bump the version, materialise on read. Raising
`tail` from 50 to 5000 must not make a write dearer, and that is the one timing claim that stays
honest across substrates, being a ratio between two sizes of the same structure.

`ttl` expiry costs nothing per write either. Entries past it are dropped on the read that follows
— no timer per entry, no version bump — and a live cursor delivers **arrivals**, so it never sees
an expiry and is right not to. Retention bounds what a **later** subscriber can replay, and
a later subscriber is the only reader an expiry is visible to.

Read on: [Reloading](decide-when-a-value-reloads.md)

## `ABIDE_MAX_STREAM_BUFFER_SIZE` caps a transcript in memory

`tail` counts productions. The thing that can actually run away is bytes, and one variable caps it
wherever a transcript is held:

| | |
| --- | --- |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | bytes, default `Infinity` |

It governs both holders of a stream transcript — a seed buffer entry, and a `global` memo's entry
fanning one producer out to late readers. One number for one shape, rather than a second variable
meaning the same thing somewhere else.

A seed buffer entry needs no other bound: it is single-use and lives seconds, so the exposure is
request rate multiplied by transcript size, and size is the only dimension that can grow. A count
ceiling would evict an entry a document in flight is about to claim, which is the one failure the
buffer exists to avoid.

Read on: [Configuration](../reference/configuration.md) ·
[Streaming HTML](../pages/send-the-page-before-the-data-lands.md)

## Next

* [Streaming data](../server/send-data-as-it-arrives.md) — where chunks come from
* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — where messages come from
* [Watch a room](../ship/watch-a-room-from-the-terminal.md) — the same cursor from a shell
