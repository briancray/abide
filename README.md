# belte

A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev).

Belte is built around four bets:

1. **Isomorphism by default** — the same callable runs on both sides. The bundler swaps the runtime per build target; user code never branches on `typeof window`.
2. **Framework owns the network** — one rpc URL shape, one websocket multiplex, one way to consume streams. No parallel "raw" escape hatches that fragment the model.
3. **One runtime, dev → prod → binary** — `belte dev`, `belte build`, `belte start`, `belte compile` all run on the same `Bun.serve` under the hood. No Node, no Vite, no separate bundler runtime.
4. **Exports grouped by lifecycle phase** — `belte/rpc` (declare) → `belte/response` (reply) → `belte/cache` (consume). New helpers go in the phase they belong to.

Working examples live in [`examples/`](examples):

- [`examples/barebones`](examples/barebones) — the smallest possible app (just a single `page.svelte`).
- [`examples/scaffold`](examples/scaffold) — the output of `bunx belte scaffold` — one of every file type with comments.
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, remote functions, `cache()`, live invalidation, streaming, Tailwind, and a cookie-session auth flow with a protected route.

---

## The four bets

### Isomorphism by default

One file declares the function, one identifier calls it. The bundler swaps the runtime: direct call on the server, typed `fetch` on the client.

```ts
// src/rpc/getPost.ts
import { GET } from 'belte/rpc'
import { json } from 'belte/response'

export const getPost = GET<{ id: string }, { title: string; body: string }>(
    ({ id }) => json(db.posts.get(id)),
)
```

```ts
// anywhere — page <script>, layout, another rpc, the browser
import { getPost } from '$rpc/getPost.ts'

const post = await getPost({ id: 'abc' })
```

The same is true for streams. A `SOCKET` rpc is an async generator; consumers iterate it the same way regardless of transport.

```ts
// src/rpc/orderFeed.ts
import { SOCKET } from 'belte/rpc'

export const orderFeed = SOCKET<{ customerId: string }, Order>(async function* ({ customerId }) {
    for await (const order of db.watchOrders(customerId)) {
        yield order
    }
})
```

### Framework owns the network

There is exactly one shape for an rpc URL (`/rpc/<filename>`), one websocket (`/__belte/socket`) that multiplexes every `SOCKET` rpc, and one reactive consumer (`subscribe`) that works against HTTP one-shots, SSE, JSONL, and websockets uniformly.

```ts
import { subscribe } from 'belte/cache'

// works the same against an SSE/JSONL handler or a SOCKET handler
const latest = $derived(subscribe(orderFeed)({ customerId }))
```

Plain HTML keeps working — every remote function exposes `.url` and `.method`, so `<form action={createPost.url} method="POST">` and `fetch(getPost.url)` are first-class.

### One runtime, dev → prod → binary

```sh
belte dev          # bundle, then `bun --hot` the server entry
belte build        # bundle the client into dist/_app/ (gzip siblings included)
belte start        # run the server entry against dist/
belte compile      # build + Bun.build({ compile }) → standalone binary
```

Every mode boots through the same code path. `belte compile` produces a single binary that embeds your gzipped client assets — no on-disk dependency on `dist/`.

### Exports grouped by lifecycle phase

The three modules you'll reach for from user code map to the three phases of a request:

```ts
import { GET, SOCKET }  from 'belte/rpc'        // declare
import { json, sse }    from 'belte/response'   // reply
import { cache, subscribe } from 'belte/cache'  // consume
```

Find the phase, find the helper.

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
import { cache } from 'belte/cache'
import { getPost } from '$rpc/getPost.ts'

const post = await cache(getPost)({ id: 'hello' })
</script>

<h1>{post.title}</h1>
<p>{post.body}</p>
```

```ts
// src/rpc/getPost.ts
import { GET } from 'belte/rpc'
import { json } from 'belte/response'

export const getPost = GET<{ id: string }, { title: string; body: string }>(
    ({ id }) => json({ title: `Post ${id}`, body: '...' }),
)
```

```ts
// src/rpc/createPost.ts
import { POST } from 'belte/rpc'
import { json } from 'belte/response'

