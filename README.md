# belte

A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev).

Belte is built around four bets:

1. **Isomorphism by default** — the same callable runs on both sides. The bundler swaps the runtime per build target; user code never branches on `typeof window`.
2. **Framework owns the network** — one route URL shape, one websocket multiplex, one way to consume streams. No parallel "raw" escape hatches that fragment the model.
3. **One runtime, dev → prod → binary** — `belte dev`, `belte build`, `belte start`, `belte compile` all run on the same `Bun.serve` under the hood. No Node, no Vite, no separate bundler runtime.
4. **Exports grouped by lifecycle phase** — `belte/route` and `belte/stream` declare, `belte/respond` shapes the reply, `belte/consume` reads it back. The module name *is* the phase name.

Working examples live in [`examples/`](examples):

- [`examples/barebones`](examples/barebones) — the smallest possible app (just a single `page.svelte`).
- [`examples/scaffold`](examples/scaffold) — the output of `bunx belte scaffold` — one of every file type with comments.
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, remote functions, streams, `cache()`, live invalidation, Tailwind, and a cookie-session auth flow with a protected route.

---

## The four bets

### Isomorphism by default

One file declares the function, one identifier calls it. The bundler swaps the runtime: direct call on the server, typed `fetch` on the client.

```ts
// src/route/getPost.ts
import { GET } from 'belte/route'
import { json } from 'belte/respond'

export const getPost = GET<{ id: string }, { title: string; body: string }>(
    ({ id }) => json(db.posts.get(id)),
)
```

```ts
// anywhere — page <script>, layout, another route, the browser
import { getPost } from '$route/getPost.ts'

const post = await getPost({ id: 'abc' })
```

The same is true for streams. One file declares a topic; the same `publish` and async iteration work on both sides.

```ts
// src/stream/chat.ts
import { stream } from 'belte/stream'

export const chat = stream<ChatMessage>({ history: 100 })
```

```ts
// server-side handler OR browser code — same call shape
import { chat } from '$stream/chat.ts'

chat.publish({ id, from, text, at })       // notify every subscriber
for await (const m of chat) { /* … */ }    // replay history, then tail
```

### Framework owns the network

There is exactly one shape for a route URL (`/route/<filename>`), one websocket (`/__belte/stream`) that multiplexes every stream declared under `src/stream/`, and one reactive consumer (`subscribe`) that reads any stream from any component.

```ts
import { subscribe } from 'belte/consume'
import { chat } from '$stream/chat.ts'

const latest = $derived(subscribe(chat))
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

The four modules you'll reach for from user code map to the phases of a request:

```ts
import { GET }              from 'belte/route'    // declare HTTP endpoints
import { stream }           from 'belte/stream'   // declare broadcast topics
import { json, sse }        from 'belte/respond'  // shape the reply
import { cache, subscribe } from 'belte/consume'  // read it back
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
import { cache } from 'belte/consume'
import { getPost } from '$route/getPost.ts'

const post = await cache(getPost)({ id: 'hello' })
</script>

<h1>{post.title}</h1>
<p>{post.body}</p>
```

```ts
// src/route/getPost.ts
import { GET } from 'belte/route'
import { json } from 'belte/respond'

export const getPost = GET<{ id: string }, { title: string; body: string }>(
    ({ id }) => json({ title: `Post ${id}`, body: '...' }),
)
```

```ts
// src/route/createPost.ts
import { POST } from 'belte/route'
import { json } from 'belte/respond'

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

The reference is grouped by the same lifecycle phases as the imports.

