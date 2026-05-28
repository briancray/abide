# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

Declare a backend once and it serves three clients at the same time:

- **Humans** — a server-rendered Svelte 5 web app, and a generated CLI.
- **Machines** — an MCP server, and the same CLI as a scriptable binary.

The CLI sits in both columns on purpose: humans type it, machines pipe it.

## What "isomorphic multimodal" means

- **One runtime.** Dev and production run the same code paths under Bun — no
  parallel implementations to drift apart.
- **Isomorphic.** The same callable has the same name and the same behaviour on
  both sides of the wire. You import `getProduct` and call `getProduct({ id })`;
  the bundler swaps the implementation — an in-process handler call on the
  server, a typed `fetch` in the browser.
- **Multimodal.** Declare a remote function once. Every surface it should reach
  (browser/HTTP, MCP, CLI) is derived from that one declaration — no second
  registry to maintain.

### Declare once

```ts
// src/server/rpc/getProduct.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { error } from 'belte/server/error'
import { z } from 'zod'

const schema = z.object({ id: z.string() })

export const getProduct = GET(
    ({ id }) => {
        const product = products[id]
        if (!product) {
            return error(404, `no product with id ${id}`)
        }
        return json(product)
    },
    { schema },
)
```

The file is one endpoint: the filename is the export name and the URL
(`/rpc/getProduct`), the imported verb is the HTTP method, and the Standard
Schema validates input. A schema flips MCP and CLI exposure on automatically —
it's the gate that makes the non-browser surfaces safe to advertise.

### Use anywhere

| Client | Call |
| --- | --- |
| Browser / HTTP | `await getProduct({ id: '1' })` — typed `fetch` to `/rpc/getProduct?id=1` |
| Server (SSR / scripts) | `await getProduct({ id: '1' })` — in-process handler call |
| MCP | `tools/call` `{ "name": "getProduct", "arguments": { "id": "1" } }` at `POST /__belte/mcp` |
| CLI | `./dist/cli getProduct --id=1` |

## Quick start

```sh
bunx belte scaffold my-app
cd my-app
bun install
belte dev
```

`belte dev` builds the client bundle and runs the server under `bun --watch`.
Edit a file in the graph and the server restarts; refresh the browser to see it.

---

# Server

## Server / rpc

### Declaring

One file under `src/server/rpc/` is one remote function. Import a verb, wrap a
handler, export it under the file's name.

```ts
type Verb = (handler, opts?: { schema?, clients? }) => RemoteFunction
```

| Part | Source |
| --- | --- |
| HTTP method | the imported verb — `GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD` |
| URL | the file path under `/rpc/` (e.g. `users/list.ts` → `/rpc/users/list`) |
| Export name | the filename stem (must match) |
| `Args` | the handler parameter type, or `InferInput<schema>` when a schema is given |
| `Return` | inferred from the handler's return via the `TypedResponse<T>` brand on the respond helpers |

`$rpc` URLs are flat — pass identifiers through args, not the path. Bracket
segments (`[id]`) belong in pages.

```ts
// src/server/rpc/createEcho.ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { z } from 'zod'

const schema = z.object({ message: z.string() })

export const createEcho = POST(
    ({ message }) => json({ method: 'POST' as const, message }, { status: 201 }),
    { schema },
)
```

Args are encoded by verb:

| Verb | Args travel as |
| --- | --- |
| `GET` / `DELETE` / `HEAD` | query string |
| `POST` / `PUT` / `PATCH` | `application/json` body |

For binary or multipart bodies `Args` is `undefined` — read the raw `Request`
with `request()` instead.

#### Response helpers

Return one of these from a handler; the `TypedResponse<T>` brand carries the
body shape into the inferred `Return` so callers stay typed without annotation.

| Helper | Import | Produces |
| --- | --- | --- |
| `json(data, init?)` | `belte/server/json` | JSON; `Cache-Control: no-store` unless overridden |
| `error(status, message?)` | `belte/server/error` | `text/plain` error; message defaults to the status reason phrase |
| `redirect(url, status=302)` | `belte/server/redirect` | 3xx; accepts relative URLs |
| `sse(asyncIterable)` | `belte/server/sse` | `text/event-stream`, one `data:` event per frame, 15s keepalive |
| `jsonl(asyncIterable)` | `belte/server/jsonl` | `application/jsonl`, one JSON value per line |

