# Belte

Isomorphic multimodal HTTP framework built for humans and machines in a single Bun runtime.

One declaration is reachable from every surface a modern app needs:

- **Humans** — web UI (Svelte 5 SSR + SPA), a CLI, and a native desktop bundle.
- **Machines** — an MCP server and the same CLI, scriptable.
- The **CLI serves both** — humans run it by hand, machines call it from a shell.

Declare a remote function once; the bundler swaps the runtime so the same name and behavior work on the server, in the browser, over MCP, and from the CLI — no duplicated clients, no second schema.

## Try it

The fastest path is a prebuilt example.

- **Scaffold a new app:**

  ```sh
  bunx @briancray/belte scaffold my-app
  cd my-app && bun install
  bun dev
  ```

- **Kitchen-sink (every feature in one app):**

  ```sh
  git clone https://github.com/briancray/belte
  cd belte/examples/kitchen-sink
  bun dev
  ```

## What is an isomorphic multimodal framework

Belte runs your server, client, MCP, and CLI logic in **one Bun runtime** with **one runtime per declaration**. You write a remote function once and it is consumed, for free, on every client surface — the bundler chooses the implementation per build target.

Declare it once under `src/server/rpc/`:

```ts
// src/server/rpc/users/get.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { z } from 'zod'

export const get = GET(
    async ({ id }) => json(await db.users.find(id)),
    { inputSchema: z.object({ id: z.string() }) },
)
```

Consume it on each surface:

| Surface | How |
| --- | --- |
| Browser | `cache(get)({ id })` inside a page component |
| HTTP | `GET /rpc/users/get?id=1` |
| MCP | tool `users-get` (read-only verb auto-exposes) |
| CLI | `app users-get --id 1` |
| OpenAPI | operation `users-get` in `/openapi.json` |

The export name must match the filename stem, and each file under `src/server/rpc/` declares exactly one remote function. The file path becomes the URL (`/rpc/users/get`), the command name (`users-get`), and the MCP tool name.

---

# Server

## Server / rpc

### Declaring

A verb helper turns a handler into a remote function. The handler receives the parsed (and, with `inputSchema`, validated) args bag and returns a `Response` — usually via a response helper.

```ts
type Verb = <Return, InputSchema>(
    handler: (args: InferOutput<InputSchema>) => Return | Promise<Return>,
    opts?: {
        inputSchema?: StandardSchema
        inputJsonSchema?: Record<string, unknown>
        outputSchema?: StandardSchema
        outputJsonSchema?: Record<string, unknown>
        clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
    },
) => RemoteFunction<InferInput<InputSchema>, Return>
```

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `inputSchema` | Standard Schema | — | Validates the args bag; rejects with `422` on failure. Its presence is what auto-exposes the verb to MCP/CLI. |
| `inputJsonSchema` | object | derived | Precomputed JSON Schema override for the input (OpenAPI params / MCP tool input). |
| `outputSchema` | Standard Schema | — | Describes the success body for the OpenAPI `200` response and the MCP tool output. |
| `outputJsonSchema` | object | derived | Precomputed JSON Schema override for the output. |
| `clients` | `{ browser?, mcp?, cli? }` | see below | Which surfaces advertise this verb. Explicit values always win. |

Verb helpers, one module path each:

`belte/server/GET` · `belte/server/POST` · `belte/server/PUT` · `belte/server/PATCH` · `belte/server/DELETE` · `belte/server/HEAD`

Args travel differently per verb:

| Verb | Args location |
| --- | --- |
| `GET` / `DELETE` / `HEAD` | query string (`?key=value`) |
| `POST` / `PUT` / `PATCH` | JSON body |

Client exposure defaults from the schema:

| Surface | Default |
| --- | --- |
| `browser` | always `true` |
| `cli` | `true` when an `inputSchema` is present |
| `mcp` | `true` when an `inputSchema` is present **and** the verb is read-only (`GET`/`HEAD`); mutating verbs require explicit `clients: { mcp: true }` |

