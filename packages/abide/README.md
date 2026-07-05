# abide

**A type-safe isomorphic framework for humans and machines, on one Bun runtime.**

You declare a typed RPC once; abide fans it out to an HTTP endpoint, an MCP
tool, a CLI subcommand, and an OpenAPI operation from that single declaration.
The same named callable runs on both sides — the bundler swaps the runtime per
side (in-process handler on the server, typed `fetch` in the browser), so a
call reads the same in SSR, client code, and a script.

- One direct dependency: TypeScript. One runtime: Bun (`>=1.3.0`).
- `tailwindcss` / `bun-plugin-tailwind` are optional peers — styling only.

## Quick start

```sh
bunx abide scaffold my-app   # scaffolds the template, installs, and (in a TTY)
                             # starts the dev server — one running app
```

Or clone the kitchen-sink example and run it:

```sh
bun install
bun run dev       # abide dev  — build + hot reload
bun run build     # abide build — client bundle into dist/_app/
bun run start     # abide start — production server against dist/
```

## 1. RPCs

An RPC is one export per file under `src/server/rpc/`. The file path is the URL
(`src/server/rpc/getMessages.ts` → `/rpc/getMessages`), and the export name is
the HTTP method. A Standard Schema (zod / valibot / arktype, unadapted)
validates args and projects the MCP tool, the CLI flags, and the OpenAPI
operation from that one declaration.

```ts
// src/server/rpc/getMessages.ts
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

const inputSchema = z.object({ room: z.coerce.string() })

export const getMessages = GET(({ room }) => json(loadMessages(room)), {
    inputSchema,
    timeout: 5000,
})
```

```ts
// src/server/rpc/postMessage.ts — a mutating rpc the component below calls
import { POST } from '@abide/abide/server/POST'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

export const postMessage = POST(({ room, body }) => json(save(room, body)), {
    inputSchema: z.object({ room: z.string(), body: z.string() }),
})
```

One declaration, five faces:

```text
                    ┌─ SSR call       cache(getMessages, { room })
                    ├─ browser fetch  getMessages({ room }) (typed proxy)
  getMessages (GET) ┼─ MCP tool       read-only + schema (auto-exposed)
                    ├─ CLI subcommand the generated CLI binary
                    └─ OpenAPI op     /openapi.json
```

A schema unlocks the CLI (any rpc that has one) and, for a read-only method
(`GET`/`HEAD`), the MCP tool. A mutating method (`POST`/`PUT`/`PATCH`/`DELETE`)
never auto-exposes to MCP — it needs an explicit `clients: { mcp: true }`.

Consume forms: `cache(fn, args?, options?)` reads through in-process during SSR;
`fn(args)` is the swapped `fetch` in the browser (throws `HttpError` on non-2xx);
`fn.raw(args)` returns the raw `Response`; and `fn.cache(args?)` / `fn.pending()`
/ `fn.invalidate()` / `fn.error()` are the rpc's own bound selectors. A handler
that returns `jsonl()`/`sse()` is a stream: the bare call returns a
`Subscribable` directly (consume with `for await (… of fn(args))` or
`state(fn(args))`) — `await fn(args)` is then a compile error.

> GET/DELETE/HEAD args travel as query strings — use `z.coerce.*` in the schema.
> The per-rpc `timeout` (a 504 on every surface — SSR, MCP, CLI, network) is
> distinct from the client-wide `ABIDE_CLIENT_TIMEOUT`.

## 2. Sockets

A socket is one broadcast topic per file under `src/server/sockets/`. A
`Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await (const m of chat)`
is the live stream — and every socket multiplexes onto one WebSocket at
`/__abide/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ room: z.string(), body: z.string() }),
    tail: 50, // retain the last 50 frames for replay
    ttl: 60_000, // drop retained frames older than 60s (lazy, no timer)
})
```

`chat.publish(m)` is isomorphic (server-side it fans out to in-process iterators
and remote subscribers; client-side it sends a validated `pub` frame).
`chat.tail(n)` opens a subscription seeded with the last `n` retained frames.
The HTTP face is `/__abide/sockets/<name>`: `GET` returns the retained tail,
`POST` publishes (only when the socket declares `clientPublish: true`).

## 3. Components

