# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

Declare a piece of behaviour once; Belte exposes it to every client without a second implementation:

- **Humans** reach it through the web (server-rendered Svelte 5 + SPA), the CLI, and a movable native desktop bundle.
- **Machines** reach it through MCP (tools, resources, prompts) and the same CLI.
- The CLI serves both — a person runs it by hand, a script or agent drives it programmatically.

One Bun process, one runtime. The bundler swaps the implementation per target (server vs browser vs thin client) behind a stable import, so the same callable name behaves the same on every side.

## Try it

The fastest path is a fresh scaffold or a prebuilt example.

**Scaffold a new app:**

```sh
bunx @briancray/belte scaffold my-app
cd my-app && bun install
bun dev
```

**Run the kitchen-sink example** (every feature in one app):

```sh
git clone https://github.com/briancray/belte.git
cd belte/examples/kitchen-sink
bun dev
```

`bun dev` builds the client, boots the server with hot reload, and prints the local URL.

## What is an isomorphic multimodal framework

A single Bun runtime hosts the server, the SSR renderer, and the build pipeline. You declare an RPC once and it is callable, for free, from every surface — browser/HTTP, MCP, CLI, and the desktop bundle — with the same name and signature on each side. The bundler rewrites the import per target: a direct in-process call on the server, a `fetch` over the network in the browser, a thin remote client in the CLI binary.

**Declare once** — one file under `src/server/rpc/`, one export named after the file:

```ts
// src/server/rpc/getOrder.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'

export const getOrder = GET<{ id: string }>(async ({ id }) => json(await db.getOrder(id)))
```

**Consume anywhere** — the same `getOrder` is reachable from each client:

| Surface | How it is reached |
| --- | --- |
| Web (SSR + SPA) | `import { getOrder } from '$server/rpc/getOrder.ts'`, then `await cache(getOrder)({ id })` in a `page.svelte` |
| HTTP | `GET /rpc/getOrder?id=…` |
| MCP | tool `getOrder` (auto-exposed when the verb is read-only and carries a schema) |
| CLI | command `getOrder --id …` |

---

# Server

## Server / rpc

### Declaring

Every file under `src/server/rpc/` exports exactly one verb-bound remote function. The filename is the export name **and** the URL stem (mounted under `/rpc/`); the imported verb picks the HTTP method.

One helper per method, each its own import:

| Import | Method | Args travel as |
| --- | --- | --- |
| `@briancray/belte/server/GET` | GET | query string |
| `@briancray/belte/server/POST` | POST | JSON body |
| `@briancray/belte/server/PUT` | PUT | JSON body |
| `@briancray/belte/server/PATCH` | PATCH | JSON body |
| `@briancray/belte/server/DELETE` | DELETE | query string |
| `@briancray/belte/server/HEAD` | HEAD | query string |

Each helper has three call shapes:

```ts
type VerbHelper = {
    // schema-validated: Args infers from the schema, replies 422 on failure
    <Return, InputSchema extends StandardSchemaV1>(
        fn: RemoteHandler<InferOutput<InputSchema>, Return>,
        opts: { inputSchema: InputSchema } & VerbOptions,
    ): RemoteFunction<InferInput<InputSchema>, Return>
    // schemaless, explicit client targeting
    <Args, Return>(fn: RemoteHandler<Args, Return>, opts: { clients: Partial<ClientFlags> }): RemoteFunction<Args, Return>
    // bare handler
    <Args, Return>(fn: RemoteHandler<Args, Return>): RemoteFunction<Args, Return>
}
```

`opts` fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `inputSchema` | Standard Schema | Validates incoming args; `Args` infers from it. Failure replies `422`. |
| `outputSchema` | Standard Schema | Describes the success body for the OpenAPI `200` and the MCP tool output. |
| `inputJsonSchema` / `outputJsonSchema` | `Record<string, unknown>` | Precomputed JSON Schema overrides. |
| `clients` | `Partial<{ browser, mcp, cli }>` | Which surfaces expose this verb. Explicit values always win. |

`Args` comes from the handler parameter (or the schema); `Return` is inferred from the handler body via the `TypedResponse<T>` brand on the response helpers — no `GET<Args, Return>` annotation needed just to type the reply.

Surface defaults: browser is always on. MCP and CLI flip on automatically when a verb carries an `inputSchema`. Mutating verbs (POST/PUT/PATCH/DELETE) stay off MCP unless `clients.mcp` is set explicitly, so a model can't mutate just because a schema exists.