```ts
// src/server/rpc/articles/create.ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { z } from 'zod'

const Article = z.object({ title: z.string(), body: z.string() })

export const create = POST(
    async (article) => json(await db.articles.insert(article), { status: 201 }),
    { inputSchema: Article, outputSchema: z.object({ id: z.string() }) },
)
```

#### Response helpers

Each returns a typed `Response`; the verb infers the caller-facing return type from the body.

| Helper | Signature | Body |
| --- | --- | --- |
| `belte/server/json` | `json<T>(data: T, init?: ResponseInit)` | `application/json`, `no-store` |
| `belte/server/error` | `error(status: number, message?: string, init?: ResponseInit)` | `text/plain`; message defaults to the status reason |
| `belte/server/redirect` | `redirect(url: string, status?: 301\|302\|303\|307\|308, init?: ResponseInit)` | 3xx with `Location` (relative URLs allowed) |
| `belte/server/sse` | `sse<Frame>(iterable: AsyncIterable<Frame>, init?: ResponseInit)` | `text/event-stream`, one event per frame |
| `belte/server/jsonl` | `jsonl<Frame>(iterable: AsyncIterable<Frame>, init?: ResponseInit)` | `application/jsonl`, one JSON value per line |

```ts
import { GET } from 'belte/server/GET'
import { sse } from 'belte/server/sse'

export const ticks = GET(() =>
    sse(async function* () {
        for (let n = 0; ; n++) {
            yield { n }
            await Bun.sleep(1000)
        }
    }()),
)
```

#### `request()` and `server()`

Both throw if called outside their scope rather than returning `undefined`.

| Function | Returns | Available |
| --- | --- | --- |
| `belte/server/request` → `request(): Request` | the inbound request | inside an SSR render or rpc handler |
| `belte/server/server` → `server(): Server` | the live `Bun.serve` instance | after `app.ts` `init()` resolves |

### Consuming

A `RemoteFunction` is callable plus a few members:

```ts
type RemoteFunction<Args, Return> = ((args: Args) => Promise<Return>) & {
    readonly method: HttpVerb
    readonly url: string
    readonly clients: ClientFlags
    readonly raw: (args: Args) => Promise<Response>
    stream(args?: Args): Subscribable<Return>
}
```

#### Plain call

`fn(args)` sends the request (args encoded per the verb) and decodes the body by Content-Type. Non-2xx throws `HttpError`.

| Response | `fn(args)` resolves to |
| --- | --- |
| `application/json` / `*+json` | parsed object |
| `text/*` | string |
| `204` / empty | `undefined` |
| other | `Blob` |
| streaming (sse/jsonl) | throws — use `.stream` |

```ts
const user = await get({ id: '1' }) // decoded body, throws HttpError on non-2xx
```

#### `.raw`

`fn.raw(args)` returns the underlying `Response` without decoding and without throwing on non-2xx — for status/header inspection or custom error handling.

```ts
const res = await get.raw({ id: '1' })
if (res.status === 404) {
    /* … */
}
```

#### `.stream`

`fn.stream(args?)` returns a `Subscribable<Return>` over the response body: sse/jsonl handlers yield each frame; non-streaming handlers yield the decoded body once. Pass it to `subscribe()` or iterate directly.

```ts
for await (const tick of ticks.stream()) {
    console.log(tick.n)
}
```

#### `HttpError`

Thrown by the plain call on non-2xx. Import from `belte/browser/HttpError`.

| Member | Type |
| --- | --- |
| `status` | `number` |
| `statusText` | `string` |
| `response` | `Response` |

#### `/openapi.json`

Every rpc is described as an OpenAPI 3.1 operation, served at `/openapi.json`. `GET`/`DELETE`/`HEAD` args become query parameters; `POST`/`PUT`/`PATCH` args become a JSON request body; `outputSchema` becomes the `200` response schema.

## Server / sockets

A socket is a named broadcast channel — bidirectional, with optional history replay — declared once and consumed on every surface like an rpc.

### Declaring