The payoff: one `.abide` component that imports the RPC and the socket above and
exercises the whole template grammar. Reactive primitives are ordinary imported
names — `state` from `@abide/abide/ui/state` (with `state.computed` /
`state.linked` members), `effect` from `@abide/abide/ui/effect` (client-only) —
called bare after import; the compiler resolves the import binding (alias-safe)
and lowers each onto the ambient scope. `props()` is the ambient prop reader (no
import). Control flow is `{#…}` mustache blocks; `{children()}` is the single
slot fill point.

A capitalised child renders its passed content at `{children()}`:

```html
<script>
const { name = 'friend' } = props()
</script>

<figure class="avatar">
    {#if children}{children()}{:else}<figcaption>{name}</figcaption>{/if}
</figure>
```

The page — `state`/`state.computed`/`state.linked`/`effect`/`props()`, every
binding and directive (on an element and on the child component), every
control-flow block, a `{#snippet}`, a root `<style>`, and a nested
`<script>`/`<style>` scoped to one branch:

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { tail } from '@abide/abide/ui/tail'
import { state } from '@abide/abide/ui/state'
import { effect } from '@abide/abide/ui/effect'
import { html } from '@abide/abide/ui/html'
import { getMessages } from '$server/rpc/getMessages'
import { postMessage } from '$server/rpc/postMessage'
import { chat } from '$server/sockets/chat'
import Avatar from '$ui/Avatar.abide'

/* props(): ambient reader — a defaulted field plus the rest for spreading. */
const { room = 'lobby', ...rest } = props()

let draft = state('')
let filter = state('')
let agree = state(false)
let tab = state('feed')
const trimmed = state.computed(() => draft.value.trim())
const mirror = state.linked(() => room)

/* A derived two-way binding is an object of { get, set }. */
const get = () => filter.value
const set = (next) => {
    filter.value = next
}

/* effect(): client-only, stripped from SSR. */
effect(() => console.log('joined', mirror.value))

/* An event handler that calls a mutating rpc. */
async function send() {
    if (trimmed.value === '') {
        return
    }
    await postMessage({ room, body: trimmed.value })
    draft.value = ''
}
</script>

<section class:active={tab.value === 'feed'} style:opacity={agree.value ? '1' : '0.6'} {...rest}>
    <h1>{room}</h1>
    <p>{html`<em>live room</em>`}</p>

    <form onsubmit={send}>
        <input bind:value={draft} placeholder="message" />
        <input type="checkbox" bind:checked={agree} />
        <label><input type="radio" bind:group={tab} value="feed" /> feed</label>
        <input bind:value={{ get, set }} />
        <button type="submit" disabled={trimmed.value === ''}>send</button>
    </form>

    {#if tail(chat)}
        <p>latest: {tail(chat).body}</p>
    {:else if tab.value === 'feed'}
        <p>waiting…</p>
    {:else}
        <p>silent</p>
    {/if}

    {#snippet row(message)}
        <li attach={(node) => node.scrollIntoView()}>{message.body}</li>
    {/snippet}

    {#await cache(getMessages, { room })}
        <p>loading…</p>
    {:then messages}
        <ul>
            {#for message, index of messages by message.id}
                {row(message)}
            {/for}
        </ul>
    {:catch failure}
        <p>failed: {failure.message}</p>
    {:finally}
        <hr />
    {/await}

    <ul>
        {#for await frame of chat}
            <li>{frame.body}</li>
        {/for}
    </ul>

    {#switch tab.value}
        {:case 'feed'}
            <p>the feed</p>
        {:default}
            <p>elsewhere</p>
    {/switch}

    {#try}
        <p>{tail(chat, { last: 5 })[0].body}</p>
    {:catch failure}
        <p>{failure.message}</p>
    {:finally}
        <span></span>
    {/try}

    <Avatar
        name={room}
        class:online={agree.value}
        style:margin={'0'}
        attach={(node) => node}
        onclick={send}
        {...rest}
    >
        {#if trimmed.value}<span>typing…</span>{/if}
    </Avatar>

    {#if tab.value === 'feed'}
        <script>
            let ticks = state(0)
            const label = state.computed(() => `tick ${ticks.value}`)
            effect(() => console.log(label.value))
        </script>
        <p>{label.value}</p>
        <style>
            p {
                color: rebeccapurple;
            }
        </style>
    {/if}
</section>

<style>
    section {
        padding: 1rem;
    }
</style>
```

The full public surface — every export, route, and environment variable — is
mapped in `AGENTS.md`.

MIT