A bare `new Response(...)` is always acceptable; the brand is optional and
untagged responses fall back to `Return = unknown`.

#### `request()` and `server()`

```ts
import { request } from 'belte/server/request'
import { server } from 'belte/server/server'
```

| Function | Returns |
| --- | --- |
| `request()` | the inbound `Request` for the current SSR/RPC pass (AsyncLocalStorage-backed) |
| `server()` | the live `Bun.serve` instance |

Both throw if called outside a request scope / before boot, rather than
returning `undefined`. `request()` works from any module under the request
scope — handler, page script, layout, downstream helper — with no plumbing.

```ts
// src/server/rpc/whoAmI.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { request } from 'belte/server/request'

export const whoAmI = GET(() => {
    const headers = request().headers
    return json({ hasCookie: headers.has('cookie'), userAgent: headers.get('user-agent') })
})
```

### Consuming

The exported value is callable as-is. On the server it runs the handler
in-process; in the browser it's a typed `fetch` to the matching URL.

```ts
import { getProduct } from '$server/rpc/getProduct.ts'

const product = await getProduct({ id: '1' })   // decoded body; throws HttpError on non-2xx
```

The plain call decodes the response by Content-Type:

| Content-Type | Decoded as |
| --- | --- |
| `application/json` (or `*/+json`) | parsed object |
| `text/*` | string |
| `204 No Content` / empty | `undefined` |
| streaming (`sse` / `jsonl` / `ndjson`) | throws — use `.stream` / `subscribe` |
| anything else | `Blob` |

Every remote function also carries metadata and two siblings:

| Member | Type | Use when |
| --- | --- | --- |
| `fn.url` / `fn.method` | `string` | wiring a plain `<form action method>` or hand-rolled `fetch` |
| `fn.raw(args?)` | `Promise<Response>` | you need headers / status / a streaming body |
| `fn.stream(args?)` | `Subscribable<Return>` | iterating SSE/JSONL frames or piping into `subscribe()` |

```ts
const body = await getReport({ id: 'r-1' })             // just the data
const response = await getReport.raw({ id: 'r-1' })     // full Response
const version = response.headers.get('x-report-version')

for await (const frame of tickFeed.stream()) { /* one frame at a time */ }
```

#### HttpError

Non-2xx responses throw `HttpError`, which carries the raw `Response`:

```ts
import { HttpError } from 'belte/browser/HttpError'

try {
    await getProduct({ id: 'nope' })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) {
        /* err.status, err.statusText, await err.response.text() */
    }
}
```

`belte/browser/HttpError` is aliased to the server class so client catch
handlers don't pull the server runtime into the bundle.

#### `openapi.json`

`GET /openapi.json` returns an OpenAPI 3.1 document built from the verb
registry — the HTTP surface every rpc exposes. GET/DELETE/HEAD args become
query parameters; POST/PUT/PATCH args become a JSON request body;
`operationId` matches the MCP tool / CLI subcommand name.

## Server / sockets

### Declaring

One file under `src/server/sockets/` is one named broadcast topic.

```ts
socket<T>(opts?: { history?, ttl?, clientPublish?, schema?, clients? }): Socket<T>
```

| Option | Default | Effect |
| --- | --- | --- |
| `history` | `0` | buffer the last N messages and replay them to new subscribers |
| `ttl` | `undefined` | per-frame max age (ms); stale history entries evicted before replay |
| `clientPublish` | `false` | when on, browser `pub` frames are forwarded server-side |
| `schema` | — | validates publish payloads synchronously; flips MCP exposure on |
| `clients` | browser-only (all surfaces if `schema`) | which surfaces advertise the socket |

```ts
// src/server/sockets/chat.ts
import { socket } from 'belte/server/socket'
import { z } from 'zod'

export type ChatMessage = { id: string; from: string; text: string; at: number }

const schema = z.object({ id: z.string(), from: z.string(), text: z.string(), at: z.number() })

export const chat = socket<ChatMessage>({ history: 100, schema })
```

Every socket multiplexes onto one framework-owned WebSocket per client at
`/__belte/sockets`. Steady-state fan-out rides Bun's native `server.publish`.

### Publishing

```ts
socket.publish(message: T): void
```

