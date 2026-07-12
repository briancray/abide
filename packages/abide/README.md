# abide

**One typed declaration, every surface: SSR, browser fetch, MCP, CLI, and OpenAPI from a single Bun runtime.**

abide is an isomorphic HTTP framework where a typed RPC you declare once fans out to an in-process SSR call, a browser fetch, an MCP tool, a CLI subcommand, and an OpenAPI operation — the bundler swaps the runtime per side, so the same callable behaves the same in-process on the server and over `fetch` in the browser. It is built for humans and machines: the same schema that types your code projects the tool, the flag, and the spec.

- One direct dependency (TypeScript), one runtime (Bun ≥ 1.3.0).
- No barrels — every public name is its own module path (`@abide/abide/server/GET`, `@abide/abide/ui/state`, …). The namespace marks the side: `server/*` runs server-side, `ui/*` client-side, `shared/*` isomorphic.

## Quick start

```sh
# Scaffold a project from the bundled template, install it, and start dev.
bunx abide scaffold my-app
```

Or clone the kitchen-sink example, which exercises the whole surface:

```sh
git clone https://github.com/briancray/abide
cd abide/examples/kitchen-sink
bun install
bun run dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the URL; the declared method helper (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`) picks the verb. Attach a `schemas.input` (any Standard Schema — zod, valibot, or arktype, unadapted) and the same schema validates the args and projects the MCP tool, the CLI flags, and the OpenAPI operation.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { load } from '$server/db.ts'

export const getMessages = GET(
    (args) => json(load(args.channel, args.limit)),
    {
        schemas: {
            input: z.object({
                channel: z.string().default('general'),
                limit: z.number().max(100).default(20),
            }),
        },
    },
)
```

One declaration, five surfaces:

```text
            export const getMessages = GET(fn, { schemas })
                               │
    ┌───────────┬──────────────┼──────────────┬─────────────┐
    ▼           ▼              ▼              ▼             ▼
 SSR call   browser fetch   MCP tool      CLI subcmd   OpenAPI op
 (bare,     (same call,     (read-only    abide-cli    /openapi.json
  in-proc)   swap to fetch)  from schema)  getMessages
```

A schema unlocks the CLI on any RPC, and MCP for read-only methods (`GET`/`HEAD`). A mutating method never auto-exposes to MCP — it opts in explicitly:

```ts
// src/server/rpc/sendMessage.ts
import { POST } from '@abide/abide/server/POST'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { append } from '$server/db.ts'

export const sendMessage = POST(
    (args) => json(append(args.channel, args.body)),
    {
        schemas: { input: z.object({ channel: z.string(), body: z.string() }) },
        clients: { mcp: true }, // a mutating RPC must opt into MCP by hand
    },
)
```

Consume forms are isomorphic. The **bare call `fn(args)` is the smart read** — cached, coalesced, reactive, resolved in-process during SSR and over `fetch` in the browser (there is no `cache()` wrapper; the bare call carries the caching). Alongside it: `fn.raw(args, init?)` for the raw `Response`, and the mutators/probes `fn.refresh()`, `fn.patch(...)`, `fn.peek()`, `fn.pending()`, `fn.refreshing()`, and `fn.error()`. A streaming handler (`jsonl`/`sse`) makes the bare call return a `Subscribable` you iterate.

> Query and path args auto-coerce from the endpoint's typed shape — a numeric field arrives as a number, no `z.coerce` needed. The per-RPC `timeout` (a 504 on every surface) is distinct from the client-wide `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A `Socket<T>` is an isomorphic `AsyncIterable<T>` — the same value you `for await` on both sides — and every socket multiplexes onto one WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ author: z.string(), body: z.string() }),
    tail: 20, // retain the last 20 frames for late joiners and reconnects
    ttl: 60_000, // evict retained frames older than 60s
})
```

Publish with `chat.publish(frame)`; seed a late reader with `chat.tail(count)`. Each socket also has an HTTP face at `/__abide/sockets/<name>`: `GET` returns the retained tail, and `POST` publishes when `clientPublish` is set.

## Components

A `.abide` component is HTML with a leading `<script>`. The example below is one page that imports the RPC and socket above and exercises the whole template grammar. Reactive primitives are imported by their own module paths and called bare: `state(0)` is a writable cell (read/write via `.value`), `state.computed(fn)` is read-only derived, `state.linked(fn)` is writable and reseeded from a thunk. `watch(source, handler)` is the single reaction primitive — over a cell, a socket, or an RPC. `props()` is the ambient prop reader (no import).

```html
<script>
import { getMessages } from '$server/rpc/getMessages.ts'
import { sendMessage } from '$server/rpc/sendMessage.ts'
import { chat } from '$server/sockets/chat.ts'
import MessageCard from '$ui/components/MessageCard.abide'
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
import { html } from '@abide/abide/ui/html'