```ts
// src/server/rpc/createOrder.ts
import { POST } from '@briancray/belte/server/POST'
import { json } from '@briancray/belte/server/json'

export const createOrder = POST(async ({ sku, qty }) => json(await db.insertOrder({ sku, qty })), {
    inputSchema: orderSchema,
})
```

#### Response helpers

One per file; each returns a `TypedResponse<T>` and defaults `Cache-Control: no-store` (intermediary caches shouldn't store rpc replies). A bare `new Response(...)` is also valid.

| Import | Returns | Notes |
| --- | --- | --- |
| `@briancray/belte/server/json` | JSON body | `json(data, init?)` — like `Response.json`. |
| `@briancray/belte/server/error` | `text/plain` error | `error(status, message?, init?)` — message defaults to the status reason phrase. |
| `@briancray/belte/server/redirect` | 3xx | `redirect(url, status = 302, init?)` — accepts relative URLs. |
| `@briancray/belte/server/jsonl` | `application/jsonl` stream | `jsonl(asyncIterable, init?)` — one JSON value per line. |
| `@briancray/belte/server/sse` | `text/event-stream` | `sse(asyncIterable, init?)` — one `data:` event per frame, 15s keepalive. |

```ts
if (!order) return error(404, 'order not found')
return redirect('/orders/' + order.id, 303)
```

#### request() and server()

Handlers receive parsed `args` only. For the inbound `Request` (headers, `signal`, cookies) or the live Bun server, call these accessors — both throw if used outside a request scope / before boot.

```ts
import { request } from '@briancray/belte/server/request'
import { server } from '@briancray/belte/server/server'

const auth = request().headers.get('authorization')
const port = server().port
```

### Consuming

A plain call resolves to the **decoded body** and throws `HttpError` on a non-2xx status.

**Encoding** (args → request): GET/DELETE/HEAD serialise a plain-object `args` onto the query string; POST/PUT/PATCH send it as `application/json`.

**Decoding** (response → value), by `Content-Type`:

| Response | Decoded value |
| --- | --- |
| `application/json`, `*/*+json` | parsed object |
| `text/*` | string |
| `204 No Content` / empty | `undefined` |
| anything else | `Blob` |
| SSE / JSONL / NDJSON | throws — use `.stream` instead |

```ts
const order = await getOrder({ id })            // decoded body
const created = await createOrder({ sku, qty }) // throws HttpError on non-2xx
```

#### `.raw(args)`

Returns the underlying `Response` untouched — no decode, no throw on non-2xx. The escape hatch for status codes, headers, or custom error handling.

```ts
type raw = (args?: Args) => Promise<Response>

const res = await getOrder.raw({ id })
if (res.status === 404) showEmptyState()
```

#### `.stream(args)`

Returns a `Subscribable<Return>` view of the response body: SSE/JSONL handlers yield each frame; non-streaming handlers yield the decoded body once. Pass it to `subscribe()` for a reactive view, or iterate directly.

```ts
type stream = (args?: Args) => Subscribable<Return>

for await (const frame of orderFeed.stream({ id })) render(frame)
```

#### HttpError

Thrown by a plain call on a non-2xx status. Carries the raw `Response` so error UI can read the body without opting into `.raw`. Import from `@briancray/belte/server/HttpError` (server) or `@briancray/belte/browser/HttpError` (browser).

```ts
class HttpError extends Error {
    readonly status: number
    readonly statusText: string
    readonly response: Response
}
```

#### openapi.json

The public HTTP surface (`/rpc/*`) is described as an OpenAPI document at `GET /openapi.json`, built from the verb registry and each verb's input/output schema.

## Server / sockets

### Declaring

Every file under `src/server/sockets/` exports exactly one socket, named after the file. A socket is a bidirectional named broadcast primitive — the same import resolves to a server-side fan-out and a client-side WebSocket proxy by build target. All sockets multiplex onto one framework-owned connection per client at `/__belte/sockets`.

```ts
type socket = <T>(opts?: SocketOptions) => Socket<T>
```

`SocketOptions`:

| Field | Type | Purpose |
| --- | --- | --- |
| `history` | `number` | Items buffered and replayed to a new subscriber. Default `0`. |
| `ttl` | `number` | History entries older than `ttl` ms are evicted lazily on read/append. |
| `clientPublish` | `boolean` | Allow clients to publish over the wire. Default `false` (server-only). |
| `schema` | Standard Schema | Validates publish payloads; flips MCP/CLI on. |
| `clients` | `Partial<{ browser, mcp, cli }>` | Which surfaces advertise this socket. |

```ts
// src/server/sockets/chat.ts
import { socket } from '@briancray/belte/server/socket'

export const chat = socket<ChatMessage>({ history: 50 })
```

### Publishing

```ts
interface Socket<T> {
    publish(message: T): void
}
```

`publish` is isomorphic. Called on the server it notifies in-process iterators and fans out to remote subscribers (via Bun's native `server.publish`); called on the client (when `clientPublish` is set) it sends a `pub` frame the dispatcher validates.

```ts
chat.publish({ user, text })
```

### Consuming

A `Socket<T>` is an `AsyncIterable<T>`. Iterating replays the history buffer then tails live; `.tail(count)` replays the last `count` items (default `0`, clamped to `history`) before tailing.

```ts
interface Socket<T> extends AsyncIterable<T> {
    tail(count?: number): AsyncIterable<T>
}
```

```ts
// raw iteration
for await (const message of chat) render(message)

// reactive (see browser / subscribe)
const latest = $derived(subscribe(chat))
const recent = $derived(subscribe(chat.tail(20)))
```

---

# Clients

## Browser

### Pages

A `page.svelte` anywhere under `src/browser/pages/` mounts at that folder's URL (`src/browser/pages/about/page.svelte` → `/about`). Dynamic segments use `[id]` / `[...rest]` folder names. Pages are Svelte 5 and render on the server (SSR) then hydrate.

```svelte
<script lang="ts">
import { cache } from '@briancray/belte/browser/cache'
import { getOrder } from '$server/rpc/getOrder.ts'

// top-level await runs during SSR; the decoded body is captured into the
// per-request cache, serialised into the HTML, and replayed on hydration
const order = await cache(getOrder)({ id: '1' })
</script>

<h1>Order {order.id}</h1>
```

### Layouts

A `layout.svelte` wraps every page at or below its folder. Layouts are **nearest-only** — the deepest matching layout runs and replaces ancestors; they do not stack. Render `{@render children()}` to place the page.

### cache

```ts
type cache = <Args, Return>(
    fn: RemoteFunction<Args, Return>,
    options?: CacheOptions,
) => (args?: Args) => Promise<Return>
```

Curries a remote call against the request-scoped (server) or tab-scoped (browser) cache store. Reading from a `$derived`/`$effect` scope subscribes it; invalidating re-runs the scope. Pass `fn.raw` to memoise the raw `Response` against the same key.

`CacheOptions`:

| Field | Type | Purpose |
| --- | --- | --- |
| `key` | `string \| unknown[] \| Record<string, unknown>` | Override the auto-derived key (method + url + args). |
| `ttl` | `number` | ms-past-resolve the entry stays live. Omitted = forever; `0` = dedupe in-flight only. |
| `scope` | `string` | Free-form tag grouping calls so one `invalidate` drops them together. |

`cache.invalidate` has three shapes:

| Call | Effect |
| --- | --- |
| `cache.invalidate()` | Drop everything. |
| `cache.invalidate(fn)` | Drop one function's calls (`fn` or `fn.raw`). |
| `cache.invalidate({ key?, scope? })` | Drop one entry by `key` and/or every entry tagged `scope` (the union). |

```ts
const order = await cache(getOrder, { ttl: 30_000, scope: 'orders' })({ id })
cache.invalidate({ scope: 'orders' }) // refetch every order-scoped reader
```

### subscribe

```ts
type subscribe = <T>(subscribable: Subscribable<T>) => T | undefined
```

Reactive consumer for streaming sources — a `Socket<T>` or the result of `fn.stream(args)`. The first read in a tracking scope opens the iterator; the last reader to stop closes it. Many readers of the same source share one underlying subscription (deduped by name). A no-op during SSR.

| Accessor | Returns |
| --- | --- |
| `subscribe(s)` | latest value, or `undefined` before the first frame |
| `subscribe.error(s)` | `Error` if the stream surfaced one, else `undefined` |
| `subscribe.status(s)` | `'pending' \| 'open' \| 'done' \| 'error'` |

```svelte
<script lang="ts">
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))
</script>
```

### navigate

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

SPA navigation: writes history, resolves the new view, swaps the page component. A pure `search`/`hash` change skips the fetch and only updates `page.url`. Cross-origin or a failed resolve falls back to a hard navigation. Import from `@briancray/belte/browser/navigate`.

| Option | Default | Effect |
| --- | --- | --- |
| `replace` | `false` | `replaceState` instead of `pushState`. |
| `scroll` | `true` | Reset scroll to top on a push navigation. |

### Page state

`page` is reactive route state, re-running `$derived` consumers on every navigation. Import from `@briancray/belte/browser/page`.

```ts
const page: {
    route: string
    params: Record<string, string> // typed per-route when codegen has run
    url: URL
}
```

## MCP

Generated automatically — there is no MCP server module to author. The endpoint lives at `POST /__belte/mcp`; auth (bearer / cookie headers) flows from the inbound request into each tool's synthesized rpc call.

| MCP concept | Source |
| --- | --- |
| Tools | every verb with `clients.mcp: true` (read-only + schema auto-on; mutating verbs opt in). Sockets add a `<name>-tail` tool, plus `<name>-publish` when `clientPublish` is set. |
| Resources | files under `src/mcp/resources/`, addressed `belte://resources/<relative-path>` |
| Prompts | markdown files under `src/mcp/prompts/` |

**Resources** are served straight from disk (or embedded in a compiled binary). Text MIME types come back inline as UTF-8; everything else as base64.

**Prompts** are `.md` files with optional YAML frontmatter and a `{{name}}`-interpolated body:

```md
---
description: Summarise an order for support
arguments:
  - name: orderId
    required: true
---
Summarise order {{orderId}} and flag anything unusual.
```

## CLI

Generated automatically. The shipped CLI binary is a **thin remote client**: it carries no handler code and talks to a running server over HTTP, so it needs `APP_URL`.

| Env var | Purpose |
| --- | --- |
| `APP_URL` | Remote server URL (required). |
| `APP_TOKEN` | Sent as `Authorization: Bearer <value>` when set. |

- Each rpc with `clients.cli: true` becomes a **command**; its args and flags are derived from the verb's JSON Schema (`getOrder --id 1`).
- Sockets contribute a `<name>-tail` command (and `<name>-publish` when allowed).
- Streaming responses (SSE/JSONL, or a socket `tail`) print frame-by-frame as NDJSON; everything else is decoded and pretty-printed once.
- A `.env` next to the binary is read at startup, so `APP_URL` / `APP_TOKEN` ship with an install tarball.

**Downloading.** A running server exposes its CLI at `GET /__belte/cli` (install script that detects the platform and drops the binary into `$BELTE_INSTALL_DIR`, default `~/.local/bin`) and `GET /__belte/cli/<platform>` (per-platform tarball). Downloads inherit the request's auth, so an authenticated server hands out an `APP_TOKEN`-primed binary.

**Branding.** Drop `src/cli/banner.txt` and `src/cli/footer.txt` to frame the top-level `--help` output.

## Bundle

`belte bundle` produces a movable, self-contained native desktop app for the host platform (a `.app` on macOS, a flat directory elsewhere) — the server binary, the launcher, and the webview library together. It boots into a connect screen where the user can **start the embedded server** or **connect to a remote one**.

### window

An optional `src/bundle/window.ts` default-exports a `BundleWindow`, baked into the launcher at build time.

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]       // custom top-level menus, inserted before Window
    config?: StandardSchemaV1 // env the embedded server needs; drives the first-run form
}
```

The standard App/Edit/Window menus plus a built-in File menu (Start / Connect / Disconnect) are always present. `config`'s JSON Schema renders the first-run setup form; answers persist to the data-dir `.env` the embedded server loads at boot (`title` → label, `description` → hint, `format: 'password'` → masked, `default` → pre-fill).

```ts
// src/bundle/window.ts
import type { BundleWindow } from '@briancray/belte/bundle/BundleWindow'

