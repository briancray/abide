# Belte

> Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

Belte is one Bun program that serves four surfaces from the same code:

| Audience | Surfaces |
| --- | --- |
| Humans | web (Svelte SSR + SPA), cli, native bundle |
| Machines | mcp, cli |

The cli sits in both columns: humans run it by hand, machines script it.

## What "isomorphic multimodal" means

- **One runtime.** Dev and build run the same code path — the bundler swaps the runtime implementation per target, the behaviour stays put.
- **Declare once, use everywhere.** A remote function written under `src/server/rpc/` is callable, by the same name with the same signature, from a Svelte page, an HTTP client, an MCP tool, and a cli subcommand. You write the handler; the framework derives every consumer.
- **Standards first.** Requests, Responses, URLs, `AsyncIterable`, JSON Schema, Server-Sent Events, WebSocket — no bespoke envelope formats.

### Declare once

```ts
// src/server/rpc/getOrder.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'

export const getOrder = GET<{ id: string }>(async ({ id }) => json(await db.order(id)))
```

The export name must match the filename stem. The URL is the file path under `src/server/rpc/`, mounted at `/rpc/...`.

### Consume it on every surface

```svelte
<!-- web: in a Svelte page -->
<script lang="ts">
  import { cache } from '@briancray/belte/browser/cache'
  import { getOrder } from '$server/rpc/getOrder'
  const order = $derived(await cache(getOrder)({ id: '7' }))
</script>
```

```sh
# cli: rpc becomes a subcommand, args become flags
app get-order --id 7
```

```http
# http / mcp tool: GET /rpc/getOrder?id=7  ·  MCP tool "getOrder"
```

---

# Server

## Server / rpc

### Declaring

Each file under `src/server/rpc/` exports exactly one remote function bound to an HTTP verb. The verb helper carries the handler; the bundler threads in the verb (from the export name) and the URL (from the path).

```ts
type VerbHelper = {
  // schema-validated
  <Return, Schema>(fn: (args: InferOutput<Schema>) => TypedResponse<Return>,
    opts: { schema: Schema; clients?: Partial<ClientFlags> }): RemoteFunction<InferInput<Schema>, Return>
  // schemaless, explicit targeting
  <Args, Return>(fn: (args: Args) => TypedResponse<Return>,
    opts: { clients: Partial<ClientFlags> }): RemoteFunction<Args, Return>
  // bare handler
  <Args, Return>(fn: (args: Args) => TypedResponse<Return>): RemoteFunction<Args, Return>
}
```

| Helper | Verb | Args source |
| --- | --- | --- |
| `GET` `DELETE` `HEAD` | read / delete | query string |
| `POST` `PUT` `PATCH` | write | JSON body |

| Option | Type | Effect |
| --- | --- | --- |
| `schema` | Standard Schema | validates args (returns 422 on failure); infers `Args` / handler input |
| `clients` | `Partial<{ browser; mcp; cli }>` | which surfaces expose this verb |

Defaults: browser-only when schemaless; all surfaces when a schema is present (the schema is what makes the non-browser surfaces safe). Explicit `clients` always wins.

```ts
// src/server/rpc/createOrder.ts
import { POST } from '@briancray/belte/server/POST'
import { json } from '@briancray/belte/server/json'
import { OrderInput } from '$shared/schemas'

export const createOrder = POST(async (input) => json(await db.insert(input)), {
  schema: OrderInput,
})
```

Args are a single parsed bag — `undefined` for empty GET/DELETE, an object for JSON or query args, `undefined` for binary/multipart bodies (read the raw request instead).

**Response helpers** (all return a `TypedResponse<T>`, so the call-site return type is inferred without annotating `Return`):

| Helper | Returns | Notes |
| --- | --- | --- |
| `json(data, init?)` | JSON | `Cache-Control: no-store` unless overridden |
| `error(status, message?, init?)` | text/plain | message defaults to the status reason phrase; the client call throws `HttpError` |
| `redirect(url, status?, init?)` | 3xx | accepts relative URLs; default 302 |
| `jsonl(iterable, init?)` | application/jsonl | one JSON value per line |
| `sse(iterable, init?)` | text/event-stream | `data:` frames + 15s keepalive comment |

