# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

Declare a function once. Belte exposes it to every surface — web, CLI, MCP, and a native desktop bundle — over one Bun process, with the same callable name and behaviour on both sides of the wire. The bundler swaps the runtime per target; you write the function once.

- **Humans** reach it through the web (Svelte 5 SSR + SPA), the CLI, or a self-contained desktop bundle.
- **Machines** reach it through MCP (tools, resources, prompts) and the same CLI.
- **The CLI serves both** — humans run it by hand, machines script it.

## Try it

The fastest path is a prebuilt example or the scaffold.

```sh
# scaffold a new project
bunx @briancray/belte scaffold my-app
cd my-app && bun install && bun dev
```

```sh
# kitchen-sink — every feature in one app
git clone https://github.com/briancray/belte
cd belte/examples/kitchen-sink && bun install && bun dev
```

`bun dev` builds the client, starts the server with hot reload, and serves at `http://localhost:3000`. Refresh the browser after a restart.

## What "isomorphic multimodal" means

- **One runtime.** Server, client build, CLI, MCP, and bundle all run on Bun. No second toolchain.
- **Declare once, consume anywhere.** A remote function declared under `src/server/rpc/` is callable as a plain function in the browser, an HTTP endpoint, an MCP tool, and a CLI command — for free. The bundler rewrites the import per target: a direct in-process call on the server, a `fetch` on the client.

Declare:

```ts
// src/server/rpc/getProduct.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'

export const getProduct = GET<{ id: string }>(async ({ id }) =>
    json(await db.product(id)),
)
```

Consume:

| Surface | How |
| --- | --- |
| Browser | `import { getProduct } from '$server/rpc/getProduct.ts'` → `await getProduct({ id })` |
| HTTP | `GET /rpc/getProduct?id=42` |
| CLI | `my-app get-product --id 42` |
| MCP | tool `getProduct` at `/__belte/mcp` (read-only verbs with a schema auto-expose) |

The filename is the export name and the URL path; the imported verb picks the HTTP method.

## Server

### Server / rpc

Each file under `src/server/rpc/` exports exactly one verb-bound remote function, named after the file. The URL is `/rpc/<path>` (no dynamic `[id]` segments — pass identifiers as args). Verb helpers: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, each imported from `@briancray/belte/server/<VERB>`.

#### Declaring

```ts
type VerbHelper = {
    // schema-validated: Args infers from the schema's input type
    <Return, InputSchema>(fn, opts: { inputSchema, outputSchema?, clients? }): RemoteFunction
    // schemaless, explicit client targeting
    <Args, Return>(fn, opts: { clients }): RemoteFunction
    // bare handler: Args/Return from the handler type
    <Args, Return>(fn): RemoteFunction
}
```

| Option | Type | Effect |
| --- | --- | --- |
| `inputSchema` | Standard Schema | Validates args; 422 on failure. `Args` infers from its output type. |
| `outputSchema` | Standard Schema | Describes the success body for OpenAPI and the MCP tool output. |
| `inputJsonSchema` / `outputJsonSchema` | `Record<string, unknown>` | Precomputed JSON Schema overrides. |
| `clients` | `{ browser?, mcp?, cli? }` | Which surfaces expose this verb. |

`clients` defaults: browser always on; **CLI** on for any verb with an `inputSchema`; **MCP** on only for read-only verbs (`GET`/`HEAD`) with a schema — a mutating verb must opt in with `clients: { mcp: true }`. Explicit `clients` always wins.

```ts
import { POST } from '@briancray/belte/server/POST'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

export const createOrder = POST(async (order) => json(await db.insert(order)), {
    inputSchema: z.object({ sku: z.string(), qty: z.number().int() }),
})
```

Args from a handler without a schema come from the parameter type (inline or via the `GET<Args>` generic). `Return` is inferred from the handler body through the `TypedResponse<T>` brand on the response helpers, so `GET(() => json({ ok: true }))` types end-to-end.

Response helpers (one per file, all return `TypedResponse<T>`):

