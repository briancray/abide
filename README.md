# belte

A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev).

Belte is built around four ideas:

1. **Folder-based filesystem routes.** Every route is a folder. `page.svelte` renders a page, `layout.svelte` wraps everything under its folder, `endpoint.ts` exposes typed HTTP handlers.
2. **A single Bun process.** The dev server, production server, and compiled standalone binary all run on `Bun.serve`. No Node, no Vite, no separate bundler runtime.
3. **Svelte 5 throughout.** Server-rendered HTML hydrates into a Svelte 5 app and navigates client-side. Layout chains run on both sides.
4. **Endpoints are callable from anywhere.** A handler exported from `endpoint.ts` is a typed function on both the server and the client — direct call on the server, network fetch on the client. The bundler swaps the implementation per target.

It ships as a library (`belte`) plus a CLI (`belte dev | build | start | compile`).

---

## Quick start

```sh
bun add belte svelte
```

Create the minimal app layout:

```
src/
  routes/
    page.svelte             # GET /
    about/
      page.svelte           # GET /about
    time/
      endpoint.ts           # GET /time → JSON API
    posts/
      [id]/
        page.svelte         # GET /posts/:id
  app.ts                    # optional: init / handle / handleError / socket
```

Run it:

```sh
belte dev      # build client bundle + start hot-reloading server
belte build    # produce dist/_app/ client bundle
belte start    # run the server against dist/
belte compile  # bundle dist/ and a Bun runtime into a single executable
```

Working examples live in [`examples/`](examples):

- [`examples/barebones`](examples/barebones) — the smallest possible app (just a single `page.svelte`).
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, remote functions, `cache()`, live cache invalidation, a WebSocket, Tailwind, and a cookie-session auth flow with a protected route.

---

## Project layout in your app

```
your-app/
  src/
    routes/             # filesystem routes (folders containing page/layout/endpoint files)
    app.ts              # optional app hooks (middleware, error, sockets, init)
    index.html          # optional shell override
    app.css             # any CSS, imported from a layout/page
  svelte.config.js      # optional Svelte compiler options
  .env                  # picked up by Bun (e.g. DEBUG=belte:*)
  dist/                 # produced by `belte build`
```

### Path aliases

Two import aliases are wired through the bundler in every mode (dev, build, compile):

- `$routes/...` → `src/routes/...`
- `$lib/...` → `src/lib/...`

```ts
import { getNow } from '$routes/time/endpoint.ts'
import { formatDate } from '$lib/formatDate.ts'
```

For editor / type-check support, add matching `paths` to your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "paths": {
            "$routes": ["./src/routes"],
            "$routes/*": ["./src/routes/*"],
            "$lib": ["./src/lib"],
            "$lib/*": ["./src/lib/*"]
        }
    }
}
```

### Routes

Every route is a folder. Only three filenames are recognized inside `src/routes/`:

- `page.svelte` — renders the page at the folder's URL
- `layout.svelte` — wraps every page at or below the folder
- `endpoint.ts` — exports HTTP-method-named functions for that URL

Folder name conventions follow Bun's `FileSystemRouter` (`nextjs` style):

- `routes/about/page.svelte` → `GET /about`
- `routes/page.svelte` → `GET /`
- `routes/posts/[id]/page.svelte` → `GET /posts/:id` (params on `match.params`)
- `routes/time/endpoint.ts` → handlers at `/time`

A misnamed file (`about.svelte`, `time.ts` at the routes root) is rejected with a clear error pointing at the right folder layout.

### Layouts

`routes/layout.svelte` wraps every page; `routes/admin/layout.svelte` wraps everything under `/admin`. Layouts compose root-to-leaf. Top-level data (session, theme, etc.) is loaded directly in the layout using `cache()` — see [`cache()`](#cache) below.

```svelte
<!-- routes/layout.svelte -->
<script lang="ts">
import '../app.css'
import { cache } from 'belte/cache'
import { getSession } from './session/endpoint.ts'

let { children }: { children: any } = $props()

const session = await cache(getSession)().then((res) => res.json())
</script>