**Request and server context:**

```ts
import { request } from '@briancray/belte/server/request' // inbound Request for this SSR/rpc pass
import { server } from '@briancray/belte/server/server'   // the live Bun.Server
```

Both throw if read outside a request scope / before boot. Handlers reach headers and `request.signal` through `request()` rather than a handler parameter, keeping the signature a single args bag.

### Consuming

A `RemoteFunction` is the same callable on server and client; the bundler swaps in-process invocation for `fetch`.

```ts
type RemoteFunction<Args, Return> = ((args: Args) => Promise<Return>) & {
  readonly method: HttpVerb
  readonly url: string
  readonly raw: RawRemoteFunction<Args>
  stream(args?: Args): Subscribable<Return>
  fetch(request: Request): Promise<Response>
}
```

| Member | Resolves to | On non-2xx |
| --- | --- | --- |
| `fn(args)` | decoded body (JSON → object, `text/*` → string, 204 → `undefined`, else `Blob`) | throws `HttpError` |
| `fn.raw(args)` | underlying `Response`, no decode | resolves normally |
| `fn.stream(args?)` | `Subscribable<Return>` (frame-by-frame for jsonl/sse) | surfaces error on the subscription |

```ts
const order = await getOrder({ id: '7' })       // decoded
const res = await getOrder.raw({ id: '7' })      // Response
```

**`.raw`** — escape hatch for status / headers / manual error handling.

```ts
type RawRemoteFunction<Args> = ((args: Args) => Promise<Response>) & {
  readonly method: HttpVerb
  readonly url: string
}
```

**`.stream`** — wraps the response body in an iterable view; jsonl/sse handlers yield each frame, non-streaming handlers yield the decoded body once. It is a `Subscribable`, so it passes to `subscribe()`.

```ts
const latest = $derived(subscribe(countLog.stream({ to: 5 })))
```

**`HttpError`** — thrown by `fn(args)` on a non-2xx response; carries the raw `Response`.

```ts
import { HttpError } from '@briancray/belte/browser/HttpError'

try {
  await getOrder({ id: 'x' })
} catch (err) {
  if (err instanceof HttpError && err.status === 404) showNotFound()
}
```

**`openapi.json`** — every rpc's HTTP surface is described at `GET /openapi.json` (OpenAPI 3.1), regardless of which non-browser clients it advertises. GET/DELETE/HEAD args become query parameters; POST/PUT/PATCH args become a JSON request body; `operationId` is the folder-prefixed command name.

## Server / sockets

### Declaring

Each file under `src/server/sockets/` exports one named broadcast socket. The name is the file path under the directory.

```ts
type socket = {
  <Schema>(opts: SocketOptions & { schema: Schema }): Socket<InferOutput<Schema>>
  <T>(opts?: SocketOptions): Socket<T>
}
```

| Option | Type | Effect |
| --- | --- | --- |
| `history` | `number` | items buffered and replayed on first iteration (default 0) |
| `ttl` | `number` | ms before a history entry is evicted (lazy, on read/append) |
| `clientPublish` | `boolean` | accept `publish` frames from browser clients (default false) |
| `schema` | Standard Schema | validates each published payload synchronously |
| `clients` | `Partial<{ browser; mcp; cli }>` | which surfaces advertise the socket |

```ts
// src/server/sockets/chat.ts
import { socket } from '@briancray/belte/server/socket'

export const chat = socket<{ user: string; text: string }>({ history: 50 })
```

### Publishing

```ts
type publish = (message: T) => void
```

`publish` is isomorphic: server-side it notifies in-process iterators and fans out to remote subscribers over Bun's native `server.publish`; client-side it sends a `pub` frame the server validates against `clientPublish`.

```ts
chat.publish({ user: 'ada', text: 'hello' })
```

