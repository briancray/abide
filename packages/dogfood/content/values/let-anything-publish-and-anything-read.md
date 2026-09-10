---
title: Let anything publish and anything read
nav: Rooms
intent: A subject several parts of the app share — anyone writes, everyone reads, no owner.
covers:
  - `channel`
  - `Channel`
  - `Room`
  - channel › `Message`
  - channel › `Accepted`
  - channel › `Args`
  - channel › `tail`
  - channel › `ttl`
  - channel › `transform`
  - channel › `identity`
examples:
  - packages/dogfood/examples/channel-shared
  - packages/dogfood/examples/channel-rooms
  - packages/dogfood/examples/channel-tail
  - packages/dogfood/examples/channel-transform
  - packages/dogfood/examples/channel-identity
---

A state has one owner and a memo has a body. The third kind of value has neither: a **room** is a
subject anything may write to and anything may read, and nobody holds it.

## The forms of `channel`

`channel` is one name that hands back another, and the second call is what picks a room.

| You write | What you get |
| --- | --- |
| `channel()` | a `Channel` — one declaration standing for a space of rooms |
| `channel(options)` | the same, with a gate, a retention or a reshape on the way in |
| `channel(…)(args)` | a `Room` — a `Reactive` whose value is the latest message, plus `publish` |

`Message` is what the room holds, `Accepted` is what a publish takes before the gates run, and
`Args` is the room key. The options are `args`, `schema`, `transform`, `identity`, `tail`, `ttl`,
`store`, `throttle` and `debounce` — six of them shared with `state` and `memo`. Every signature
is in the [`channel` reference](../reference/channel.md).

## Anyone publishes, anyone reads

{% example channel-shared %}

*2 components, 0 props threaded* — against the subscriber list the hand-written arm keeps, and
the wiring it takes per reader.

That symmetry is the whole difference from the other two. A state is written by whoever owns it;
a memo is computed by its body; a room is written by **anything that can reach it**, and read the
same way. The composer names the room and not the readout, the readout names the room and not the
composer, and the room is the whole of what is between them.

So there is no second type to learn either. A bare read is the latest message — `room.speaker` is
the last speaker, reached with no probe and no cursor — the probes answer, and `await` waits.

`publish` hands back the message's `seq`, monotonic per room, and a reconnect resumes from it.
`set` is not a second spelling of it: it is `Reactive`'s own write meaning here what it means
everywhere, and it **replaces the newest message in place** and mints no `seq`. Publishing grows a
room; `set` corrects the message it is showing.

In-process nothing is gated — the page publishes because it is your code. Whether a caller
**outside** the process may publish is a separate question with a separate answer, defaulting to
no, and it belongs to the transport rather than here.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## A channel is a space of rooms

{% example channel-rooms %}

`Channel` is `(args?) => Room`, so a channel is a **space of rooms** and `args` picks one. That
one declaration is a different room per conversation in the address bar, which is why changing
rooms is changing the URL and nothing else. Each has its own messages, its own tail and its own
`seq`, and coming back to one finds it as you left it.

Args are keyed by the same canonical wire form a memo's args use — sorted, `undefined` dropped,
`Date` written ISO — so a fresh object built each run lands on the same room. The `args` option is
a schema that **refuses** a key rather than normalising one, two spellings that both pass being
two rooms.

**A room is created by a publish, never by a subscribe.** Subscribing to one nothing has published
to is legal, allocates no entry, and reads as `pending()` — which is the empty conversation on the
card. That bounds the number of rooms by *publish authority* rather than by how many argument keys
a caller can invent, and it is why there is no room-count ceiling to configure.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Schemas](../server/check-what-callers-send-you.md)

## `tail` decides how far back a room goes

{% example channel-tail %}

`tail` is how many past messages the room retains, and it defaults to **1** — latest only, like
every other `Reactive`. A chat pane asks for more, and fifty is the ordinary figure where three is
what makes the cap visible in a single press.

The reader's `tail(50)` is a **cursor**, not a second retention. It asks for as much as the room
has, and the room is what decides how much that is.

