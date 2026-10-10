---
title: Keep every caller in sync
nav: Live updates
intent: Serve live state to every caller — chat, presence, live prices — pushed rather than polled.
covers:
  - `Produced`
  - `PatchOp`
examples:
  - packages/dogfood/examples/socket-room.json
---

A chat pane, a presence list and a live price all want one array on the server reaching every
browser, pushed rather than polled every two seconds. You serve it the way you serve any read: a
`global` reactive value behind a `GET`, written to by a `POST`.

Nothing on the page polls and nothing on it opens a connection. A page that reads the `GET` follows
it, and a `patch` on the server reaches every page following it.

## Live state is three declarations

| You write | What it is |
| --- | --- |
| `reactive(fn, { global: true })` | the value every caller shares, one per args key where `fn` declares a parameter |
| `export const room = GET(rooms)` | its address — a browser reading it follows it |
| `export const say = POST(…)` | the way in from outside, a handler that patches the value |

`global: true` puts the value in one process-wide cache that outlives every request (11.34). Leave
it out and the value is request-local on a server (11.32), so every caller gets one of their own and
nobody hears anybody. Every signature is in the [Transports](../reference/transports.md) reference,
and what a channel is before it has an address is
[Channels](../values/let-anything-publish-and-anything-read.md).

## A turn one tab sends reaches every tab

{% example socket-room %}

*2 handlers, 0 frames* — against the arm, which opens the socket, frames each turn, holds a turn
sent while it is down, keeps a latest turn per room, fans each turn out to that room's tabs and
reopens the connection when it drops.

Each reader gets a room of their own. The body declares a parameter, so `rooms` is keyed (11.2) and
`room({ id })` is one room per id. The id is a cookie that every tab of one browser sends and nobody
else's does, so the room is yours and your tabs'.

A browser reading a `GET` is subscribed to that handler's productions for those args (18.3), over
one web socket mux every followed `GET` on the page shares (18.1). So a page following four rooms
holds one connection.

The tab that sends does not paint its own turn. `say` sends the text, the handler patches the room,
and what the patch wrote goes to every follower (18.11), this tab included. The transcript is the
server's, in the order the server took it, in every tab at once.

Each turn carries an id the server gives it, and the room declares `by: 'id'`. A follower's copy
carries `by` (18.4), so a `{#for turn of room}` keys its rows by it (32.32) and a new turn adds one
row. `ttl` is the life of a keyed entry (11.45), which is how a room nobody uses is let go.

## The server writes each message, so nobody forges its author

`say` takes `{ id, text }` and nothing else. The turn's id, its speaker and anything else it
carries are written by the handler, so a caller can only ever add a turn that says what they typed.
The example writes `'you'`; an app with sign-in writes who is signed in:

```ts server
export const say = POST(({ id, text }: { id: string; text: string }) => {
    const { name } = principal.resolved()
    rooms({ id }).patch((turns) => {
        turns.push({ id: crypto.randomUUID(), speaker: name, text })
    })
})
```

The handler may read `principal`, because a handler is bound to the request it answers (16.25). The
room's own body may not: `global: true` is a build error on a body reading `principal` (11.37),
since one value serves every caller.

So the room is append-only with no rung saying so. A caller has no way to write to it except the
handlers you declared, and each one writes exactly what its body writes. Who may post is the
`POST`'s own `middleware`, which runs on every call (16.11). A moderator removing a turn is a second
`POST`, behind a rung of its own, whose handler finds the turn by id and splices it out.

A `patch` mutates the value in place rather than minting a production (5.7), so a `schema` on the
room never sees it. The check is on the way in: the `POST`'s `args` are derived from its annotation
(19.9), and anything stricter goes in the handler beside the push.

abide puts no cap on the array. The example trims in the same patch that appends —
`if (turns.length > 20) turns.shift()` — and the `shift` is one more op on the wire.

Read on: [Mutations](change-something-on-the-server.md) ·
[Auth & principal](../app/know-who-is-calling.md)

## Rungs on the `GET` decide who may follow