`publish` is isomorphic: server code publishes in-process and fans out to
remote subscribers; client code sends a `pub` frame the dispatcher honours only
when `clientPublish` is on. With `clientPublish` left off (the default), route
publishes through an rpc so the server can validate first:

```ts
// src/server/rpc/publishChat.ts
import { POST } from 'belte/server/POST'
import { error } from 'belte/server/error'
import { json } from 'belte/server/json'
import { z } from 'zod'
import { type ChatMessage, chat } from '$server/sockets/chat.ts'

const schema = z.object({ from: z.string(), text: z.string() })

export const publishChat = POST(({ from, text }) => {
    if (!from.trim() || !text.trim()) {
        return error(400, 'from and text are required')
    }
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
}, { schema })
```

### Consuming

A `Socket<T>` is an `AsyncIterable<T>`. Iterating opens a subscription; the same
shape works on both sides.

```ts
for await (const m of chat)          { /* full history replay, then live */ }
for await (const m of chat.tail())   { /* no replay — live only */ }
for await (const m of chat.tail(20)) { /* last 20 (clamped to history), then live */ }
```

In the browser, read reactively with `subscribe()` (see below) rather than
hand-driving the iterator. For sustained pub/sub use a socket — HTTP rpc isn't
the place for long-lived multi-publisher subscriptions.

---

# Clients

## Browser

Pages and layouts are Svelte 5 components under `src/browser/pages/`. They run
on the server during SSR and on the client after hydration — same component,
both sides.

### Pages

Every folder containing a `page.svelte` mounts at that folder's URL. Dynamic
segments use `[name]` / `[...rest]` and arrive as `$props`.

| File | URL |
| --- | --- |
| `src/browser/pages/page.svelte` | `/` |
| `src/browser/pages/about/page.svelte` | `/about` |
| `src/browser/pages/product/[id]/page.svelte` | `/product/:id` |

```svelte
<!-- src/browser/pages/product/[id]/page.svelte -->
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getProduct } from '$server/rpc/getProduct.ts'

let { id }: { id: string } = $props()    // typed via the generated src/.belte/routes.d.ts

const product = $derived(await cache(getProduct, { key: ['product', id] })({ id }))
</script>

<h1>{product.name} — €{product.price}</h1>
```

A top-level `await` runs on the server during SSR; the decoded body is captured
into the per-request cache, serialized into the HTML, and replayed on hydration
— no second fetch.

### Layouts

A `layout.svelte` wraps every page below its folder and renders `{@render
children()}`. Layouts are **nearest-only**: the deepest matching layout runs and
replaces ancestors — they don't stack. To share chrome, extract a snippet and
render it from each layout.

```svelte
<!-- src/browser/pages/layout.svelte -->
<script lang="ts">
import '../app.css'
let { children }: { children: import('svelte').Snippet } = $props()
</script>

<header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
<main>{@render children()}</main>
```

### `cache()`

```ts
cache(fn, options?) => (args?) => Promise<Return>
```

Curries a remote call against the request-scoped store: dedupe on a key derived
from `fn.method + fn.url + args`, SSR snapshot, and reactivity. The first
`$derived`/`$effect` read opens a subscription; invalidating the key re-runs
that scope.

| Option | Value | Effect |
| --- | --- | --- |
| `ttl` | `undefined` | live forever (default) |
| `ttl` | `0` | dedupe in-flight only — drop once settled |
| `ttl` | `number` | expire `ttl` ms after the promise resolves |
| `key` | `string` / `unknown[]` / object | override the auto-derived key |

```ts
const counter = $derived(cache(getCounter)())
const mirror  = $derived(await cache(getCounter)())   // same key, same entry

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)                       // re-runs every subscriber
}
```

| Invalidate | Effect |
| --- | --- |
| `cache.invalidate(fn)` | drop every entry for that rpc |
| `cache.invalidate(key)` | drop one keyed entry |
| `cache.invalidate()` | clear the whole store |

`cache(fn.raw)` shares the same stored entry as `cache(fn)` — the decode just
happens on the way out for callers of `fn`.

### `subscribe()`

```ts
subscribe(subscribable: Subscribable<T>) => T | undefined
```

