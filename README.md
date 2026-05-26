# belte

A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev).

| Section | What it covers |
| --- | --- |
| [Bets](#bets) | the four foundational decisions |
| [Examples](#examples) | barebones, scaffold, kitchen-sink |
| [The four bets](#the-four-bets) | each bet expanded with a snippet |
| [A complete app on one screen](#a-complete-app-on-one-screen) | minimal layout + page + rpc + `package.json` |
| [CLI](#cli) | `bunx belte scaffold` and the in-project commands |
| [Project layout](#project-layout) | folder tree + path aliases |
| [Pages and layouts](#pages-and-layouts--srcpages) | `page.svelte` / `layout.svelte`, nearest-only layouts, dynamic segments |
| [App hooks](#app-hooks--srcappts) | `init` / `handle` / `handleError` |
| [HTML shell](#html-shell--srcapphtml) | three SSR markers |
| [Project config](#project-config) | `svelte.config.js`, `tsconfig` extending `belte/tsconfig` |
| [`belte/server`](#belteserver) | rpc verbs, response helpers, sockets, `request` / `server`, `HttpError`, cache-control defaults |
| [`belte/browser`](#beltebrowser) | direct calls, `cache`, `subscribe`, `page` / `navigate`, `HttpError`, request lifecycle |

## Bets

1. **Isomorphism by default** — same callable, both sides. The bundler swaps the runtime; user code never branches on `typeof window`.
2. **Framework owns the network** — one rpc URL shape, one ws multiplex, two reactive consumers (`cache` for request/response, `subscribe` for streams).
3. **One runtime, dev → prod → binary** — every CLI mode runs on the same `Bun.serve`. No Node, no Vite.
4. **Two flat umbrellas per side** — `belte/server` (everything declared on the server) and `belte/browser` (the html consumer). Future siblings (`belte/cli`, `belte/mcp`) plug in without growing the server side.

## Examples

- [`examples/barebones`](examples/barebones) — one `page.svelte`.
- [`examples/scaffold`](examples/scaffold) — output of `bunx belte scaffold`, one of every file type.
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, rpcs, sockets, `cache`, invalidation, Tailwind, cookie-session auth.

---

## The four bets

### Isomorphism by default

```ts
// src/server/rpc/getPost.ts
import { GET, json } from 'belte/server'
export const getPost = GET(({ id }: { id: string }) => json({ title: `Post ${id}` }))
```

```ts
// anywhere — page, layout, another rpc, the browser
import { getPost } from '$rpc/getPost.ts'
const post = await getPost({ id: 'abc' })
```

Sockets work the same way — one declaration, isomorphic `publish` and async iteration:

```ts
// src/server/sockets/chat.ts
import { socket } from 'belte/server'
export const chat = socket<ChatMessage>({ history: 100 })
```

### Framework owns the network

| Concern             | Shape                                              |
| ------------------- | -------------------------------------------------- |
| RPC URL             | `/rpc/<filename>` (flat — no `[id]` segments)      |
| WebSocket           | one `/__belte/sockets` multiplexed per client      |
| Reactive (req/resp) | `$derived(cache(fn)(args))` — re-runs on invalidate |
| Reactive (stream)   | `$derived(subscribe(source))` — re-runs per frame  |

Plain HTML still works — every rpc has `.url` and `.method`, so `<form action={createPost.url} method={createPost.method}>` and `fetch(getPost.url)` are first-class.

### One runtime, dev → prod → binary

| Command         | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| `belte dev`     | bundle + `bun --hot` the server entry                        |
| `belte build`   | bundle the client into `dist/_app/` (gzip siblings included) |
| `belte start`   | run the server entry against `dist/`                         |
| `belte compile` | build + `Bun.build({ compile })` → standalone binary         |

`belte compile` embeds the gzipped client assets into the binary — no on-disk dependency on `dist/`.

### Two flat umbrellas per side

```ts
// server side
import {
    GET, POST, PUT, PATCH, DELETE, HEAD,
    socket,
    json, error, redirect, sse, jsonl,
    request, server, HttpError,
} from 'belte/server'

// browser side
import { page, navigate, cache, subscribe, HttpError } from 'belte/browser'
```

`belte/server` is the only thing `src/server/**` imports from belte; `belte/browser` is the only thing `src/pages/**` imports. Future consumer modules (`belte/cli`, `belte/mcp`) sit alongside `belte/browser`.

---

## A complete app on one screen

```svelte
<!-- src/pages/layout.svelte -->
<script lang="ts">
import '../app.css'
let { children }: { children: import('svelte').Snippet } = $props()
</script>
<header><a href="/">Home</a></header>
<main>{@render children()}</main>
```

```svelte
<!-- src/pages/page.svelte -->
<script lang="ts">
import { cache } from 'belte/browser'
import { getPost } from '$rpc/getPost.ts'
const post = await cache(getPost)({ id: 'hello' })
</script>
<h1>{post.title}</h1>
```

```ts
// src/server/rpc/getPost.ts
import { GET, json } from 'belte/server'
export const getPost = GET(({ id }: { id: string }) => json({ title: `Post ${id}` }))
```

```json
// package.json
{ "scripts": { "dev": "belte dev" }, "dependencies": { "belte": "^0.0.1", "svelte": "^5.0.0" } }
```

```sh
bun install && bun run dev
```

---

## CLI

```sh
bunx belte scaffold my-app    # copy the bundled template
belte dev                     # build + hot-reload
belte build                   # bundle the client into dist/_app/
belte start                   # run the prod server against dist/
belte compile [--target=…] [--out=…]   # standalone binary
```

`belte compile` defaults to your host target (`bun-darwin-arm64`, `bun-linux-x64`, …) and writes to `dist/app`.

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
import { cache } from 'belte/browser'
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
import type { AppModule } from 'belte/server'

export const handle: AppModule['handle'] = async (request, next) => {
    const response = await next(request)
    response.headers.set('x-server', 'belte')
    return response
}
```

WebSocket upgrades aren't exposed here — they're owned by the socket hub at `/__belte/sockets`.

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
// tsconfig.json — strict/lib/module + the four aliases are inherited
{
    "extends": "belte/tsconfig",
    "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

Inherits `strict`, `target: ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `types: ["bun"]`, and the four path aliases (`$pages` / `$rpc` / `$sockets` / `$lib`, resolved via `${configDir}` against your project root). Override anything by adding a `compilerOptions` of your own — extending merges.

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
import { GET, json, error } from 'belte/server'

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

### Schema validation

Every verb helper accepts `{ schema }` as a second argument. Any [Standard Schema](https://standardschema.dev)-compatible value works (zod, valibot, arktype, …). Failed inbound validation → `422` + `{ issues }`. Schema + library are server-only — the client bundle never sees zod.

```ts
import { POST, json } from 'belte/server'
import { z } from 'zod'

const schema = z.object({ title: z.string().min(1), body: z.string() })
export const createPost = POST(({ title, body }) => json({ id: crypto.randomUUID() }), { schema })
```

`Args` on the caller infer from `InferInput`; the handler receives `InferOutput`. Generic order is `<Return, Schema>` so `POST<MyReturn>(fn, { schema })` overrides `Return` while letting `Schema` infer.

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
import { GET, sse } from 'belte/server'

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
import { request, server } from 'belte/server'

const cookie = request().headers.get('cookie')
const port = server().port
```

### `HttpError`

Thrown by rpc calls on non-2xx. Carries `status`, `statusText`, `response`. Also accepted as `throw new HttpError(...)` inside a handler.

Re-exported from `belte/browser` so client-side catch handlers can import it without pulling the server runtime into the bundle:

```ts
// server handler
import { HttpError } from 'belte/server'

// page / layout
import { HttpError } from 'belte/browser'

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

Override per response via the helper's `init` arg. Pre-gzipped siblings are streamed when the client sends `Accept-Encoding: gzip`.

### Sockets

- One topic per file under `src/server/sockets/`.
- A `Socket<T>` is an isomorphic `AsyncIterable<T>` — `for await (const m of chat)` and `chat.publish(m)` work identically on the server and in the browser. The bundler swaps the runtime per build target (in-process fan-out on the server, ws proxy on the client).
- Every socket multiplexes onto one ws per client at `/__belte/sockets`.
- Steady-state fan-out rides Bun's `server.publish`, so chatty topics don't iterate JS per message per client.

```ts
import { socket } from 'belte/server'
export type ChatMessage = { id: string; from: string; text: string; at: number }
export const chat = socket<ChatMessage>({ history: 100 })
```

| Option         | Default     | Effect                                                                       |
| -------------- | ----------- | ---------------------------------------------------------------------------- |
| `history`      | `0`         | buffer last *N* messages for replay                                          |
| `ttl`          | `undefined` | per-frame max age in ms; entries older than `ttl` are evicted before replay  |
| `clientPublish`| `false`     | when `true`, browser publishes are forwarded server-side                     |

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
import { POST, json, error } from 'belte/server'
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

The html-browser consumer surface — direct rpc calls, the `cache` and `subscribe` reactive consumers, and SPA navigation. Future siblings (`belte/cli`, `belte/mcp`) plug in without changing `belte/server`.

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
import { cache } from 'belte/browser'
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
import { cache } from 'belte/browser'
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
import { subscribe } from 'belte/browser'
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
import { page, navigate } from 'belte/browser'

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