```ts
type socket = <Schema>(opts: {
    schema?: Schema
    history?: number
    ttl?: number
    clientPublish?: boolean
    jsonSchema?: Record<string, unknown>
    clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
}) => Socket<InferOutput<Schema>>
```

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `schema` | Standard Schema | — | Validates publish payloads; auto-exposes the socket to MCP/CLI. |
| `history` | number | `0` | How many recent messages to buffer for replay on subscribe. |
| `ttl` | number (ms) | — | Evict buffered messages older than this before replay. |
| `clientPublish` | boolean | `false` | Allow clients to publish over the wire (off = server-only fan-out). |
| `clients` | `{ browser?, mcp?, cli? }` | schema-derived | Which surfaces advertise the socket. |

```ts
// src/server/sockets/chat.ts
import { socket } from 'belte/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ user: z.string(), text: z.string() }),
    history: 50,
    clientPublish: true,
})
```

### Publishing

```ts
type publish = (message: T) => void
```

Isomorphic: server code publishes in-process and fans out to remote subscribers; client code (when `clientPublish` is set) sends a frame the server validates and rebroadcasts.

```ts
chat.publish({ user: 'ada', text: 'hello' })
```

### Consuming

A `Socket<T>` is an `AsyncIterable<T>`. Iterating opens a subscription (with full history replay when `history` is set); `.tail(count)` replays only the last `count` before tailing live.

```ts
type Socket<T> = AsyncIterable<T> & {
    readonly name: string
    publish(message: T): void
    tail(count?: number): AsyncIterable<T>
}
```

```ts
// full history, then live
for await (const message of chat) {
    render(message)
}

// last 10, then live
for await (const message of chat.tail(10)) {
    render(message)
}
```

In a Svelte component, read it reactively with `subscribe()` (below) rather than a raw `for await`.

---

# Clients

## Browser

### Pages

Pages are Svelte 5 components at `src/browser/pages/<route>/page.svelte`. The folder path is the route; `[id]` is a dynamic segment, `[...rest]` a catch-all.

| File | Route |
| --- | --- |
| `src/browser/pages/page.svelte` | `/` |
| `src/browser/pages/about/page.svelte` | `/about` |
| `src/browser/pages/media/[id]/page.svelte` | `/media/:id` |

```svelte
<!-- src/browser/pages/media/[id]/page.svelte -->
<script lang="ts">
  import { cache } from 'belte/browser/cache'
  import { page } from 'belte/browser/page'
  import { getMedia } from '../../../server/rpc/media/get'

  const item = $derived(await cache(getMedia)({ id: page.params.id }))
</script>

<h1>{item.title}</h1>
```

### Layouts

A `layout.svelte` in a pages folder wraps that folder's subtree; the nearest layout up the tree applies. Render children with `{@render children()}`.

```svelte
<!-- src/browser/pages/layout.svelte -->
<script lang="ts">
  let { children } = $props()
</script>

<nav><a href="/">home</a></nav>
{@render children()}
```

### `cache`

```ts
type cache = {
    <Args, Return>(fn: RemoteFunction<Args, Return>, options?: CacheOptions): (args?: Args) => Promise<Return>
    <Args>(fn: RawRemoteFunction<Args>, options?: CacheOptions): (args?: Args) => Promise<Response>
    invalidate(target?: RemoteFunction | string | unknown[] | Record<string, unknown>): void
}
```

| `CacheOptions` | Type | Meaning |
| --- | --- | --- |
| `key` | `string \| unknown[] \| object` | Override the auto-derived key (method + url + args). |
| `ttl` | number (ms) | `undefined` = forever, `0` = dedupe in-flight only, `n` = expire `n` ms after resolve. |

`cache(fn, options?)` returns an invoker; calling it dedupes by key and shares one stored `Response`. Reads inside a `$derived`/`$effect` re-run when the key is invalidated. During SSR the cache seeds the hydration snapshot so the first client read skips the network.

```ts
const post = $derived(await cache(getPost, { ttl: 60_000 })({ id }))
// later
cache.invalidate(getPost) // all entries for that function
cache.invalidate()        // everything
```

### `subscribe`

```ts
type subscribe = {
    <T>(source: Subscribable<T>): T | undefined
    error<T>(source: Subscribable<T>): Error | undefined
    status<T>(source: Subscribable<T>): 'pending' | 'open' | 'done' | 'error'
}
```