| Helper | Signature | Body |
| --- | --- | --- |
| `json` | `json<T>(data: T, init?): TypedResponse<T>` | JSON, `Cache-Control: no-store` by default |
| `error` | `error(status, message?, init?): TypedResponse<never>` | `text/plain`; message defaults to the status reason |
| `redirect` | `redirect(url, status=302, init?): TypedResponse<never>` | accepts relative URLs; 301/302/303/307/308 |
| `jsonl` | `jsonl<Frame>(iterable, init?): TypedResponse<Frame>` | JSON Lines stream from an `AsyncIterable` |
| `sse` | `sse<Frame>(iterable, init?): TypedResponse<Frame>` | `text/event-stream`, 15s keepalive |

To short-circuit, `throw` — the `app.handleError` hook catches it. `return error(...)` is the expected non-throwing path, same control flow as `return json(...)`.

Inside a handler or SSR render:

| Helper | Returns | Notes |
| --- | --- | --- |
| `request()` from `@briancray/belte/server/request` | the inbound `Request` | throws outside a request scope |
| `server()` from `@briancray/belte/server/server` | the live `Bun.Server` | throws before boot |

#### Consuming

A plain call resolves to the Content-Type-decoded body and throws `HttpError` on non-2xx. Args encode by method:

| Methods | Args go in |
| --- | --- |
| `GET`, `HEAD`, `DELETE` | query string |
| `POST`, `PUT`, `PATCH` | JSON body |

Response decoding follows Content-Type: `*json*` → parsed JSON, `text/*` → string, `sse`/`jsonl` → stream (via `.stream`), otherwise `Blob`.

```ts
const product = await getProduct({ id: '42' })   // decoded body, throws HttpError on non-2xx
```

```ts
type RemoteFunction<Args, Return> = ((args: Args) => Promise<Return>) & {
    readonly method: HttpVerb
    readonly url: string
    raw(args?: Args): Promise<Response>        // underlying Response, no decode, no throw
    stream(args?: Args): Subscribable<Return>  // iterate a body frame-by-frame
    fetch(request: Request): Promise<Response> // framework dispatch hook
}
```

- `.raw(args)` — the underlying `Response` for callers that need status, headers, or body streaming.
- `.stream(args)` — a `Subscribable` view: `sse`/`jsonl` handlers yield each frame, non-streaming handlers yield the decoded body once. Pass it to `subscribe()` (see Browser).

`HttpError` (from `@briancray/belte/browser/HttpError`) carries the raw `Response`:

```ts
type HttpError = Error & { status: number; statusText: string; response: Response }
```

OpenAPI: a generated spec is served at `GET /openapi.json` describing every HTTP-exposed verb.

### Server / sockets

Each file under `src/server/sockets/` exports one `socket`, named after the file. A socket is a bidirectional named broadcast primitive — the same import is a server-side fan-out and a client-side ws proxy, multiplexed onto one framework connection per client at `/__belte/sockets`.

#### Declaring

```ts
function socket<Schema>(opts: SocketOptions & { schema: Schema }): Socket<InferOutput<Schema>>
function socket<T>(opts?: SocketOptions): Socket<T>
```

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `history` | `number` | `0` | Items replayed to a new subscriber. |
| `ttl` | `number` (ms) | — | History entries expire this long after publish (evicted lazily). |
| `clientPublish` | `boolean` | `false` | Allow clients to publish over the wire. |
| `schema` | Standard Schema | — | Validates publish payloads; `T` infers from it. |
| `clients` | `{ browser?, mcp?, cli? }` | browser-only schemaless; all surfaces with a schema | Which surfaces advertise the socket. |

```ts
// src/server/sockets/chat.ts
import { socket } from '@briancray/belte/server/socket'
import { z } from 'zod'

export const chat = socket({
    history: 50,
    clientPublish: true,
    schema: z.object({ user: z.string(), text: z.string() }),
})
```

#### Publishing

```ts
publish(message: T): void   // isomorphic
```

Server code calls `chat.publish(m)` to notify in-process iterators and fan out to remote subscribers. Client code calls the same `publish` (a `pub` frame the dispatcher validates against `clientPublish`). Publish validates synchronously when a schema is set, and throws on a bad payload.