### Consuming

A `Socket<T>` is an `AsyncIterable<T>`. Iterating replays history then tails live; `.tail(count)` replays only the last `count` items (clamped to the configured `history`).

```ts
type Socket<T> = AsyncIterable<T> & {
  readonly name: string
  publish(message: T): void
  tail(count?: number): AsyncIterable<T>
}
```

```ts
// raw iteration
for await (const message of chat) render(message)
```

```svelte
<!-- reactive, in a Svelte page -->
<script lang="ts">
  import { subscribe } from '@briancray/belte/browser/subscribe'
  import { chat } from '$server/sockets/chat'
  const latest = $derived(subscribe(chat))             // full history then live
  const recent = $derived(subscribe(chat.tail(10)))    // last 10 then live
</script>
```

All declared sockets multiplex onto one framework-owned WebSocket per client at `/__belte/sockets`. For sustained pub/sub use sockets — HTTP rpc streams are for per-call generators, not long-lived multi-publisher subscriptions.

---

# Clients

## Browser

Pages are folder-based Svelte 5 components under `src/browser/pages/`.

| File | Role |
| --- | --- |
| `pages/page.svelte` | root route `/` |
| `pages/<dir>/page.svelte` | route at `/<dir>` |
| `pages/<dir>/[id]/page.svelte` | dynamic param `id` |
| `pages/<dir>/[...rest]/page.svelte` | catch-all `rest` |
| `pages/<dir>/layout.svelte` | layout for `/<dir>` and below |

**Layouts** wrap the nearest matching prefix; the deepest ancestor wins, no stacking.

**`cache`** — request-scoped dedupe + reactive memoisation of a remote call.

```ts
type cache = <Args, Return>(fn: RemoteFunction<Args, Return>, options?: CacheOptions)
  => (args?: Args) => Promise<Return>
```

| Option | Type | Effect |
| --- | --- | --- |
| `key` | `string \| unknown[] \| object` | override the auto-derived key (method + url + args) |
| `ttl` | `number` | `undefined` = forever, `0` = dedupe in-flight only, `n` = expire `n` ms after resolve |

```ts
const post = $derived(await cache(getPost)({ id }))      // decoded body
const res = $derived(await cache(getPost.raw)({ id }))    // raw Response (shares the entry)
cache.invalidate(getPost)                                 // drop all entries for this fn
cache.invalidate()                                        // drop everything
```

Reading from a `$derived` / `$effect` registers the scope; invalidating re-runs it. SSR seeds the cache into the HTML so the first client render hydrates without re-fetching.

**`subscribe`** — reactive view over any `Subscribable` (a `Socket` or `fn.stream(args)`).

```ts
type subscribe = <T>(subscribable: Subscribable<T>) => T | undefined
subscribe.error  = <T>(s: Subscribable<T>) => Error | undefined
subscribe.status = <T>(s: Subscribable<T>) => 'pending' | 'open' | 'done' | 'error'
```