export const createPost = POST<{ title: string; body: string }, { id: string }>(
    async (args) => json({ id: crypto.randomUUID() }, { status: 201 }),
)
```

```json
{
    "name": "my-app",
    "type": "module",
    "scripts": { "dev": "belte dev", "build": "belte build", "start": "belte start" },
    "dependencies": { "belte": "^0.0.1", "svelte": "^5.0.0" }
}
```

```sh
bun install
bun run dev
```

---

## CLI

### Scaffold a new project

```sh
bunx belte scaffold my-app
cd my-app
bun install
bun run dev
```

`bunx belte scaffold` copies belte's bundled template (the same files as [`examples/scaffold`](examples/scaffold)) into a new directory. The target must not exist or must be empty.

### In an existing project

Inside a project that depends on `belte`, the package binary is on `PATH` under `bun run`:

```sh
belte dev                    # build, then `bun --hot` the server entry
belte build                  # bundle the client into dist/_app/ (gzip siblings included)
belte start                  # run the server entry against dist/
belte compile [--target=…] [--out=…]
                             # build + Bun.build({ compile }) → standalone binary
```

`belte compile` defaults to your host target (`bun-darwin-arm64`, `bun-linux-x64`, etc.) and writes to `dist/app`.

### Debug logging

Bun reads `.env` automatically:

- `DEBUG=belte:*` — per-request log line
- `DEBUG=belte:trace` — per-request timing table (render, remote dispatch, middleware)

---

## Reference

The reference is grouped by the same three lifecycle phases as the imports.

- **[Declare](#declare)** — how routes, handlers, and app hooks get registered.
- **[Reply](#reply)** — what runs when a request lands.
- **[Consume](#consume)** — how the client reads, reacts, and navigates.

### Project layout

```
my-app/
  src/
    .belte/                     # generated: Routes type augmentation; gitignored
    pages/                      # all pages live here; every page is a folder
      page.svelte                 # GET /
      layout.svelte               # wraps every page below
      about/page.svelte           # GET /about
      posts/[id]/page.svelte      # GET /posts/:id (id is a $prop, typed via Routes)
    rpc/                        # all remote functions live here; one per file
      getHello.ts                 # GET /rpc/getHello   (GET)
      createUser.ts               # POST /rpc/createUser (POST)
      orderFeed.ts                # WS  /rpc/orderFeed   (SOCKET, over /__belte/socket)
    app.ts                      # optional: init / handle / handleError
    app.html                    # optional: HTML shell override
    app.css                     # any CSS, imported from a layout/page
  svelte.config.js              # optional Svelte compiler options
  tsconfig.json
  package.json
  .env                          # Bun reads this automatically (e.g. DEBUG=belte:*)
  dist/                         # produced by `belte build`
```

Three import aliases are wired through the bundler in every mode:

- `$pages/...` → `src/pages/...`
- `$rpc/...` → `src/rpc/...`
- `$lib/...` → `src/lib/...`

---

## Declare

How code gets registered with the framework. File-system + decorator-style imports.

### Pages — `src/pages/page.svelte`, `layout.svelte`

A page is a Svelte 5 component. Folder name becomes the URL: `src/pages/page.svelte` mounts at `/`, `src/pages/posts/[id]/page.svelte` mounts at `/posts/:id`. Dynamic segments (`[id]`, `[...rest]`) are spread onto the page as individual props; the typed shape is generated into `src/.belte/routes.d.ts` and surfaces as `Routes` on `belte/page`.

A layout wraps every page at or below its folder. Layouts compose root-to-leaf: a request for `/admin/users` runs `pages/layout.svelte` → `pages/admin/layout.svelte` → the page. Pages and layouts both run on the server during SSR and on the client during navigation.

**Barebones — `src/pages/page.svelte`**

```svelte
<h1>Hello from belte</h1>
```

**Full — `src/pages/posts/[id]/page.svelte`**

```svelte
<script lang="ts">
import { cache } from 'belte/cache'
import { getPost } from '$rpc/getPost.ts'

