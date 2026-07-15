# abide

**One typed declaration fans out to HTTP, a browser proxy, a CLI, an MCP tool, and an OpenAPI spec — in a single Bun runtime, for humans and machines alike.**

abide is an isomorphic framework where a server RPC is one typed function: the bundler swaps its runtime per side (in-process on the server, `fetch` in the browser) and projects the same declaration onto every other surface. The `.abide` component grammar ties those RPCs, live sockets, and reactive state into one page that server-renders and hydrates.

- One direct dependency (TypeScript); one runtime (Bun ≥ 1.3). Tailwind is an optional peer.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds the project, installs deps, starts the dev server
```

Or run the kitchen-sink example:

```sh
git clone https://github.com/briancray/abide
cd abide && bun install
cd examples/kitchen-sink && bun dev
```

## RPCs

An RPC is one export per file under `src/server/rpc/` — the file path is the URL. The handler's typed input parameter is the contract: at build it projects to JSON Schema (ADR-0030) that drives the MCP tool, CLI flags, and OpenAPI operation. A Standard Schema (zod / valibot / arktype, unadapted) in `schemas.input` adds runtime validation on top.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'
import { listMessages } from '../db.ts'

export const getMessages = GET(
  async ({ limit }: { limit: number }) => json(await listMessages(limit)),
  { schemas: { input: z.object({ limit: z.number().max(100) }) } },
)
```

One declaration, five surfaces:

```text
                        getMessages  (src/server/rpc/getMessages.ts)
                              │
   ┌──────────────┬──────────┼───────────────┬───────────────────┐
   ▼              ▼          ▼               ▼                   ▼
 SSR call     browser      MCP tool        CLI               OpenAPI op
 (in-proc)    fetch        get_messages    app get-messages   GET /rpc/
 smart read   typed proxy  (read → auto)   --limit 20         getMessages
```

A **typed input** unlocks the CLI, and for a read-only method (GET/HEAD) the MCP tool, with no hand-written schema — the projected shape is the machine-advertisable contract. A mutating method (POST/PUT/PATCH/DELETE) never auto-exposes to MCP; it needs explicit `clients: { mcp: true }`.

```ts
// src/server/rpc/sendMessage.ts — a plainly-typed mutation, opted into MCP
import { POST } from '@abide/abide/server/POST'
import { json } from '@abide/abide/server/json'
import { appendMessage } from '../db.ts'

export const sendMessage = POST(
  async ({ text }: { text: string }) => json(await appendMessage(text)),
  { clients: { mcp: true } },
)
```

Consume it many ways. The **bare call `fn(args)` is the smart read** — cached, coalesced, reactive, isomorphic (in-process during SSR, `fetch` in the browser). Alongside it: `fn.raw(args, init?)` for the raw `Response`, and the probes/mutators `fn.pending()` / `fn.refreshing()` / `fn.error()` / `fn.peek()` / `fn.refresh()` / `fn.invalidate()` / `fn.amend(...)`. A streaming handler (`jsonl`/`sse`) makes the bare call return a `Subscribable`. There is no `cache()` wrapper — the bare call carries the caching.

> Query / path / form args auto-coerce from the endpoint's typed shape (ADR-0028): a numeric / boolean / date field arrives already typed, so no `z.coerce` is needed — a value that won't parse stays a string so the schema raises an honest 422. The per-RPC `timeout` (504, on every surface) is distinct from `ABIDE_CLIENT_TIMEOUT`.

## Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A `Socket<T>` is an isomorphic `AsyncIterable<T>`; every socket multiplexes onto one WebSocket at `/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
  schema: z.object({ id: z.string(), text: z.string() }),
  tail: 50,        // retain the last 50 frames for late joiners / reconnects
  ttl: 60_000,     // evict retained frames older than 60s before replay
})
```

The HTTP face is `/__abide/sockets/<name>`: `GET` returns the retained tail, `POST` publishes (gated by `clientPublish`).

## Components

A `.abide` component is a single page that server-renders and hydrates. This one imports the RPC and socket above and exercises the whole grammar.

```html
<script>
import { getMessages } from '$server/rpc/getMessages.ts'
import { sendMessage } from '$server/rpc/sendMessage.ts'
import { chat } from '$server/sockets/chat.ts'
import Card from '$ui/Card.abide'
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
import { html } from '@abide/abide/ui/html'
import { props } from '@abide/abide/ui/props'

const { room = 'general' } = props()

let draft = state('')
let limit = state(20)
let live = state(true)
let tab = state('feed')
let unread = state(0)

// state.computed — read-only derived; state.linked — writable, reseeded from a thunk
let trimmed = state.computed(() => draft.trim())
let title = state.linked(() => `#${room}`)