#### Consuming

A `Socket<T>` is an `AsyncIterable<T>`.

```ts
interface Socket<T> extends AsyncIterable<T> {
    readonly name: string
    publish(message: T): void
    tail(count?: number): AsyncIterable<T>
}
```

- `for await (const m of chat)` replays the full history buffer, then tails live.
- `chat.tail(count)` replays the last `count` items (default `0`, clamped to `history`) before tailing.

In a Svelte component, pass the socket straight to `subscribe()`:

```svelte
<script lang="ts">
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))
</script>
```

## Clients

### Browser

Folder-based pages under `src/browser/pages/`. Every `page.svelte` mounts at its directory URL; `layout.svelte` wraps that directory and below. Dynamic segments use `[name]` (single) and `[...rest]` (catch-all).

| File | URL |
| --- | --- |
| `pages/page.svelte` | `/` |
| `pages/about/page.svelte` | `/about` |
| `pages/product/[id]/page.svelte` | `/product/:id` |
| `pages/layout.svelte` | wraps `/` and all descendants |

Pages are Svelte 5 components. Top-level `await` runs during SSR; pair it with `cache()` so the decoded body is captured into the per-request cache, serialized into the HTML, and replayed on hydration — no second fetch.

```svelte
<script lang="ts">
import { cache } from '@briancray/belte/browser/cache'
import { getProduct } from '$server/rpc/getProduct.ts'
import { page } from '@briancray/belte/browser/page'

const product = await cache(getProduct)({ id: page.params.id })
</script>

<h1>{product.name}</h1>
```

#### cache

```ts
function cache<Args, Return>(fn: RemoteFunction<Args, Return>, options?: CacheOptions):
    (args?: Args) => Promise<Return>
function cache<Args>(fn: RawRemoteFunction<Args>, options?: CacheOptions):
    (args?: Args) => Promise<Response>
cache.invalidate(target?: RemoteFunction | string | object): void
```

| Option | Type | Effect |
| --- | --- | --- |
| `key` | `string \| object` | Override the cache key (defaults to method + url + args). |
| `ttl` | `number` (ms) | `undefined` → forever; `0` → dedupe in-flight only; `>0` → expire after the promise resolves. |

Configure then invoke: `cache(fn, options)(args)`. The invoker keys on `fn.method + fn.url + args`, shares the in-flight promise on a hit, and registers the surrounding `$derived`/`$effect` so `cache.invalidate(fn)` re-runs it. `cache(fn.raw)` returns the `Response`; both variants share one stored entry. Outside a tracking scope it's an ordinary memoised call, so the same code works on the server.

#### subscribe

```ts
function subscribe<T>(source: Subscribable<T>): T | undefined
subscribe.error(source): Error | undefined
subscribe.status(source): 'pending' | 'open' | 'done' | 'error'
```

Reactive consumer for a `Socket<T>` or an `fn.stream(args)` result. The first `$derived` read opens the iterator (history replay for a socket, a fresh fetch for a stream); the last reader to stop closes it. Reads sharing a source dedupe by name, so passing fresh `fn.stream(args)` across re-renders is safe. No-op on the server — seed the first paint with `cache()` and layer `subscribe()` on top for live updates.

```svelte
const tick = $derived(subscribe(tickFeed.stream()))
const log = $derived(subscribe(countLog.stream({ to: 5 })))
```

#### navigate

```ts
function navigate(href: string, options?: { replace?: boolean; scroll?: boolean }): Promise<void>
```

SPA navigation (from `@briancray/belte/browser/navigate`). Writes history, resolves the new view, and swaps the page component. A search/hash-only change skips the fetch and reassigns `page.url` only. Cross-origin or a failed resolve falls back to a hard navigation.

#### Page state

```ts
const page: { route: string; params: Record<string, string>; url: URL }
```

`page` (from `@briancray/belte/browser/page`) is reactive `$state`. Narrowing on `page.route` narrows `page.params` to that route's shape (when route types are generated). `page.url` is reassigned on every navigation, so `$derived` consumers re-run.