let { id }: { id: string } = $props()

/*
`cache(fn, { key })` scopes the entry under an explicit key so two posts
don't share one getPost entry. Wrapping inside `$derived` makes the value
re-resolve when `id` changes (navigating /posts/1 → /posts/2 without
remounting the Page).
*/
const post = $derived(await cache(getPost, { key: ['post', id] })({ id }))
</script>

<svelte:head><title>{post?.title ?? 'Not found'}</title></svelte:head>

{#if post}
    <article><h1>{post.title}</h1><p>{post.body}</p></article>
{:else}
    <p>No post with id {id}.</p>
{/if}
```

**Barebones — `src/pages/layout.svelte`**

```svelte
<script lang="ts">
import '../app.css'
let { children }: { children: import('svelte').Snippet } = $props()
</script>

<svelte:head><title>belte app</title></svelte:head>
<header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
<main>{@render children()}</main>
```

**Full — `src/pages/layout.svelte`**

```svelte
<script lang="ts">
import '../app.css'
import { cache } from 'belte/cache'
import { page } from 'belte/page'
import { getSession } from '$rpc/getSession.ts'
import { logout } from '$rpc/logout.ts'

let { children }: { children: import('svelte').Snippet } = $props()

const session = await cache(getSession)()

const linkClass = (href: string) =>
    page.url.pathname === href ? 'active' : ''
</script>

<header>
    <nav>
        <a href="/" class={linkClass('/')}>Home</a>
        <a href="/about" class={linkClass('/about')}>About</a>
        {#if session?.user}
            <span>{session.user}</span>
            <form method="POST" action={logout.url}><button type="submit">Log out</button></form>
        {:else}
            <a href="/login">Log in</a>
        {/if}
    </nav>
</header>
<main>{@render children()}</main>
```

### RPC modules — `src/rpc/<name>.ts`

Every file under `src/rpc/` exports exactly one remote function. The filename is both the URL path (under `/rpc/`) and the export name; the imported helper picks the HTTP verb or transport. Folders become URL segments — `src/rpc/users/getUser.ts` mounts at `/rpc/users/getUser`. Rpc URLs are flat: there are no `[name]` dynamic segments, pass identifiers via args.

| Helper                              | Transport                                | Returns                                          |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `GET / DELETE / HEAD`               | HTTP, args from URL search params        | `Response` — decoded body on the way out         |
| `POST / PUT / PATCH`                | HTTP, args from JSON body or `FormData`  | `Response` — decoded body on the way out         |
| `SOCKET`                            | Multiplexed websocket at `/__belte/socket` | `AsyncIterable<Frame>` — async generator handler |

The handler signature is `(args) => Response` for HTTP verbs and `async function* (args)` for `SOCKET`. Sending the wrong verb to an HTTP rpc URL returns `405` with an `Allow` header.

For raw `Request` access (binary bodies, custom headers, etc.) call `request()` from `belte/server` inside the handler — see [Reply](#reply).

**Barebones — `src/rpc/getHello.ts`**

```ts
import { GET } from 'belte/rpc'
import { json } from 'belte/response'

export const getHello = GET<undefined, { message: string }>(() =>
    json({ message: 'Hello from belte' }),
)
```

**Full — a CRUD-ish post resource**

```ts
// src/rpc/getPost.ts
import { GET } from 'belte/rpc'
import { json, error } from 'belte/response'
import { db } from '$lib/db.ts'

export const getPost = GET<{ id: string }, { title: string; body: string }>(({ id }) => {
    const post = db.posts.get(id)
    if (!post) {
        return error(404, 'post not found')
    }
    return json(post)
})
```

```ts
// src/rpc/createPost.ts
import { POST } from 'belte/rpc'
import { json } from 'belte/response'
import { db } from '$lib/db.ts'

export const createPost = POST<{ title: string; body: string }, { id: string }>(async (args) => {
    const id = await db.posts.insert(args)
    return json({ id }, { status: 201 })
})
```

```ts
// src/rpc/deletePost.ts
import { DELETE } from 'belte/rpc'
import { db } from '$lib/db.ts'

export const deletePost = DELETE<{ id: string }, undefined>(async ({ id }) => {
    await db.posts.delete(id)
    return new Response(null, { status: 204 })
})
```

**Streaming — `src/rpc/orderFeed.ts`**

```ts
import { SOCKET } from 'belte/rpc'
import { db } from '$lib/db.ts'

export const orderFeed = SOCKET<{ customerId: string }, Order>(async function* ({ customerId }) {
    for await (const order of db.watchOrders(customerId)) {
        yield order
    }
})
```

`SOCKET` rpcs ride a single framework-owned websocket per client at `/__belte/socket`. To expose a stream over plain HTTP instead (so `curl` / `EventSource` / `fetch` all work), use a verb helper and wrap the generator with `sse(...)` or `jsonl(...)` from `belte/response`.

### App hooks — `src/app.ts`

Optional application hooks. Every export is optional; delete the ones you don't need. Belte resolves this file at build time via the `belte:app` virtual module — no import is needed from your own code.

- `init` runs once after `Bun.serve` is up. Receives `{ server }` because it runs before any request. Optionally return a cleanup function that runs on SIGINT/SIGTERM.
- `handle` is middleware that wraps the default request pipeline (`next(request)` invokes it). Inside the handler, reach for the inbound `Request` via `request()` and the live `Server` via the `server` import from `belte/server`.
- `handleError` is your 500 fallback. Replaces belte's default stack-trace response.

WebSockets are not exposed here — belte's only native WebSocket surface is `SOCKET`-bound rpc.

**Barebones**

```ts
import type { AppModule } from 'belte/types/AppModule'

export const init: AppModule['init'] = ({ server }) => {
    console.log(`server listening on http://localhost:${server.port}`)
}

export const handle: AppModule['handle'] = async (request, next) => {
    return next(request)
}

export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong', { status: 500 })
}
```

**Full**

```ts
import type { AppModule } from 'belte/types/AppModule'
import { error } from 'belte/response'

export const init: AppModule['init'] = async ({ server }) => {
    await db.connect()
    console.log(`listening on http://localhost:${server.port}`)
    return async () => {
        await db.disconnect()
    }
}

export const handle: AppModule['handle'] = async (request, next) => {
    if (new URL(request.url).pathname.startsWith('/admin')) {
        if (!request.headers.get('authorization')) {
            return error(401, 'Unauthorized')
        }
    }
    const response = await next(request)
    response.headers.set('x-server', 'belte')
    return response
}

export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong', { status: 500 })
}
```

### HTML shell — `src/app.html`

Optional. If present, belte uses it as the SSR template; otherwise a default shell is used. Three comment markers are replaced per render:

- `<!--ssr:head-->` — head emitted by Svelte (`<svelte:head>` content, etc.)
- `<!--ssr:body-->` — rendered page body
- `<!--ssr:state-->` — cache snapshot + route info for hydration

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="/_app/client.css" />
<!--ssr:head-->
</head>
<body>
<div id="app"><!--ssr:body--></div>
<!--ssr:state-->
<script type="module" src="/_app/client.js"></script>
</body>
</html>
```