A room anyone can follow is a room anyone can read. Put a rung on the `GET`:

```ts server
export const room = GET(rooms, {
    middleware: [
        async (next, ctx) =>
            (await isMember(ctx.request, ctx.args())) ? next(ctx) : refuse(403),
    ],
})
```

A read over http passes the rung like any call (16.11). A subscription runs it once, as it opens, in
the request the connection opened in, and is sent productions only where the rung admitted it
(18.8, 18.16). The decision is made per connection: access revoked after it opened takes effect when
it next reconnects.

`crossOrigin` gates the same subscription from another origin, closed unless the `GET` admits that
origin (18.2).

Read on: [Authorization](decide-who-may-call-what.md) · [CORS](let-another-origin-call-you.md)

## A follower is sent what a patch wrote, as JSON Patch

A `patch` on the room is sent to every follower standing at the version it was made over as what it
wrote, in JSON Patch (RFC 6902), and not as the array (18.11). Each write is a `PatchOp`: an `add`,
`remove` or `replace` at a JSON Pointer, so a `push` is an `add` at `/-` and a `shift` a `remove` at
`/0`. A twenty-turn room sends one turn per message, not twenty.

| The patch | The follower is sent |
| --- | --- |
| over the version it holds | the ops |
| over a version it does not hold | the ops, and it reads the value again (18.12) |
| over a copy the page wrote to itself | the ops, and it reads the value again (18.21) |
| one whose writes cannot be sent as data | the value, whole (18.13) |

A write to a followed copy stays in that tab — a `say` is how a turn reaches the room — and lasts
until the server next changes the room.

The same follow is open to anything that speaks http. Ask the `GET`'s address for
`text/event-stream` and it is server-sent events, each frame's op its `event`, its version the `id`,
and the value or the JSON Patch its `data` (18.20):

```
curl -N -H 'Accept: text/event-stream' \
  'https://app.example/__abide/rpc/socketRoomSupport/room?id=lobby'
```

An `EventSource` reconnecting sends the last `id` back as `Last-Event-ID`, and is sent only what
moved after it.

Read on: [Watch a channel](../ship/watch-a-room-from-the-terminal.md)

## A reconnect is sent the value, then its patches

A version names one production or one patch, and no other in this process or in any earlier one
(18.7). A client subscribing names the version it holds (18.9), and the server's answer follows
from it (18.6):

| The client holds | It is sent |
| --- | --- |
| the value's current version | nothing, until the next patch |
| any other version | the value, whole |

Seeding a first render, a connection that dropped and reopened, and a tab too slow to keep up are
one mechanism, and none of it is spelled by the app.

The value is not durable. It lives in memory, so a restart starts the room from its body again.
History anyone must be able to scroll back past that is app data behind an ordinary rpc.

## A followed value is still a reactive value

The call hands back the same `Reactive` the handler had, `Produced` included (16.3). A bare read is
the array, `room.at(-1)` is the latest turn, and the probes answer. A follower's copy is `busy()`
until its first production arrives (9.14).

Writing to that copy is not how to send. A `set` on it stands only until the next production
replaces it (9.4), so a turn goes through `say`.

`room.invalidate({ id })` and `room.refresh({ id })` inside a handler reach every browser's copy of
that room (7.10, 7.18). A `for await` over the room hands back the standing array once per turn, a
burst collapsing to the latest (2.6), so code that has to act on every message acts in `say`.

## Each instance holds its own room

A `global` value lives in the process, as its cache does. More than one instance degrades rather
than breaks: a reconnect landing on another instance names a version that instance never minted,
and is sent that instance's value whole. abide supplies no cross-process mechanism for it.

Read on: [Sharing](../values/share-one-value-across-components.md)

## Next

* [Channels](../values/let-anything-publish-and-anything-read.md) — what a channel is, before it has an address
* [Reading data](read-data-without-writing-an-api.md) — `GET`, and how any read follows the server
* [Watch a channel](../ship/watch-a-room-from-the-terminal.md) — following a `GET` from a shell
