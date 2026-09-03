---
title: Let anything publish and anything read
nav: Rooms
intent: A subject several parts of the app share — anyone writes, everyone reads, no owner.
covers:
  - `channel`
  - `Channel`
  - `Room`
  - channel › `Message`
  - channel › `Args`
  - channel › `tail`
  - channel › `ttl`
  - channel › `transform`
examples:
  - packages/dogfood/examples/rooms
---

A state has one owner and a memo has a body. The third kind of value has neither: a **room** is a
subject anything may write to and anything may read, and nobody holds it.

{% example rooms %}

*2 components, 0 props threaded* — a list on the page and a badge in the heading, with neither
one owning the value and nothing passed between them.

## A room is a `Reactive` with `publish`

`channel()` hands back a factory; calling it hands back a `Room`, which is a `Reactive` whose value
is **the latest message**, plus `publish`.

So there is no second type to learn. A bare read is the latest message, the probes answer, `await`
waits, and `room.tail(n)` is the cursor:

{% snippet rooms src/ui/pages/threads/[id]/page.abide {#if room.pending()} … {#for await post %}

The badge in the heading is the bare read — `{room.author}` is the latest message's author,
reached with no probe and no cursor:

{% snippet rooms src/ui/components/Unread.abide <p class="hint"> %}

`publish` hands back the message's `seq` — monotonic per room — which is what a reconnect resumes
from.

`set` is not a second spelling of it. It is `Reactive`'s own write meaning here what it means
everywhere: it **replaces the newest message in place** and mints no `seq`, so `inbox = message`
edits the latest rather than appending after it. Publishing is how a room grows; `set` is how the
thing it is currently showing is corrected.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[History & tail](keep-the-last-few-values.md)

## Anyone publishes, anyone reads

That symmetry is the whole difference from the other two. A state is written by whoever owns it; a
memo is computed by its body; a room is written by **anything that can reach it**, and read the
same way.

The page publishes and the badge reads, and neither knows the other exists:

{% snippet rooms src/ui/pages/threads/[id]/page.abide <button onclick %}

{% snippet rooms src/ui/components/Unread.abide const room = thread %}

In-process nothing is gated — the page publishes because it is your code. Whether a caller
**outside** the process may publish is a separate question with a separate answer, defaulting to
no, and it belongs to the transport rather than here.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md)

## A channel is a space of rooms

`Channel` is `(args?) => Room`, so a channel is a **space of rooms** and `args` picks one:

{% snippet rooms src/ui/pages/threads/[id]/page.abide const room = thread %}

That one line is a different room per `id` in the address bar, from a single declaration —
which is why changing rooms is changing the URL and nothing else:

{% snippet rooms src/ui/pages/threads/[id]/page.abide <nav class="switch"> %}

Switch between them in the example above. Each room has its own messages, its own tail and
its own `seq`, and coming back to one finds it as you left it.

Args are keyed by the same canonical wire form a memo's args use — sorted, `undefined` dropped,
`Date` written ISO — so a fresh object built each run lands on the same room.

**A room is created by a publish, never by a subscribe.** Subscribing to one nothing has published
to is legal, allocates no entry, and reads as `pending()`. That bounds the number of rooms
by *publish authority* rather than by how many argument keys a caller can invent, and it is why
there is no room-count ceiling to configure.

Read on: [Caching](load-once-per-set-of-arguments.md)

## A room is not a stream

Both produce more than once, and the difference is what the producer declared — not something a
runtime sniffs. A channel declares a `Message`, so **every publish is a whole one**. A streaming
body declares chunks of one value, so no chunk is a whole anything.

| | the producer yields | `pending()` until | a bare read | `tail(n)` |
| --- | --- | --- | --- | --- |
| room | a complete `Message` | the **first** message | the latest message | the last n messages |
| stream | a **chunk** of one value | it **closes** | the accumulation, once it closes | the last n chunks |

So `{inbox}` is the latest message and `{await inbox}` blocks until the first one, both meaningful.
And `done()` stays false while a room is live — a room is not a thing that finishes — so
`{:finally}` never mounts on one.

Read on: [Streaming data](../server/send-data-as-it-arrives.md)

## `tail` decides how many past messages a room keeps

`tail` is how many past messages the room retains, and it defaults to **1** — latest only, like
every other `Reactive`. A chat pane asks for more:

{% snippet rooms src/shared/threads.ts export const thread %}

Fifty is also how far back a **reconnect** can resume: a cursor older than the tail is answered
with the whole tail, never with a gap. `tail: 0` is passthrough and drop.

`ttl` is the life of one retained message, each on its own clock.

Read on: [History & tail](keep-the-last-few-values.md)

## `transform` refuses a message under a name you declared

`transform` is the same option `state` and `memo` take, on the third `Reactive`. It may rewrite the
message or **refuse** it by returning a `Failed` — and that is what it is for here, `schema` being
where a message's *shape* goes. Both gates refuse; what you refuse **with** picks between them, and
only this one carries a name and data of your own:

It is the last option on the channel above. What it refuses with is declared once, and the
name and its data are the type on both sides:

{% snippet rooms src/shared/failures.ts export const tooLong %}

It runs on **every** publish, the app's own included — normalising is not a question about who is
asking.

A message's **shape** is the sibling option, `schema`, and it is the channel's rather than the
socket's for this same reason — one declared at the transport would have skipped itself
in-process exactly the way a trim did. So `channel({ schema: messageSchema })` is where a
message's shape is stated, `transform` is there for the rarer case of storing something other
than what was published, and the `socket` is left declaring who may connect and whether a frame
may publish at all.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Schemas](../server/check-what-callers-send-you.md) ·
[Local state](show-a-value-that-changes.md)

## A room is discarded once nobody subscribes and nothing is retained

Both conditions, and the second falls out of `ttl` rather than being a second use of it: nothing
is left to keep once the last subscriber has gone and the last retained message has expired, so
there is no idle window to configure.

A resubscribe before then finds the room and its tail intact, which makes navigating away
and back free.

## Rooms are process-wide, not per caller

The one thing to get right. A memo's default scope is one caller — request-local on a server — and
**a room is the opposite**: a room every caller can reach is what a room *is*, and `args` is how
one caller's room is told from another's.

So on a server a `channel()` is shared across requests by design. Anything caller-specific belongs
in the `args`, exactly as it does for a `global` memo.

## `state.share` is one caller; a room is many

They look alike — both give distant components one thing with no prop between them — and they are
opposites underneath.

| | `state.share` | a room |
| --- | --- | --- |
| scope | one caller — request-local on a server | process-wide, every caller |
| before anyone writes | the value you created, `success()` | `undefined`, `pending()` |
| lifetime | never evicted within its scope | discarded once subscribers hit 0 and retention drains |
| typing | a key per name, each its own type | one `Message` across every room |

The short version: `state.share` is **one caller, many components**. A room is **many callers, one
subject**. Reach for the first when the thing is yours and the path between readers is long; reach
for a room when the thing belongs to nobody.

Read on: [Sharing](share-one-value-across-components.md)

## Next

* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — serving a room to callers outside the process
* [History & tail](keep-the-last-few-values.md) — retention, cursors and replay in full
* [Sharing](share-one-value-across-components.md) — the one-caller counterpart