### CSS — `src/app.css`

Any CSS the app cares about. It isn't picked up automatically — import it once from a layout (typically the root `layout.svelte`) so it ships with every page. To enable Tailwind v4, add `bun-plugin-tailwind` and `tailwindcss` as devDependencies and replace this file with `@import "tailwindcss";`.

### Project config — `svelte.config.js`, `tsconfig.json`, `package.json`

```js
// svelte.config.js — opt in to top-level await inside components
/** @type {import('belte').SvelteConfig} */
export default {
    compilerOptions: {
        experimental: { async: true },
    },
}
```

```json
// tsconfig.json — teach the editor about the $pages / $rpc / $lib aliases
{
    "compilerOptions": {
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "lib": ["ESNext", "DOM", "DOM.Iterable"],
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "noEmit": true,
        "isolatedModules": true,
        "types": ["bun"],
        "paths": {
            "$pages": ["./src/pages"], "$pages/*": ["./src/pages/*"],
            "$rpc": ["./src/rpc"], "$rpc/*": ["./src/rpc/*"],
            "$lib": ["./src/lib"], "$lib/*": ["./src/lib/*"]
        }
    },
    "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

```json
// package.json
{
    "name": "my-app",
    "type": "module",
    "scripts": {
        "dev": "belte dev",
        "build": "belte build",
        "start": "belte start",
        "compile": "belte compile"
    },
    "dependencies": {
        "belte": "^0.0.1",
        "svelte": "^5.0.0"
    }
}
```

---

## Reply

What runs when a request lands. Helpers that shape a `Response`, see the inbound `Request`, or signal failure.

### `request()` — `belte/server`

The inbound `Request` for the SSR pass or rpc handler that's in flight. Backed by `AsyncLocalStorage`, so it works from anywhere inside the request scope (a page's `<script>`, a layout, a helper, an rpc handler) without having to thread `request` through every function. Throws if called outside a request scope (top-level module code, `init`, etc.).

```ts
import { request } from 'belte/server'

