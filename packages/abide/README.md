# abide

**A type-safe isomorphic framework built on web standards and Bun. Zero runtime dependencies, single runtime.**

abide is not just a web framework. Strongly-typed RPCs surface through HTTP, a CLI, and an MCP, with a full OpenAPI spec. Everything is generated for you with zero additional work - but you control surface exposure. Its a framework built for humans *and* machines.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds, installs, and starts the dev server
```

To see a full demo, clone the repo and run the kitchen-sink example — every surface is a runnable, documented page:

```sh
git clone https://github.com/briancray/abide
cd abide && bun install
cd examples/kitchen-sink && bun run dev
```

## Three foundational primitives

### RPCs

An RPC is a handler wrapped by its HTTP method — one export per file under `src/server/rpc/`. The file path is the URL; the schema validates args and projects the MCP tool, CLI flags, and OpenAPI operation. Standard Schema is the contract: zod, valibot, and arktype work unadapted.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

// query args arrive as strings — coerce in the schema
const inputSchema = z.object({ room: z.string(), limit: z.coerce.number().default(50) })

export const getMessages = GET(
    async ({ room, limit }) => json(await db.recentMessages(room, limit)),
    { inputSchema },
)
```

One declared verb fans out to every surface — this is the whole premise:

```text
       export const getMessages = GET(fn, { inputSchema })
                                 │
   ┌───────────────┬────────────┼──────────────┬────────────────┐
 SSR call      browser fetch    MCP tool      CLI subcommand   OpenAPI op
cache(fn)()   fetch /rpc/...   getMessages   app get-messages  /openapi.json
(in-process)  (typed proxy)  (read-only+schema) (schema→flags)   (described)
```

The same callable is consumed differently per side — `cache(getMessages)({ room })` in-process, the swapped `fetch` in the browser, `.raw(args)` for a `Response`, `.stream(args)` for `tail()`. A schema gates the machine surfaces: it unlocks CLI and (for read-only verbs) MCP; a mutating verb never auto-exposes to MCP — it needs an explicit `clients: { mcp: true }`. Per-verb `timeout` (504, on every surface) is distinct from the client-side `ABIDE_CLIENT_TIMEOUT`.

> Query args travel as strings — use `z.coerce.*` so numbers and booleans validate.

### Sockets

One broadcast topic per file under `src/server/sockets/`. A `Socket<T>` is an isomorphic `AsyncIterable<T>` — every socket multiplexes onto one ws at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

const schema = z.object({ id: z.string(), from: z.string(), text: z.string(), at: z.number() })

// retain the last 100 frames, evict any older than an hour
export const chat = socket({ schema, tail: 100, ttl: 3_600_000 })
export type ChatMessage = z.infer<typeof schema>
```

For clients that can't speak the ws multiplex, each socket has an HTTP face at `/__abide/sockets/<name>` — `GET` returns the retained tail, `POST` publishes (gated by `clientPublish`).

### Components

Components are `.abide` files — valid HTML with `<script>`, native `<template>` control flow, `{expr}` bindings, and a component-scoped `<style>`. The reactive primitives (`state`, `derived`, `effect`, `prop`) are in scope without import. This page reads the verb above through `cache()`, tails the socket live, and exercises most of the template grammar:

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { getMessages } from '$server/rpc/getMessages.ts'
import { publishChat } from '$server/rpc/publishChat.ts'
import { chat } from '$server/sockets/chat.ts'
import Avatar from '$ui/Avatar.abide'

let room = prop('room')                                  // typed via src/.abide/routes.d.ts
const history = derived(() => cache(getMessages)({ room })) // SSR snapshot + reactive refetch
const latest = derived(() => tail(chat))                 // re-renders on every new frame

let from = state('alice')
let text = state('')
let filter = state('all')        // all | mine | others
let onlyUnread = state(false)

async function send(event: SubmitEvent) {
    event.preventDefault()
    if (text.trim() === '') return
    await publishChat({ room, from, text })              // server validates, then broadcasts
    text = ''
}
</script>

<template name="message" args={m}>                       <!-- snippet: a reusable builder -->
    <li class="row"><Avatar name={m.from} /> <strong>{m.from}</strong>: {m.text}</li>
</template>

<form onsubmit={send}>
    <input bind:value={from} placeholder="you" />
    <input bind:value={text} placeholder="say something…" />
    <label><input type="checkbox" bind:checked={onlyUnread} /> unread only</label>
    <fieldset>
        <label><input type="radio" bind:group={filter} value="all" /> all</label>
        <label><input type="radio" bind:group={filter} value="mine" /> mine</label>
    </fieldset>
    <button type="submit" disabled={text.trim() === ''}>send</button>
</form>

<template if={latest}>
    <p class="ping">latest from <strong>{latest.from}</strong></p>
    <template else>
        <p class="ping muted">no live messages yet</p>
    </template>
</template>

<template switch={filter}>
    <template case={'mine'}><p>showing your messages</p></template>
    <template default><p>showing every message</p></template>
</template>

<template await={history}>
    <p>loading history…</p>
    <template then="messages">
        <ul>
            <template each={messages} as="m" key="m.id">
                {message(m)}                              <!-- render the snippet -->
            </template>
        </ul>
    </template>
    <template catch="err">
        <p class="error">{err.message}</p>
    </template>
</template>

<style>
    .row { display: flex; gap: 0.5rem; }
    .muted { color: #94a3b8; }
    .error { color: #dc2626; }
</style>
```


MIT
