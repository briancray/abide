---
title: channel()
nav: channel
intent: The factory for a room anyone may publish to and anyone may read.
enumerates:
  - channel
---

The **`channel()`** function creates a room keyed by its arguments. A room is a
[`Reactive`](reactive.md) whose value is the latest message, plus `publish` — so a bare read
is the latest message and a cursor walks the ones before it, with no second type to learn.

## Syntax

```ts server
channel()
channel(options)
```

### Parameters

* `options` (optional) — the [`Reactive`](reactive.md) options, plus `args` below.

### Return value

A `Channel`: call it with the room key to get that room.

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `channel` | `<Accepted, Args, Message = Accepted, Failures = never>(options?: ChannelOptions<Accepted, Message, Failures, Args>) => Channel<Message, Args, Accepted, Failures>` | The factory. |
| `Channel` | `<Message, Args, Accepted = Message, Failures = never>(args?: Args) => Room<Message, Accepted, Failures>` | A room keyed by `args`. |
| `Room` | `Reactive<Message, Accepted, Failures> & { publish: (message: Accepted) => number \| Failures }` | The room itself. `publish` hands back the sequence number it minted, or the refusal a `transform` gave it. |
| `Args` | `Record<string, JsonValue> \| undefined` | The room, keyed by the same canonical wire form a memo's args are. |
| `Message` | `unknown` | The message type, which is what a reader holds. |
| `Accepted` | `unknown` | What a publish takes, which a `transform` may reshape into the `Message`. |

## Options

Everything [`ReactiveOptions`](reactive.md) carries, plus the room key below. A publish and a
message are two types, so a `transform` that stamps an id or a received-at has somewhere to put it.

| Name | Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Accepted>` | Inherited. Gates what a publish takes, and runs on every publish including the server's own. |
| `identity` | `((value: Message) => unknown) \| ((next: Message, previous: Message) => boolean)` | Inherited, defaulting to the reference. A publish it deems a consecutive duplicate mints no production. |
| `args` | `Schema<Args>` | What a valid room key is. It refuses only: a room is filed under the key as sent, so a normalisation here would not merge two spellings of one room. |
| `tail` | `number` | How many past messages are retained, and how far back a reconnect can resume. Default 1. |
| `ttl` | `number` | The life of a retained message. Default infinity. |
| `store` | `Store<Message> \| ((args: Args) => Store<Message>)` | Round-trips the standing message, and never the tail. |
| `transform` | `Transformer<Accepted, Message, Failures>` | Runs on every publish, the server's own included. |
| `throttle` | `number` | Inherited. Caps how often readers see the room move; a cursor still gets what `tail` retained, batched. |
| `debounce` | `number` | Inherited. Holds the room's changes until publishing stops. |

## Description

A room is created by a publish and never by a subscribe, so the room count is bounded by
publish authority rather than by how many keys a caller can think of. Subscribing to a room
nothing has published to is legal, allocates nothing, and reads as pending.

A room is discarded when its last subscriber goes, and the ring goes with it. Retention bounds
what a subscriber still holding the room can replay, never how long the room outlives one.

`publish` appends, and it is the only way a room changes: there is no revoke and no clear.
Removing a message is an ordinary publish of a tombstone the block renders as removed.

A room is the one producer whose default `identity` is the reference, because a publish is an
**event** and two identical events are two events — where a state's production is a **value**
and two identical values are one. A presence room that wants the collapse says
`identity: structural`.

## Examples

### A room and its cursor

```abide abide
{#for await message of chat({ id }).tail(100) by message.id}
    <li>{message.body}</li>
{/for}
```

### A roster that collapses a republished duplicate

```ts server
export const roster = channel<string[]>({ identity: structural })
```

## See also

* [Rooms](../values/let-anything-publish-and-anything-read.md)
* [Sockets](../server/keep-a-room-of-callers-in-sync.md)
* [History & tail](../values/keep-the-last-few-values.md)
* [`Reactive`](reactive.md)