The retention is also how far back a **reconnect** can resume: a cursor older than the tail is
answered with the whole ring, never with a gap. `tail: 0` is passthrough and drop.

`ttl` is the sibling option, and it is the life of one retained message rather than of the room —
each on its own clock.

Read on: [History & tail](keep-the-last-few-values.md)

## `transform` refuses a message under a name you declared

{% example channel-transform %}

`transform` is the same option `state` and `memo` take, on the third `Reactive`. It may rewrite
the message or **refuse** it by returning a `Failed`, and that is its job here. You declare what
it refuses with once, and the name and its data are the type on both sides — so `publish` hands
back a `number` or that `Failed`, and `tooLong.is` narrows between them.

`Accepted` and `Message` are what the two ends of a transform are called. With no reshape they are
one type, which is why the channel above reads as one parameter.

It runs on **every** publish, the app's own included — normalising is not a question about who is
asking.

A message's **shape** is the sibling option, `schema`, and it is the channel's rather than the
socket's for this same reason: one declared at the transport would have skipped itself in-process
exactly the way a trim did. So `channel({ schema: messageSchema })` is where a message's shape is
stated, `transform` is there for the rarer case of storing something other than what was
published, and the `socket` is left declaring who may connect and whether a frame may publish at
all.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Schemas](../server/check-what-callers-send-you.md) ·
[Local state](show-a-value-that-changes.md)

## `identity` decides what counts as the same message

{% example channel-identity %}

A publish `identity` deems a consecutive duplicate mints no production: nothing enters the ring,
no reader wakes, and the **standing** sequence number is what comes back. A retry after a dropped
connection is that case, and it is the one a screen cannot show you — the room reads identically
either way, which is why the card puts the cursor on screen and the spec asserts it.

It compares against the **previous message alone** and never scans the ring. A phrase said again
ten turns later is a new message rather than a duplicate, which is the cheap reading and also the
right one: a room is a subject over time, not a set.

The option is the one every `Reactive` takes, in either of its two forms — a key function, or a
comparator over the previous value and the next.

Read on: [Local state](show-a-value-that-changes.md)

## A room is not a stream

Both produce more than once, and what the producer declared separates them — not something a
runtime sniffs. A channel declares a `Message`, so **every publish is a whole one**. A streaming
body declares chunks of one value, so no chunk is a whole anything.

| | the producer yields | `pending()` until | a bare read | `tail(n)` |
| --- | --- | --- | --- | --- |
| room | a complete `Message` | the **first** message | the latest message | the last n messages |
| stream | a **chunk** of one value | it **closes** | the accumulation, once it closes | the last n answers |

So `{inbox}` is the latest message and `{await inbox}` blocks until the first one, both meaningful.
And `done()` stays false while a room is live — a room is not a thing that finishes — so
`{:finally}` never mounts on one.

Read on: [Streaming data](../server/send-data-as-it-arrives.md)

## A room is discarded once nobody subscribes

One condition, and there is no idle window to configure. The ring goes with the room, so
retention bounds what a **live** subscriber can replay rather than how long an empty room is
kept.

Navigate away from the last open tab and the transcript is gone. History past the ring was
always app data behind an ordinary rpc, and `tail()` replays the ring before it goes live, so
the two overlap rather than leaving a gap.

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
| scope | one component and its descendants | process-wide, every caller |
| before anyone writes | the value you created, `success()` | `undefined`, `pending()` |
| lifetime | never evicted within its scope | discarded once subscribers hit 0 |
| typing | a key per name, each its own type | one `Message` across every room |

The short version: `state.share` is **one caller, many components**. A room is **many callers, one
subject**. Reach for the first when the thing is yours and the path between readers is long; reach
for a room when the thing belongs to nobody.

Read on: [Sharing](share-one-value-across-components.md)

## Next

* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — serving a room to callers outside the process
* [History & tail](keep-the-last-few-values.md) — retention, cursors and replay in full
* [Sharing](share-one-value-across-components.md) — the one-caller counterpart
