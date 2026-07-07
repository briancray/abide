# abide

**One typed declaration, every surface: an RPC you write once fans out to HTTP,
a CLI, an MCP tool, and an OpenAPI operation — and the same callable runs
in-process on the server and over fetch in the browser.**

abide is an isomorphic multimodal HTTP framework built for humans and machines
in a single Bun runtime: file-path routing, Standard Schema validation, and a
compiled `.abide` UI layer that server-renders, streams, and hydrates the same
components. The bundler swaps each callable's runtime per side — same name,
same behavior, no client/server forks in app code.

- One direct dependency (TypeScript). One runtime (Bun ≥ 1.3).

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds, installs, and starts the dev server
```

Or run the kitchen-sink example, which demos the full surface:

```sh
git clone https://github.com/briancray/abide
cd abide && bun install
cd examples/kitchen-sink && bun run dev
```

## RPCs

An RPC is one exported handler per file under `src/server/rpc/` — the file path
is the URL. The export wraps the handler in an HTTP-method helper (`GET`,
`POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`); a Standard Schema `inputSchema`
(zod, valibot, arktype — no adapter) validates the args and projects the CLI
flags, the MCP tool, and the OpenAPI operation from the one declaration.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { listMessages } from '$server/store'

export const getMessages = GET(
    async ({ room, limit }) => json(await listMessages(room, limit)),
    {
        inputSchema: z.object({
            room: z.string(),
            limit: z.coerce.number().default(50),
        }),
    },
)
```

That one file fans out:

```text
src/server/rpc/getMessages.ts
      │
      ├─ SSR / server   await getMessages({ room })  in-process, no HTTP
      ├─ browser        await getMessages({ room })   typed fetch proxy
      ├─ HTTP           GET /rpc/getMessages?room=…
      ├─ CLI            my-app get-messages --room …
      ├─ MCP            tool: get-messages
      └─ OpenAPI        operation in /openapi.json
```

A schema is the gate: it unlocks the CLI, and — for read-only methods
(GET/HEAD) — the MCP tool. A mutating method (POST/PUT/PATCH/DELETE) never
auto-exposes to MCP; it needs an explicit `clients: { mcp: true }`.

The bare call **is** the smart read — cached, coalesced, reactive,
stale-while-revalidate — and it is isomorphic: the same callable resolves
in-process during SSR (its value baked into the HTML for warm hydration) and
over `fetch` in the browser. Around it:

- `getMessages.raw(args, init?)` — the raw `Response`; per-call transport
  options (`signal`, `headers`, …) live here
- `getMessages.refresh(args?)` — refetch, keeping the stale value visible
- `getMessages.patch(args?, updater)` — mutate the retained value locally,
  no network
- `getMessages.peek(args?)` — read the retained value synchronously
- `getMessages.pending(args?)` / `.refreshing(args?)` / `.error(args?)` —
  reactive probes
- a handler that returns `jsonl()`/`sse()` makes the bare call return a
  `Subscribable` you `for await` — detected at build time, nothing to declare

> Query args travel as strings — use `z.coerce.*` for numbers and booleans on
> GET/HEAD. The per-RPC `timeout` option is a server-side handler deadline
> (504, enforced on every surface); `ABIDE_CLIENT_TIMEOUT` bounds browser calls
> and is separate.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/` — the
export name is the topic. A `Socket<T>` is an isomorphic `AsyncIterable<T>`:
server code iterates and broadcasts in-process; browser code gets the same
shape over one multiplexed WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ author: z.string(), text: z.string() }),
    tail: 50, // retain the last 50 frames for late joiners (default 1)
    ttl: 60_000, // retained frames expire after a minute
    clientPublish: true, // allow browser publishes (off by default)
})
```

`chat.broadcast(msg)` publishes from either side — schema-validated on the
server, and client publishes are gated by `clientPublish`. `for await (const
msg of chat)` is the live stream; `chat.peek()` reads the latest retained
frame; `chat.refresh()` re-pulls the server tail after a reconnect. A schema
also advertises the topic to MCP and the CLI.

Every exposed socket has an HTTP face at `/__abide/sockets/<name>`: `GET`
returns the retained tail as JSON (or a live SSE stream under
`Accept: text/event-stream`), `POST` publishes — gated by `clientPublish`.

## Components

Pages are `.abide` single-file components under `src/ui/pages/` (`page.abide` /
`layout.abide`; a `[id]` folder becomes a route param read via `props()`). A
component is HTML plus `{expr}` bindings and `{#…}` control-flow blocks.
Reactive state comes from imported primitives the compiler lowers, so inside a
component you read and write state as plain variables. The same file renders on
the server — blocking awaits inline, streaming awaits out of order, cached
reads seeded warm — and hydrates in the browser.

