# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

- **Humans** reach a belte app through the web (Svelte 5 pages) and a downloadable CLI.
- **Machines** reach the same app through MCP and the same CLI.

## What is an isomorphic multimodal framework

- **One runtime.** `belte dev`, `belte start`, and the compiled binaries all run on the same `Bun.serve`. No Node, no Vite, no second bundler.
- **Isomorphic.** A declaration is one callable with one name. The bundler swaps the runtime per target — direct call on the server, `fetch` on the client — so the same import works on both sides.
- **Multimodal.** Declare an rpc once and it's reachable from four call-sites for free: the server, the browser, an MCP tool/resource, and a CLI command.

Declare once:

```ts
// src/server/rpc/getProduct.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { error } from 'belte/server/error'
import { z } from 'zod'

const schema = z.object({ id: z.string() })

export const getProduct = GET(({ id }) => {
    const product = products[id]
    if (!product) {
        return error(404, `no product with id ${id}`)
    }
    return json(product)
}, { schema })
```

Consume anywhere:

| Caller       | Call-site                                                                |
| ------------ | ------------------------------------------------------------------------ |
| Server / SSR | `import { getProduct } from '$rpc/getProduct.ts'` then `await getProduct({ id })` |
| Browser      | same import; `cache(getProduct)({ id })` for SSR-aware reactivity        |
| MCP          | a GET → resource `belte://rpc/getProduct{?id}`; a write → tool, at `POST /__belte/mcp` |
| CLI          | `myapp getProduct --id=abc` from the compiled binary                     |

```svelte
<!-- browser: SSR-aware read -->
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getProduct } from '$rpc/getProduct.ts'
const product = await cache(getProduct)({ id: '1' })
</script>
<h1>{product.name}</h1>
```

```sh
# MCP: read the resource over JSON-RPC
curl -sX POST http://localhost:3000/__belte/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"belte://rpc/getProduct?id=1"}}'

# CLI: same rpc as a subcommand
myapp getProduct --id=1
```

A **schema is the gate**: any rpc carrying `{ schema }` auto-exposes to MCP and CLI. Without one it stays browser-only. Override per declaration with `{ clients: { mcp: false, cli: false } }`.

**Headless with the `APP_URL` switch.** The same client code runs in-process or against a deployment depending on one variable. A full CLI binary (default) bundles every rpc and runs locally; set `APP_URL` and it talks to a remote server instead. `createClient({ url })` makes the same choice in scripts.

```sh
myapp getProduct --id=1                                  # in-process
APP_URL=https://shop.example myapp getProduct --id=1     # same binary, remote server
```

## Contents