const cookie = request().headers.get('cookie')
const accept = request().headers.get('accept')
```

### `server` — `belte/server`

The live `Bun.Server` instance. Stable reference from module scope (it's a Proxy that resolves to the active server after boot), so you can import it once and use it from anywhere — request handlers, helper modules, anywhere a request scope isn't available. Throws on access before `Bun.serve` has finished booting.

```ts
import { server } from 'belte/server'

server.publish('chat', JSON.stringify(message))
console.log(`listening on :${server.port}`)
```

### `HttpError` — `belte/shared/HttpError`

Thrown by remote-function calls (and cached invokers) when the server responds with a non-2xx status. Carries `status`, `statusText`, and the raw `response` so callers can render context-aware error UI. The framework's `handleError` hook also catches `throw new HttpError(...)` from inside a handler, so the same type is the wire format on the way out and the typed error on the way in.

```ts
import { HttpError } from 'belte/shared/HttpError'

try {
    const post = await getPost({ id })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) {
        // show a not-found state
    }
    throw err
}
```

### `belte/response` — `json` / `error` / `redirect` / `sse` / `jsonl`

Response constructors with rpc-friendly defaults. All five set `Cache-Control: no-store` unless the caller overrides it — intermediary caches shouldn't memoise rpc replies; the framework's per-request cache handles in-process dedupe.

```ts
import { json, error, redirect, sse, jsonl } from 'belte/response'

json({ ok: true })                 // application/json
json({ ok: true }, { status: 201 })
error(404, 'order not found')      // text/plain with the message verbatim
error(500)                         // standard reason phrase as the body
redirect('/login')                 // 302 with Location: /login
redirect('/articles/1', 301)       // permanent
```

`sse` and `jsonl` wrap an `AsyncIterable<Frame>` in a streaming response — `text/event-stream` for `sse`, `application/jsonl` for `jsonl`. Both translate consumer cancellation into `iterator.return()`, so the handler's `for await` exits via the normal control path and any DB cursors / file handles get to release in their `finally`. `sse` also emits a 15s `: keepalive` comment so intermediaries don't drop idle connections.

```ts
import { GET } from 'belte/rpc'
import { sse } from 'belte/response'