Reactive consumer for streaming sources — a `Socket<T>` or the result of
`fn.stream(args)`. The first read in a tracking scope opens the iterator; the
last reader closes it. Many `$derived`s reading the same source share one
subscription.

| Read | Type | For |
| --- | --- | --- |
| `subscribe(src)` | `T \| undefined` | latest frame; `undefined` until the first arrives |
| `subscribe.status(src)` | `'pending' \| 'open' \| 'done' \| 'error'` | distinguish first-pending from clean end / error |
| `subscribe.error(src)` | `Error \| undefined` | wire-layer error (reads never throw) |

```ts
import { subscribe } from 'belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))                    // socket
const ticks  = $derived(subscribe(tickFeed.stream()))       // rpc stream, no args
const counts = $derived(subscribe(countLog.stream({ to: 5 })))
```

`subscribe()` is a no-op on the server. For an SSR-friendly initial paint, seed
with `cache()` against an HTTP rpc, then layer `subscribe()` on top after
hydration.

### `navigate()`

```ts
navigate(href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

SPA navigation: writes history (push by default), resolves the new view, swaps
the page component. A search/hash-only change skips the network round-trip and
just reassigns `page.url`. Cross-origin or failed resolves fall back to a hard
navigation.

### Page state

```ts
import { page } from 'belte/browser/page'
```

`page` is a `$state` object — a discriminated union keyed on `route`, so
narrowing on `page.route` gives the matching `page.params` shape.

| Field | Type |
| --- | --- |
| `page.route` | the matched route key |
| `page.params` | path params for that route |
| `page.url` | the live `URL`, reassigned on every navigation |

Reading `page.url` inside a `$derived` re-runs on every nav — active-link
styling falls out for free:

```ts
const linkClass = (prefix: string) =>
    page.url.pathname.startsWith(prefix) ? 'font-semibold' : 'text-slate-600'
```

## MCP

An MCP server is mounted at `POST /__belte/mcp` with zero config — JSON-RPC 2.0,
protocol `2025-06-18`. Server name and version come from `package.json`. Tools,
prompts, and resources are derived from code you already wrote.

| Source | Becomes |
| --- | --- |
| every rpc with MCP exposure on (auto-on when it carries a `schema`) | one **tool**, named after its URL with folder segments joined by `-` (`users/list.ts` → `users-list`), regardless of HTTP verb |
| each `prompt(...)` file under `src/mcp/prompts/` | one **prompt** (`prompts/list` + `prompts/get`) |
| each file under `src/mcp/resources/` | one **resource** at `belte://resources/<path>` (text inline, binary base64) |

No schema → no MCP exposure. Override per declaration with `{ clients: { mcp:
false } }`. Sockets are not exposed to MCP. Inbound MCP requests forward
`cookie` / `authorization` / `x-forwarded-*` onto every synthesized rpc request,
and tool calls take the same `verb.fetch` path as the HTTP route — same
validation, response helpers, and error mapping.

### rpcs are tools

```sh
curl -sX POST http://localhost:3000/__belte/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"createEcho","arguments":{"message":"hi"}}}'
```

### Resources

Drop files under `src/mcp/resources/`; each is listed in `resources/list` and
read via `resources/read` by its `belte://resources/<relative-path>` URI.

```
src/mcp/resources/
  schema.sql        →  belte://resources/schema.sql
  docs/api.md       →  belte://resources/docs/api.md
```

### Prompts

One `prompt(...)` per file under `src/mcp/prompts/`. The schema both validates
incoming arguments and feeds the argument list advertised in `prompts/list`;
`render(args)` returns the messages (a bare string is sugar for one user
message).

```ts
// src/mcp/prompts/summarize.ts
import { prompt } from 'belte/server/prompt'
import { z } from 'zod'

const schema = z.object({ topic: z.string(), tone: z.string().optional() })

export const summarize = prompt({
    description: 'Draft a request to summarize a topic.',
    schema,
    render: ({ topic, tone }) =>
        `Write a concise summary of ${topic}${tone ? ` in a ${tone} tone` : ''}.`,
})
```

## CLI

Two things share the name. `createClient` is a typed rpc proxy for scripts and
tests; the standalone binary is the same proxy wrapped in an argv parser.

### `createClient`

```ts
createClient<Api>(opts?: { url?, token?, manifest? }) => Api
```

