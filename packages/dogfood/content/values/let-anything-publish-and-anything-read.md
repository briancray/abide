---
title: Let anything write and anything read
nav: Channels
intent: Live state every client reads and anything may add to — presence, progress, a price, messages.
covers:
  - `for await (… of s)`
  - `s[Symbol.asyncIterator]`
examples:
  - packages/dogfood/examples/channel-shared.json
  - packages/dogfood/examples/channel-rooms.json
  - packages/dogfood/examples/channel-tail.json
  - packages/dogfood/examples/channel-transform.json
---

A reactive value is state your code has. A **channel** is state the system keeps sending to everyone
connected — who is online, how far a job has got, a price, the messages in a conversation. It is a
`reactive` holding an array: anything that reaches it appends, anything that reaches it reads, and
nobody owns it.

## The forms of a channel

A channel is not a factory of its own. It is a `reactive` over an array, `patch` is how a message is
appended, and `by` is what tells one message from another.

| You write | What you get |
| --- | --- |
| `reactive<Turn[]>([], { by: 'id' })` | one channel — a `Reactive` |
| `reactive((_args: Args): Turn[] => [], { by: 'id' })` | a `Keyed`, one channel per args key |
| `turns({ conversation })` | the channel for that key — a `Reactive` |

`room.patch((list) => list.push(m))` appends in place (5.7). The latest message is `room.at(-1)`,
and `{#for m of room}` is the whole conversation. How long the array grows is yours to decide: abide
puts no cap on it, and the trim goes in the same patch as the push.

Every other option is the one any reactive value takes. `args` refuses a key (11.28), `transform`
shapes what a `set` stores, and `ttl` is the life of a keyed channel's entry (11.45). On a channel a
`GET` serves, `refresh` and `invalidate` reach every subscriber's copy (7.10, 7.18). Every
signature is in the [`reactive` reference](../reference/reactive.md).

## Anyone appends, anyone reads

{% example channel-shared %}

*2 components, 0 props threaded* — against the subscriber list the hand-written arm keeps, and
the wiring it takes per reader.

That symmetry is the whole difference. A value you write belongs to whoever owns it; a derived
value is computed by its body; a channel is written by **anything that can reach it**, and read
the same way. The composer imports the channel and not the readout, the readout imports the channel
and not the composer, and the channel is the whole of what is between them.

What comes back is a `Reactive`, so there is no second type to learn either. `LastSpoken` derives
`last` as `reactive(() => onboarding.at(-1))`, which follows the channel the way any derived value
follows what it read. Opened with `[]`, a channel has landed: it is `ready()` before anyone speaks,
and `last` reads `undefined` until somebody does.

Nothing is loading where a channel is written, so it is never `busy()` there (3.9). A subscriber's
copy is `busy()` until the first value arrives over the connection (9.14), so an `await` there
resolves at that value (2.7).

In-process nobody asks who is writing — the page appends because it is your code. A caller
**outside** the process reaches a channel only through a handler you declare: a `GET` to follow it,
and a `POST` whose handler patches it. So there is no way in from outside that you did not write.

Read on: [Live updates](../server/keep-a-room-of-callers-in-sync.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## A channel per args key

{% example channel-rooms %}

Give the body a parameter and it is **one channel per key** (11.2), and the args you call it with
pick one. That one declaration is a different channel per conversation, which is why changing
conversations is changing one value and nothing else. Each holds its own messages, and coming back
to one finds it as you left it.

The body answers `[]`, so a conversation nobody has written to lands empty — the empty conversation
on the card. The parameter has to be declared, or the call is the unkeyed form.

Args are keyed by the same canonical wire form every keyed value uses — sorted, `undefined` dropped,
`Date` written ISO — so a fresh object built each run lands on the same channel (11.24). The `args`
option is a schema that **refuses** a key rather than normalizing one, two spellings that both pass
being two channels (11.28).

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Schemas](../server/check-what-callers-send-you.md)

## A channel's length is its writer's to decide

{% example channel-tail %}

The trim is one line in the patch that appends: `if (turns.length > 3) turns.shift()`. The card
keeps three so the cap shows in a single press; a chat pane keeps fifty. Put the push and the trim
in one function every writer calls, as `say` is here, and the cap belongs to the channel rather than
to whichever caller remembered it.

`by: 'id'` is what makes the trim cheap on screen. Each message carries an id the app gives it, and
a keyed `{#for}` moves the rows it keeps (32.29), so a send adds one row and drops one. Without `by`
the rows are positional (32.13): trimming the front shifts every message up one place, and every
row is rewritten.

On the wire the trim is cheap too. A patch on a value a `GET` serves is sent to its followers as what
it wrote rather than as the value (18.11), and a `shift` is one write.

Read on: [Recent values](keep-the-last-few-values.md) · [Lists](../templates/repeat-markup-over-a-list.md)