Nested content becomes the component's `children` prop — an ordinary declared
prop of type `Snippet` — and renders wherever the component calls
`{children()}`:

```html
<script>
    import { props } from '@abide/abide/ui/props'
    import type { Snippet } from '@abide/abide/shared/snippet'

    const { title, children } = props<{ title: string; children?: Snippet }>()
</script>

<section>
    <h2>{title}</h2>
    {#if children}{children()}{:else}<p>Nothing here yet.</p>{/if}
</section>

<style>
    section {
        border: 1px solid gray;
    }
</style>
```

And one page tying together the RPC from above, the socket, and the whole
template grammar:

```html
<script>
    import { getMessages } from '$server/rpc/getMessages'
    import { sendMessage } from '$server/rpc/sendMessage' // POST, declared like getMessages
    import { chat } from '$server/sockets/chat'
    import { state } from '@abide/abide/ui/state'
    import { watch } from '@abide/abide/ui/watch'
    import { html } from '@abide/abide/ui/html'
    import { props } from '@abide/abide/ui/props'
    import Panel from '$ui/components/Panel.abide'

    const { room = 'lobby' } = props<{ room?: string }>()

    let draft = state('')
    let author = state('anon')
    let tone = state('friendly')
    let notify = state(true)
    let volume = state(5, (next, previous) => (Number.isFinite(next) ? next : previous))
    let shout = state.computed(() => draft.toUpperCase())
    let roomDraft = state.linked(() => room)

    // watch is the one reaction primitive: a socket, an rpc, or a tracked thunk.
    watch(chat, () => getMessages.refresh({ room }))
    watch(() => console.log(author, tone))

    // a writable computed lives at the binding: bind:value={{ get, set }}
    const get = () => draft.trim()
    const set = (next) => (draft = next)

    const focus = (element) => element.focus()
    const panelProps = { title: 'Live feed' }
    const draftAttrs = { placeholder: 'say something', autocomplete: 'off' }

    async function send() {
        await sendMessage({ room: roomDraft, author, text: draft })
        draft = ''
    }
</script>

{#snippet line(message)}
    <li>{message.author}: {message.text}</li>
{/snippet}

<Panel {...panelProps}>
    <h1 class:muted={!notify} style:opacity={notify ? '1' : '0.6'}>
        {room} — {shout}
    </h1>

    {#await getMessages({ room })}
        <p>loading…</p>
    {:then messages}
        {#if messages.length === 0}
            <p>No messages yet.</p>
        {:else if messages.length < 100}
            <ul>
                {#for message, i of messages by message.id}
                    {line(message)}
                {/for}
            </ul>
        {:else}
            <script>
                // branch-local state, re-seeded each time this branch mounts
                let offset = state(0)
            </script>
            <p>huge room — showing from {offset}</p>
            <button onclick={() => (offset = offset + 100)}>next</button>
            <style>
                p {
                    font-variant-numeric: tabular-nums;
                }
            </style>
        {/if}
    {:catch error}
        <p>failed to load: {error.message}</p>
    {:finally}
        <p>checked just now</p>
    {/await}

    <ol>
        {#for await message of chat}
            {line(message)}
        {/for}
    </ol>

    {#switch tone}
        {:case 'friendly'}
            <p>{html`<em>be&nbsp;kind</em>`}</p>
        {:default}
            <p>say anything</p>
    {/switch}

    {#try}
        <p>{JSON.parse(draft).summary}</p>
    {:catch}
        <p>draft isn't JSON yet</p>
    {/try}

    <form onsubmit={(event) => { event.preventDefault(); send() }}>
        <input attach={focus} bind:value={draft} {...draftAttrs} />
        <input bind:value={{ get, set }} />
        <label><input type="checkbox" bind:checked={notify} /> notify</label>
        <label><input type="radio" bind:group={tone} value="friendly" /> friendly</label>
        <label><input type="radio" bind:group={tone} value="blunt" /> blunt</label>
        <input type="range" bind:value={volume} min="0" max="10" />
        <select bind:value={author}>
            <option>anon</option>
            <option>me</option>
        </select>
        <button disabled={draft === ''}>send</button>
    </form>
</Panel>

<style>
    form {
        display: flex;
        gap: 0.5rem;
    }
    .muted {
        color: gray;
    }
</style>
```

MIT