<header>
    {#if session?.user}signed in as {session.user}{:else}signed out{/if}
</header>
<main>{@render children()}</main>
```

### Endpoints (remote functions)

An `endpoint.ts` file exports one or more HTTP-verb-bound functions using the helpers from `belte/route/<VERB>`:

```ts
// routes/time/endpoint.ts
import { GET } from 'belte/route/GET'

export const getNow = GET<undefined, { now: string }>(() =>
    Response.json({ now: new Date().toISOString() }),
)
```

```ts
// routes/login/endpoint.ts
import { POST } from 'belte/route/POST'

export const login = POST<{ username: string }, never>(async (args) => {
    const name = String(args?.username ?? '').trim()
    if (!name) {
        return new Response('username is required', { status: 400 })
    }
    return new Response(undefined, { status: 303, headers: { Location: '/dashboard' } })
})
```

Each helper takes `<Args, Return>` type parameters. `Args` is what the function accepts when called (the client proxy serializes it; the server parses it back). `Return` is the JSON-decoded body type, used to type `response.json()` at call sites.

Argument handling is content-type-driven on the server:

- `GET` / `DELETE` → args come from the URL search params
- `POST` / `PUT` / `PATCH` with `application/json` → args parsed from the JSON body
- `POST` / `PUT` / `PATCH` with form data → args from `FormData`

On the client, the same function is a typed proxy that calls the matching URL — `args` is serialized to search params (GET/DELETE) or a JSON body (everything else). Each exported function also carries `.url` and `.method`, so plain `fetch(getNow.url)` works too.

```ts
// from a Svelte component or another endpoint
import { getNow } from '$routes/time/endpoint.ts'

const res = await getNow()           // typed call — fetch on the client, direct on the server
const { now } = await res.json()     // typed as { now: string }
```

Unhandled methods return `405` with an `Allow` header. If a folder has both `page.svelte` and `endpoint.ts`, the page handles `GET`/`HEAD` (rendering) while the endpoint handles its own verbs.

#### Server-only handlers

To skip the client proxy entirely (webhooks, server-to-server, anything you don't want exposed to the browser), pass `{ hydrate: false }`:

```ts
export const handleWebhook = POST<Payload, never>(
    async (payload) => {
        // ...
        return new Response(null, { status: 204 })
    },
    { hydrate: false },
)
```

The client build replaces the export with a stub that throws if called, so calling it from a browser-side module is a build-time-visible mistake rather than a runtime fetch.

### `cache()`

`cache()` is belte's request-scoped data cache. It wraps a remote function call, dedupes during SSR, hydrates into the browser, and ties into Svelte reactivity for client-side invalidation.

```ts
import { cache } from 'belte/cache'
import { getCounter, incrementCounter } from './state/endpoint.ts'

// Top-level await during SSR — the response is serialized into the HTML
// and replayed on the client during hydration.
const initial = await cache(getCounter)().then((res) => res.json())

// Inside $derived.by, cache() subscribes the deriving scope. After a
// mutation, cache.invalidate() broadcasts and every derived re-runs.
const counter = $derived.by(() => cache(getCounter)().then((res) => res.json()))

async function bump() {
    await incrementCounter()
    cache.invalidate(getCounter)
}
```

`cache(fn, options?)` returns an invoker. Options:

- `ttl` — `undefined` (default) keeps the entry forever, `0` dedupes only (drops once the promise settles), any positive number is a milliseconds-past-resolve TTL.
- `key` — overrides the auto-derived key. Useful when sharing a single entry across calls or stripping noisy args.

Invalidation:

- `cache.invalidate(fn)` — drops every entry for that remote function (any args)
- `cache.invalidate(key)` — drops a specific key set via `options.key`
- `cache.invalidate()` — clears the whole store

The server uses a fresh cache store per request; the client uses one module-level store that persists for the session.

### `src/app.ts`

`src/app.ts` is the single optional entry for application-level hooks. Every export is optional.

```ts
import type { AppModule } from 'belte/types/AppModule'

export const init: AppModule['init'] = async ({ server }) => {
    // run once after Bun.serve is up; return an optional cleanup for SIGINT/SIGTERM
}

export const handle: AppModule['handle'] = async (req, next) => {
    // wrap the default pipeline — branch, mutate, short-circuit, etc.
    const response = await next(req)
    return response
}

export const handleError: AppModule['handleError'] = (error, req) => {
    // custom 500 fallback
    return new Response('boom', { status: 500 })
}
```

Inside `handle` (or any handler), three utilities mutate the final response without rebuilding it:

```ts
import { setCookie } from 'belte/server/setCookie'
import { setHeader } from 'belte/server/setHeader'
import { setStatus } from 'belte/server/setStatus'

setHeader('x-trace-id', traceId)
setCookie('sid=...; Path=/; HttpOnly; SameSite=Lax')
setStatus(401)
```

`belte/server/server` exposes a stable proxy to the live `Bun.serve` instance — safe to import at module scope.

### WebSockets

WebSockets are configured under `app.ts`'s `socket` export. The data type is registered globally via module augmentation so `ws.data` is typed everywhere it appears:

```ts
// src/app.ts
import type { AppModule } from 'belte/types/AppModule'
import type { ServerWebSocket } from 'bun'

declare module 'belte/types/App' {
    interface SocketData {
        id: number
    }
}

let nextId = 0

export const socket: AppModule['socket'] = {
    upgrade: () => ({ data: { id: ++nextId } }),
    open(ws) {
        ws.send(`hi #${ws.data.id}`)
    },
    message(ws, msg) {
        ws.send(`echo: ${msg}`)
    },
}
```

Default upgrade path is `/__belte/socket`; override with `socket.path`. Returning `false` from `upgrade` refuses the connection.

### Caching defaults

Belte sets sensible `Cache-Control` defaults on every response it owns:

- Hashed chunks under `/_app/` → `public, max-age=31536000, immutable`
- Unhashed entry/asset files (`client.js`, `client.css`, …) → `public, max-age=0, must-revalidate`
- SSR HTML / JSON responses → `private, no-cache`
- Errors (`404`, `405`, `500`) → `no-store`

To override, return a `Response` from an endpoint handler — its headers are passed through untouched. Pre-gzipped sibling files are streamed automatically when the client sends `Accept-Encoding: gzip`.

### Svelte config

Optional `svelte.config.js` at the project root. Same shape as upstream:

```js
/** @type {import('belte').SvelteConfig} */
export default {
    compilerOptions: {
        experimental: { async: true },
    },
}
```

---

## CLI

```
belte dev                    # build, then `bun --hot` the server entry
belte build                  # bundle the client into dist/_app/ (gzip siblings included)
belte start                  # run the server entry against dist/
belte compile [--target=…] [--out=…]
                             # build + Bun.build({ compile }) → standalone binary
```

`belte compile` defaults to your host target (`bun-darwin-arm64`, `bun-linux-x64`, etc.) and writes to `dist/server`. The binary embeds your gzipped client assets, so it has no on-disk dependency on `dist/`.

### Debug logging

Set `DEBUG=belte:*` (Bun reads `.env` automatically) to see per-request logs. `DEBUG=belte:trace` adds a per-request timing table covering render, remote dispatch, and middleware.