export default {
    title: 'Orders',
    width: 1100,
    height: 720,
    menu: [{ label: 'Sync', items: [{ label: 'Sync now', shortcut: 'r', emit: 'sync' }] }],
} satisfies BundleWindow
```

### disconnected.svelte

Drop `src/bundle/disconnected.svelte` to replace the default connect screen.

### onMenu

Custom menu items dispatch a `belte:menu` event; `onMenu` subscribes and returns an unsubscribe, so it drops into a Svelte `$effect`. Inert during SSR and in a plain browser tab. Import from `@briancray/belte/bundle/onMenu`.

```ts
type onMenu = {
    (handler: (name: string) => void): () => void
    (name: string, handler: () => void): () => void
}

$effect(() => onMenu('sync', () => syncNow()))
```

### icon.png

`src/bundle/icon.png` is the app icon (converted to the platform format at bundle time) and the connect-screen logo.

---

# Some details

## App hooks

An optional `src/app.ts` exports lifecycle hooks (all optional, resolved at build time — no import needed from your code).

| Export | Signature | Runs |
| --- | --- | --- |
| `init` | `({ server }) => void \| (() => void)` | once after `Bun.serve` is up; the returned function runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | middleware wrapping the request pipeline |
| `handleError` | `(error, request) => Response` | custom 500 fallback |

## Project layout

```
src/
  app.ts                      # optional lifecycle hooks
  server/
    rpc/<name>.ts             # one verb-bound rpc per file  → /rpc/<name>
    sockets/<name>.ts         # one socket per file
    lib/                      # your server-only helpers
  browser/
    pages/**/page.svelte      # routes; folder path = URL
    pages/**/layout.svelte    # nearest-only layout
    public/                   # static files served at site root
    app.html                  # optional SSR shell
    app.css                   # styles
    lib/                      # your browser-only helpers
  mcp/
    resources/                # files exposed as MCP resources
    prompts/*.md              # MCP prompts
  cli/
    banner.txt / footer.txt   # CLI --help chrome
  bundle/
    window.ts                 # desktop window config
    disconnected.svelte       # connect-screen override
    icon.png                  # app icon
svelte.config.js              # optional Svelte compiler options
```

Import aliases map to the five top-level surfaces: `$server`, `$browser`, `$shared`, `$mcp`, `$cli` (e.g. `$server/rpc/getOrder.ts`). A `lib/` folder under any surface is userland — add your own path aliases for shared helpers, and check the surface folders for existing functionality before writing new. `tsconfig.json` extends `@briancray/belte/tsconfig`.

## CLI commands

| Command | Action |
| --- | --- |
| `bunx @briancray/belte scaffold <name>` | Scaffold a new project. |
| `belte dev` | Build the client and run the server with hot reload. |
| `belte build` | Build the client into `dist/_app/` (CI / static deploy). |
| `belte start` | Run the production server against `dist/`. |
| `belte compile [--target] [--out]` | Standalone server executable (embedded backend). |
| `belte cli [--target] [--out] [--platforms a,b,c]` | Thin remote CLI binary (needs `APP_URL`). |
| `belte bundle` | Movable, self-contained desktop app for this platform (unsigned). |

## public/ files

Files under `src/browser/public/` are served at the site root (`src/browser/public/robots.txt` → `/robots.txt`), bypassing SSR and middleware, with `Cache-Control: public, max-age=3600`.

## Bundling

`belte build` emits hashed chunks into `dist/_app/`. Content-addressed chunks are served immutable; the entry bundle and HTML shell revalidate.

| Asset | Cache-Control |
| --- | --- |
| Hashed `/_app/` chunk | `public, max-age=31536000, immutable` |
| Unhashed `/_app/` entry, shell | `public, max-age=0, must-revalidate` |
| `public/` file | `public, max-age=3600` |
| SSR HTML | `private, no-cache` |
| rpc reply (helper default) | `no-store` |

Zstd-precompressed siblings are written next to each `_app` asset and served to capable clients.

## Environment variables

`.env` files load fill-when-unset: ambient/shell and Bun's CWD `.env` win, later layers back-fill only what is missing, so the app reads one flat `process.env`.

| Variable | Used by |
| --- | --- |
| `PORT` | server listen port (default `3000`) |
| `APP_URL` | CLI thin client — remote server URL (required) |
| `APP_TOKEN` | CLI thin client — bearer token |
| `DEBUG` | logging scopes (see below) |

## Logging and DEBUG

`@briancray/belte/shared/log` is the shared logger: `info` / `warn` / `error` / `success` / `detail`, plus `request(method, path, status, ms)` with a per-method/per-status colour palette and `debug(scope, message)`.

Request logging and `debug` output are gated by `DEBUG`, following the `debug` package conventions:

| `DEBUG` value | Enables |
| --- | --- |
| `belte` | the `belte` scope (includes request logging) |
| `belte:*` | `belte` and any `belte:<sub>` scope |
| `*` | everything |
| `a,belte` | comma-separated list |

---

Built with [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev). MIT licensed.
</content>
</invoke>