| Option | Mode | Behaviour |
| --- | --- | --- |
| `url` | remote | each call hits `<url>/<path>` via `fetch` |
| (no `url`) | in-process | looks up the verb in the registry and calls `verb.fetch` — no network |
| `token` | both | sets `authorization: Bearer <token>` |
| `manifest` | both | bundler-emitted manifest; in-process falls back to the live registry |

```ts
// scripts/seed.ts — in-process client for a migration script
import { createClient } from 'belte/cli/createClient'
import { createEcho } from '$server/rpc/createEcho.ts'   // import forces the registry to populate
void createEcho

const client = createClient<{
    createEcho: (args: { message: string }) => Promise<{ method: 'POST'; message: string }>
}>()
await client.createEcho({ message: 'seeded' })
```

### The binary

`belte cli` two-pass builds a standalone executable. RPCs become subcommands;
the argv parser maps each rpc's JSON Schema to flags:

| Schema type | Flag |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name <n>` (coerced) |
| `array` | repeated `--name <v>` |
| anything else | `--name <value>` |

`--json '<args>'` supplies the whole bag verbatim; a piped JSON object on stdin
seeds it (flags layer on top).

```sh
belte cli                                                       # build ./dist/cli (full)
./dist/cli getProduct --id=1                                    # in-process (no APP_URL)
APP_URL=http://localhost:3000 ./dist/cli getProduct --id=1      # remote
./dist/cli --help
./dist/cli getProduct --help
```

`belte cli` defaults to **full** — every rpc module is bundled in, so the binary
runs locally (and still reaches a remote server when `APP_URL` is set at
runtime). `--thin` opts into the remote-only client (manifest only, requires
`APP_URL` at runtime).

CLI commands cover the request/response surface only. Sockets, `sse`, and
`jsonl` rpcs aren't reachable from the binary yet — use the browser or MCP
surface for those.

### Downloading

`createServer` registers two install routes so anyone can fetch the binary.

| Route | Returns |
| --- | --- |
| `GET /__belte/cli` | a shell installer — detects `uname`, downloads the platform tarball, drops the binary into `$BELTE_INSTALL_DIR` (default `~/.local/bin`) |
| `GET /__belte/cli/<platform>` | a gzipped tarball — the thin binary plus a `.env` carrying the request's origin as `APP_URL` |

```sh
curl -fsSL https://your-app.example/__belte/cli | sh
```

Cross-build the per-platform thin binaries the download route serves:

```sh
belte cli --thin --platforms=linux-x64,darwin-arm64
# writes dist/cli-thin/<platform>/<programName>
```

The first download for a missing platform triggers an on-demand build
(concurrent requests dedupe onto one); pre-build into `dist/cli-thin/` to skip
it. When the inbound request to `GET /__belte/cli/<platform>` carries an
`authorization: Bearer` header, the token is written into the tarball's `.env`
as `APP_TOKEN`, so the installed binary authenticates without extra setup.

### CLI chrome

`src/cli/banner.txt` prints atop the top-level `--help`; `src/cli/footer.txt`
prints below it. Both are optional and baked into the binary.

---

# Details

## App hooks

An optional `src/app.ts` exports up to three hooks. All are optional; framework
defaults apply when missing.

| Hook | Signature | Purpose |
| --- | --- | --- |
| `init` | `({ server }) => void \| (() => void)` | boot-time setup; an optional returned cleanup runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | single middleware wrapping the request pipeline |
| `handleError` | `(error, request) => Response` | fallback for thrown errors (replaces the default stack-trace 500) |

```ts
import type { AppModule } from 'belte/server/AppModule'

