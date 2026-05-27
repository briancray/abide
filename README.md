# belte

A multimodal framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev). One typed backend; three clients — browser, MCP, CLI.

| Section | What it covers |
| --- | --- |
| [Bets](#bets) | the four foundational decisions |
| [Examples](#examples) | barebones, scaffold, kitchen-sink |
| [The three bets](#the-three-bets) | multimodal isomorphism, framework-owned network, single runtime |
| [A complete app on one screen](#a-complete-app-on-one-screen) | one rpc, three clients |
| [CLI](#cli) | `bunx belte scaffold`, in-project commands, `belte cli` |
| [Project layout](#project-layout) | folder tree + path aliases |
| [Pages and layouts](#pages-and-layouts--srcpages) | `page.svelte` / `layout.svelte`, nearest-only layouts, dynamic segments |
| [App hooks](#app-hooks--srcappts) | `init` / `handle` / `handleError` |
| [MCP server](#mcp-server--srcservermcpts) | optional `src/server/mcp.ts` — authorize hook, name, version |
| [HTML shell](#html-shell--srcapphtml) | three SSR markers |
| [Project config](#project-config) | `svelte.config.js`, `tsconfig` extending `belte/tsconfig` |
| [`belte/server`](#belteserver) | rpc verbs, response helpers, sockets, `request` / `server`, `HttpError`, cache-control defaults |
| [`belte/browser`](#beltebrowser) | direct calls, `cache`, `subscribe`, `page` / `navigate`, `HttpError`, request lifecycle |
| [`belte/mcp`](#beltemcp) | `createMcpServer`, tool + resource derivation, auth forwarding |
| [`belte/cli`](#beltecli) | `createClient`, argv parsing, thin vs full binaries, install endpoint |

## Bets

1. **Multimodal isomorphism** — one rpc declaration, four call-sites: server, browser, MCP tool, CLI command. The bundler / MCP dispatcher / CLI binary each swap the runtime.
2. **Framework owns the network** — one rpc URL shape, one ws multiplex for sockets, one MCP endpoint, one CLI download endpoint.
3. **One runtime, dev → prod → binary** — every command runs on the same `Bun.serve`. No Node, no Vite.

## Examples

- [`examples/barebones`](examples/barebones) — one `page.svelte`.
- [`examples/scaffold`](examples/scaffold) — output of `bunx belte scaffold`, one of every file type.
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, rpcs, sockets, `cache`, invalidation, Tailwind, cookie-session auth.

---

## The three bets

### Multimodal isomorphism

One rpc declaration. Three clients can call it; the server can call its own rpc just as easily.

```ts
// src/server/rpc/getPost.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { z } from 'zod'

const schema = z.object({ id: z.string() })
export const getPost = GET(({ id }) => json({ title: `Post ${id}` }), { schema })
```

| Caller        | Call-site                                                              |
| ------------- | ---------------------------------------------------------------------- |
| Server / SSR  | `import { getPost } from '$rpc/getPost.ts'` then `await getPost({ id })` |
| Browser       | same import path; `cache(getPost)({ id })` for SSR-aware reactivity     |
| MCP tool      | exposed as tool `getPost` at `POST /__belte/mcp`                       |
| CLI command   | exposed as `myapp getPost --id=abc` from the compiled binary           |

Schemas are the gate: any rpc with a `{ schema }` auto-exposes to MCP and CLI. Without a schema, it stays browser-only. Override per-rpc with `{ clients: { mcp: false, cli: false } }`.

Surface differences worth knowing:

| Surface       | Direct call | Schema validation | Stream subscribe                              | Socket publish        |
| ------------- | ----------- | ----------------- | --------------------------------------------- | --------------------- |
| Browser       | yes         | yes               | live (ws multiplex)                           | if `clientPublish`    |
| MCP tool      | yes         | yes               | single-shot `await_<socket>` + history snapshot resource | if `clientPublish` |
| CLI command   | yes         | yes (argv → schema) | not yet                                     | not yet               |

### Framework owns the network

| Concern             | Shape                                                          |
| ------------------- | -------------------------------------------------------------- |
| RPC URL             | `/rpc/<filename>` (flat — no `[id]` segments)                  |
| WebSocket           | one `/__belte/sockets` multiplexed per client                  |
| MCP                 | one `POST /__belte/mcp` (JSON-RPC 2.0)                          |
| CLI install         | `GET /__belte/cli` returns a shell installer; `GET /__belte/cli/<platform>` streams a tarball |
| Reactive (req/resp) | `$derived(cache(fn)(args))` — re-runs on invalidate            |
| Reactive (stream)   | `$derived(subscribe(source))` — re-runs per frame              |

Plain HTML still works — every rpc has `.url` and `.method`, so `<form action={createPost.url} method={createPost.method}>` and `fetch(getPost.url)` are first-class.

### One runtime, dev → prod → binary

| Command         | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| `belte dev`     | bundle + `bun --hot` the server entry                        |
| `belte build`   | bundle the client into `dist/_app/` (gzip siblings included) |
| `belte start`   | run the server entry against `dist/`                         |
| `belte compile` | build + `Bun.build({ compile })` → standalone server binary  |
| `belte cli`     | bake the rpc manifest, compile a standalone CLI binary       |

`belte compile` embeds the gzipped client assets into the binary. `belte cli --platforms=linux-x64,darwin-arm64` cross-builds thin CLI binaries the server's `/__belte/cli/<platform>` endpoint serves to users.

---

## A complete app on one screen

One rpc, declared once, reachable from the browser via SSR-aware cache, from any MCP client over JSON-RPC, and from a downloadable CLI binary.

```ts
// src/server/rpc/getPost.ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { z } from 'zod'

const schema = z.object({ id: z.string() })
export const getPost = GET(({ id }) => json({ title: `Post ${id}` }), { schema })
```

```svelte
<!-- src/pages/page.svelte -->
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getPost } from '$rpc/getPost.ts'
const post = await cache(getPost)({ id: 'hello' })
</script>
<h1>{post.title}</h1>
```

```svelte
<!-- src/pages/layout.svelte -->
<script lang="ts">
import '../app.css'
let { children }: { children: import('svelte').Snippet } = $props()
</script>
<header><a href="/">Home</a></header>
<main>{@render children()}</main>
```

```json
// package.json
{ "scripts": { "dev": "belte dev" }, "dependencies": { "belte": "^0.0.1", "svelte": "^5.0.0", "zod": "^3.0.0" } }
```

```sh
bun install && bun run dev
```

Same app, talking to the MCP endpoint:

```sh
curl -sX POST http://localhost:3000/__belte/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getPost","arguments":{"id":"hello"}}}'
```

Same app, talking via the compiled CLI binary:

```sh
belte cli                              # build ./dist/cli
./dist/cli getPost --id=hello          # in-process — registry baked in
APP_URL=http://localhost:3000 ./dist/cli getPost --id=hello   # remote — manifest only
```

---

## CLI

```sh
bunx belte scaffold my-app    # copy the bundled template
belte dev                     # build + hot-reload
belte build                   # bundle the client into dist/_app/
belte start                   # run the prod server against dist/
belte compile [--target=…] [--out=…]                   # standalone server binary
belte cli     [--target=…] [--out=…] [--platforms=…]   # standalone CLI binary
```

`belte compile` defaults to your host target (`bun-darwin-arm64`, `bun-linux-x64`, …) and writes to `dist/app`.

`belte cli` is two-pass: a discovery build walks the rpc registry to bake a manifest, then `Bun.build({ compile })` emits the binary. `APP_URL` at build time decides thin vs full:

| `APP_URL` at build | Mode | Behavior                                                                       |
| ------------------ | ---- | ------------------------------------------------------------------------------ |
| unset              | full | every rpc module is bundled in. Runs in-process when `APP_URL` is unset at runtime, remote when it's set. |
| set                | thin | only the manifest is bundled. Requires `APP_URL` at runtime to reach the server. |

`--platforms=linux-x64,darwin-arm64,…` requires thin mode and emits `dist/cli-thin/<platform>/<programName>` — the layout the server's `/__belte/cli/<platform>` download endpoint expects. Users install via:

```sh
curl -fsSL https://your-app.example/__belte/cli | sh
```

**Debug logging** (read from `.env` automatically):

- `DEBUG=belte:*` — per-request log line
- `DEBUG=belte:trace` — per-request timing table

---

## Project layout

```
src/
  pages/                   # page.svelte / layout.svelte; folder path = URL
  server/
    rpc/                   # one rpc per file → /rpc/<filename>
    sockets/               # one topic per file → /__belte/sockets multiplex
    mcp.ts                 # optional: custom createMcpServer call
  app.ts                   # optional: init / handle / handleError
  app.html, app.css        # optional shell and CSS
```

| Alias       | Resolves to            |
| ----------- | ---------------------- |
| `$pages/…`  | `src/pages/…`          |
| `$rpc/…`    | `src/server/rpc/…`     |
| `$sockets/…`| `src/server/sockets/…` |
| `$lib/…`    | `src/lib/…`            |

## Pages and layouts — `src/pages/`

- Every page is a folder containing `page.svelte`. Folder path becomes the URL.
- Dynamic segments `[id]` and `[...rest]` are spread onto the page as individual props; the typed shape lands in `src/.belte/routes.d.ts`.
- Layouts are **nearest-only**: the deepest matching `layout.svelte` runs. Nested layouts *replace* ancestors — they don't stack. To inherit chrome, extract a snippet and `{@render}` it from each layout.
- Pages and layouts both run during SSR *and* on the client during navigation.

```svelte
<!-- src/pages/posts/[id]/page.svelte -->
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getPost } from '$rpc/getPost.ts'
let { id }: { id: string } = $props()
const post = $derived(await cache(getPost, { key: ['post', id] })({ id }))
</script>
<h1>{post.title}</h1>
```

## App hooks — `src/app.ts`

Every export is optional. Resolved at build time via the `belte:app` virtual module — no import from your code.

| Export        | Runs                                                                |
| ------------- | ------------------------------------------------------------------- |
| `init`        | once after `Bun.serve` boots. Return a cleanup for SIGINT/SIGTERM.  |
| `handle`      | middleware wrapping the request pipeline (`next(request)` invokes). |
| `handleError` | 500 fallback. Replaces belte's default stack-trace response.        |

```ts
import type { AppModule } from 'belte/server/AppModule'

export const handle: AppModule['handle'] = async (request, next) => {
    const response = await next(request)
    response.headers.set('x-server', 'belte')
    return response
}
```

WebSocket upgrades aren't exposed here — they're owned by the socket hub at `/__belte/sockets`.

## MCP server — `src/server/mcp.ts`

Optional. Default-export an `McpServer` to customise the MCP endpoint at `POST /__belte/mcp`. Without this file, the framework constructs a zero-arg `createMcpServer()` and uses package.json for `name` and `version`.

```ts
import { createMcpServer } from 'belte/mcp/createMcpServer'
import { HttpError } from 'belte/server/HttpError'
import { request } from 'belte/server/request'

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

| Option      | Default                          | Effect                                                                |
| ----------- | -------------------------------- | --------------------------------------------------------------------- |
| `name`      | `package.json` name              | server identity in the MCP `initialize` response                      |
| `version`   | `package.json` version           | server identity in the MCP `initialize` response                      |
| `authorize` | `undefined`                      | called once per MCP request before any tool/resource dispatch. Throw to reject. |

Per-tool authorization stays in the underlying rpc handler — same code path as the HTTP route.

## HTML shell — `src/app.html`

Optional. Three comment markers are replaced per render:

- `<!--ssr:head-->` — Svelte-emitted head (title, meta, link tags)
- `<!--ssr:body-->` — rendered page body
- `<!--ssr:state-->` — cache snapshot + route info for hydration

## Project config

```js
// svelte.config.js — opt in to top-level await inside components
/** @type {import('belte').SvelteConfig} */
export default { compilerOptions: { experimental: { async: true } } }
```

```json
// tsconfig.json — strict/lib/module inherited; paths declared inline
{
    "extends": "belte/tsconfig",
    "include": ["src/**/*.ts", "src/**/*.svelte"],
    "compilerOptions": {
        "paths": {
            "$pages": ["./src/pages"],
            "$pages/*": ["./src/pages/*"],
            "$rpc": ["./src/server/rpc"],
            "$rpc/*": ["./src/server/rpc/*"],
            "$sockets": ["./src/server/sockets"],
            "$sockets/*": ["./src/server/sockets/*"],
            "$lib": ["./src/lib"],
            "$lib/*": ["./src/lib/*"]
        }
    }
}
```

Inherits `strict`, `target: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, and `types: ["bun"]`. Paths are declared inline per project because Bun (1.3.x) doesn't substitute `${configDir}` in `paths` inherited via `extends`. Override anything else by adding to `compilerOptions` — extending merges.

---

## `belte/server`

Everything declared on the server: rpcs, sockets, response helpers, request/server accessors.

### RPC

- One file per rpc under `src/server/rpc/`. Filename = export name = URL path under `/rpc/`.
- The imported verb (`GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD`) picks the HTTP method.
- Folders become URL segments (`src/server/rpc/users/getUser.ts` → `/rpc/users/getUser`).
- URLs are flat — no `[name]` segments. Pass identifiers via args.
- Wrong verb on a known URL returns `405` with an `Allow` header.

| Verb                  | Args parsed from                              |
| --------------------- | --------------------------------------------- |
| `GET / DELETE / HEAD` | URL search params                             |
| `POST / PUT / PATCH`  | JSON body or `FormData` (query overrides)     |

```ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'
import { error } from 'belte/server/error'

export const getPost = GET(({ id }: { id: string }) => {
    const post = db.posts.get(id)
    if (!post) return error(404, 'post not found')
    return json(post)
})
```

`Return` is inferred from the handler's body via a `TypedResponse<T>` brand on `json` / `error` / `redirect` / `jsonl` / `sse`. Bare `new Response(...)` is still assignable; it falls back to `Return = unknown`. Use `GET<Args, Return>(...)` to override.

### `.raw` and `.stream(args?)` — every rpc

Every rpc function has two siblings on its value, available wherever the rpc is imported (server, browser, another rpc):

| Sibling           | Returns                                  | Use when                                   |
| ----------------- | ---------------------------------------- | ------------------------------------------ |
| `fn.raw(args?)`   | `Promise<Response>` (raw, undecoded)     | you need headers / status / streaming body |
| `fn.stream(args?)`| `Subscribable<Return>`                   | iterating SSE/JSONL frames, or piping into `subscribe()` |

```ts
const res = await getDownload.raw({ id })
for await (const chunk of res.body) { /* … */ }

for await (const tick of tickFeed.stream()) { /* … */ }
```

`.raw` composes with `cache()` — `cache(fn.raw)` shares the same cache key as `cache(fn)`. `.stream(args)` composes with `subscribe()` (see [`belte/browser`](#beltebrowser)).

### Schema validation + client exposure

Every verb helper accepts `{ schema, clients? }` as a second argument. Any [Standard Schema](https://standardschema.dev)-compatible value works (zod, valibot, arktype, …). Failed inbound validation → `422` + `{ issues }`. Schema + library are server-only — the client bundle never sees zod.

```ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { z } from 'zod'

const schema = z.object({ title: z.string().min(1), body: z.string() })
export const createPost = POST(({ title, body }) => json({ id: crypto.randomUUID() }), { schema })
```

`Args` on the caller infer from `InferInput`; the handler receives `InferOutput`. Generic order is `<Return, Schema>` so `POST<MyReturn>(fn, { schema })` overrides `Return` while letting `Schema` infer.

A schema also gates the non-browser surfaces. Defaults:

| `clients:` key | Default                         | Override                                       |
| -------------- | ------------------------------- | ---------------------------------------------- |
| `browser`      | `true`                          | `{ clients: { browser: false } }`              |
| `mcp`          | `true` when `schema` is present | `{ clients: { mcp: false } }` (or no schema)   |
| `cli`          | `true` when `schema` is present | `{ clients: { cli: false } }` (or no schema)   |

### Response helpers

| Helper            | Content-Type            | Notes                                              |
| ----------------- | ----------------------- | -------------------------------------------------- |
| `json(data)`      | `application/json`      | thin wrapper over `Response.json` with rpc defaults |
| `error(status, msg?)` | `text/plain`        | message verbatim; status reason if omitted         |
| `redirect(url, status?)` | `Location` header | default `302`                                    |
| `sse(iterable)`   | `text/event-stream`     | one event per yielded frame + 15s keepalive        |
| `jsonl(iterable)` | `application/jsonl`     | one line per yielded frame                         |

All set `Cache-Control: no-store` unless overridden. `sse` and `jsonl` translate consumer cancellation into `iterator.return()`, so `finally` blocks run.

```ts
import { GET } from 'belte/server/GET'
import { sse } from 'belte/server/sse'

export const tickFeed = GET(() =>
    sse((async function* () {
        for (let n = 1; ; n++) { yield { n }; await Bun.sleep(1000) }
    })()),
)
```

For broadcast fan-out across many subscribers, declare a [socket](#sockets) instead — sockets multiplex onto one ws and replay history.

### `request()` and `server()`

- `request()` — inbound `Request` for the SSR pass or rpc handler in flight. Throws outside a request scope.
- `server()` — live `Bun.Server`. Throws before `Bun.serve` has booted.

```ts
import { request } from 'belte/server/request'
import { server } from 'belte/server/server'

const cookie = request().headers.get('cookie')
const port = server().port
```

### `HttpError`

Thrown by rpc calls on non-2xx. Carries `status`, `statusText`, `response`. Also accepted as `throw new HttpError(...)` inside a handler.

Re-exported from `belte/browser` so client-side catch handlers can import it without pulling the server runtime into the bundle:

```ts
// server handler
import { HttpError } from 'belte/server/HttpError'

// page / layout
import { HttpError } from 'belte/browser/HttpError'

try { await getPost({ id }) }
catch (err) {
    if (err instanceof HttpError && err.status === 404) { /* … */ }
    throw err
}
```

### HTTP cache-control defaults

| Response                                                     | Header                                       |
| ------------------------------------------------------------ | -------------------------------------------- |
| Hashed bundles/chunks under `/_app/`                         | `public, max-age=31536000, immutable`        |
| Other static assets under `/_app/`                           | `public, max-age=0, must-revalidate`         |
| SSR HTML / JSON                                              | `private, no-cache`                          |
| Errors (404 / 405 / 500)                                     | `no-store`                                   |
| `/__belte/mcp`, `/__belte/cli`                               | `no-store`                                   |

Override per response via the helper's `init` arg. Pre-gzipped siblings are streamed when the client sends `Accept-Encoding: gzip`.

### Sockets

- One topic per file under `src/server/sockets/`.
- A `Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await (const m of chat)` and `chat.publish(m)` work identically on the server and in the browser. The bundler swaps the runtime per build target (in-process fan-out on the server, ws proxy on the client).
- Every socket multiplexes onto one ws per client at `/__belte/sockets`.
- Steady-state fan-out rides Bun's `server.publish`, so chatty topics don't iterate JS per message per client.

```ts
import { socket } from 'belte/server/socket'
import { z } from 'zod'

export type ChatMessage = { id: string; from: string; text: string; at: number }
const schema = z.object({ id: z.string(), from: z.string(), text: z.string(), at: z.number() })
export const chat = socket<ChatMessage>({ history: 100, schema })
```

| Option         | Default     | Effect                                                                       |
| -------------- | ----------- | ---------------------------------------------------------------------------- |
| `history`      | `0`         | buffer last *N* messages for replay                                          |
| `ttl`          | `undefined` | per-frame max age in ms; entries older than `ttl` are evicted before replay  |
| `clientPublish`| `false`     | when `true`, browser publishes are forwarded server-side                     |
| `schema`       | `undefined` | validates `publish()` payloads synchronously; auto-exposes to MCP            |
| `clients`      | (derived)   | same shape as rpc — schema flips on `mcp` by default                         |

#### Iteration

```ts
for await (const m of chat)       { /* full history replay, then tail */ }
for await (const m of chat.tail())   { /* no replay — only live */ }
for await (const m of chat.tail(20)) { /* last 20 (clamped to history), then live */ }
```

Iteration auto-closes when `return()` runs (`break` out of `for await`).

#### Publishing

`publish` is isomorphic. From the browser it only works if `clientPublish: true`. For validated/auth'd publishes, gate through an HTTP rpc:

```ts
// src/server/rpc/publishChat.ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'
import { error } from 'belte/server/error'
import { type ChatMessage, chat } from '$sockets/chat.ts'

export const publishChat = POST(({ from, text }: { from: string; text: string }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})
```

---

## `belte/browser`

The html-browser consumer surface — direct rpc calls, the `cache` and `subscribe` reactive consumers, and SPA navigation.

### Direct rpc calls

Calling an rpc directly resolves to the decoded body:

| Content-Type       | Decoded as |
| ------------------ | ---------- |
| `application/json` | object     |
| `text/*`           | `string`   |
| binary             | `Blob`     |
| `204 No Content`   | `undefined`|

Non-2xx throws `HttpError`. Args go on the query string for `GET`/`DELETE`/`HEAD`, JSON body for the rest.

```ts
import { getPost } from '$rpc/getPost.ts'
const post = await getPost({ id: 'abc' })
```

Each rpc also exposes `.url` and `.method`, so plain forms and `fetch` work:

```svelte
<form action={createPost.url} method={createPost.method}>…</form>
```

### `cache(fn, options?)`

Wraps a direct rpc call with three things on top: **dedupe**, **SSR snapshot**, **reactivity**.

```ts
import { cache } from 'belte/browser/cache'
const session = await cache(getSession)()
```

| Option | Type                          | Effect                                                                 |
| ------ | ----------------------------- | ---------------------------------------------------------------------- |
| `ttl`  | `undefined` (default)         | live forever                                                           |
| `ttl`  | `0`                           | dedupe in-flight only — drop once promise settles                      |
| `ttl`  | `number` (ms)                 | expire after resolve                                                   |
| `key`  | `string` / `unknown[]`        | override the auto key (e.g. `{ key: ['post', id] }`)                   |

```ts
cache(getNow, { ttl: 0 })()
cache(searchPosts, { key: 'posts' })({ q })
```

`cache(fn.raw)` memoises the underlying `Response` against the same key as `cache(fn)`.

### Reactive reads + invalidation

Wrap `cache()` in `$derived` to subscribe; mutate via plain rpc call, then invalidate.

```svelte
<script lang="ts">
import { cache } from 'belte/browser/cache'
import { getCounter } from '$rpc/getCounter.ts'
import { incrementCounter } from '$rpc/incrementCounter.ts'

const counter = $derived(cache(getCounter)())
async function bump() { await incrementCounter(); cache.invalidate(getCounter) }
</script>

{#await counter}…{:then { count }}<p>{count}</p>{/await}
<button onclick={bump}>+1</button>
```

| `cache.invalidate(arg)` | Drops                                              |
| ----------------------- | -------------------------------------------------- |
| `(fn)`                  | every entry for that rpc, any args                 |
| `(key)`                 | the specific key (paired with `cache(fn, { key })`)|
| `()`                    | the whole store                                    |

### `subscribe(source)`

Reactive consumer for any `Subscribable<T>` — a `Socket<T>` or `fn.stream(args)`. First read in a tracking scope opens the underlying iterator; last reader closes it. Multiple `$deriveds` on the same source share one subscription.

```svelte
<script lang="ts">
import { subscribe } from 'belte/browser/subscribe'
import { chat } from '$sockets/chat.ts'
import { tickFeed } from '$rpc/tickFeed.ts'

const message = $derived(subscribe(chat))                // socket
const tick    = $derived(subscribe(tickFeed.stream()))   // rpc stream
const status  = $derived(subscribe.status(chat))         // 'pending' | 'open' | 'done' | 'error'
const error   = $derived(subscribe.error(chat))          // Error | undefined
</script>
```

- Errors surface via `subscribe.error(source)` — reading `latest` from a `$derived` can't crash the component.
- `subscribe` is a no-op on the server. Seed the initial paint with `cache()`, then layer `subscribe()` on top for live updates.

### `page` + `navigate`

`page` is a reactive `{ route, params, url }`. Reading any field inside `$derived` / `$effect` subscribes that scope.

```ts
import { page } from 'belte/browser/page'
import { navigate } from 'belte/browser/navigate'

const isActive = (href: string) => page.url.pathname === href
if (page.route === '/posts/[id]') page.params.id   // typed as string

navigate('/posts/2')
navigate('/login', { replace: true })
```

Same-pathname navigations (hash / search only) skip the fetch and just refresh `page.url`. Network errors or unknown routes fall back to a full page load.

### Request lifecycle

```
request
  ↓
src/app.ts handle?             middleware (optional)
  ↓
pages/.../layout.svelte        nearest layout — runs top-level await cache(fn)()
  ↓
pages/<path>/page.svelte       page — also runs await cache(fn)()
  ↓
serialize cache snapshot       entries JSON'd into <script>window.__SSR__</script>
  ↓
HTML to client
  ↓
hydration                      client cache loads from __SSR__ — no second fetch
  ↓
$derived(cache(fn)())          subscribes; cache.invalidate re-runs every subscriber
$derived(subscribe(source))    opens after hydration (socket: ws replay+tail; rpc: fetch loop)
```

---

## `belte/mcp`

Server-only namespace. Auto-mounted at `POST /__belte/mcp` (JSON-RPC 2.0, MCP protocol `2025-06-18`). The default behavior works zero-config; provide `src/server/mcp.ts` to customise.

### Tool + resource derivation

Every rpc with `clients.mcp` becomes one tool named after its export. Every socket with `clients.mcp` contributes:

| Derived from socket   | Kind     | What it does                                                               |
| --------------------- | -------- | -------------------------------------------------------------------------- |
| `await_<name>`        | tool     | blocks for the next published entry (default `30000ms` timeout via `timeoutMs`) |
| `publish_<name>`      | tool     | only when `clientPublish: true` — publishes a validated payload            |
| `belte://stream/<name>` | resource | latest history window as JSON                                              |

Schemas attached to verbs and sockets are rendered as the tool's `inputSchema` (Standard Schema → JSON Schema). Without a schema, the surface stays off.

### Auth forwarding

Inbound MCP requests forward `cookie`, `authorization`, `x-forwarded-for`, `x-forwarded-proto` headers onto every synthesized rpc request, so existing session/bearer middleware in `src/app.ts` keeps working unchanged. The optional `authorize` hook on `createMcpServer` runs once per envelope before any dispatch.

Tool calls go through the **same** `verb.fetch` code path as the HTTP route — validation, response helpers, and error mapping behave identically.

### `createMcpServer(opts?)`

Returns `{ handle(request: Request): Promise<Response> }`. The framework calls `handle` for every `POST /__belte/mcp` request. Options are documented in [MCP server — `src/server/mcp.ts`](#mcp-server--srcservermcpts).

### Streaming caveat

MCP gets single-shot `await_<name>` plus snapshot resources — not a live subscription. Real-time fan-out stays on the ws multiplex for now.

---

## `belte/cli`

Server-only namespace covering the in-process / remote rpc client and the standalone CLI binary toolchain.

### `createClient<Api>(opts?)`

Typed proxy over the project's rpcs. Modes are chosen at construction:

| Option       | Mode        | Behavior                                                                  |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| `url`        | remote      | each call hits `<url>/<manifest[name].url>` over `fetch`                  |
| no `url`     | in-process  | looks up the verb in the registry, calls `verb.fetch(synthesized)` — no network |
| `token`      | both        | sets `authorization: Bearer <token>` on the synthesized request           |
| `manifest`   | both        | the bundler-emitted CLI manifest; in-process falls back to the live registry |

```ts
// scripts/seed.ts
import { createClient } from 'belte/cli/createClient'
import { createPost } from '$rpc/createPost.ts'   // forces the registry to populate
void createPost                                   // referenced so the import isn't tree-shaken

const client = createClient<{ createPost: (args: { title: string; body: string }) => Promise<{ id: string }> }>()
await client.createPost({ title: 'Hi', body: 'World' })
```

### Standalone binary

`belte cli` packages the same client surface into a downloadable executable. Argv parses against each rpc's JSON Schema; required fields become required args, optional fields become flags.

```sh
myapp getPost --id=abc           # GET /rpc/getPost?id=abc
myapp createPost --title='...' --body='...'   # POST /rpc/createPost
myapp --help
myapp getPost --help
```

`.env` next to the binary is auto-loaded — set `APP_URL` and `APP_TOKEN` there to point a thin binary at a deployed server.

### Server-side install endpoint

`createServer` registers two routes for the CLI:

| Route                          | Returns                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `GET /__belte/cli`             | shell installer that detects `uname`, downloads the right platform tarball, drops the binary into `$BELTE_INSTALL_DIR` (default `~/.local/bin`) |
| `GET /__belte/cli/<platform>`  | gzipped tarball containing the thin binary + an `.env` with the request's origin as `APP_URL` |

The first request triggers a `belte cli --platforms=…` build if needed; concurrent requests dedupe onto one build. Pre-build into `dist/cli-thin/` to skip the on-demand step.

### Streaming caveat

CLI commands cover the request/response surface only — sockets, `sse`, and `jsonl` rpcs aren't reachable from the binary yet. Plain `await` on a streaming verb will return an unreadable `Response` body; use the browser or MCP surface for those.