First read in a tracking scope opens the underlying iterator; the last reader to stop closes it. Many `$derived`s reading the same source share one subscription. No-op on the server (SSR can't hold a stream open). Errors surface through `subscribe.error` rather than throwing.

**`navigate`** — SPA navigation.

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

Writes history, resolves the new view via a JSON fetch, swaps the page component. Same-pathname changes (only `search` / `hash`) skip the fetch and just update `page.url`. Falls back to a hard navigation if resolve fails or the target is cross-origin.

**Page state** — a reactive `$state` object describing the current location.

```ts
type Page = { route: string; params: Record<string, string>; url: URL }
```

```svelte
<script lang="ts">
  import { page } from '@briancray/belte/browser/page'
</script>
<p>route {page.route} — id {page.params.id} — {page.url.search}</p>
```

With generated route types, `page` is a discriminated union keyed on `route`, so narrowing on `page.route` gives the matching `params` shape.

## Mcp

The MCP server is generated automatically and served at `POST /__belte/mcp` (JSON-RPC, protocol `2025-06-18`). No server module to author.

| MCP concept | Source |
| --- | --- |
| tools | every rpc with `clients.mcp` (any verb) — tool name is the folder-prefixed command name |
| resources | files under `src/mcp/resources/` |
| prompts | markdown files under `src/mcp/prompts/` |

Sockets are never exposed to MCP. Tool dispatch runs through the same `fetch` path as HTTP, so validation, handlers, and error helpers behave identically; inbound auth headers are forwarded.

**Resources** — files under `src/mcp/resources/` are listed and read at the `belte://resources/<relative-path>` URI. Text-like MIME types return inline `text`; everything else returns base64 `blob`.

```
src/mcp/resources/
  catalog.json     → belte://resources/catalog.json
  docs/intro.md    → belte://resources/docs/intro.md
```

**Prompts** — each `src/mcp/prompts/<name>.md` is one prompt. YAML frontmatter supplies `description` and an `arguments` list (all string-typed); the body is the template, interpolated via `{{name}}` placeholders into a single user message on `prompts/get`.

```markdown
---
description: Summarize an order for a customer
arguments:
  - name: id
    description: Order id
    required: true
---
Summarize order {{id}} in one sentence.
```

## Cli

A standalone cli binary is generated automatically — a thin remote client carrying the rpc manifest, talking to a running server over HTTP.

| Variable | Role |
| --- | --- |
| `APP_URL` | server the cli calls (required; also baked into the install `.env`) |
| `APP_TOKEN` | bearer token sent as `Authorization` (baked in when the download request was authenticated) |

- Each rpc with `clients.cli` becomes a subcommand; the command name is the folder-prefixed URL (`users/list.ts` → `users-list`).
- Flags are derived from the verb's JSON Schema:

| Schema property type | Flag form |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name <n>` (coerced) |
| `array` | repeated `--name <v>` |
| other | `--name <value>` |
| any shape | `--json '<args>'` escape hatch, or pipe a JSON object on stdin |

```sh
APP_URL=http://localhost:3000 app users-list --limit 20 --active
echo '{"id":7}' | app get-order
```

**Downloading** — a running server hosts a one-line installer:

| Endpoint | Returns |
| --- | --- |
| `GET /__belte/cli` | platform-detecting shell script |
| `GET /__belte/cli/<platform>` | gzipped tarball: the platform binary + a `.env` with `APP_URL` (and `APP_TOKEN` if the request was authenticated) |

```sh
curl -fsSL http://localhost:3000/__belte/cli | sh   # installs into ~/.local/bin
```

Authenticated downloads carry the bearer token into the tarball's `.env`, so the installed cli is pre-authorized.

**Help chrome** — optional `src/cli/banner.txt` prints above the top-level help, `src/cli/footer.txt` below it.

## Bundle

`belte bundle` produces a movable, self-contained native desktop app for the host platform (a `.app` on macOS, a flat directory elsewhere). It travels with the standalone server binary, a launcher, and the native webview lib — runs on another machine of the same OS with nothing installed. Unsigned; distribution still needs platform signing/notarization.

The bundle boots into a connect screen that can **start the embedded server** or **connect to a remote one** by URL.

**`window`** — optional `src/bundle/window.ts` default-exports the window config.

```ts
type BundleWindow = {
  title?: string
  width?: number
  height?: number
  menu?: BundleMenu[]   // custom top-level menus between Edit and Window
}
```

```ts
// src/bundle/window.ts
import type { BundleWindow } from '@briancray/belte/bundle/BundleWindow'

export default {
  title: 'Orders',
  width: 1100,
  height: 720,
} satisfies BundleWindow
```

Standard App / Edit / Window menus plus a File menu (Start server / Connect / Disconnect) are always installed. Custom menu items either `emit` a `belte:menu` event into the page or `navigate` the window.

**`onMenu`** — the page side of `emit`. Subscribes to custom menu clicks; the handler receives the item's `emit` name, so the page computes any arguments and makes the rpc call itself.

```ts
type onMenu = (handler: (name: string) => void) => () => void
```

```svelte
<script lang="ts">
  import { onMenu } from '@briancray/belte/bundle/onMenu'
  import { navigate } from '@briancray/belte/browser/navigate'
  $effect(() => onMenu((name) => {
    if (name === 'open-mcp') navigate('/mcp')
  }))
</script>
```

Returns an unsubscribe function, so it drops straight into an `$effect`. Inert during SSR and in a plain browser tab — the native menu that fires the event exists only in the bundled app.

**`disconnected.svelte`** — the connect screen. Drop a `src/bundle/disconnected.svelte` to override the default (logo + URL form + Start server button).

**`icon.png`** — on macOS, `src/bundle/icon.png` is converted to `icon.icns` for the `.app` (or supply `src/bundle/icon.icns` directly).

---

# Details

## App hooks

Optional `src/app.ts` exports — all optional, with defaults when absent.

| Export | Signature | Role |
| --- | --- | --- |
| `init` | `({ server }) => void \| (() => void)` | boot-time setup; returned function runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | single middleware around every dispatched request |
| `handleError` | `(error, request) => Response` | catches thrown handler errors (default is a `<pre>` stack dump) |

## Project layout

```
src/
  app.ts                      # optional hooks
  browser/
    app.html                  # optional custom shell
    pages/**/page.svelte      # routes
    pages/**/layout.svelte    # layouts
    public/                   # static files served at the site root
  server/
    rpc/*.ts                  # one remote function per file
    sockets/*.ts              # one socket per file
  mcp/
    prompts/*.md              # MCP prompts
    resources/**              # MCP resources
  cli/
    banner.txt  footer.txt    # CLI help chrome
  bundle/
    window.ts  disconnected.svelte  icon.png
  shared/                     # cross-surface code
```

Build-time aliases resolve to these directories: `$server`, `$browser`, `$shared`, `$mcp`, `$cli`. Add a `lib/` folder under any surface for that surface's helpers and declare your own alias for it — `lib/` is userland.

## Cli commands

| Command | Action |
| --- | --- |
| `bunx belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with watch-restart |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte compile [--target] [--out]` | standalone server executable (assets embedded) |
| `belte cli [--target] [--out] [--platforms=a,b,c]` | thin remote cli binary (needs `APP_URL`) |
| `belte bundle` | movable native app bundle for this platform |

## public/ files

Files under `src/browser/public/` are served at the site root. In a compiled binary they are embedded (zstd); in dev / `belte start` they are read off disk.

## Bundling

- The client build emits hashed chunks to `dist/_app/`, each with a `.zst` sibling (zstd level 22). The server streams precompressed bytes to clients that accept zstd and decompresses on the fly for the rest.
- `belte compile` runs the client build, embeds the assets, and emits ESM bytecode for fast cold start.

| Asset bucket | Cache-Control |
| --- | --- |
| hashed `/_app/` chunks | `public, max-age=31536000, immutable` |
| unhashed `/_app/` entries + shell | `public, max-age=0, must-revalidate` |
| `public/` files | `public, max-age=3600` |
| SSR HTML | `private, no-cache` |
| rpc helpers / errors | `no-store` |

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `PORT` | server | listen port (default 3000) |
| `APP_URL` | cli | server the cli targets |
| `APP_TOKEN` | cli | bearer token for cli calls |
| `DEBUG` | logging | enable debug scopes (`debug`-style globs) |
| `BELTE_INSTALL_DIR` | install script | cli install location (default `~/.local/bin`) |

## Logging and DEBUG

A shared `[belte]` logger colours request lines by method and status. Debug output follows the `debug` npm convention:

| `DEBUG` value | Enables |
| --- | --- |
| `belte` | the `belte` scope (per-request log lines) |
| `belte:*` | `belte` and every `belte:<sub>` scope |
| `*` | everything |
| `a,belte` | comma-separated list |
</content>