### Mcp

Generated automatically and served at `POST /__belte/mcp` — there is no MCP server module to author. Auth flows from the inbound request (bearer / cookie headers) into each tool's handler.

| MCP concept | Source |
| --- | --- |
| Tools | every rpc verb and socket with `clients.mcp: true` (read-only schema'd verbs auto-on; sockets expose `<name>-tail`, plus `<name>-publish` when `clientPublish` is set) |
| Resources | files under `src/mcp/resources/`, addressed `belte://resources/<path>` (text inline, others base64) |
| Prompts | `.md` files under `src/mcp/prompts/` |

A prompt file has optional YAML frontmatter and a `{{name}}`-interpolated body:

```md
---
description: Summarise an order
arguments:
  - name: id
    description: Order id
    required: true
---
Summarise order {{id}} for a customer email.
```

### Cli

Generated automatically — every rpc command becomes a CLI command, with flags derived from each verb's input schema. The shipped binary is a thin remote client: it carries a baked-in manifest and talks to a running server over HTTP.

| Concept | Detail |
| --- | --- |
| Command name | kebab-cased from the rpc name (`getProduct` → `get-product`) |
| Flags | derived from `inputSchema` (`--id <string>`, `[--note <string>]`, `--flag`, `--tag <value...>`) |
| `APP_URL` | the server the CLI calls (required at runtime) |
| `APP_TOKEN` | optional bearer token, sent as `Authorization: Bearer` |
| `--help`, `<cmd> --help` | top-level command list / per-command flags |

```sh
APP_URL=http://localhost:3000 my-app get-product --id 42
```

Build the binary with `belte cli` (`--platforms a,b,c` cross-compiles per target into `dist/cli-thin/<platform>/`).

Downloading: a running server hosts a platform-detecting install script and per-platform binaries.

```sh
curl -fsSL http://localhost:3000/__belte/cli | sh
```

`GET /__belte/cli` returns the script (pointed at the host you reached); `GET /__belte/cli/<platform>` streams the binary tarball. An authenticated download bakes the caller's bearer token into the binary's `.env`.

A `src/cli/banner.txt` prints above the top-level help and `src/cli/footer.txt` below it.

### Bundle

`belte bundle` produces a movable, self-contained native desktop app for the host platform (a `.app` on macOS, a flat directory elsewhere) — the server binary, a launcher, and the native webview together, no Chromium. The launcher boots into a connect screen: start the embedded server, or connect to a remote one by URL. It resolves the last connection before opening the window, so a configured app relaunches straight into the live server.

The embedded server honors a configured `PORT` (see Environment variables), binding a fixed address; with none set it takes a free port. Set one to start the server on one machine and connect to it from another via the connect screen.

#### Window

Optional `src/bundle/window.ts`, default-exported, baked in at build time.

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]      // custom top-level menus
    config?: StandardSchema  // env the embedded server needs
}
```

```ts
// src/bundle/window.ts
import type { BundleWindow } from '@briancray/belte/bundle/BundleWindow'
import { z } from 'zod'