export const orderFeed = GET<{ customerId: string }, Order>(({ customerId }) =>
    sse(async function* () {
        for await (const order of db.watchOrders(customerId)) {
            yield order
        }
    }()),
)
```

When `subscribe(fn)(args)` on the client reads from an rpc with `sse` or `jsonl`, it parses each frame and the iteration shape is identical to a `SOCKET` rpc — pick the transport that fits the handler, not the call site.

### HTTP cache-control defaults

Belte sets sensible `Cache-Control` defaults on every response it owns:

- Hashed entry bundles and chunks under `/_app/` (`client-<hash>.js`, `client-<hash>.css`, `<name>-<hash>.js`, sourcemaps) → `public, max-age=31536000, immutable`
- Other static assets under `/_app/` (images, fonts, anything emitted without a content hash) → `public, max-age=0, must-revalidate`
- SSR HTML / JSON responses → `private, no-cache`
- Errors (`404`, `405`, `500`) → `no-store`

To override, return a `Response` whose `Cache-Control` you set explicitly — the `belte/response` helpers all let you pass an `init` to do that. Pre-gzipped sibling files are streamed automatically when the client sends `Accept-Encoding: gzip`.

---

## Consume

How the client (and SSR pass) reads data, stays live, and navigates.

### Direct calls

The function returned by `GET()` / `POST()` / etc. is callable as-is. On the server, the call runs the handler directly; on the client, it issues a `fetch` to the matching URL with the args serialized into the query string (for `GET` / `DELETE` / `HEAD`) or the JSON body (for the others). The call resolves to the decoded body — JSON for `application/json`, `string` for `text/*`, `Blob` for binary, `undefined` for `204`. Non-2xx throws `HttpError`.

```ts
import { getPost } from '$rpc/getPost.ts'
import { createPost } from '$rpc/createPost.ts'

const post = await getPost({ id: 'abc' })          // typed as { title; body }
const { id } = await createPost({ title, body })   // typed as { id }
```

Each remote function also exposes `.url` and `.method`, so plain HTML forms and plain `fetch` work too:

```svelte
<form method="POST" action={createPost.url}>
    <input name="title" />
    <textarea name="body"></textarea>
    <button>save</button>
</form>
```

```ts
const res = await fetch(getPost.url + '?id=abc')
```

### `cache(fn, options?)` — `belte/cache`

Direct calls are fine for one-shot work, but pages and layouts usually want three things on top: dedupe across components reading the same data, serialization into the SSR HTML, and reactivity so a mutation can trigger refetches.

`cache()` does all three. Wrap a remote function call with it and the result is stored in a request-scoped (server) or session-scoped (client) cache keyed by `method + url + args`. The invoker returns the same decoded body shape as the plain call.

```ts
import { cache } from 'belte/cache'
import { getSession } from '$rpc/getSession.ts'

const session = await cache(getSession)()
```

Options:

- `ttl` — `undefined` (default, lives forever); `0` (dedupe in-flight only); positive ms (expire after resolve).
- `key` — override the auto-derived key. Useful for grouping (`{ key: 'posts' }`) or scoping per arg (`{ key: ['post', id] }`).

```ts
cache(getNow, { ttl: 0 })()                  // dedupe only — drop entry once promise settles
cache(getNow, { ttl: 30_000 })()             // expire 30s after resolve
cache(searchPosts, { key: 'posts' })({ q })  // collapse multiple call patterns onto one key
```

### Reactive reads + mutations

Wrap a `cache()` call in `$derived` to subscribe the deriving scope to that cache key. After invalidation, every subscriber re-runs and fetches a fresh entry.

```svelte
<script lang="ts">
import { cache } from 'belte/cache'
import { getCounter } from '$rpc/getCounter.ts'
import { incrementCounter } from '$rpc/incrementCounter.ts'

const counter = $derived(cache(getCounter)())

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)   // every $derived subscribing to getCounter refetches
}
</script>

{#await counter}…{:then { count }}<p>{count}</p>{/await}
<button onclick={increment}>+1</button>
```

`cache.invalidate` overloads:

- `cache.invalidate(fn)` — drops every entry for that remote function, regardless of args.
- `cache.invalidate(key)` — drops a specific key (used with `cache(fn, { key })`).
- `cache.invalidate()` — clears the whole store.

Mutations are just remote function calls — `incrementCounter()` goes over the wire on the client and runs in-process on the server. There's no special "form action" type.

### `.raw` — escape hatch

Every remote function has a `.raw` sibling — itself a remote function with the same `method` + `url`, but whose call resolves to the underlying `Response` instead of the decoded body. Reach for it when you need headers, status, or a stream:

```ts
const res = await getDownload.raw({ id })
for await (const chunk of res.body) { /* … */ }
```

It composes with `cache()` the same way the decoded variant does — pass `fn.raw` (instead of `fn`) and the invoker returns `Promise<Response>`. Both share one stored entry by `method + url + args`:

```ts
const response = await cache(getPost.raw)({ id })
```

### `.stream(args)` + `subscribe(fn)` — `belte/cache`

Both `RemoteFunction` (verb-bound rpcs whose handlers reply with `sse(...)` / `jsonl(...)`) and `SocketFunction` (`SOCKET`-bound rpcs) expose the same `.stream(args)` iteration entry point: an `AsyncIterable<Frame>` you drain with `for await`. The transport choice belongs to the rpc module — the call site is the same regardless.

```ts
for await (const order of orderFeed.stream({ customerId })) {
    console.log(order)
}
```

For reactive consumption, `subscribe(fn)(args)` from `belte/cache` is the equivalent of `cache()` for streams. It manages a per-key registry of open streams, opens on first `$derived` read and closes on last reader (driven by Svelte's `createSubscriber`), and re-keys when args change. Subscribe is a no-op on the server — SSR can't keep a stream open across the request boundary, so pages that want a value in the initial HTML use `cache()` for the seed and `subscribe()` for live updates after hydration.

```svelte
<script lang="ts">
import { cache, subscribe } from 'belte/cache'
import { getOrders, orderFeed } from '$rpc/...'

