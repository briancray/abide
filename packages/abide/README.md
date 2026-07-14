# abide

**A type-safe isomorphic framework where one typed declaration is an HTTP endpoint, a CLI subcommand, an MCP tool, and an OpenAPI operation at once.**

You write a handler once; abide fans it out across every surface, and the bundler swaps the runtime per side — the same call reads in-process during SSR and becomes a typed `fetch` in the browser. Built for humans _and_ machines, on a single runtime.

- One direct dependency (TypeScript), one runtime (Bun ≥ 1.3.0).

## Quick start

```sh
bunx abide scaffold my-app   # scaffold, install, and start the dev server
```

```sh
# or explore the full feature tour
git clone https://github.com/briancray/abide
cd abide/examples/kitchen-sink
bun install
bun run dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the URL; the handler's typed input drives everything downstream. Any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype — unadapted) validates the arguments and projects the MCP tool, CLI flags, and OpenAPI operation.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { recentMessages } from '../db.ts'

// The success body's type flows back to every caller; `cache` retains the read.
export const getMessages = GET(
    async ({ limit }: { limit: number }) => json(await recentMessages(limit)),
    { schemas: { input: z.object({ limit: z.number().int().max(100) }) }, cache: { ttl: 5_000 } },
)
```

One declaration branches to every surface:

```text
        export const getMessages = GET(handler, { schemas })
                              │
   ┌──────────┬──────────────┼──────────────┬──────────────┐
   ▼          ▼              ▼              ▼              ▼
 SSR call   browser        MCP tool       CLI            OpenAPI op
 the bare   fetch          (read-only,    subcommand     in
 call,      typed proxy    auto-exposed)  abide cli      /openapi.json
 in-process fn(args)                      getMessages
```

A **typed handler input** is what flips those surfaces on: the input type is projected to JSON Schema at build, so a plainly-typed handler auto-exposes to the CLI and — for read-only methods (`GET`/`HEAD`) — MCP with no hand-written `schemas.input` (a declared `schemas.input` adds runtime validation on top). A mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) never auto-exposes to MCP; opt it in with `clients: { mcp: true }`.

Consume it by importing the export. The **bare call `getMessages(args)` is the smart read** — cached, coalesced, reactive, isomorphic (in-process on the server, `fetch` in the browser). Around it sit `getMessages.raw(args, opts?)` for the raw `Response`, the mutators/probes `.refresh()` / `.invalidate()` / `.amend(...)` / `.peek()` / `.pending()` / `.refreshing()` / `.error()`, and — when the handler streams (`jsonl`/`sse`) — a bare call that returns an `AsyncIterable`.

> Query, path, and form args auto-coerce from the endpoint's typed shape at build, so a numeric/boolean/date field arrives already typed — no `z.coerce` (a value that won't parse stays a string, so the schema raises an honest 422). The per-RPC `timeout` (504 on every surface) is distinct from the client transport ceiling `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A `Socket<T>` is an isomorphic `AsyncIterable<T>` — iterate it for the live stream — and every socket multiplexes onto one WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ user: z.string(), text: z.string() }),
    tail: 50, // retain the last 50 frames so late joiners / reconnects seed from `.tail()`
    ttl: 60_000, // evict retained frames older than 60s before replay
})
```

`chat.publish(frame)` is isomorphic — server code fans out in-process and to remote subscribers; client code sends a `pub` frame (gated by `clientPublish`, off by default). The HTTP face is `/__abide/sockets/<name>`: a `GET` returns the retained tail, a `POST` publishes.

## Components

A `.abide` component is valid HTML with a `<script>`, reactive primitives imported by their own module paths, and mustache control-flow blocks. The page below imports the RPC and socket above and exercises the whole grammar:

```html
<script>
import { getMessages } from '$server/rpc/getMessages'
import { sendMessage } from '$server/rpc/sendMessage'
import { countToday } from '$server/rpc/countToday'
import { chat } from '$server/sockets/chat'
import Card from '$ui/Card.abide'
import Avatar from '$ui/Avatar.abide'
import Message from '$ui/Message.abide'
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
import { html } from '@abide/abide/ui/html'
import { props } from '@abide/abide/ui/props'

const { title = 'Chat' } = props()

let limit = state(20)                          // writable cell, read/reassigned as a plain variable
let draft = state('')
let notify = state(true)
let channel = state('general')
const trimmed = state.computed(() => draft.trim())     // read-only derived
const shown = state.linked(() => limit)                // writable, reseeded when `limit` changes

const rootAttrs = { role: 'log' }
const extra = { compact: true }
const get = () => draft.toUpperCase()
const set = (next: string) => { draft = next }

// watch — the single reaction primitive: over a cell, then over a live socket.
watch(limit, (n) => console.log('limit is now', n))
watch(chat, (frame) => console.log('new message', frame.text))

function focus(node: HTMLElement) { node.focus() }
function connection() { return chat.pending() ? 'connecting' : 'open' }
function risky() { return draft.at(999)!.length }

async function send() {
    await sendMessage({ text: trimmed })       // a mutating RPC from an event handler
    draft = ''
}
</script>

<section class="chat" class:empty={limit === 0} style:--rows={shown} {...rootAttrs}>
    <h1>{title}</h1>

    <!-- A bare read STREAMS: it peeks `undefined` while pending, so it composes
         with `??` and the probes. `await` is the marker for the other mode. -->
    <p class:loading={getMessages.pending({ limit })}>
        {getMessages({ limit })?.length ?? 0} messages
        {#if getMessages.error({ limit })}<span>failed to load</span>{/if}
    </p>

    <!-- `{await}` means RESOLVED: the server blocks the flush and the client suspends
         this region until it settles, so the value is never pending at the read (no `?.`)
         — the region just shows nothing, then reveals. -->
    <small>today: {await countToday()}</small>

    <!-- `{#await}` is the explicit opt-in — a distinct pending branch and `{:then}` narrowing. -->
    {#await getMessages({ limit })}
        <p>loading…</p>
    {:then messages}
        {#if messages.length}
            {#for message, i of messages by message.id}
                <Message message={message} ondelete={() => sendMessage({ text: '' })} {...extra}>
                    <Avatar alt={message.user} />
                </Message>
            {/for}
        {:else if limit > 0}
            <p>no messages yet</p>
        {:else}
            <p>raise the limit</p>
        {/if}
    {:catch err}
        <p>{err instanceof Error ? err.message : String(err)}</p>
    {:finally}
        <hr />
    {/await}

    <!-- live socket frames over an AsyncIterable -->
    <ul>
        {#for await frame of chat}
            <li>{frame.user}: {frame.text}</li>
        {/for}
    </ul>

    {#switch connection()}
        {:case 'open'}<span>live</span>
        {:case 'connecting'}<span>connecting…</span>
        {:default}<span>offline</span>
    {/switch}

    {#try}
        <p>{risky()}</p>
    {:catch e}
        <p>widget crashed: {e instanceof Error ? e.message : String(e)}</p>
    {:finally}
        <span>rendered</span>
    {/try}

    <form onsubmit={send}>
        <input name="text" bind:value={draft} />
        <label><input type="checkbox" bind:checked={notify} /> notify</label>
        <input type="radio" bind:group={channel} value="general" />
        <input aria-label="shout" bind:value={{ get, set }} />
        <button attach={focus}>send</button>
    </form>

    {#snippet stat(label: string, value: number)}
        <dd>{label}: {value}</dd>
    {/snippet}
    <dl>{stat('shown', limit)}</dl>

    <Card>
        <p>{html`<em>${trimmed}</em>`}</p>
    </Card>

    {#if limit > 10}
        <script>
        // a nested branch script: branch-local state, re-seeded per mount, no imports
        let expanded = state(false)
        const label = state.computed(() => (expanded ? 'less' : 'more'))
        </script>
        <button onclick={() => (expanded = !expanded)}>{label}</button>
        <style>
        button { font-weight: 600; }
        </style>
    {/if}
</section>

<style>
.chat { display: grid; gap: 0.5rem; }
</style>
```

The child component fills the passed content at `{children()}`; `{#if children}…{:else}…{/if}` is the fallback (there is no `<slot>` element, no named slots):

```html
<script>
import { props } from '@abide/abide/ui/props'
const { children } = props()
</script>

<article class="card">
    {#if children}{children()}{:else}<p>empty</p>{/if}
</article>
```

MIT
