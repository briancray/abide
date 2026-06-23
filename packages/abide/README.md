# abide

**One typed declaration fans out to HTTP, a CLI, an MCP tool, and an OpenAPI
spec — and the bundler swaps the runtime per side.**

abide is an isomorphic framework on Bun and web standards: you declare a verb,
a socket, or a component once, and the same callable runs server-side, in the
browser, from the terminal, and from an agent — the bundler decides which
runtime each side gets. Built for humans *and* machines.

- One direct dependency — the TypeScript compiler, used by `abide check`.
  Tailwind is an optional peer. Everything runs on a single Bun runtime
  (≥ 1.3.0); no second toolchain.

## Quick start

```sh
bunx abide scaffold my-app   # copies the template, installs, starts dev
```

Or clone the kitchen-sink and run it:

```sh
git clone https://github.com/briancray/abide
cd abide/examples/kitchen-sink
bun install
bun run dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/`. **The file path is the
URL.** The schema validates arguments and projects the MCP tool, the CLI flags,
and the OpenAPI operation. The contract is Standard Schema — zod, valibot, or
arktype, unadapted.

```ts
// src/server/rpc/getMessages.ts — file path is the route: GET /getMessages
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

const inputSchema = z.object({ room: z.string() })

export const getMessages = GET(({ room }) => json(board(room)), { inputSchema })
```

One declaration, five surfaces:

```text
              getMessages = GET(fn, { inputSchema })
                              │
   ┌───────────┬─────────────┼────────────┬──────────────┐
 SSR call   browser fetch   MCP tool    CLI command    OpenAPI op
cache(fn)() typed proxy()  (read-only)  abide ... cli  /openapi.json
```

A schema unlocks the CLI everywhere and MCP for read-only verbs; a mutating
verb never auto-exposes to MCP — it needs explicit `clients: { mcp: true }`.
Consume the verb four ways: `cache(getMessages)({ room })` resolves in-process
during SSR, the same call hits a swapped `fetch` in the browser,
`getMessages.raw(args)` returns the undecoded `Response`, and
`getMessages.stream(args)` is an iterable view of the body.

> Query args travel as strings — validate with `z.coerce.*`. The per-verb
> `timeout` (504 on every surface) is distinct from `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A
`Socket<T>` is an isomorphic `AsyncIterable<T>`, and every socket multiplexes
onto one websocket at `/__abide/sockets`.

```ts
// src/server/sockets/messages.ts — topic name = file name: `messages`
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

const schema = z.object({ id: z.string(), room: z.string(), from: z.string(), text: z.string() })

// retain the last 50 frames; evict any older than an hour
export const messages = socket({ schema, tail: 50, ttl: 3_600_000 })
export type Message = z.infer<typeof schema>
```

The socket also has an HTTP face at `/__abide/sockets/messages`, for clients
that can't speak the ws multiplex: `GET` returns the retained tail, `POST`
publishes — gated by `clientPublish` (off by default, so the POST 403s).

## Components

A `.abide` component is the payoff: it imports the verb and the socket above
and ties them together with the native `<template>` grammar. Reactive state is
reached only through `scope()` — `scope().state()` is writable,
`scope().computed()` is read-only. `props()` and `effect()` are in-scope, no
import.

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { getMessages } from '$server/rpc/getMessages.ts'
import { postMessage } from '$server/rpc/postMessage.ts'
import { messages } from '$server/sockets/messages.ts'
import Avatar from '$ui/Avatar.abide'

const { room = 'lobby' } = props<{ room?: string }>()

// SSR-warm history; live frames then stream over the ws
const seed = cache(getMessages)({ room })
const live = scope().computed(() => tail(messages, { last: 50 }))

let from = scope().state('alice')
let text = scope().state('')
let pinned = scope().state(false)
let sort = scope().state('newest')

async function send() {
    await postMessage({ room, from, text })
    text = ''
}
</script>

<template name="bubble" args={msg}>
    <li class="flex gap-2"><Avatar name={msg.from} /> <b>{msg.from}</b> {msg.text}</li>
</template>

<form onsubmit={send} class="flex gap-2">
    <input bind:value={from} class="border px-2" />
    <input bind:value={text} placeholder="message" class="flex-1 border px-2" />
    <label><input type="checkbox" bind:checked={pinned} /> pin</label>
    <label><input type="radio" bind:group={sort} value="newest" /> newest</label>
    <button disabled={!text} class="border px-3">send</button>
</form>

<template if={pinned}>
    <p class="text-xs text-amber-700">room pinned</p>
    <template else><p class="text-xs text-slate-400">not pinned</p></template>
</template>

<template switch={sort}>
    <template case={'newest'}><p class="text-xs">newest first</p></template>
    <template default><p class="text-xs">oldest first</p></template>
</template>

<template await={seed}>
    <p class="text-xs text-slate-500">loading…</p>
    <template then="history">
        <ul class="mt-3 space-y-1">
            <template each={live ?? history} as="msg" key="msg.id">
                {bubble(msg)}
            </template>
        </ul>
    </template>
    <template catch="err"><p class="text-rose-700">{err.message}</p></template>
</template>

<style>
    li { font-size: 0.875rem; }
</style>
```

MIT
