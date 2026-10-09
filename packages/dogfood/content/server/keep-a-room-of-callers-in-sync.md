---
title: Keep every caller in sync
nav: Sockets
intent: Serve a channel to callers outside the process — chat, presence, live prices, pushed rather than polled.
covers:
  - `Produced`
  - socket › `Args`
  - socket › `crossOrigin`
  - socket › `middleware`
  - `SocketEvent`
  - `socket`
  - `Socket`
  - `clientPublish`
  - `server/sockets/chat.ts`
  - `server/sockets/feed.ts`
  - `src/server/sockets/**/*.ts`
examples:
  - packages/dogfood/examples/socket-room.json
---

A channel is already live state anything in the process may publish and anything may read. A chat
pane, a presence list and a live price all want that same state reaching browsers — pushed, not
polled every two seconds.

`socket` gives a channel an address. Nothing about the channel changes, and nothing on the page
polls: it is the same `Reactive` the server publishes into, reached from outside the process.

## The forms of `socket`

| You write | What you get |
| --- | --- |
| `socket(values)` | a `Socket` — `(args?) => Reactive`, serving each channel's messages out |
| `socket(values, options)` | the same, with `clientPublish`, `crossOrigin` or `middleware` |

`values` is a `Reactive` — a channel, where it declares `history` — or a `Keyed` holding one per
args key, so one socket carries every channel in it (18.1). It is built with `global: true`: a
channel is one value every caller shares (9.16), and a value built without `global` is
request-local on a server (11.32), so `socket` refuses one where it is declared (18.18). `Produced` and `Args` come through unchanged, so neither is spelled again here.
What the options gate is the **transport**: who may connect, who may publish inward, and from
which origin. Every signature is in the [Transports](../reference/transports.md) reference, and
what a channel is before it has an address is [Channels](../values/let-anything-publish-and-anything-read.md).

## A turn one tab sends reaches every tab

{% example socket-room %}

*1 option, 0 frames* — against the arm, which opens the socket, frames each turn, keeps a latest
turn per room, fans each turn out to that room's tabs and reopens the connection when it drops.

Each reader gets a room of their own. `rooms` is keyed, so `support({ id })` is one channel per
id, and the id is a cookie — every tab of one browser sends it, and nobody else's does. A page
everyone can post to would put a stranger's turn in front of you; keyed by an id only your browser
holds, the room is yours and its tabs. A room nobody has posted to for an hour is let go (11.46).

The tab that sends does not paint its own turn. `publish` on a browser's copy sends the message to
the room on the server, and it comes back to every subscriber as a production, this tab included
(18.6). So the transcript is the server's, in the order the server took it, in every tab at once.

## A channel over a socket is still a channel

There is nothing about the shape that says which transport carried it: a bare read is the latest
message, the probes answer, `s.history(n)` is the cursor, and `publish` hands back the `seq` it
minted or the `Failed` it was refused with (9.5). `Args` picks the channel, keyed by the same
canonical wire form a keyed value's arguments use (11.24).

A `publish` on the server's value is sent to every subscriber (9.1), and `invalidate` and `refresh`
on it reach every subscriber's copy (7.10, 7.18). A `GET` is carried the same way: a client reading
one is subscribed over the same mux to that handler's productions for those `Args` (18.17).

What a channel does before it has an address is on
[Channels](../values/let-anything-publish-and-anything-read.md), and none of it changes here.

## A socket's address is its file path and export name

Anything under `#server/sockets/**/*.ts` is reachable, the same way `#server/rpc/**` is:

| File | Export | Reached at |
| --- | --- | --- |
| `#server/sockets/chat.ts` | `default` | `/__abide/socket/chat` |
| `#server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

Every socket is carried over **one** web socket mux, so a page subscribed to four channels holds
one connection.

## Callers are read-only until `clientPublish` says otherwise

Default false. A socket serves messages out and accepts none in.

That flag gates **this transport and nothing else**, which is why it belongs to the socket
rather than to the channel: a socket accepts frames at a channel nobody named. The other way into
a channel from outside is a `POST`, and one of those exists only because you declared an rpc that
publishes into it — the declaration is already the intent a second flag would restate.

```ts #server/rpc/threads.ts — excerpt
export const say = POST(({ id, text }: { id: string; text: string }) =>
    thread({ id }).publish({ id: crypto.randomUUID(), text }),
)
```

`transform` still runs on a publish `clientPublish` admits. Refusing a message is a question
about the message, not about who asked.

Read on: [Mutations](change-something-on-the-server.md)

## `SocketOptions` gates the upgrade and what may be published

The upgrade goes through `middleware`, which is the same `Middleware` type the http lane takes,
instantiated over a `SocketEvent`:

```ts shared
type SocketEvent = {
    kind: 'subscribe' | 'publish'
    args: Args
    message?: Produced
    request: Request
}
```

```ts #server/sockets/chat.ts — excerpt
export default socket(thread, {
    clientPublish: true,
    crossOrigin: ['https://partner.example'],
    middleware: [
        async (next, event) => {
            const publishing = event.kind === 'publish'
            if (publishing && !(await canPost(event.request, event.args)))
                throw new Error('not a member')
            return next(event)
        },
    ],
})
```

`message` is absent on a subscribe, nothing having been published yet. There is no `Response`
to return, so a **throw is the only refusal** on this lane.

`crossOrigin` is closed unless declared — `true` for any origin, a `string[]` for the
allow-list — exactly as it is on the http lane.

Read on: [Authorization](decide-who-may-call-what.md) · [CORS](let-another-origin-call-you.md)

## A reconnect resumes without a gap and without a duplicate

Every message carries a `seq`, monotonic per channel and minted with the production (18.10). A
channel also carries an **epoch** — its history version — minted when the value, or the keyed
entry, is constructed (9.19). A restart constructs it again, so the epoch moves.

You never write either (18.12). `s.history(n)` already replays the snapshot and goes live from where it
ended, so a reconnect sends the last `seq` it rendered and the epochs are compared underneath:

| | The client gets |
| --- | --- |
| same epoch, known cursor | everything after that `seq` |
| same epoch, cursor older than `history` | the whole ring, never a gap |
| moved epoch | the ring **marked as a reset** |

A reset is announced because it has to be: a server that changed incarnation cannot know what
the client painted, so replaying silently would duplicate rows a `{#for}` over the cursor had already
appended. On a reset the block clears its accumulated rows and repaints from the ring — the one
place it is not append-only, and rare enough that correctness beats the reflow.

That makes three handoffs one mechanism rather than three — seeding a first render, a
socket that dropped and reopened, a tab too slow to adopt — with `s.history(n)` the only
spelling any of them has.

A cursor you persisted across sessions is the one thing this does not serve, and could not: the
ring lives in memory, bounded by `history` and `ttl`, so a cursor older than that is always past
it. Catching up over that horizon is app data behind an ordinary rpc.

Read on: [History](../values/keep-the-last-few-values.md)

## Removing a message is an ordinary publish

A `publish` appends, and there is no `revoke` and no `clear` over what a channel retains (9.17).

A moderator removing a message publishes a **tombstone** the block renders as removed:

```ts #shared/channels.ts — excerpt
type Post = { id: string; text: string; removed?: true }

export const thread = reactive(
    (_args: { id: string }): Post | undefined => undefined,
    { history: 20, global: true },
)
```

```abide #ui/pages/threads/[id]/page.abide — excerpt
{#for post of thread({ id }).history(20) by post.id}
    {#if post.removed}
        <li class="removed">removed</li>
    {:else}
        <li>{post.text}</li>
    {/if}
{/for}
```

`by post.id` lands the tombstone — `{ id, text: '', removed: true }` — on the row the original
keyed to, so a live subscriber updates one row and a late one replays both messages and resolves
them the same way. No epoch move, no reset frame, no repaint.

**A ring edit could not have delivered what it promised.** Dropping the message from the retention
would stop it being *served* again — but the ring is already bounded by `history` and `ttl`, and a
process restart drops it wholesale. Anything that must genuinely never be served again is durable,
so it lives in the app's own store behind an rpc, where a delete is a delete.

## The `seq` counter and the epoch are process-local

Both live in the process, as a `global` value's cache does. More than one instance degrades rather
than breaks: a reconnect landing on another instance is the announced epoch reset, and the client
takes the ring. abide supplies no cross-process mechanism for it.

Read on: [Sharing](../values/share-one-value-across-components.md)

## Next

* [Channels](../values/let-anything-publish-and-anything-read.md) — what a channel is, before a transport
* [Schemas](check-what-callers-send-you.md) — declaring what a message must look like
* [Watch a channel](../ship/watch-a-room-from-the-terminal.md) — subscribing from a shell