const seed = await cache(getOrders)({ customerId })       // SSR-friendly initial value
const latest = $derived(subscribe(orderFeed)({ customerId })) // live updates after hydration
const error = $derived(subscribe.error(orderFeed)({ customerId }))
const status = $derived(subscribe.status(orderFeed)({ customerId }))
</script>
```

Errors surface through `subscribe.error(fn)(args)` rather than throwing — reading the latest frame from a `$derived` can't crash the component. `subscribe.status(fn)(args)` exposes `'pending' | 'open' | 'done' | 'error'` for callers that need to distinguish "haven't received the first frame" from "stream ended cleanly".

### `page` + `navigate` — `belte/page`

`page` is a reactive object describing the current view: `{ route, params, url }`. `route` is the matched route pattern (`'/posts/[id]'`); `params` is the typed param shape derived from the auto-generated `Routes` augmentation; `url` is a `URL` that's reassigned on every SPA navigation. Reading any field inside `$derived` / `$effect` subscribes that scope, so derivations re-run on nav.

`navigate(href, options?)` does a SPA navigation: writes history, resolves the new route, swaps the Page component. Same-pathname navigations (hash-only, search-only) skip the fetch and just refresh `page.url`. Falls back to a full page load on network errors or unknown routes. `options` are `{ replace?: boolean; scroll?: boolean }`.

```ts
import { page, navigate } from 'belte/page'

const isActive = (href: string) => page.url.pathname === href
const filter = $derived(page.url.searchParams.get('q') ?? '')

if (page.route === '/posts/[id]') {
    page.params.id  // typed as string
}

navigate('/posts/2')
navigate('/login', { replace: true })
```

### Request lifecycle

```
browser request
  │
  ▼
src/app.ts  handle?            optional middleware (wraps next call)
  │
  ▼
pages/layout.svelte            root-to-leaf chain of layouts
pages/**/layout.svelte         each runs top-level `await cache(fn)()` for its data
  │
  ▼
pages/<path>/page.svelte       page renders, can also `await cache(fn)()`
  │
  ▼
serialize cache snapshot       every cache entry is JSON'd into <script>window.__SSR__</script>
  │
  ▼
HTML to client
  │
  ▼
hydration                      client cache store loads from __SSR__ — no second fetch
  │
  ▼
$derived(cache(fn)()) subscribes; cache.invalidate(fn) re-runs every subscriber
$derived(subscribe(fn)())     opens streams after hydration, re-runs on each frame
```
