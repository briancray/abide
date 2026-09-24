---
title: Let anything publish and anything read
nav: Channels
intent: Live state the system publishes and every client reads — presence, progress, a price, messages.
covers:
  - `s.publish`
examples:
  - packages/dogfood/examples/channel-shared.json
  - packages/dogfood/examples/channel-rooms.json
  - packages/dogfood/examples/channel-tail.json
  - packages/dogfood/examples/channel-transform.json
  - packages/dogfood/examples/channel-identity.json
---

A reactive value is state your code has. A **channel** is state the system keeps sending to everyone
connected, live — who is online, how far a job has got, a price, the messages in a conversation.
Anything may publish to one, anything may read it, and nobody owns it.

## The forms of a channel

A channel is not a factory of its own. It is a `reactive` that declares `history`, and `publish` is
how it is written.

| You write | What you get |
| --- | --- |
| `reactive<Message>(undefined, { history: 50 })` | one channel — a `Reactive` |
| `reactive((_args: Args): Message \| undefined => undefined, { history: 50 })` | a `Keyed`, one channel per args key |
| `conversations({ id })` | the channel for that key — a `Reactive` |

`history` is how many past messages a channel keeps beside the latest (6.16), and how far back a
reconnect resumes (9.10). Every other option is the one any reactive value takes. `args` refuses a
key (11.28), `schema` and `transform` gate every publish (9.12), and `store` keeps the latest message
and never the ring (9.11). On a channel a socket or an rpc carries, `refresh` and `invalidate`
reach every subscriber's copy (7.10, 7.18). Every signature is in the
[`reactive` reference](../reference/reactive.md).

## Anyone publishes, anyone reads

{% example channel-shared %}

*2 components, 0 props threaded* — against the subscriber list the hand-written arm keeps, and
the wiring it takes per reader.

That symmetry is the whole difference. A value you write belongs to whoever owns it; a derived
value is computed by its body; a channel is written by **anything that can reach it**, and read
the same way. The composer imports the channel and not the readout, the readout imports the channel
and not the composer, and the channel is the whole of what is between them.

What comes back is a `Reactive`, so there is no second type to learn either. A bare read is the
latest message — `onboarding.speaker` is the last speaker, reached with no probe and no cursor — and
the probes answer. Opened with `undefined`, a channel has landed `undefined` (4.15): it is `ready()`
before anyone publishes, and a read answers `undefined` until somebody does. The readout checks the
value rather than the probe for that reason.

Nothing is loading where a channel is published, so it is never `busy()` there (3.9). A
subscriber's copy is `busy()` until the first message arrives over the connection (9.29), so an
`await` there resolves at that message (2.8).

In-process nobody asks who is publishing — the page publishes because it is your code. Whether a caller
**outside** the process may publish is a separate question with a separate answer, defaulting to
no, and it belongs to the transport rather than here.

Read on: [Sockets](../server/keep-a-room-of-callers-in-sync.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## A channel per args key

{% example channel-rooms %}

Give the body a parameter and it is **one channel per key** (11.2), and the args you call it with
pick one. That one declaration is a different channel per conversation, which is why changing
conversations is changing one value and nothing else. Each has its own messages, its own
history and its own `seq` (9.28), and coming back to one finds it as you left it.

The body answers `undefined`, and that lands (11.63). So a conversation nothing has published to
reads `undefined` — the empty conversation on the card. An `undefined` never enters the history
(6.18), so a cursor over a fresh conversation replays nothing and its history starts at the first
publish (6.19). The parameter has to be declared, or the call is the unkeyed form. The return has to
be typed `Turn | undefined`, or `publish` would not take a `Turn`.

Args are keyed by the same canonical wire form every keyed value uses — sorted, `undefined` dropped,
`Date` written ISO — so a fresh object built each run lands on the same channel (11.24). The `args`
option is a schema that **refuses** a key rather than normalising one, two spellings that both pass
being two channels (11.28).

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Schemas](../server/check-what-callers-send-you.md)

## `history` decides how far back a channel goes

{% example channel-tail %}

`history` is how many past messages the channel keeps beside the latest (6.16). The card keeps two,
so the pane holds three turns. With none declared a channel holds its latest message alone, and a
cursor over it replays that one and goes live. A chat pane asks for more, and fifty is the ordinary
figure where two is what makes the cap visible in a single press.

The reader's `history(50)` is a **cursor**, not a second retention. It asks for as much as the channel
has, and the channel decides how much that is (2.6).

The retention is also how far back a **reconnect** can resume: a cursor older than the history is
answered with the whole ring, never with a gap (9.10).

`ttl` is the sibling option. On a keyed channel it is the life of an entry, and the entry's ring
goes with it (11.46).

Read on: [History](keep-the-last-few-values.md)

## `transform` refuses a message under a name you declared