const { title = 'Chat', ...rest } = props()

let channel = state('general')
let draft = state('')
let pinned = state(false)
let limit = state(20)

let trimmed = state.computed(() => draft.value.trim())
let live = state.linked(() => limit.value)

const badge = html`<sup class="ml-1 text-xs text-emerald-600">live</sup>`

watch(trimmed, (value) => console.log('draft is now', value))
watch(chat, (frame) => {
    live.value = live.value + 1
})

async function submit(event) {
    event.preventDefault()
    if (trimmed.value === '') return
    await sendMessage({ channel: channel.value, body: trimmed.value })
    draft.value = ''
}

function autofocus(node) {
    node.focus()
    return () => {}
}

const rowProps = { class: 'flex gap-2' }

// Derived two-way binding: read a string, coerce writes back into the numeric cell.
const get = () => String(limit.value)
const set = (next) => (limit.value = Number(next))
</script>

<section {...rest} class:pinned={pinned.value} style:opacity={pinned.value ? '1' : '0.85'}>
    <h1>{title} {badge}</h1>

    <form onsubmit={submit}>
        <input bind:value={draft} attach={autofocus} placeholder="Say something" />
        <label><input type="checkbox" bind:checked={pinned} /> pin</label>
        <label><input type="radio" bind:group={channel} value="general" /> general</label>
        <label><input type="radio" bind:group={channel} value="random" /> random</label>
        <input bind:value={{ get, set }} />
        <button type="submit">Send</button>
    </form>

    {#snippet row(message, index)}
        <MessageCard {...rowProps} name={message.author} onclick={() => console.log(index)}>
            <p>{message.body}</p>
        </MessageCard>
    {/snippet}

    {#if live.value > 100}
        <p>Busy channel</p>
    {:else if live.value > 0}
        <p>{live.value} updates</p>
    {:else}
        <script>
            let seenAt = state(Date.now())
            let ageLabel = state.computed(() => `waiting since ${seenAt.value}`)
        </script>
        <style>
            p { color: gray; }
        </style>
        <p>{ageLabel.value}</p>
    {/if}

    {#await getMessages({ limit: limit.value })}
        <p>Loading…</p>
    {:then messages}
        {#for message, i of messages by message.id}
            {row(message, i)}
        {/for}
    {:catch problem}
        <p>Failed: {problem.message}</p>
    {:finally}
        <hr />
    {/await}

    {#for await frame of chat}
        <p class="text-sm opacity-70">{frame.author}: {frame.body}</p>
    {/for}

    {#switch channel.value}
        {:case 'general'}
            <span>General channel</span>
        {:case 'random'}
            <span>Random channel</span>
        {:default}
            <span>Unknown channel</span>
    {/switch}

    {#try}
        <MessageCard name="system">
            <p>System notice</p>
        </MessageCard>
    {:catch}
        <p>Card crashed</p>
    {:finally}
        <span class="sr-only">done</span>
    {/try}
</section>

<style>
    section {
        display: grid;
        gap: 0.5rem;
    }
</style>
```

The capitalised `MessageCard` renders its passed content where it calls `{children()}`. The `<slot>` element was removed — `{children()}` is the single fill point, and `{#if children}{children()}{:else}…{/if}` is the fallback form.

```html
<script>
const { name, ...rest } = props()
</script>

<article {...rest}>
    <strong>{name}</strong>
    {#if children}
        {children()}
    {:else}
        <em>No content</em>
    {/if}
</article>
```

MIT