| Section | Covers |
| --- | --- |
| [Server](#server) | rpc verbs, response helpers, `.raw` / `.stream`, `request` / `server`, `openapi.json` |
| [Sockets](#sockets) | isomorphic `AsyncIterable` broadcast topics, publishing, `.tail` |
| [Prompts](#prompts) | MCP prompt templates under `src/server/prompts/` |
| [Browser](#browser) | pages, layouts, `cache`, `subscribe`, `navigate`, `page` |
| [MCP](#mcp) | auto-derived tools / resources / prompts at `POST /__belte/mcp` |
| [CLI](#cli) | `createClient`, the standalone binary, install + authenticated downloads |
| [Details](#details) | app hooks, project layout, commands, `public/`, bundling, env, logging |

---

## Server

Everything declared on the server: rpcs, sockets, prompts, response helpers, request/server accessors. `belte/server` is a namespace — every public name has its own path (`belte/server/GET`, `belte/server/json`, `belte/server/socket`, …), so importing one never drags its siblings into the bundle.

### RPC

#### Declaring

- One file per rpc under `src/server/rpc/`. Filename = export name = URL path under `/rpc/`.
- The imported verb picks the HTTP method. Folders become URL segments (`rpc/users/getUser.ts` → `/rpc/users/getUser`).
- URLs are flat — no `[id]` segments. Pass identifiers via args. Wrong verb on a known URL returns `405` with an `Allow` header.

```ts
Verb(handler)                                   // bare — Args/Return from the handler
Verb(handler, { schema, clients? })             // validated; Args = InferInput<Schema>
Verb<Return, Schema>(handler, { schema })        // override Return, let Schema infer
```

| Verb                  | Args parsed from                          |
| --------------------- | ----------------------------------------- |
| `GET` / `DELETE` / `HEAD` | URL search params                     |
| `POST` / `PUT` / `PATCH`  | JSON body or `FormData` (query overrides) |

| Option    | Effect                                                                       |
| --------- | ---------------------------------------------------------------------------- |
| `schema`  | any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …). Failed inbound validation → `422` + `{ issues }`. Schema + library stay server-only. |
| `clients` | per-surface exposure `{ browser, mcp, cli }`. `browser` defaults `true`; `mcp` / `cli` default to `true` when a `schema` is present. |

`Return` is inferred from the handler body via a `TypedResponse<T>` brand on `json` / `error` / `redirect` / `sse` / `jsonl`. A bare `new Response(...)` is still assignable; it falls back to `Return = unknown`.

```ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { z } from 'zod'

const schema = z.object({ message: z.string() })

export const createEcho = POST(
    ({ message }) => json({ method: 'POST' as const, message }, { status: 201 }),
    { schema },
)
```

##### Response helpers

| Helper                   | Content-Type        | Notes                                          |
| ------------------------ | ------------------- | ---------------------------------------------- |
| `json(data, init?)`      | `application/json`  | thin wrapper over `Response.json`              |
| `error(status, msg?)`    | `text/plain`        | message verbatim; status reason if omitted     |
| `redirect(url, status?)` | — (`Location`)      | default `302`                                  |
| `sse(iterable)`          | `text/event-stream` | one event per yielded frame + 15s keepalive    |
| `jsonl(iterable)`        | `application/jsonl` | one line per yielded frame                     |

All default to `Cache-Control: no-store`. `sse` and `jsonl` translate consumer cancellation into `iterator.return()`, so `finally` blocks run.

```ts
import { GET } from 'belte/server/GET'
import { sse } from 'belte/server/sse'

export const tickFeed = GET(() =>
    sse((async function* () {
        for (let tick = 1; ; tick += 1) {
            yield { tick, at: new Date().toISOString() }
            await Bun.sleep(1000)
        }
    })()),
)
```

For broadcast fan-out across many subscribers, declare a [socket](#sockets) instead.

##### `request()` and `server()`

```ts
import { request } from 'belte/server/request'
import { server } from 'belte/server/server'

const cookie = request().headers.get('cookie')   // inbound Request for the SSR pass / handler in flight
const port = server().port                        // live Bun.Server
```

`request()` throws outside a request scope; `server()` throws before `Bun.serve` has booted.

#### Consuming

Calling an rpc directly resolves to the decoded body. Args go on the query string for `GET` / `DELETE` / `HEAD`, JSON body for the rest. Non-2xx throws `HttpError`.

| Content-Type       | Decoded as  |
| ------------------ | ----------- |
| `application/json` | object      |
| `text/*`           | `string`    |
| binary             | `Blob`      |
| `204 No Content`   | `undefined` |

```ts
import { getProduct } from '$rpc/getProduct.ts'
const product = await getProduct({ id: 'abc' })
```

Each rpc also exposes `.url` and `.method`, so plain forms and `fetch` are first-class:

```svelte
<form action={createEcho.url} method={createEcho.method}>…</form>
```

##### `.raw(args?)` — the undecoded `Response`

Returns `Promise<Response>` for when you need headers, status, or the streaming body. Composes with `cache()` under the same key as `cache(fn)`.

```ts
const res = await getReport.raw({ id })
const version = res.headers.get('x-report-version')
```

##### `.stream(args?)` — a `Subscribable` view

Returns a `Subscribable<Return>` over an SSE/JSONL body — iterate it, or pipe it into [`subscribe()`](#browser).

```ts
for await (const tick of tickFeed.stream()) { /* … */ }
```

##### `HttpError`

Thrown by rpc calls on non-2xx; carries `status`, `statusText`, `response`. Also valid as `throw new HttpError(...)` inside a handler. Import from `belte/browser/HttpError` in pages so a catch handler doesn't pull the server runtime into the client bundle.

```ts
import { HttpError } from 'belte/browser/HttpError'

const product = await cache(getProduct, { key: ['product', id] })({ id }).catch((err) => {
    if (err instanceof HttpError && err.status === 404) {
        return undefined
    }
    throw err
})
```

##### `openapi.json`

`GET /openapi.json` returns an OpenAPI 3.1 document built from the verb registry — the HTTP surface every rpc exposes, regardless of which non-browser clients it advertises. GET/DELETE/HEAD args become query parameters; POST/PUT/PATCH args become a JSON request body. `operationId` matches the MCP tool / CLI subcommand name.

### Sockets

A `Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await (const m of chat)` and `chat.publish(m)` work identically on the server and in the browser. The bundler swaps the runtime: in-process fan-out on the server, ws proxy on the client. Every socket multiplexes onto one ws per client at `/__belte/sockets`, and steady-state fan-out rides Bun's `server.publish`, so chatty topics don't iterate JS per message per client.

#### Declaring

One topic per file under `src/server/sockets/`. Filename = export name = topic name.

```ts
import { socket } from 'belte/server/socket'
import { z } from 'zod'

export type ChatMessage = { id: string; from: string; text: string; at: number }

const schema = z.object({ id: z.string(), from: z.string(), text: z.string(), at: z.number() })

export const chat = socket<ChatMessage>({ history: 100, schema })
```

| Option          | Default     | Effect                                                                      |
| --------------- | ----------- | --------------------------------------------------------------------------- |
| `history`       | `0`         | buffer last *N* messages for replay                                         |
| `ttl`           | `undefined` | per-frame max age in ms; entries older than `ttl` are evicted before replay |
| `clientPublish` | `false`     | when `true`, browser publishes are forwarded server-side                    |
| `schema`        | `undefined` | validates `publish()` payloads synchronously; auto-exposes to MCP           |
| `clients`       | (derived)   | same shape as rpc — a schema flips `mcp` on by default                      |

#### Publishing

`publish` is isomorphic. From the browser it only works when `clientPublish: true`. For validated/auth'd publishes, gate through an HTTP rpc:

```ts
// src/server/rpc/publishChat.ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { error } from 'belte/server/error'
import { chat, type ChatMessage } from '$sockets/chat.ts'

export const publishChat = POST<{ from: string; text: string }>(({ from, text }) => {
    if (!from.trim() || !text.trim()) {
        return error(400, 'from and text required')
    }
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})
```

#### Consuming

A socket is an `AsyncIterable`, so bare `for await` works on both sides. In the browser, prefer [`subscribe()`](#browser) so the iterator's lifecycle is driven by the component.

```ts
for await (const m of chat)          { /* full history replay, then tail */ }
for await (const m of chat.tail())   { /* no replay — live only */ }
for await (const m of chat.tail(20)) { /* last 20 (clamped to history), then live */ }
```

Iteration auto-closes when `return()` runs (`break` out of `for await`).

### Prompts

MCP prompt templates — read-only message generators served only over MCP (no browser or CLI counterpart). One prompt per file under `src/server/prompts/`; filename = export name = prompt name.

```ts
prompt({ description?, schema?, render })
```

| Option        | Effect                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| `description` | shown in `prompts/list`                                                           |
| `schema`      | validates incoming arguments and supplies the advertised argument list            |
| `render`      | `(args) => string \| PromptMessage[]` — a bare string is sugar for one user message |

`PromptMessage` is `{ role: 'user' | 'assistant'; text: string }`.

```ts
// src/server/prompts/summarize.ts
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

---

## Clients

Three ways to reach the same backend. The browser is hand-written (Svelte pages + reactive consumers); MCP and CLI are derived automatically from the rpcs, sockets, and prompts you already declared.

### Browser

The html consumer surface — pages, layouts, the `cache` and `subscribe` reactive consumers, and SPA navigation.

#### Pages

- Every page is a folder containing `page.svelte` (Svelte 5). The folder path becomes the URL.
- Dynamic segments `[id]` and `[...rest]` arrive as individual `$props()`; the typed shape lands in `src/.belte/routes.d.ts`.
- Pages run during SSR *and* on the client during navigation. Top-level `await` runs on the server first, then replays from the cache snapshot on hydration.

```svelte
<!-- src/pages/server/rpc/product/[id]/page.svelte -->
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getProduct } from '$rpc/getProduct.ts'
let { id }: { id: string } = $props()
const product = $derived(await cache(getProduct, { key: ['product', id] })({ id }))
</script>
<h1>{product.name}</h1>
```

#### Layouts

`layout.svelte` wraps the pages below it. Layouts are **nearest-only**: the deepest matching layout runs and *replaces* ancestors — they don't stack. To inherit chrome, extract a snippet and `{@render}` it from each layout. Layouts run on both sides like pages.

```svelte
<!-- src/pages/layout.svelte -->
<script lang="ts">
import '../app.css'
let { children }: { children: import('svelte').Snippet } = $props()
</script>
<header><a href="/">Home</a></header>
<main>{@render children()}</main>
```

#### `cache(fn, options?)`

Wraps a direct rpc call with three things: **dedupe**, **SSR snapshot**, **reactivity**. Wrap it in `$derived` to subscribe; mutate via a plain rpc call, then invalidate.

| Option | Value                  | Effect                                            |
| ------ | ---------------------- | ------------------------------------------------- |
| `ttl`  | `undefined` (default)  | live forever                                      |
| `ttl`  | `0`                    | dedupe in-flight only — drop once the promise settles |
| `ttl`  | `number` (ms)          | expire after resolve                              |
| `key`  | `string` / `unknown[]` | override the auto key (e.g. `['post', id]`)       |

```svelte
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getCounter } from '$rpc/getCounter.ts'
import { incrementCounter } from '$rpc/incrementCounter.ts'

const counter = $derived(cache(getCounter)())

async function bump() {
    await incrementCounter()
    cache.invalidate(getCounter)
}
</script>

{#await counter}…{:then { count }}<p>{count}</p>{/await}
<button onclick={bump}>+1</button>
```

| `cache.invalidate(arg)` | Drops                                  |
| ----------------------- | -------------------------------------- |
| `(fn)`                  | every entry for that rpc, any args     |
| `(key)`                 | the specific key                       |
| `()`                    | the whole store                        |

`cache(fn.raw)` memoises the underlying `Response` against the same key as `cache(fn)`.

#### `subscribe(source)`

Reactive consumer for any `Subscribable<T>` — a `Socket<T>` or `fn.stream(args)`. The first read in a tracking scope opens the underlying iterator; the last reader closes it. Multiple `$deriveds` on one source share one subscription.

```svelte
<script lang="ts">
import { subscribe } from 'belte/browser/subscribe'
import { chat } from '$sockets/chat.ts'

const latest = $derived(subscribe(chat))            // re-renders on every frame
const status = $derived(subscribe.status(chat))     // 'pending' | 'open' | 'done' | 'error'
const error  = $derived(subscribe.error(chat))      // Error | undefined
</script>
```

- Errors surface via `subscribe.error(source)`, so reading the latest value can't crash the component.
- `subscribe` is a no-op on the server. Seed the initial paint with `cache()`, then layer `subscribe()` on top for live updates after hydration.

#### `navigate(url, options?)`

```ts
import { navigate } from 'belte/browser/navigate'

navigate('/posts/2')
navigate('/login', { replace: true })
```

Same-pathname navigations (hash / search only) skip the fetch and just refresh `page.url`. Network errors or unknown routes fall back to a full page load.

#### `page` state

`page` is a reactive `{ route, params, url }`. Reading any field inside `$derived` / `$effect` subscribes that scope; it's a discriminated union keyed on `route`, so narrowing on `page.route` types `page.params`.

```ts
import { page } from 'belte/browser/page'

const isActive = (href: string) => page.url.pathname === href
if (page.route === '/posts/[id]') {
    page.params.id   // typed as string
}
```

### MCP

Server-only namespace, auto-mounted at `POST /__belte/mcp` (JSON-RPC 2.0, MCP protocol `2025-06-18`). Tools, resources, and prompts are derived live from the same rpcs, sockets, and prompts the rest of the app already uses — no second registry. It works zero-config; provide `src/server/mcp.ts` to customise.

| Source                            | Becomes                          | When                                            |
| --------------------------------- | -------------------------------- | ----------------------------------------------- |
| non-GET rpc with `schema`         | tool `<name>`                    | writes (POST/PUT/PATCH/DELETE) are tools        |
| GET rpc with `schema`             | resource `belte://rpc/<name>{?args}` | reads are resources; args make a resource template |
| `prompts/<name>.ts`               | prompt `<name>`                  | schema → argument list; `render()` → messages   |
| socket with `schema`              | tool `await_<name>`              | blocks for the next published entry (default `30000ms`, override via `timeoutMs`) |
| socket with `clientPublish`       | tool `publish_<name>`            | payload validated by the socket's schema        |
| socket history                    | resource `belte://stream/<name>` | latest history window as JSON                   |

No schema → no MCP exposure. Override per declaration with `{ clients: { mcp: false } }`.

```ts
// src/server/mcp.ts — optional
import { createMcpServer } from 'belte/mcp/createMcpServer'
import { HttpError } from 'belte/server/HttpError'

export default createMcpServer({
    name: 'belte-app',
    version: '1.0.0',
    authorize: (req) => {
        if (!req.headers.get('authorization')) {
            throw new HttpError(401, 'mcp requires bearer token')
        }
    },
})
```

| Option      | Default                | Effect                                                       |
| ----------- | ---------------------- | ------------------------------------------------------------ |
| `name`      | `package.json` name    | server identity in the `initialize` response                 |
| `version`   | `package.json` version | server identity in the `initialize` response                 |
| `authorize` | `undefined`            | runs once per MCP request before any dispatch — throw to reject |

**Auth forwarding.** Inbound MCP requests forward `cookie`, `authorization`, `x-forwarded-for`, `x-forwarded-proto` onto every synthesized rpc request, so session/bearer middleware in `src/app.ts` keeps working. Tool calls go through the **same** `verb.fetch` code path as the HTTP route — validation, response helpers, and error mapping behave identically. Per-tool authorization stays in the underlying handler.

**Streaming caveat.** MCP gets single-shot `await_<name>` plus snapshot resources — not a live subscription. Real-time fan-out stays on the ws multiplex.

### CLI

Server-only namespace covering the typed rpc client and the standalone binary toolchain. Schema-bearing rpcs auto-expose; argv parses against the same JSON Schema MCP uses.

#### `createClient<Api>(opts?)`

Typed proxy over the project's rpcs. The mode is chosen at construction.

| Option     | Mode       | Behavior                                                            |
| ---------- | ---------- | ------------------------------------------------------------------- |
| `url`      | remote     | each call hits `<url>/<path>` over `fetch`                          |
| no `url`   | in-process | looks up the verb in the registry, calls `verb.fetch` — no network  |
| `token`    | both       | sets `authorization: Bearer <token>`                                |
| `manifest` | both       | the bundler-emitted CLI manifest; in-process falls back to the live registry |

```ts
// scripts/seed.ts
import { createClient } from 'belte/cli/createClient'
import { createEcho } from '$rpc/createEcho.ts'   // import forces the registry to populate
void createEcho                                   // referenced so it isn't tree-shaken

const client = createClient<{
    createEcho: (args: { message: string }) => Promise<{ method: 'POST'; message: string }>
}>()
await client.createEcho({ message: 'seeded' })
```

#### Standalone binary

`belte cli` packages the same client surface into an executable. It defaults to **full** — every rpc module bundled in, runs in-process locally, and reaches a remote server when `APP_URL` is set at runtime. `--thin` builds the **remote client** instead: manifest only, requires `APP_URL` at runtime.

```sh
belte cli                                          # build ./dist/cli (full)
./dist/cli getEcho --message=hello                 # in-process (no APP_URL)
APP_URL=http://localhost:3000 ./dist/cli getEcho --message=hello   # remote
./dist/cli --help
./dist/cli getEcho --help
```

Argv parses against each rpc's JSON Schema — every property is a flag:

| Schema type        | Flag                                            |
| ------------------ | ----------------------------------------------- |
| `boolean`          | `--name` / `--no-name`                          |
| `number` / `integer` | `--name <n>` (coerced with `Number()`)        |
| `array`            | repeated `--name <v>`                           |
| anything else      | `--name <value>` (string)                       |

`--json '<object>'` supplies the whole args bag verbatim; a JSON object piped on stdin does the same (flags layer on top). Unknown flags throw. `.env` next to the binary is auto-loaded, so a thin binary picks up `APP_URL` / `APP_TOKEN` from the install tarball.

#### Downloading + authenticated downloads

`createServer` registers two install routes.

| Route                         | Returns                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /__belte/cli`            | shell installer — detects `uname`, downloads the platform tarball, drops the binary into `$BELTE_INSTALL_DIR` (default `~/.local/bin`) |
| `GET /__belte/cli/<platform>` | gzipped tarball — the thin binary + an `.env` carrying the request's origin as `APP_URL`      |

```sh
curl -fsSL https://your-app.example/__belte/cli | sh
```

If the download request carries an `Authorization: Bearer <token>` header, that token is baked into the tarball's `.env` as `APP_TOKEN`, so an **authenticated download** produces a binary pre-wired with the caller's credential. Tokens forward verbatim — the framework neither issues nor refreshes them; your rpc handlers validate whatever value comes back.

Cross-build the thin binaries the download route serves:

```sh
belte cli --thin --platforms=linux-x64,darwin-arm64
# writes dist/cli-thin/<platform>/<programName>
```

The first download for a missing platform triggers a build on demand; concurrent requests dedupe onto one build. Pre-build into `dist/cli-thin/` to skip the wait.

**Streaming caveat.** CLI commands cover the request/response surface only — sockets, `sse`, and `jsonl` rpcs aren't reachable from the binary yet. Use the browser or MCP surface for those.

---

## Details

### App hooks — `src/app.ts`

Every export is optional and resolved at build time via the `belte:app` virtual module — no import from your code.

| Export        | Runs                                                               |
| ------------- | ------------------------------------------------------------------ |
| `init`        | once after `Bun.serve` boots. Return a cleanup for SIGINT/SIGTERM. |
| `handle`      | middleware wrapping the request pipeline (`next(request)` invokes). |
| `handleError` | 500 fallback. Replaces belte's default stack-trace response.       |

```ts
import type { AppModule } from 'belte/server/AppModule'

export const handle: AppModule['handle'] = async (request, next) => {
    const response = await next(request)
    response.headers.set('x-server', 'belte')
    return response
}
```

WebSocket upgrades aren't exposed here — they're owned by the socket hub at `/__belte/sockets`.

### Project layout

```
src/
  pages/                   # page.svelte / layout.svelte; folder path = URL
  server/
    rpc/                   # one rpc per file → /rpc/<filename>
    sockets/               # one topic per file → /__belte/sockets multiplex
    prompts/               # one prompt per file → MCP prompts/<name>
    mcp.ts                 # optional: custom createMcpServer call
  app.ts                   # optional: init / handle / handleError
  app.html, app.css        # optional shell and CSS
public/                    # static files served at the site root
```

| Alias        | Resolves to            |
| ------------ | ---------------------- |
| `$pages/…`   | `src/pages/…`          |
| `$rpc/…`     | `src/server/rpc/…`     |
| `$sockets/…` | `src/server/sockets/…` |
| `$lib/…`     | `src/lib/…`            |

`tsconfig.json` extends `belte/tsconfig` (inherits `strict`, `target: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `types: ["bun"]`). Path aliases are declared inline per project because Bun (1.3.x) doesn't substitute `${configDir}` in inherited `paths`. Top-level `await` inside components is opt-in via `svelte.config.js`:

```js
/** @type {import('belte').SvelteConfig} */
export default { compilerOptions: { experimental: { async: true } } }
```

### CLI commands

```sh
bunx belte scaffold my-app   # copy the bundled template into ./my-app
belte dev                    # bundle + bun --watch the server entry
belte build                  # bundle the client into dist/_app/
belte start                  # run the server entry against dist/
belte compile [--target=…] [--out=…]                          # standalone server binary
belte cli     [--thin] [--target=…] [--out=…] [--platforms=…] # standalone CLI binary
```

`belte compile` defaults to the host target (`bun-darwin-arm64`, `bun-linux-x64`, …), writes to `dist/app`, and embeds the compressed client assets into the binary. `belte cli` is two-pass: a discovery build walks the rpc registry to bake `dist/cli-manifest.json`, then `Bun.build({ compile })` emits the binary.

### `public/` files

Files under `public/` are served at the site root (`public/robots.txt` → `/robots.txt`), sidestepping the per-request cache and `app.handle` middleware. They carry `Cache-Control: public, max-age=3600`. A miss falls through to the 404 / middleware path. In a compiled binary the folder is embedded (zstd) the same way `/_app/` assets are.

### Bundling

Two build targets share the same resolver and Svelte plugin; the bundler swaps each isomorphic module's runtime per target. The client build emits hashed chunks into `dist/_app/` with pre-compressed `.zst` siblings, streamed when the client sends `Accept-Encoding: zstd`.

| Response                            | `Cache-Control`                       |
| ----------------------------------- | ------------------------------------- |
| Hashed bundles/chunks under `/_app/`| `public, max-age=31536000, immutable` |
| Other static assets under `/_app/`  | `public, max-age=0, must-revalidate`  |
| Files under `public/`               | `public, max-age=3600`                |
| SSR HTML / JSON                     | `private, no-cache`                   |
| Errors, rpc helpers, `/__belte/*`, `/openapi.json` | `no-store`             |

Override per response via a helper's `init` argument. `src/app.html` is optional; three comment markers are replaced per render — `<!--ssr:head-->`, `<!--ssr:body-->`, `<!--ssr:state-->` (the cache snapshot + route info for hydration).

### Environment variables

| Variable             | Read by   | Effect                                                   |
| -------------------- | --------- | -------------------------------------------------------- |
| `PORT`               | server    | listen port (default `3000`)                             |
| `APP_URL`            | CLI       | remote server URL; unset → in-process                    |
| `APP_TOKEN`          | CLI       | sent as `Authorization: Bearer <value>`                  |
| `BELTE_INSTALL_DIR`  | installer | install location (default `~/.local/bin`)                |
| `DEBUG`              | logging   | enables debug output (see below)                         |

`APP_URL` / `APP_TOKEN` are read from a `.env` next to the binary, so the install tarball wires a thin binary to its origin automatically.

### Logging and `DEBUG`

`belte/shared/log` is the shared logger — `log.info` / `warn` / `error` / `success` / `detail` / `request` plus `log.debug(scope, message)`, which only prints when `scope` is enabled. It's browser-safe (ANSI coloring no-ops off-Bun).

| `DEBUG` value | Enables                            |
| ------------- | ---------------------------------- |
| `belte`       | belte's per-request log line       |
| `belte:*`     | `belte` and any `belte:<scope>`    |
| `*`           | everything                         |
| `a,belte`     | comma-separated list               |

`DEBUG` is read from `.env` automatically.