export const handle: AppModule['handle'] = async (request, next) => {
    const response = await next(request)
    response.headers.set('x-server', 'belte')
    return response
}
```

## Project layout

Five top-level surfaces under `src/`, each with an import alias.

| Path | Alias | Holds |
| --- | --- | --- |
| `src/server/rpc/<name>.ts` | `$server` | one verb-bound remote function per file → `/rpc/<name>` |
| `src/server/sockets/<name>.ts` | `$server` | one socket per file → `/__belte/sockets` multiplex |
| `src/browser/pages/**/page.svelte` | `$browser` | a page at the folder URL |
| `src/browser/pages/**/layout.svelte` | `$browser` | a nearest-only layout |
| `src/browser/public/**` | `$browser` | static files served at the site root |
| `src/browser/app.html` | `$browser` | optional SSR shell |
| `src/mcp/prompts/<name>.ts` | `$mcp` | one MCP prompt per file |
| `src/mcp/resources/**` | `$mcp` | files exposed as `belte://resources/<path>` |
| `src/cli/banner.txt`, `footer.txt` | `$cli` | CLI help chrome |
| `src/shared/**` | `$shared` | cross-side code |
| `src/app.ts` | — | optional app hooks |

Filenames are the contract: one export per `rpc` / `socket` / `prompt` file,
named after the file stem.

## CLI commands

| Command | Does |
| --- | --- |
| `bunx belte scaffold <name>` | scaffold a new project from the bundled template |
| `belte dev` | build the client and run the server under `bun --watch` |
| `belte build` | build the client bundle into `dist/_app/` |
| `belte start` | run the production server against an existing `dist/` |
| `belte compile [--target=<bun-…>] [--out=<path>]` | build a standalone server executable |
| `belte cli [--thin] [--target=<bun-…>] [--out=<path>] [--platforms=<a,b,c>]` | build the CLI binary |

## Framework routes

| Path | Purpose |
| --- | --- |
| folder paths under `src/browser/pages/` | SSR pages |
| `/rpc/<name>` | rpc endpoints |
| `/_app/*` | hashed client bundle |
| site-root paths from `src/browser/public/` | static files |
| `/__belte/sockets` | WebSocket multiplex |
| `/__belte/mcp` | MCP JSON-RPC (POST) |
| `/__belte/cli`, `/__belte/cli/<platform>` | CLI installer + binary |
| `/openapi.json` | OpenAPI 3.1 of the rpc surface |

## `public/` files

Files under `src/browser/public/` are served at the site root (`robots.txt` →
`/robots.txt`), sidestepping the per-request cache and middleware. A miss falls
through to the page/404 path.

## Bundling

- `belte build` runs `Bun.build` against the client entry into `dist/_app/`,
  with code splitting, minification, and linked source maps. Each output also
  gets a zstd-compressed `.zst` sibling (level 22, paid once) so the server can
  stream precompressed bytes to clients that accept `zstd` and decompress on the
  fly for those that don't.
- `belte compile` produces a standalone server binary with the client assets,
  `src/browser/public/`, and `src/mcp/resources/` embedded (zstd) — no `dist/`
  or source folders needed at runtime.
- The bundler rewrites each `rpc` / `socket` / `prompt` module per build target:
  the server gets the real handler, the client gets a name-only proxy stub, so
  handler bodies and server-only imports never reach the browser.

## HTTP cache-control

| Response | `Cache-Control` |
| --- | --- |
| hashed `/_app/*` chunks | `public, max-age=31536000, immutable` |
| `/_app/` entry + HTML shell assets | `public, max-age=0, must-revalidate` |
| SSR HTML | `private, no-cache` |
| rpc respond helpers (`json` / `error` / `redirect` / `sse` / `jsonl`) | `no-store` |

## Environment variables

| Variable | Read by | Effect |
| --- | --- | --- |
| `PORT` | server | listen port (default `3000`) |
| `APP_URL` | `belte cli` build + binary runtime | build: set → thin, unset → full. runtime: set → remote calls, unset → in-process |
| `APP_TOKEN` | binary runtime | bearer token sent on remote calls |
| `BELTE_INSTALL_DIR` | install script | install directory (default `~/.local/bin`) |
| `DEBUG` | logger | enable request + debug logging |

## Logging and `DEBUG`

`belte/shared/log` is the shared logger — a `console.*` wrapper with a `[belte]`
prefix and per-method/per-status colouring for request lines.

| Call | Output |
| --- | --- |
| `log.info` / `log.warn` / `log.success` / `log.detail` | prefixed level lines |
| `log.error(value)` | red; full stack trace for `Error` values |
| `log.debug(scope, message)` | only when `DEBUG` matches `scope` |
| `log.request(method, path, status, ms)` | coloured request line |

`DEBUG` follows the `debug` npm convention: `belte` enables the `belte` scope,
`belte:*` enables it and any `belte:`-prefixed scope, `*` enables everything,
and commas separate a list. Setting `DEBUG=belte` turns on per-request logging.