## `transform` refuses a message under a name you declared

{% example channel-transform %}

`transform` is the same option every reactive value takes. It may rewrite the value or **refuse** it
by returning a `Failed`, and the card's refuses a turn longer than the conversation takes. You
declare the refusal once, and its name and data are the type on both sides — so `tooLong.is`
narrows `error()` to it.

A `patch` mutates the held array in place (5.7), so neither `schema` nor `transform` sees it. The
card writes the whole array instead, `onboarding = [...onboarding, turn]`, and the transform checks
the turn it ends on. A refused write stores nothing (4.9) and fills `error()` (4.10), so the last
accepted turn stays on screen beside the message. `set` hands that refusal back too (4.18). The
other spelling checks the turn before patching it in, and keeps the patch.

It runs on **every** write, the app's own included — normalizing is not a question about who is
asking. A message's **shape** is the sibling option, `schema`, and it is the channel's rather than
the `GET`'s for the same reason (16.26).

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Schemas](../server/check-what-callers-send-you.md) ·
[Patching a list](patch-a-list-from-a-live-feed.md)

## Every write is gated by `identity`

There is no ungated write to a channel. `identity` means what it means on every value, and a `set`
of the value already held mints nothing (5.2). A turn said twice is two elements in the
array, so a repeated message is still a change, and the channel holds both.

A `set` on a subscriber's copy stands until the next value arrives and replaces it (9.4).

Read on: [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md)

## Following a channel sees turns, not every message

`for await (const turns of onboarding)` walks the channel's cursor. On a value with no streaming
producer the cursor hands back the standing value once per turn, however many writes landed since
the last, and a patch in place is one of them (2.6). A burst of three messages in one turn is one
step, holding all three.

So there is no exactly-once tail of a channel. Code that has to act on every message acts where it
writes it — in `say`, beside the push. The cursor never hands back an `undefined` value (6.10).

A stream is the other case: its cursor yields from the start of the run in flight and then live,
one step per chunk (2.5), and a capped window still delivers every chunk (5.10).

Read on: [Watching values](do-something-when-a-value-changes.md) ·
[Streaming data](../server/send-data-as-it-arrives.md)

## A channel is not a stream

Both hold an array that grows, and who grows it separates them. A channel has no producer: anything
appends to it, and every append is a whole message. A body that is or returns an async generator is
a stream, and its array is the chunks its run has yielded (9.1).

| | the array grows by | `busy()` | `await` resolves at |
| --- | --- | --- | --- |
| channel | a `patch` from anything that reaches it | never where it is written (3.9) | at once where it is written |
| stream | a **chunk** from its own run | until the stream **closes** (3.7) | the close |

A channel does not finish, so being live is not being busy.

Read on: [Streaming data](../server/send-data-as-it-arrives.md)

## A channel lives as long as the value does

Nothing discards a channel for having no subscribers. A keyed channel's entry lives until its
`ttl` (11.45), and a write to it starts that life again, so a room nobody wrote to for an hour is
let go. On a channel with no body there is no producer, and `ttl` is inert (6.2).

A message that should expire on its own is the app's to drop: a `setTimeout` per message that
patches it out. A restart drops every channel, and a conversation older than the process was always
app data behind an ordinary rpc.

Read on: [Reloading](decide-when-a-value-reloads.md)

## Channels are process-wide, not per caller

The one thing to get right. A reactive value's default scope is one caller — request-local on a
server (11.32) — and **a channel every caller follows is the opposite**. So it is built with
`global: true`, which puts it in one process-wide cache that outlives every request (11.34). State
every caller can reach is what a channel *is*, and `args` is how one caller's channel is told from
another's.

So on a server a channel is shared across requests by design. Anything caller-specific belongs in
the `args`, exactly as it does for a `global` keyed value.

## `reactive.share` is one caller; a channel is many

They look alike — both give distant components one thing with no prop between them — and they are
opposites underneath.

| | `reactive.share` | a channel |
| --- | --- | --- |
| scope | one component and its descendants | process-wide, every caller |
| before anyone writes | the value you created, `ready()` | the array you opened it with, `ready()` |
| lifetime | never evicted within its scope | the value's, or an entry's `ttl` |
| typing | a key per name, each its own type | one element type across every channel |

The short version: `reactive.share` is **one caller, many components**. A channel is **many callers,
one subject**. Reach for the first when the thing is yours and the path between readers is long;
reach for a channel when the thing belongs to nobody.

Read on: [Sharing](share-one-value-across-components.md)

## Next

* [Live updates](../server/keep-a-room-of-callers-in-sync.md) — serving a channel to callers outside the process
* [Recent values](keep-the-last-few-values.md) — keeping the last few values, on a channel or anywhere
* [Sharing](share-one-value-across-components.md) — the one-caller counterpart