{% example channel-transform %}

`transform` is the same option every reactive value takes. It may rewrite
the message or **refuse** it by returning a `Failed`, and that is its job here. You declare what
it refuses with once, and the name and its data are the type on both sides — so `publish` hands
back a `number` or that `Failed`, and `tooLong.is` narrows between them.

`Shaped` is everything a transform can hand back, and the types split it the way the value does at
run time: the refusal is typed onto what `publish` hands back and onto `error()`, and the rest is
what the channel stores. So the card spells no type argument. It annotates the transform's
parameter instead, `turn: Turn`, since TypeScript cannot take `Turn` and infer the rest.

It runs on **every** publish, the app's own included — normalising is not a question about who is
asking.

A message's **shape** is the sibling option, `schema`, and it is the channel's rather than the socket's
for this same reason: one declared at the transport would have skipped itself in-process exactly the
way a trim did. So `{ schema: messageSchema }` on the channel is where a message's shape is
stated, `transform` is there for the rarer case of storing something other than what was published,
and the `socket` is left declaring who may connect and whether a frame may publish at all.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Schemas](../server/check-what-callers-send-you.md) ·
[Local state](show-a-value-that-changes.md)

## A publish is a message, whatever `identity` says

{% example channel-identity %}

`publish` mints a production whatever `identity` says, and hands back its `seq` (9.5, 9.6). A turn
said twice was said twice, so the second press moves the cursor a reconnect would resume from.

`identity` still means what it means on every value, and what it gates is `set` (5.2). The two
writes differ in more than that:

| | `publish` | `set` |
| --- | --- | --- |
| `identity` | not consulted (9.6) | a repeat mints nothing (5.2) |
| hands back | the `seq`, or the refusal (9.5) | only the refusal |
| on a value a socket carries | sent to every subscriber (9.1) | kept here, never sent (9.4) |
| on a value nothing carries | reaches its own readers (9.13) | reaches its own readers |

A `set` on a subscriber's copy stands until the next message arrives and replaces it (9.9). Where
`identity` does compare, it compares against the **previous** production alone and never scans the
ring (9.7).

Read on: [Local state](show-a-value-that-changes.md)

## A channel is not a stream

Both produce more than once, and what the producer declared separates them — not something a runtime
sniffs. A channel is written by `publish`, so **every production is a whole message** (9.6). A
body declared `async function*` declares a stream, and no chunk it yields is a whole anything (9.20).

| | each production is | `busy()` | a bare read | `await` resolves at |
| --- | --- | --- | --- | --- |
| channel | a complete message | never where it is published (3.9) | the latest message | at once where it is published |
| stream | a **chunk** of one value | until the stream **closes** (3.7) | the accumulation so far | the close |

A channel does not finish, so being live is not being busy. `{inbox}` is the latest message, and a
subscriber that awaits the value itself resolves at the first message to arrive (9.29). A stream
keeps no
`history`, which on one retains finished runs rather than chunks (6.17).

Read on: [Streaming data](../server/send-data-as-it-arrives.md)

## A channel's past lives as long as the value does

Nothing discards a channel for having no subscribers. A keyed channel's entry lives until its `ttl`,
and its ring goes with it (11.46). Without a `ttl` it lives as long as the value that holds it.

A restart drops every ring. History past the ring was always app data behind an ordinary rpc, and
`history()` replays the ring before it goes live, so the two overlap rather than leaving a gap.

## Channels are process-wide, not per caller

The one thing to get right. A reactive value's default scope is one caller — request-local on a
server (11.32) — and **a value a socket carries is the opposite** (9.16), which is why it is built
with `global: true` (18.18). State every caller can
reach is what a channel *is*, and `args` is how one caller's channel is told from another's.

So on a server a channel is shared across requests by design. Anything caller-specific belongs
in the `args`, exactly as it does for a `global` keyed value.

## `reactive.share` is one caller; a channel is many

They look alike — both give distant components one thing with no prop between them — and they are
opposites underneath.

| | `reactive.share` | a channel |
| --- | --- | --- |
| scope | one component and its descendants | process-wide, every caller |
| before anyone writes | the value you created, `ready()` | `undefined`, `ready()` |
| lifetime | never evicted within its scope | the value's, or an entry's `ttl` |
| typing | a key per name, each its own type | one `Message` across every channel |

The short version: `reactive.share` is **one caller, many components**. A channel is **many callers,
one subject**. Reach for the first when the thing is yours and the path between readers is long;
reach for a channel when the thing belongs to nobody.

Read on: [Sharing](share-one-value-across-components.md)

## Next

* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — serving a channel to callers outside the process
* [History](keep-the-last-few-values.md) — retention, cursors and replay in full
* [Sharing](share-one-value-across-components.md) — the one-caller counterpart
