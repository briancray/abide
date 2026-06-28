# abide

**One typed declaration fans out to HTTP, a CLI, an MCP tool, and an OpenAPI
operation — and the same callable runs on the server and in the browser.**

abide is an isomorphic, multimodal HTTP framework for a single Bun runtime: you
declare a typed RPC once and it becomes a browser fetch, an in-process SSR call,
an MCP tool, a CLI subcommand, and an OpenAPI operation; the bundler swaps the
runtime per side so the same name behaves the same on both. Built for humans
*and* machines.

- One direct dependency (TypeScript). One runtime (Bun ≥ 1.3).
- `.abide` single-file components render on the server and hydrate in place.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds, installs, and starts the dev server
```

Or clone the kitchen-sink example:

```sh
git clone https://github.com/briancray/abide
cd abide/examples/kitchen-sink
bun install
bun run dev
```

## RPCs

An RPC is one export under `src/server/rpc/`. The file path is the URL; the
export's schema validates the args and projects the MCP tool, the CLI flags, and
the OpenAPI operation. The schema contract is Standard Schema — pass a zod,
valibot, or arktype schema directly, unadapted.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

export const getMessages = GET(
  async ({ channel }) => json(await db.recentMessages(channel)),
  { inputSchema: z.object({ channel: z.coerce.string() }) },
)
```

One declaration, every surface:

```text
                  export const getMessages = GET(fn, { inputSchema })
                                     │
       ┌───────────────┬─────────────┼─────────────┬───────────────┐
       ▼               ▼             ▼             ▼               ▼
   SSR call       browser fetch   MCP tool     CLI command     OpenAPI op
 cache(fn)()     typed proxy    (read-only)   getMessages …  /openapi.json
 (in-process)    (swapped fn())
```

A schema unlocks the CLI for any method and auto-exposes read-only methods
(`GET`/`HEAD`) as MCP tools; a mutating method (`POST`/`PUT`/`PATCH`/`DELETE`)
never auto-exposes to MCP — it needs an explicit `clients: { mcp: true }`.
Consume the RPC four ways: `cache(getMessages)({ channel })` in-process during
SSR, the swapped `fetch` proxy in the browser, `getMessages.raw(args)` for the
underlying `Response`, and `getMessages.stream(args)` for a frame iterable.

> Query args travel as strings — validate with `z.coerce.*`. A per-RPC
> `timeout` (504 on every surface) is distinct from the client-side
> `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A
`Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await (const m of chat)`
is the live stream — and every socket multiplexes onto one WebSocket at
`/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
  schema: z.object({ id: z.string(), author: z.string(), text: z.string() }),
  tail: 50,        // retain the last 50 frames for replay
  ttl: 60_000,     // evict retained frames older than 60s
})
```

Each socket also has an HTTP face at `/__abide/sockets/<name>`: `GET` returns the
retained tail, `POST` publishes a frame (gated by `clientPublish`).

## Components

A `.abide` component renders on the server and hydrates in the browser. The page
below imports the RPC and the socket above and exercises the whole template
grammar. Reactive state is reached through `scope()` — the documented default is
to destructure it once at the top of the `<script>` and call the primitives bare.

```html
<script>
  import { cache } from '@abide/abide/shared/cache'
  import { tail } from '@abide/abide/ui/tail'
  import { html } from '@abide/abide/ui/html'
  import { getMessages } from '$server/rpc/getMessages'
  import { sendMessage } from '$server/rpc/sendMessage'
  import { chat } from '$server/sockets/chat'
  import Card from '$ui/Card.abide'
  import Message from '$ui/Message.abide'
  import Risky from '$ui/Risky.abide'

  // props() is the ambient prop reader — no import; destructure with defaults + rest
  const { channel = 'general', ...rest } = props()

  // destructure-once: reach every reactive primitive through scope(), then call bare
  const { state, computed, linked, effect } = scope()

  let draft = state('')
  let count = state(0)
  let muted = state(false)
  let topic = state('all')
  const doubled = computed(() => count * 2)
  const banner = linked(() => `# ${channel}`)

  // live reads off the §3 socket: latest frame, plus a window of the last 20
  const latest = tail(chat)
  const recent = tail(chat, { last: 20 })

  // effect runs client-only (stripped from SSR)
  effect(() => {
    document.title = `${channel} (${count})`
  })

  // an event handler calling a mutating RPC
  async function send() {
    await sendMessage({ channel, text: draft })
    draft = ''
    count = count + 1
  }

  // the derived two-way binding's accessors
  const get = () => count
  const set = (value) => (count = Number(value))

  // an attachment: runs against the element at mount
  const focus = (node) => node.focus()
</script>

<main {...rest}>
  <h1 class:muted={muted} style:opacity={muted ? 0.5 : 1}>{banner}</h1>
  <p>seen {count} — doubled {doubled}</p>
  <p>{html`<em>latest:</em> ${latest?.text ?? '—'}`}</p>

  <form onsubmit={send}>
    <input bind:value={draft} attach={focus} placeholder="message" />
    <label><input type="checkbox" bind:checked={muted} /> mute</label>
    <label><input type="radio" bind:group={topic} value="all" /> all</label>
    <label><input type="radio" bind:group={topic} value="mine" /> mine</label>
    <input type="range" min="0" max="50" bind:value={{ get, set }} />
    <button>send</button>
  </form>

  {#snippet row(message)}
    <li>{html`<strong>${message.author}</strong>`}: {message.text}</li>
  {/snippet}

  {#if recent.length === 0}
    <p>No messages yet.</p>
  {:else if muted}
    <p>Muted — {recent.length} hidden.</p>
    <script>
      // a nested script scoped to this branch — its own scope(), no imports
      const { computed } = scope()
      const note = computed(() => `${recent.length} while muted`)
    </script>
    <small>{note}</small>
    <style>
      small { color: gray; }
    </style>
  {:else}
    <ul>
      {#for message, i of recent by message.id}
        <Card title={`#${i}`}>{row(message)}</Card>
      {/for}
    </ul>
  {/if}

  <h2>filter</h2>
  {#switch topic}
    {:case 'all'}<p>showing everything</p>
    {:case 'mine'}<p>showing mine</p>
    {:default}<p>unknown filter</p>
  {/switch}

  <h2>history</h2>
  {#await cache(getMessages)({ channel })}
    <p>loading…</p>
  {:then list}
    <ul>
      {#for entry of list by entry.id}
        <Message {...entry} />
      {/for}
    </ul>
  {:catch error}
    <p>failed: {error.message}</p>
  {:finally}
    <hr />
  {/await}

  <h2>live</h2>
  <ul>
    {#for await frame of chat}
      <li>{frame.text}</li>
    {/for}
  </ul>

  {#try}
    <Risky />
  {:catch error}
    <p>widget crashed: {error.message}</p>
  {:finally}
    <span>boundary settled</span>
  {/try}
</main>

<style>
  main { font-family: system-ui; }
  .muted { text-decoration: line-through; }
</style>
```

A capitalised tag is a child component; the content nested inside it renders
where the child calls `{children()}` (the `<slot>` element was removed — there
are no named slots). `{#if children}…{:else}…{/if}` is the fallback form:

```html
<script>
  const { title = 'Card' } = props()
</script>

<section class="card">
  <h3>{title}</h3>
  {#if children}{children()}{:else}<p>empty</p>{/if}
</section>

<style>
  .card { border: 1px solid #ddd; }
</style>
```

MIT
