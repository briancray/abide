# abide

**One typed declaration fans out to an HTTP endpoint, a CLI subcommand, an MCP tool, and an OpenAPI operation — and the same callable runs on the server and in the browser.**

abide is a type-safe isomorphic framework on Bun and web standards. You declare an RPC, a socket, or a `.abide` component once; the bundler swaps the runtime per side (in-process on the server, a typed `fetch` proxy in the browser) so the name, the call, and the behaviour are identical wherever you import it. Built for humans *and* the machines that now read and drive software.

- One direct dependency (TypeScript). Bun is the only runtime — no Node, no separate bundler, no dev server to wire up.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds the project, installs it, and starts dev
```

Or read the runnable tour — every primitive below, live:

```sh
git clone git@github.com:briancray/abide.git
cd abide/examples/kitchen-sink
bun install
bun dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the URL (`getMessages.ts` → `/rpc/getMessages`), and a Standard Schema (zod / valibot / arktype, unadapted) validates the args once and projects the same declaration into every surface.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

const inputSchema = z.object({ room: z.string() })

export const getMessages = GET(({ room }) => json(db.messages(room)), { inputSchema })
```

That single declaration fans out:

```text
      export const getMessages = GET(fn, { inputSchema })
                            │
  ┌────────────┬────────────┬────────────┬────────────┐
  ▼            ▼            ▼            ▼            ▼
  SSR call     browser      MCP tool     CLI cmd      OpenAPI
  cache(fn)()  fetch proxy  (read-only)  abide cli    /openapi.json
```

The schema is the gate: it unlocks the CLI and — for read-only methods (GET/HEAD) — the MCP tool automatically. A mutating method (POST/PUT/PATCH/DELETE) never auto-exposes to MCP; it opts in with `clients: { mcp: true }`. Consume a call four ways: `cache(getMessages)()` in-process (warm SSR + hydration), the swapped `fetch` proxy in the browser, `getMessages.raw(args)` for the untouched `Response`, and `getMessages.stream(args)` for a frame stream.

> Query args travel as strings — use `z.coerce.*` for numbers/booleans on GET/DELETE/HEAD. A per-RPC `timeout` (a 504 on every surface) is distinct from the client-wide `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A `Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await (const m of chat)` is the live stream — and every socket multiplexes onto one WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

const schema = z.object({ from: z.string(), text: z.string(), at: z.number() })

// tail: retain the last 100 frames for late joiners; ttl: evict frames older than an hour.
export const chat = socket({ schema, tail: 100, ttl: 3_600_000 })
export type ChatMessage = z.infer<typeof schema>
```

Each socket also has an HTTP face at `/__abide/sockets/<name>`: `GET` returns the retained tail, `POST` publishes (only when the socket declares `clientPublish`). `chat.publish(m)` is isomorphic — server-side it fans out in-process and to remote subscribers; client-side it sends a validated `pub` frame.

## Components

A component is a `.abide` file: valid HTML with a `<script>`, `{#…}` control-flow blocks, `<template name>` snippets, `{expr}` bindings, and a component-scoped `<style>`. This page imports the RPC and socket above — `cache(getMessages)` seeds the list warm at SSR, `tail(chat)` layers live frames on top after hydration.

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { getMessages } from '$server/rpc/getMessages.ts'
import { createMessage } from '$server/rpc/createMessage.ts'
import { chat } from '$server/sockets/chat.ts'
import Avatar from '$ui/Avatar.abide'

const { room = 'lobby' } = props()
const { state, computed } = scope()

let draft = state('')
let notify = state(true)
const live = computed(() => tail(chat))            // read-only derived
const ready = computed(() => draft.trim().length > 0)

async function send(event: SubmitEvent) {
    event.preventDefault()
    await createMessage({ room, text: draft, notify })
    draft = ''
}
</script>

<template name="row" args={{ msg }}>
    <li><Avatar name={msg.from} /> {msg.text}</li>
</template>

<form onsubmit={send}>
    <input bind:value={draft} placeholder="message" />
    <label><input type="checkbox" bind:checked={notify} /> notify</label>
    <button disabled={!ready()}>Send</button>
</form>

{#if live()}<p class="muted">latest: {live().text}</p>{/if}

{#await cache(getMessages)({ room })}
    <p>Loading…</p>
{:then messages}
    <ul>
        {#for msg of messages by msg.at}{row({ msg })}{/for}
    </ul>
{:catch error}
    <p class="error">{error.message}</p>
{/await}

<style>
    .muted { color: #64748b; }
    .error { color: #b91c1c; }
</style>
```

MIT
