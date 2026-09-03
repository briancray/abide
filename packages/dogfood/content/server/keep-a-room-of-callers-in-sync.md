---
title: Keep a room of callers in sync
nav: Sockets
intent: Serve a room to callers outside the process — chat, presence, a live feed, pushed rather than polled.
covers:
  - socket › `Message`
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
---

A room is already a subject anything in the process may write and anything may read. A chat
pane, a presence list and a price feed all want that same subject reaching browsers — pushed,
not polled every two seconds.

`socket` gives a channel an address. Nothing about the room changes.

```ts #server/sockets/chat.ts
import { socket } from 'abide'
import { thread } from '#shared/rooms'

export default socket(thread, { clientPublish: true })
```

```abide #ui/pages/threads/[id]/page.abide — excerpt
<script>
import { state } from 'abide'
import chat from '#server/sockets/chat'

const room = chat({ id: route.params.id })
const draft = state('')
</script>

{#for await message of room.tail(50)}<li>{message.text}</li>{/for}
<input bind:value={draft}/>
<button onclick={() => room.publish({ text: draft })}>Send</button>
```

*2 files, 0 polling interval* — and the same `Room` the server publishes into.

## A socket over a channel is a channel over a socket

`socket(channel)` hands back a `Socket`, which is `(args?) => Room` — the **same `Room`** a
channel invokes to. So there is nothing about the shape that says which transport carried it:
a bare read is the latest message, the probes answer, `room.tail(n)` is the cursor, and
`publish` hands back the `seq` it minted or the `Failed` a `transform` refused it with.

`Message` and `Args` come through from the channel unchanged. `Args` picks the room, keyed by
the same canonical wire form a memo's arguments use.

Read on: [Rooms](../values/let-anything-publish-and-anything-read.md)

## A socket's address is its file path and export name

Anything under `#server/sockets/**/*.ts` is reachable, the same way `#server/rpc/**` is:

| File | Export | Reached at |
| --- | --- | --- |
| `#server/sockets/chat.ts` | `default` | `/__abide/socket/chat` |
| `#server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` |

Every channel is carried over **one** web socket mux, so a page subscribed to four rooms holds
one connection.

## Callers are read-only until `clientPublish` says otherwise

Default false. A socket serves messages out and accepts none in.

That flag gates **this transport and nothing else**, which is why it belongs to the socket
rather than to the channel: a socket accepts frames at a room nobody named. The other way into
a room from outside is a `POST`, and one of those exists only because you declared an rpc that
publishes into it — the declaration is already the intent a second flag would restate.

```ts #server/rpc/threads.ts — excerpt
export const say = POST(({ id, text }: { id: string; text: string }) =>
    thread({ id }).publish({ text }),
)
```

`transform` still runs on a publish `clientPublish` admits. Refusing a message is a question
about the message, not about who asked.

Read on: [Mutations](change-something-on-the-server.md)

## `SocketOptions` gates the upgrade and what may be published

`SocketOptions` is the upgrade and what may come up it. The upgrade goes through `middleware`,
which is the same `Middleware` type the http lane takes, instantiated over a `SocketEvent`:

```ts shared
type SocketEvent = {
    kind: 'subscribe' | 'publish'
    room: Args
    message?: Message
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
            if (publishing && !(await canPost(event.request, event.room)))
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

Every message carries a `seq`, monotonic per room and minted at publish. A room also carries an
**epoch** — its history version — which moves when the process restarts, a counter held in
memory going back to zero when the process does.

You never write either. `room.tail(n)` already replays the snapshot and goes live from where it
ended, so a reconnect sends the last `seq` it rendered and the epochs are compared underneath:

| | The client gets |
| --- | --- |
| same epoch, known cursor | everything after that `seq` |
| same epoch, cursor older than `tail` | the whole tail, never a gap |
| moved epoch | the tail **marked as a reset** |

A reset is announced because it has to be: a server that changed incarnation cannot know what
the client painted, so replaying silently would duplicate rows a `{#for await}` had already
appended. On a reset the block clears its accumulated rows and repaints from the tail — the one
place it is not append-only, and rare enough that correctness beats the reflow.

That makes three handoffs one mechanism rather than three — seeding a first render, a
socket that dropped and reopened, a tab too slow to adopt — with `room.tail(n)` the only
spelling any of them has.

A cursor you persisted across sessions is the one thing this does not serve, and could not: the
tail is a memory ring bounded by `tail` and `ttl`, so a cursor older than that is always past
it. Catching up over that horizon is app data behind an ordinary rpc.

Read on: [History & tail](../values/keep-the-last-few-values.md)

## Removing a message is an ordinary publish

A `publish` appends, and it is the only way a room changes. There is no `revoke` and no `clear`.

A moderator removing a message publishes a **tombstone** the block renders as removed:

```ts #shared/rooms.ts — excerpt
type Line = { id: string; body?: string; removed?: true }

export const chat = channel<Line>({ tail: 200 })
```

```abide #ui/pages/threads/[id]/page.abide — excerpt
{#for await m of chat().tail(200) by m.id}
    {#if m.removed}
        <li class="removed">removed</li>
    {:else}
        <li>{m.body}</li>
    {/if}
{/for}
```

`by m.id` lands the tombstone on the row the original keyed to, so a live subscriber updates one
row and a late one replays both messages and resolves them the same way. No epoch move, no reset
frame, no repaint.

**A ring edit could not have delivered what it promised.** Dropping the message from the retention
would stop it being *served* again — but the ring is already bounded by `tail` and `ttl`, and a
process restart drops it wholesale. Anything that must genuinely never be served again is durable,
so it lives in the app's own store behind an rpc, where a delete is a delete.


## The `seq` counter and the epoch are process-local

The `seq` counter and the epoch, as a `global` memo's cache is. More than one instance degrades
rather than breaks: a reconnect landing on another instance is the announced epoch reset, and
the client takes the tail. abide supplies no cross-process mechanism for it.

Read on: [Sharing](../values/share-one-value-across-components.md)

## Next

* [Rooms](../values/let-anything-publish-and-anything-read.md) — what a room is, before a transport
* [Schemas](check-what-callers-send-you.md) — declaring what a message must look like
* [Watch a room](../ship/watch-a-room-from-the-terminal.md) — subscribing from a shell