Reactive view over a `Socket<T>` or an `fn.stream(args)` result. The first `$derived` read opens the underlying iterator; the last to stop reading closes it. Readers of the same source (deduped by name) share one subscription. No-op during SSR.

```svelte
<script lang="ts">
  import { subscribe } from 'belte/browser/subscribe'
  import { chat } from '../../server/sockets/chat'

  const latest = $derived(subscribe(chat))
  const status = $derived(subscribe.status(chat))
</script>

{#if latest}<p>{latest.user}: {latest.text}</p>{/if}
<small>{status}</small>
```

### `navigate`

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

SPA navigation: pushes history (or replaces), resolves the new view, and updates page state. Internal link clicks are intercepted automatically — call `navigate()` directly only for programmatic moves. A search/hash-only change skips the data fetch and just reassigns `page.url`. Import from `belte/browser/navigate`.

### Page state

`belte/browser/page` exports a reactive `page` object. Reassignments on navigation re-run `$derived` consumers.

| Field | Type | Meaning |
| --- | --- | --- |
| `route` | `string` | Current matched route. |
| `params` | `Record<string, string>` | Dynamic-segment values. |
| `url` | `URL` | Live location. |

## MCP

An MCP server is generated automatically and served at `/__belte/mcp` — no server module to author. Auth flows from the inbound request.

| MCP concept | Source |
| --- | --- |
| Tools (rpc) | Each verb with `clients.mcp` (read-only verbs auto-expose; mutating verbs opt in). The HTTP verb feeds the tool's `readOnlyHint` / `destructiveHint` / `idempotentHint`. |
| Tools (sockets) | Each socket with `clients.mcp` gets a `<name>-tail` read tool, plus `<name>-publish` when `clientPublish` is set. |
| Resources | Files under `src/mcp/resources/`, served as `belte://resources/<path>`. |
| Prompts | `src/mcp/prompts/<name>.md` — frontmatter for metadata, body for the template. |

```md
<!-- src/mcp/prompts/summarize.md -->
---
description: Summarize an article
arguments:
  - name: id
    required: true
---
Summarize article {{id}} in three sentences.
```

## CLI

A CLI is generated automatically — humans run it, machines script it. Each rpc becomes a subcommand named after its URL (`users-get`), with flags derived from its schema; sockets contribute `<name>-tail` and `<name>-publish`.

The CLI is a thin remote client: it talks to a running server over HTTP.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Server to call (required), e.g. `http://localhost:3000`. |
| `APP_TOKEN` | Bearer token sent as `Authorization` (optional). |

```sh
APP_URL=http://localhost:3000 app users-get --id 1
app users-get --help     # per-command flags from the schema
app --help               # command list
```

A `.env` next to the binary is loaded automatically, so installed tarballs carry their own `APP_URL` / `APP_TOKEN`.

### Downloading

A running server hands out the CLI binary:

| Route | Returns |
| --- | --- |
| `GET /__belte/cli` | a platform-detecting install script (`curl … \| sh`) |
| `GET /__belte/cli/<platform>` | the prebuilt binary tarball for that platform |

Gate these behind auth with the `app.ts` `handle` hook to require a token before download.

### Banner and footer

`src/cli/banner.txt` prints above the top-level help; `src/cli/footer.txt` prints below it.

## Bundle

`belte bundle` assembles a movable, self-contained native desktop app for the host platform. It boots into a connect screen: start the embedded server or connect to a remote one.

### Window

A default-exported config from an optional `src/bundle/window.ts`.

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]
}
```

The standard App / Edit / Window menus plus a File menu (Start server / Connect / Disconnect) are always installed. `menu` adds custom top-level menus whose items emit `belte:menu` events.

```ts
// src/bundle/window.ts
import type { BundleWindow } from 'belte/bundle/BundleWindow'