// watch — the single reaction primitive (client-only): a cell, then a socket
watch(trimmed, next => console.debug('draft', next))
watch(chat, frame => { unread += 1 })

const badge = html`<sup>${unread}</sup>`

async function send() {
  if (!trimmed) return
  await sendMessage({ text: draft })   // mutating RPC in an event handler
  draft = ''
}

// an attach directive: run against the element, return a teardown
function autofocus(node: HTMLElement) {
  node.focus()
  return () => {}
}

// the get/set pair for a derived two-way binding
function get() { return draft.toUpperCase() }
function set(next: string) { draft = next }
</script>

<header class="row" class:live={live} style:opacity={live ? 1 : 0.5} {...{ id: 'top' }}>
  <h1>{title} {badge}</h1>
  <label><input type="checkbox" bind:checked={live} /> live</label>
</header>

<!-- bare async read: undefined while pending, composes with ?. and ?? -->
<p>{getMessages({ limit })?.length ?? 0} loaded</p>
{#if getMessages.pending()}<span>loading…</span>{/if}
{#if getMessages.error()}<span role="alert">failed</span>{/if}

<form onsubmit={send}>
  <input name={room} bind:value={draft} attach={autofocus} />
  <!-- derived two-way binding: { get, set } -->
  <input bind:value={{ get, set }} />
  <button type="submit" disabled={trimmed === ''}>Send</button>
</form>

<nav>
  {#for name of ['feed', 'about']}<span>{name}</span>{/for}
  <label><input type="radio" bind:group={tab} value="feed" /> feed</label>
  <label><input type="radio" bind:group={tab} value="about" /> about</label>
</nav>

{#switch tab}
  {:case 'feed'}
    <ol>
      {#for message, i of getMessages({ limit }) ?? [] by message.id}
        <li style:--i={i}>{message.text}</li>
      {/for}
    </ol>
  {:case 'about'}
    <p>Room {room}.</p>
  {:default}
    <p>—</p>
{/switch}

<!-- inline await: blocks SSR until the value is in the initial HTML -->
<p>total: {await getMessages({ limit: 100 })?.length ?? 0}</p>

<!-- {#await} is the opt-in for a distinct pending branch and {:then} narrowing -->
{#await getMessages({ limit })}
  <p>loading feed…</p>
{:then messages}
  <p>{messages.length} messages</p>
{:catch failure}
  <p>{failure instanceof Error ? failure.message : String(failure)}</p>
{:finally}
  <hr />
{/await}

{#if live}
  <script>
  // a nested branch <script> — branch-local state, re-seeded per mount, no imports
  let seen = state(0)
  let plural = state.computed(() => (seen === 1 ? 'frame' : 'frames'))
  </script>
  <style>
    /* nested <style> scopes to this branch's subtree */
    p { font-variant-numeric: tabular-nums; }
  </style>
  <p>{seen} {plural} this session</p>
  <ul>
    {#for await frame of chat}
      <li>{frame.text}</li>
    {:catch streamError}
      <li>{streamError instanceof Error ? streamError.message : String(streamError)}</li>
    {/for}
  </ul>
{:else if unread > 0}
  <p>{unread} while paused</p>
{:else}
  <p>paused</p>
{/if}

{#try}
  <Card {...{ tone: 'accent' }} class:wide={live}>
    <p>{html('<em>trusted</em>')}</p>
  </Card>
{:catch renderError}
  <p>card failed: {renderError instanceof Error ? renderError.message : String(renderError)}</p>
{:finally}
  <footer>room {room}</footer>
{/try}

{#snippet row(message: { id: string; text: string })}
  <li data-id={message.id}>{message.text}</li>
{/snippet}
<ul>{#if getMessages({ limit })}{row({ id: '0', text: 'pinned' })}{/if}</ul>

<style>
  /* a root <style> is component-scoped */
  .row { display: flex; gap: 0.5rem; }
</style>
```

The child component renders its passed content at `{children()}`, with a fallback:

```html
<script>
import { props } from '@abide/abide/ui/props'
import type { Snippet } from '@abide/abide/shared/snippet'
const { tone = 'plain', children } = props<{ tone?: string; children?: Snippet }>()
</script>

<section class:accent={tone === 'accent'}>
  {#if children}{children()}{:else}<em>empty</em>{/if}
</section>
```

Async reads have no ceremony: the bare call in `{getMessages({ limit })}` is the way — a peek that reads `undefined` while pending and auto-streams on SSR, pairing with `.pending()` / `.error()` for affordances. Reach for `{#await}` only when you want an explicit pending branch, a local `{:catch}`, or `{:then}` narrowing.

MIT
