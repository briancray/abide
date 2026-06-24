# abide

**One typed declaration fans out to HTTP, a CLI, an MCP tool, and an
OpenAPI spec — the bundler swaps the runtime per side.**

abide is an isomorphic framework on Bun where you write a function once and
it serves every consumer: a browser fetch, an in-process SSR call, a CLI
subcommand, an MCP tool, an OpenAPI operation. The same callable keeps its
name and behaviour on both sides — the bundler decides whether it runs the
real handler or a network proxy. Built for humans _and_ machines.

- One direct dependency (`typescript`); `tailwindcss` + `bun-plugin-tailwind`
  are optional peers. Single runtime: Bun ≥ 1.3.0.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds, installs deps, and starts dev
```

Or read the full feature tour in the kitchen-sink example:

```sh
git clone https://github.com/briancray/abide
cd abide/examples/kitchen-sink
bun install
bun run dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the
URL; the export name is the verb. A Standard Schema (zod / valibot / arktype,
unadapted) validates the args and projects the same shape into the MCP tool,
the CLI flags, and the OpenAPI operation.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { recent } from '../../chatState.ts'

const inputSchema = z.object({ room: z.string(), limit: z.coerce.number().default(20) })

export const getMessages = GET(({ room, limit }) => json(recent(room).slice(-limit)), {
    inputSchema,
})
```

One declaration, every surface:

```text
              getMessages = GET(fn, { inputSchema })
                              │
      ┌─────────────┬─────────┼──────────┬──────────────┐
      ▼             ▼         ▼          ▼              ▼
  SSR call      browser    MCP tool   CLI sub-      OpenAPI
  cache(fn)()   fetch       (read)    command       operation
                proxy
```

A schema unlocks the CLI for every verb and MCP for read-only verbs (`GET` /
`HEAD`); a mutating verb never auto-exposes to MCP — it needs an explicit
`clients: { mcp: true }`. Consume the verb four ways: `cache(getMessages)(args)`
in-process (warm SSR hydration), the swapped `fetch` proxy in the browser,
`getMessages.raw(args)` for the untouched `Response`, and
`getMessages.stream(args)` to iterate a `jsonl`/`sse` body.

> Query args arrive as strings — wrap numeric/boolean fields in `z.coerce.*`.
> The per-verb `timeout` (504 on every surface) is distinct from the
> client-side `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A
`Socket<T>` is an isomorphic `AsyncIterable<T>`; every socket multiplexes onto
one WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

const schema = z.object({ id: z.string(), from: z.string(), text: z.string(), at: z.number() })

// retain the last 100 frames; evict any older than an hour
export const chat = socket({ schema, tail: 100, ttl: 3_600_000 })
export type ChatMessage = z.infer<typeof schema>
```

It also has an HTTP face for clients that can't speak the multiplex (the CLI
and MCP): `GET /__abide/sockets/chat` returns the retained tail, and
`POST /__abide/sockets/chat` publishes — gated by `clientPublish` (default off,
so browsers publish through a validating verb instead).

## Components — the full template

A `.abide` component pulls the verb and the socket above into one page and
exercises the template grammar. `scope`, `props`, `effect`, `html`, and
`snippet` are ambient — no import needed.

<!-- prettier-ignore -->
```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { getMessages } from '$server/rpc/getMessages.ts'
import { publishChat } from '$server/rpc/publishChat.ts'
import { chat } from '$server/sockets/chat.ts'
import Avatar from '$ui/Avatar.abide'

const { room } = props()

// warm on the server, live on the client
const history = scope().computed(() => cache(getMessages)({ room }))
const latest = scope().computed(() => tail(chat))

let from = scope().state('alice')
let text = scope().state('')
let pinned = scope().state(false)
let view = scope().state('all')

async function send() {
    await publishChat({ from, text })
    text = ''
}
</script>

<template name="line" args={message}>
    <li><Avatar name={message.from} /> <b>{message.from}</b>: {message.text}</li>
</template>

<form onsubmit={send}>
    <input bind:value={from} placeholder="name" />
    <input bind:value={text} placeholder="message" />
    <label><input type="checkbox" bind:checked={pinned} /> pin</label>
    <label><input type="radio" bind:group={view} value="all" /> all</label>
    <label><input type="radio" bind:group={view} value="mine" /> mine</label>
    <button disabled={!text}>send</button>
</form>

<template if={latest}>
    <p>latest from {latest.from}</p>
<template else>
    <p>no messages yet</p>
</template>

<template switch={view}>
<template case="mine"><p>showing your messages</p></template>
<template default><p>showing every message</p></template>
</template>

<template await={history}>
    <p>loading…</p>
<template then="data">
    <ul>
        <template each={data} as="message" key="message.id" index="i">
            {i}. {line(message)}
        </template>
    </ul>
<template catch="reason">
    <p>failed: {reason.message}</p>
</template>
</template>

<style>
form { display: flex; gap: 0.5rem; }
</style>
```

MIT