export default {
    title: 'My App',
    width: 1024,
    height: 768,
    config: z.object({
        HOST_ROOT: z.string().meta({ title: 'Content folder', description: 'Path to scan' }),
        API_KEY: z.string().optional().meta({ title: 'API key', format: 'password' }),
    }),
} satisfies BundleWindow
```

`config` drives a first-run setup modal on the connect screen. Each property is one env var the embedded server reads via `Bun.env`; the JSON Schema slots map to the form — `title` → label, `description` → hint, `format: 'password'` → masked input, `default` → prefill. Answers persist to a per-user data-dir `.env`; a required key with no default is what makes the modal appear.

#### disconnected.svelte

Drop a `src/bundle/disconnected.svelte` to replace the default connect screen. It talks to the launcher's control server (`POST /connect`, `POST /start`, the config endpoints), and the launcher records the connection.

#### onMenu

Custom menu items dispatch a `belte:menu` event into the page; `onMenu` (from `@briancray/belte/bundle/onMenu`) subscribes.

```ts
function onMenu(handler: (name: string) => void): () => void
function onMenu(name: string, handler: () => void): () => void
```

```svelte
$effect(() => onMenu('reload', () => location.reload()))
```

Returns an unsubscribe, so it drops into a Svelte `$effect`. Inert during SSR and in a plain browser tab.

#### icon

`src/bundle/icon.png` (or a ready-made `src/bundle/icon.icns`) becomes the app icon on macOS; `src/bundle/logo.png` is the connect-screen logo.

## Some details

### App hooks

Optional `src/app.ts` — resolved at build time, no import needed.

```ts
type AppModule = {
    init?: (ctx: { server: Server }) => void | (() => void) | Promise<...>  // returns SIGINT/SIGTERM cleanup
    handle?: (request: Request, next: (req: Request) => Promise<Response>) => Response | Promise<Response>
    handleError?: (error: unknown, request: Request) => Response | Promise<Response>
}
```

Every hook is optional. `init` runs once after `Bun.serve` is up and may return a cleanup; `handle` is single middleware wrapping the pipeline; `handleError` is the custom 500 fallback. WebSockets aren't exposed here — use the sockets hub.

### Project layout

```
src/
  app.ts                   optional app hooks
  server/
    rpc/<name>.ts          one remote function per file → /rpc/<name>
    sockets/<name>.ts      one socket per file
    lib/                   server-only helpers (your own)
  browser/
    app.html               shell (optional override)
    app.css                global styles
    pages/**/page.svelte   routes
    pages/**/layout.svelte layouts
    public/                static files served at the root
    lib/                   browser-only helpers (your own)
  mcp/
    resources/**           MCP resources
    prompts/**.md          MCP prompts
  cli/
    banner.txt             CLI help banner
    footer.txt             CLI help footer
  bundle/
    window.ts              desktop window + config
    disconnected.svelte    custom connect screen
    icon.png               app icon
  shared/                  cross-side helpers (your own)
```

Import project code through the path aliases `$server`, `$browser`, `$shared`, `$mcp`, `$cli` (e.g. `import { getProduct } from '$server/rpc/getProduct.ts'`). A `lib/` folder under any surface is a fine home for your own helpers.

### Cli commands

| Command | Does |
| --- | --- |
| `bunx @briancray/belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte compile [--target] [--out]` | standalone server executable |
| `belte cli [--target] [--out] [--platforms]` | thin remote CLI binary |
| `belte bundle` | self-contained desktop app for this platform |

### public files

Files under `src/browser/public/` are served at the root path. `belte compile`/`belte bundle` embed them (zstd) into the binary; `belte dev`/`belte start` read them off disk.

### Bundling

`belte compile` produces a standalone server binary (client assets embedded). `belte cli` produces the thin remote CLI. `belte bundle` assembles the desktop app from the compiled server, launcher, and webview lib. The bundle is unsigned — distribution to other users still needs platform signing/notarization.

### Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `PORT` | server | listen port (default `3000`); in a bundle the embedded server binds a configured value, else a free port |
| `APP_URL` | CLI | server the CLI calls (required) |
| `APP_TOKEN` | CLI | bearer token for CLI calls |
| `DEBUG` | everywhere | enable debug logging (see below) |
| `BELTE_INSPECT` | bundle | open the native webview inspector |

A bundle loads a per-user data-dir `.env` (written by the config form) and a shipped binary-dir `.env`, merged into `process.env` at boot beneath the shell and CWD `.env` — so app code just reads `Bun.env.*` regardless of source. Setting `PORT` there (or in `config`) binds the embedded server to a fixed, reachable address; the server has no `hostname` set, so it listens on all interfaces.

### Logging and DEBUG

The shared logger prints a coloured `[belte]` prefix and per-method/per-status request lines. `DEBUG` follows the `debug` package conventions:

| `DEBUG` value | Enables |
| --- | --- |
| `belte` | scope `belte` |
| `belte:*` | `belte` and `belte:*` |
| `*` | everything |
| `a,belte` | comma-separated list |