export default {
    title: 'My App',
    width: 1100,
    height: 720,
} satisfies BundleWindow
```

### `disconnected.svelte`

`src/bundle/disconnected.svelte` overrides the screen shown when the app has no server connection.

### `onMenu`

```ts
type onMenu = {
    (handler: (name: string) => void): () => void
    (name: string, handler: () => void): () => void
}
```

Subscribes to custom menu-item clicks; returns an unsubscribe function. Pass a single handler to receive every item's `emit` name, or a name plus a handler to fire only for that item. Inert during SSR and in a plain browser tab.

```svelte
<script lang="ts">
  import { onMenu } from 'belte/bundle/onMenu'
  // catch-all
  $effect(() => onMenu((name) => {
    if (name === 'reload') location.reload()
  }))
  // filtered to one item
  $effect(() => onMenu('reload', () => location.reload()))
</script>
```

### Icon

`src/bundle/icon.icns` is used as-is; otherwise `src/bundle/icon.png` is converted (macOS).

---

# Some details

## App hooks

An optional `src/app.ts` default-exports lifecycle hooks. All are optional.

| Hook | Signature | Purpose |
| --- | --- | --- |
| `init` | `(ctx: { server }) => void \| (() => void) \| Promise<…>` | Boot-time setup; returns an optional cleanup run on `SIGINT`/`SIGTERM`. |
| `handle` | `(request, next) => Response \| Promise<Response>` | Single middleware; mutate the response or branch on the URL. |
| `handleError` | `(error, request) => Response \| Promise<Response>` | Replace the default `500`. |

```ts
// src/app.ts
export default {
    async handle(request, next) {
        const response = await next(request)
        response.headers.set('x-powered-by', 'belte')
        return response
    },
}
```

## Project layout

| Path | Holds |
| --- | --- |
| `src/server/rpc/**` | remote functions (one verb export per file) |
| `src/server/sockets/**` | sockets (one `socket()` export per file) |
| `src/browser/pages/**` | `page.svelte` / `layout.svelte` routes |
| `src/browser/public/**` | static files served at the site root |
| `src/browser/app.html` | optional HTML shell override |
| `src/mcp/resources/**` | MCP resource files |
| `src/mcp/prompts/*.md` | MCP prompts |
| `src/cli/banner.txt`, `footer.txt` | CLI help chrome |
| `src/bundle/window.ts`, `disconnected.svelte`, `icon.png` | desktop bundle config |
| `src/app.ts` | app hooks |

A `lib/` folder under any surface (e.g. `src/server/lib/`, `src/browser/lib/`) is a good home for shared, non-convention modules that surface code imports.

## CLI commands

| Command | Does |
| --- | --- |
| `bunx belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte compile [--target] [--out]` | build a standalone server executable |
| `belte cli [--target] [--out] [--platforms]` | build the CLI binary (thin remote client) |
| `belte bundle` | build a movable native app bundle for this platform |

## Public files

Files in `src/browser/public/` are served at the site root (`src/browser/public/favicon.ico` → `/favicon.ico`). The on-disk set is snapshotted at server start; add a file and restart to pick it up.

## Bundling

The build writes a zstd-compressed `.zst` sibling next to each `dist/_app/` asset, and the server serves the precompressed bytes to clients that accept zstd. `belte compile` produces a standalone server binary; `belte cli` produces the thin CLI client; `belte bundle` produces the desktop app.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (default `3000`). |
| `APP_URL` | Target server for the CLI client. |
| `APP_TOKEN` | Bearer token for the CLI client. |
| `DEBUG` | Enable debug logging (see below). |
| `BELTE_INSPECT` | Open the native webview inspector in a bundle. |

## Logging

`belte/shared/log` exposes a small console logger.

| Method | Use |
| --- | --- |
| `log.info(msg)` | informational line |
| `log.success(msg)` | green success line |
| `log.warn(msg)` | yellow warning |
| `log.error(value)` | red error (full stack for `Error`) |
| `log.detail(msg)` | dim secondary line |
| `log.request(method, path, status, ms)` | colored request line |
| `log.debug(scope, msg)` | printed only when `scope` is enabled via `DEBUG` |

`DEBUG` follows the `debug` package conventions:

| `DEBUG` | Enables |
| --- | --- |
| `belte` | exactly `belte` |
| `belte:*` | `belte` and `belte:anything` |
| `*` | everything |
| `a,belte` | comma-separated list |

Setting `DEBUG=belte` also turns on per-request server logging.