- **[Route](#route)** — how pages, layouts, route modules, stream modules, and app hooks get registered.
- **[Respond](#respond)** — what runs when a request lands.
- **[Consume](#consume)** — how the client reads, reacts, and navigates.

### Project layout

```
my-app/
  src/
    .belte/                     # generated: Routes type augmentation; gitignored
    pages/                      # all pages live here; every page is a folder
      page.svelte                 # GET /
      layout.svelte               # wraps every page below (nearest-only; replaces ancestors)
      about/page.svelte           # GET /about
      posts/[id]/page.svelte      # GET /posts/:id (id is a $prop, typed via Routes)
    route/                      # all remote functions live here; one per file
      getHello.ts                 # GET /route/getHello
      createUser.ts               # POST /route/createUser
    stream/                     # all broadcast topics live here; one per file
      chat.ts                     # multiplexed onto /__belte/stream
    app.ts                      # optional: init / handle / handleError
    app.html                    # optional: HTML shell override
    app.css                     # any CSS, imported from a layout/page
  svelte.config.js              # optional Svelte compiler options
  tsconfig.json
  package.json
  .env                          # Bun reads this automatically (e.g. DEBUG=belte:*)
  dist/                         # produced by `belte build`
```

Four import aliases are wired through the bundler in every mode:

- `$pages/...` → `src/pages/...`
- `$route/...` → `src/route/...`
- `$stream/...` → `src/stream/...`
- `$lib/...` → `src/lib/...`

---

## Route

How code gets registered with the framework. File-system + decorator-style imports.

### Pages — `src/pages/page.svelte`, `layout.svelte`

A page is a Svelte 5 component. Folder name becomes the URL: `src/pages/page.svelte` mounts at `/`, `src/pages/posts/[id]/page.svelte` mounts at `/posts/:id`. Dynamic segments (`[id]`, `[...rest]`) are spread onto the page as individual props; the typed shape is generated into `src/.belte/routes.d.ts` and surfaces as `Routes` on `belte/page`.

A layout wraps every page at or below its folder, and **layouts are nearest-only**: a request for `/admin/users` runs the deepest matching `layout.svelte` — so `pages/admin/layout.svelte` if it exists, otherwise `pages/layout.svelte`, but never both. Nested layouts *replace* ancestors, they do not stack. If a subtree needs the chrome from a parent layout, copy it (or extract it to a snippet and `{@render}` it from both layouts). Pages and layouts both run on the server during SSR and on the client during navigation.

**Barebones — `src/pages/page.svelte`**

```svelte
<h1>Hello from belte</h1>
```

**Full — `src/pages/posts/[id]/page.svelte`**

```svelte
<script lang="ts">
import { cache } from 'belte/consume'
import { getPost } from '$route/getPost.ts'

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
import { cache } from 'belte/consume'
import { page } from 'belte/page'
import { getSession } from '$route/getSession.ts'
import { logout } from '$route/logout.ts'

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

### Route modules — `src/route/<name>.ts`

Every file under `src/route/` exports exactly one remote function. The filename is both the URL path (under `/route/`) and the export name; the imported helper picks the HTTP verb. Folders become URL segments — `src/route/users/getUser.ts` mounts at `/route/users/getUser`. Route URLs are flat: there are no `[name]` dynamic segments, pass identifiers via args.

| Helper                              | Transport                                | Args parsed from                          |
| ----------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `GET / DELETE / HEAD`               | HTTP                                     | URL search params                         |
| `POST / PUT / PATCH`                | HTTP                                     | JSON body or `FormData` (query overrides) |

The handler signature is `(args) => Response`. Sending the wrong verb to a route URL returns `405` with an `Allow` header. For raw `Request` access (binary bodies, custom headers, etc.) call `request()` from `belte/server` inside the handler — see [Respond](#respond). For long-lived broadcast subscriptions, use [Stream modules](#stream-modules--srcstreamnamets) instead.

**Barebones — `src/route/getHello.ts`**

```ts
import { json } from 'belte/respond'
import { GET } from 'belte/route'

export const getHello = GET<undefined, { message: string }>(() =>
    json({ message: 'Hello from belte' }),
)
```

**Full — a CRUD-ish post resource**

```ts
// src/route/getPost.ts
import { GET } from 'belte/route'
import { json, error } from 'belte/respond'
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
// src/route/createPost.ts
import { POST } from 'belte/route'
import { json } from 'belte/respond'
import { db } from '$lib/db.ts'

export const createPost = POST<{ title: string; body: string }, { id: string }>(async (args) => {
    const id = await db.posts.insert(args)
    return json({ id }, { status: 201 })
})
```

```ts
// src/route/deletePost.ts
import { DELETE } from 'belte/route'
import { db } from '$lib/db.ts'

export const deletePost = DELETE<{ id: string }, undefined>(async ({ id }) => {
    await db.posts.delete(id)
    return new Response(null, { status: 204 })
})
```

To expose a one-shot streaming response over plain HTTP (so `curl` / `EventSource` / `fetch` all work) — for example, a server-pushed log tail or a long-running computation — wrap the generator with `sse(...)` or `jsonl(...)` from `belte/respond`. For fan-out broadcast where multiple consumers see the same messages, declare a stream instead.

### Stream modules — `src/stream/<name>.ts`

Every file under `src/stream/` declares exactly one broadcast topic. The filename is both the export name and the topic's wire identity; the bundler binds it to `defineStream` on the server (real fan-out, optional history buffer, Bun-native publish to subscribed ws clients) or to `streamProxy` on the client (subscription over the framework's multiplexed websocket). The same import works on both sides:

```ts
// src/stream/chat.ts
import { stream } from 'belte/stream'

export type ChatMessage = { id: string; from: string; text: string; at: number }

export const chat = stream<ChatMessage>({ history: 100 })
```

```ts
// anywhere — `for await` replays history (if any) then tails live
for await (const message of chat) { /* … */ }
for await (const message of chat.tail()) { /* skip the history replay */ }

// `publish` is isomorphic — call from a route handler or (with clientPublish) the browser
chat.publish({ id: crypto.randomUUID(), from, text, at: Date.now() })
```

`stream<T>(options?)` options:

- `history` — buffer the last *N* messages and replay them to each new iterator (`for await (const m of chat)`). Default `0` (no replay). Iterators opened via `chat.tail()` always skip the buffer.
- `clientPublish` — when `true`, browser publishes are forwarded server-side; when `false` (default), a publish frame from the client is silently dropped. Topics that need auth or validation gate publish through an HTTP `POST` instead.

Every stream rides one framework-owned websocket per client at `/__belte/stream`. Steady-state fan-out is handled by Bun's native `server.publish`, so a topic with many subscribers doesn't iterate JS per message per client. Subscriptions auto-close when the iterator's `return()` runs (idiomatic `break` out of a `for await`); on the client, `subscribe()` (see [Consume](#consume)) drives this lifecycle from Svelte's reactivity.

**Publishing gated through HTTP** — when only authenticated callers should publish:

```ts
// src/route/publishChat.ts
import { POST } from 'belte/route'
import { error, json } from 'belte/respond'
import { type ChatMessage, chat } from '$stream/chat.ts'

export const publishChat = POST<{ from: string; text: string }, ChatMessage>(({ from, text }) => {
    if (!from.trim() || !text.trim()) return error(400, 'from and text are required')
    const message: ChatMessage = { id: crypto.randomUUID(), from, text, at: Date.now() }
    chat.publish(message)
    return json(message)
})
```

### App hooks — `src/app.ts`

Optional application hooks. Every export is optional; delete the ones you don't need. Belte resolves this file at build time via the `belte:app` virtual module — no import is needed from your own code.

- `init` runs once after `Bun.serve` is up. Receives `{ server }` because it runs before any request. Optionally return a cleanup function that runs on SIGINT/SIGTERM.
- `handle` is middleware that wraps the default request pipeline (`next(request)` invokes it). Inside the handler, reach for the inbound `Request` via `request()` and the live `Server` via the `server` import from `belte/server`.
- `handleError` is your 500 fallback. Replaces belte's default stack-trace response.

WebSockets are not exposed here — belte's only native WebSocket surface is the stream hub, multiplexed onto `/__belte/stream` from `src/stream/` declarations.

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
import { error } from 'belte/respond'

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
// tsconfig.json — teach the editor about the $pages / $route / $stream / $lib aliases
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
            "$route": ["./src/route"], "$route/*": ["./src/route/*"],
            "$stream": ["./src/stream"], "$stream/*": ["./src/stream/*"],
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

## Respond

What runs when a request lands. Helpers that shape a `Response`, see the inbound `Request`, or signal failure.

### `request()` — `belte/server`

The inbound `Request` for the SSR pass or route handler that's in flight. Backed by `AsyncLocalStorage`, so it works from anywhere inside the request scope (a page's `<script>`, a layout, a helper, a route handler) without having to thread `request` through every function. Throws if called outside a request scope (top-level module code, `init`, etc.).

```ts
import { request } from 'belte/server'

const cookie = request().headers.get('cookie')
const accept = request().headers.get('accept')
```

### `server` — `belte/server`

The live `Bun.Server` instance. Stable reference from module scope (it's a Proxy that resolves to the active server after boot), so you can import it once and use it from anywhere — request handlers, helper modules, anywhere a request scope isn't available. Throws on access before `Bun.serve` has finished booting.

```ts
import { server } from 'belte/server'

console.log(`listening on :${server.port}`)
```

For broadcast fan-out across subscribers, prefer a stream over reaching for `server.publish` directly — streams pick the right topic name, manage subscriber lifecycle, and stay isomorphic.

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

### `belte/respond` — `json` / `error` / `redirect` / `sse` / `jsonl`

Response constructors with route-friendly defaults. All five set `Cache-Control: no-store` unless the caller overrides it — intermediary caches shouldn't memoise route replies; the framework's per-request cache handles in-process dedupe.

```ts
import { json, error, redirect, sse, jsonl } from 'belte/respond'

json({ ok: true })                 // application/json
json({ ok: true }, { status: 201 })
error(404, 'order not found')      // text/plain with the message verbatim
error(500)                         // standard reason phrase as the body
redirect('/login')                 // 302 with Location: /login
redirect('/articles/1', 301)       // permanent
```

`sse` and `jsonl` wrap an `AsyncIterable<Frame>` in a streaming response — `text/event-stream` for `sse`, `application/jsonl` for `jsonl`. Both translate consumer cancellation into `iterator.return()`, so the handler's `for await` exits via the normal control path and any DB cursors / file handles get to release in their `finally`. `sse` also emits a 15s `: keepalive` comment so intermediaries don't drop idle connections.

```ts
import { GET } from 'belte/route'
import { sse } from 'belte/respond'

export const tickFeed = GET<undefined, { tick: number; at: string }>(() =>
    sse(async function* () {
        for (let tick = 1; ; tick += 1) {
            yield { tick, at: new Date().toISOString() }
            await Bun.sleep(1000)
        }
    }()),
)
```

`sse` and `jsonl` are for one-shot streaming responses tied to a single HTTP request. For fan-out broadcasts where many subscribers see the same messages with replay-on-connect semantics, declare a [stream](#stream-modules--srcstreamnamets) instead.

### HTTP cache-control defaults

Belte sets sensible `Cache-Control` defaults on every response it owns:

- Hashed entry bundles and chunks under `/_app/` (`client-<hash>.js`, `client-<hash>.css`, `<name>-<hash>.js`, sourcemaps) → `public, max-age=31536000, immutable`
- Other static assets under `/_app/` (images, fonts, anything emitted without a content hash) → `public, max-age=0, must-revalidate`
- SSR HTML / JSON responses → `private, no-cache`
- Errors (`404`, `405`, `500`) → `no-store`

To override, return a `Response` whose `Cache-Control` you set explicitly — the `belte/respond` helpers all let you pass an `init` to do that. Pre-gzipped sibling files are streamed automatically when the client sends `Accept-Encoding: gzip`.

---

## Consume

How the client (and SSR pass) reads data, stays live, and navigates.

### Direct calls

The function returned by `GET()` / `POST()` / etc. is callable as-is. On the server, the call runs the handler directly; on the client, it issues a `fetch` to the matching URL with the args serialized into the query string (for `GET` / `DELETE` / `HEAD`) or the JSON body (for the others). The call resolves to the decoded body — JSON for `application/json`, `string` for `text/*`, `Blob` for binary, `undefined` for `204`. Non-2xx throws `HttpError`.

```ts
import { getPost } from '$route/getPost.ts'
import { createPost } from '$route/createPost.ts'

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

### `cache(fn, options?)` — `belte/consume`

Direct calls are fine for one-shot work, but pages and layouts usually want three things on top: dedupe across components reading the same data, serialization into the SSR HTML, and reactivity so a mutation can trigger refetches.

`cache()` does all three. Wrap a remote function call with it and the result is stored in a request-scoped (server) or session-scoped (client) cache keyed by `method + url + args`. The invoker returns the same decoded body shape as the plain call.

```ts
import { cache } from 'belte/consume'
import { getSession } from '$route/getSession.ts'

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
import { cache } from 'belte/consume'
import { getCounter } from '$route/getCounter.ts'
import { incrementCounter } from '$route/incrementCounter.ts'

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

Every remote function has a `.raw` sibling — itself a remote function with the same `method` + `url`, but whose call resolves to the underlying `Response` instead of the decoded body. Reach for it when you need headers, status, or a streaming body:

```ts
const res = await getDownload.raw({ id })
for await (const chunk of res.body) { /* … */ }
```

It composes with `cache()` the same way the decoded variant does — pass `fn.raw` (instead of `fn`) and the invoker returns `Promise<Response>`. Both share one stored entry by `method + url + args`:

```ts
const response = await cache(getPost.raw)({ id })
```

### `subscribe(stream)` — `belte/consume`

The reactive consumer for streams. Pass a `Stream` declared under `src/stream/` and read the latest published value inside any `$derived`. The first read in a tracking scope opens the subscription (replaying history if the topic was declared with `{ history: n }`); the last reader to drop closes it. Many `$deriveds` reading the same stream share one underlying subscription.

```svelte
<script lang="ts">
import { subscribe } from 'belte/consume'
import { chat } from '$stream/chat.ts'

const latest = $derived(subscribe(chat))                 // T | undefined
const error  = $derived(subscribe.error(chat))           // Error | undefined
const status = $derived(subscribe.status(chat))          // 'pending' | 'open' | 'done' | 'error'
</script>
```

Errors surface through `subscribe.error(stream)` rather than throwing — reading `latest` from a `$derived` can't crash the component. `subscribe.status(stream)` distinguishes "haven't received the first message" (`pending`) from "stream ended cleanly" (`done`) and "wire layer surfaced an error" (`error`).

`subscribe` is a no-op on the server — SSR can't keep a stream open across the request boundary. Pages that want a seeded value in the initial HTML should fetch a snapshot via `cache()` against an HTTP route and layer `subscribe()` on top for live updates after hydration:

```svelte
<script lang="ts">
import { cache, subscribe } from 'belte/consume'
import { getRecentOrders } from '$route/getRecentOrders.ts'
import { orders } from '$stream/orders.ts'

const seed   = await cache(getRecentOrders)({ customerId })  // SSR-friendly initial value
const latest = $derived(subscribe(orders))                   // live updates after hydration
</script>
```

For lower-level iteration on either side (or for server-side fan-in), use the stream's async iterator directly — `for await (const m of chat)` replays history and tails live, `chat.tail()` skips the replay.

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
pages/.../layout.svelte        nearest matching layout (deepest wins; replaces ancestors)
                               runs top-level `await cache(fn)()` for its data
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
$derived(subscribe(stream))    opens the ws subscription after hydration, re-runs on each frame
```
