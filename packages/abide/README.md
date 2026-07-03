# abide

**One typed declaration fans out to HTTP, a CLI, an MCP tool, and an OpenAPI
spec — on a single Bun runtime.**

abide is a type-safe isomorphic framework: you declare an RPC, a socket, and a
`.abide` component once, and the bundler swaps the runtime per side — the same
callable is a direct in-process call on the server and a typed `fetch` in the
browser. Built for humans *and* machines: every schema-carrying RPC is
simultaneously a browser endpoint, a CLI subcommand, an MCP tool, and an
OpenAPI operation.

One direct dependency (TypeScript). One runtime (Bun ≥ 1.3.0).

## Quick start

```sh
# Scaffold a project, install it, and start the dev server (in a TTY).
bunx abide scaffold my-app

# Or explore the full feature set in the kitchen-sink example.
git clone https://github.com/briancray/abide
cd abide/examples/kitchen-sink
bun install
bun run dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the URL
(under `/rpc/`), the import (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`) picks
the HTTP method, and an optional `inputSchema` — any Standard Schema (zod,
valibot, arktype, unadapted) — validates the args and projects the MCP tool, the
CLI flags, and the OpenAPI operation.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

const rooms: Record<string, { id: string; text: string }[]> = {}

// GET /rpc/getMessages?room=lobby
export const getMessages = GET(
    (args: { room: string }) => json(rooms[args.room] ?? []),
    { inputSchema: z.object({ room: z.coerce.string() }) },
)
```

```ts
// src/server/rpc/postMessage.ts
import { POST } from '@abide/abide/server/POST'
import { json } from '@abide/abide/server/json'
import { error } from '@abide/abide/server/error'
import { z } from 'zod'

const rateLimited = error.typed('rateLimited', 429)

// A mutating method never auto-exposes to MCP — opt in explicitly.
export const postMessage = POST(
    (args: { room: string; text: string }) => {
        if (args.text.length > 500) return rateLimited()
        return json({ ok: true })
    },
    { inputSchema: z.object({ room: z.string(), text: z.string() }), clients: { mcp: true } },
)
```

One declaration, five surfaces:

```text
              export const getMessages = GET(fn, { inputSchema })
                                  │
      ┌────────────┬─────────────┼─────────────┬────────────┐
      ▼            ▼             ▼             ▼            ▼
 cache(fn)()   typed fetch    MCP tool     CLI subcmd   OpenAPI op
  (SSR, warm    (browser,    (read-only   (any schema-  (/openapi
   hydration)    swapped)     GET/HEAD)    carrying)     .json)
```

A schema unlocks the CLI for any RPC and MCP for read-only methods (`GET`/`HEAD`);
a mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) reaches MCP only with an
explicit `clients: { mcp: true }`. Consume an RPC four ways: `cache(fn)()`
in-process (warm SSR + hydration), the swapped `fetch` in the browser,
`fn.raw(args)` for the underlying `Response`, and `fn.stream(args)` to iterate
`jsonl`/`sse` frames.

> Query args travel as strings — coerce them (`z.coerce.number()`). A per-RPC
> `timeout` returns 504 on every surface; it is distinct from the client-wide
> `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A
`Socket<T>` is an isomorphic `AsyncIterable<T>` — iterate for the live stream,
`.tail(count)` to seed from the retained tail. Every socket multiplexes onto one
WebSocket at `/__abide/sockets`; the server publishes in-process and fans out,
the browser proxy sends a `pub` frame.

```ts
// src/server/sockets/messages.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const messages = socket({
    schema: z.object({ room: z.string(), text: z.string() }),
    tail: 50, // retain the last 50 frames for late joiners / reconnects
    ttl: 60_000, // evict retained frames older than 60s before replay
})
```

The HTTP face lives at `/__abide/sockets/<name>`: `GET` returns the retained
tail, `POST` publishes (gated by `clientPublish`).

## Components

A `.abide` component is a single file: a leading `<script>` (module imports plus
reactive setup), the template, and an optional component-scoped `<style>`. This
page imports the RPC from §RPCs and the socket from §Sockets and drives them
through the whole template grammar.

Reactive state is reached only through `scope()`. The authoring default is the
destructure-once idiom — pull the primitives off `scope()` at the top of the
`<script>`, then call them bare. `computed` is read-only; `effect` is client-only
(stripped from SSR). A bare `state`/`computed`/`linked`/`effect` with no
`scope()` destructure is a compile error.

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { html } from '@abide/abide/ui/html'
import { getMessages } from '$server/rpc/getMessages.ts'
import { postMessage } from '$server/rpc/postMessage.ts'
import { messages } from '$server/sockets/messages.ts'
import MessageCard from '$ui/MessageCard.abide'

const { state, computed, linked, effect } = scope()
const { room = 'lobby' } = props()

let draft = state('')
let showRaw = state(false)
let filter = state('all')
const trimmed = computed(() => draft.trim())
const outgoing = linked(() => room + ': ' + trimmed)
const banner = html`<strong>#${room}</strong>`

// client-only reaction — never runs during SSR
effect(() => console.log('draft is now', draft))

// the derived two-way binding target, read down / written up
const get = () => outgoing
const set = (value) => (draft = value)
// mutating RPC from an event handler
const send = () => {
    postMessage({ room, text: trimmed })
    draft = ''
}
</script>

{#snippet chip(label)}
    <span class="rounded bg-slate-100 px-2 text-xs">{label}</span>
{/snippet}

<section class="p-4" attach={(node) => node.focus()} {...{ id: 'chat' }}>
    <h1 class:live={showRaw} style:opacity={showRaw ? 1 : 0.6}>{banner}</h1>

    {#await cache(getMessages)({ room })}
        <p>loading…</p>
    {:then history}
        {#if history.length > 0}
            {#for message, i of history by message.id}
                <MessageCard {...message}>
                    {chip(i)}
                    <p>{message.text}</p>
                </MessageCard>
            {/for}
        {:else if showRaw}
            <p>no history yet</p>
        {:else}
            <p>say hello</p>
        {/if}
    {:catch error}
        <p>failed to load: {error.message}</p>
    {:finally}
        <hr />
    {/await}

    {#for await frame of messages.tail(10)}
        <p class="live-frame">{frame.text}</p>
    {/for}

    {#switch filter}
        {:case 'all'}<p>showing all rooms</p>
        {:case 'mine'}<p>showing my rooms</p>
        {:default}<p>—</p>
    {/switch}

    {#try}
        {#if showRaw}
            <script>const { computed } = scope()
const label = computed(() => 'raw view active')</script>
            <pre>{label}</pre>
        {/if}
    {:catch error}
        <p>render error: {error.message}</p>
    {:finally}
        <small>rendered</small>
    {/try}

    <form onsubmit={send}>
        <input bind:value={draft} placeholder="message" />
        <label><input type="checkbox" bind:checked={showRaw} /> raw</label>
        <label><input type="radio" bind:group={filter} value="all" /> all</label>
        <label><input type="radio" bind:group={filter} value="mine" /> mine</label>
        <input bind:value={{ get, set }} />
        <button type="submit">send</button>
    </form>
</section>

<style>
    .live { color: teal; }
</style>
```

Content nested inside a capitalised child component renders where the child
calls `{children()}` — the single slot, with `{#if children}…{:else}…{/if}` as
its fallback (there is no `<slot>` element and no named slots):

```html
<script>
const { text = '' } = props()
</script>

<article class="card rounded border p-2">
    <p class="font-medium">{text}</p>
    {#if children}{children()}{:else}<em>no body</em>{/if}
</article>
```

MIT
