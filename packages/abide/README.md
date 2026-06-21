# abide

**One typed RPC declaration fans out to an HTTP route, a typed browser proxy, a CLI subcommand, an MCP tool, and an OpenAPI operation — built for humans and machines.**

abide is an isomorphic framework on Bun: the same callable has the same name and behaviour on both sides, and the bundler swaps the runtime per side — a server handler in `src/server`, a `fetch` proxy in the browser. Server-render and hydrate the same `.abide` components, broadcast over multiplexed sockets, and expose every read to an agent — all in a single Bun runtime.

- One dependency (`typescript`, for the type-checking shadow); `tailwindcss` + `bun-plugin-tailwind` are optional peers.
- Runs on Bun `>= 1.3.0`. No bundler config, no server framework, no client router to wire up.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds, installs deps, and (in a TTY) starts dev
```

Or read the exhaustive demo:

```sh
git clone https://github.com/briancray/abide
cd abide && bun install
cd examples/kitchen-sink && bun dev
```

The whole public surface — every export, CLI command, route, env var, and the `.abide` grammar — is mapped in [`AGENTS.md`](./AGENTS.md).

## RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the URL (`getMessages.ts` → `/rpc/getMessages`), and a [Standard Schema](https://standardschema.dev) (zod / valibot / arktype, unadapted) validates the args and projects every other surface.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { history } from '../../store.ts'

const inputSchema = z.object({ room: z.string() })

export const getMessages = GET(({ room }) => json({ messages: history(room) }), { inputSchema })
```

That one declaration fans out:

```text
                  getMessages   (one declaration)
                        │
   ┌──────────┬─────────┼─────────┬──────────────┐
   ▼          ▼         ▼         ▼              ▼
 SSR call   browser   MCP tool   CLI sub-     OpenAPI
cache(fn)()  fetch   (read-only) command      operation
```

The `inputSchema` unlocks the CLI and — because a `GET`/`HEAD` is read-only — an MCP tool. A mutating verb (`POST`/`PUT`/`PATCH`/`DELETE`) never auto-exposes to an agent; opt in with `clients: { mcp: true }`. Consume the verb four ways, all typed against the declaration: `cache(getMessages)({ room })` for an SSR-memoized in-process read, the bundler-swapped `getMessages({ room })` `fetch` proxy in the browser, `.raw(args)` for the untouched `Response`, and `.stream(args)` for a frame-by-frame `jsonl`/`sse` body.

> Query args travel as strings — use `z.coerce.*` for numbers and booleans. The per-verb `timeout` option fires a `504` on every surface and is distinct from the client-wide `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A `Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await` it on the server, or read it reactively with `tail()` in a component — and every socket multiplexes onto one WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/messages.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

const schema = z.object({
    id: z.string(),
    room: z.string(),
    from: z.string(),
    text: z.string(),
    at: z.number(),
})

// retain the last 100 frames; lazily evict any older than an hour
export const messages = socket({ schema, tail: 100, ttl: 3_600_000 })
export type Message = z.infer<typeof schema>
```

The schema validates every publish and flips on the read surfaces (a `messages-tail` MCP tool / CLI command). For clients that can't speak the ws multiplex, each socket has an HTTP face at `/__abide/sockets/messages`: `GET` returns the retained tail, `POST` publishes — gated by `clientPublish` (default `false`, so browsers publish through a validating verb instead).

## Components

A component is an `.abide` file: valid HTML with a `<script>`, native `<template>` control flow, `{expr}` bindings, and a component-scoped `<style>`. `scope()` is the sole reactive surface; `props`, `effect`, and `html` are in scope without import. This one imports the verb and socket above:

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { getMessages } from '$server/rpc/getMessages.ts'
import { sendMessage } from '$server/rpc/sendMessage.ts'
import { messages } from '$server/sockets/messages.ts'
import Avatar from '$ui/Avatar.abide'

const { room } = props<{ room: string }>()

let from = scope().state('alice')               // a writable cell — read/assign as a plain var
let draft = scope().state('')
let pinned = scope().state(false)
let filter = scope().state('all')
const live = scope().computed(() => tail(messages))   // re-renders on every new frame

async function send(event: SubmitEvent) {
    event.preventDefault()
    if (draft.trim() === '') return
    await sendMessage({ room, from, text: draft })     // a mutating verb
    draft = ''
}
</script>

<!-- a named snippet: a reusable builder, rendered like a function -->
<template name="bubble" args={msg}>
    <li><Avatar name={msg.from} /> <b>{msg.from}</b>: {msg.text}</li>
</template>

<h1>#{room}</h1>

<form onsubmit={send}>
    <input bind:value={from} />
    <input bind:value={draft} placeholder="message" />
    <label><input type="checkbox" bind:checked={pinned} /> pin</label>
    <label><input type="radio" bind:group={filter} value="all" /> all</label>
    <label><input type="radio" bind:group={filter} value="mine" /> mine</label>
    <button type="submit" disabled={draft.trim() === ''}>send</button>
</form>

<template if={live}>
    <p class="live">latest: {live.text}</p>
    <template else>
        <p>no messages yet</p>
    </template>
</template>

<template switch={filter}>
    <template case={'all'}><p>showing everyone</p></template>
    <template case={'mine'}><p>showing {from}</p></template>
    <template default><p>—</p></template>
</template>

<template await={cache(getMessages)({ room })}>
    <p>loading…</p>
    <template then="history">
        <ul>
            <template each={history.messages} as="msg" key="msg.id">
                {bubble(msg)}
            </template>
        </ul>
    </template>
    <template catch="error">
        <p>failed: {error.message}</p>
    </template>
</template>

<style>
    .live {
        font-weight: 600;
    }
</style>
```

MIT
