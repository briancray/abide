# belte

A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev).

Belte is built around four ideas:

1. **Folder-based filesystem routes.** Every route is a folder. `page.svelte` renders a page, `layout.svelte` wraps everything under its folder, `endpoint.ts` exposes typed HTTP handlers.
2. **A single Bun process.** The dev server, production server, and compiled standalone binary all run on `Bun.serve`. No Node, no Vite, no separate bundler runtime.
3. **Svelte 5 throughout.** Server-rendered HTML hydrates into a Svelte 5 app and navigates client-side. Layout chains run on both sides.
4. **Endpoints are callable from anywhere.** A handler exported from `endpoint.ts` is a typed function on both the server and the client — direct call on the server, network fetch on the client. The bundler swaps the implementation per target.

It ships as a library (`belte`) plus a CLI (`belte scaffold | dev | build | start | compile`).

Working examples live in [`examples/`](examples):

- [`examples/barebones`](examples/barebones) — the smallest possible app (just a single `page.svelte`).
- [`examples/scaffold`](examples/scaffold) — the output of `bunx belte scaffold` — one of every file type with comments.
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, remote functions, `cache()`, live cache invalidation, a WebSocket, Tailwind, and a cookie-session auth flow with a protected route.

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

`belte compile` defaults to your host target (`bun-darwin-arm64`, `bun-linux-x64`, etc.) and writes to `dist/app`. The binary embeds your gzipped client assets, so it has no on-disk dependency on `dist/`.

### Debug logging

Bun reads `.env` automatically:

- `DEBUG=belte:*` — per-request log line
- `DEBUG=belte:trace` — per-request timing table (render, remote dispatch, middleware)

---

## Project structure

```
my-app/
  src/
    routes/                     # all routes live here; every route is a folder
      page.svelte                 # GET /
      layout.svelte               # wraps every page below
      about/
        page.svelte               # GET /about
      hello/
        endpoint.ts               # typed HTTP handlers at /hello
    app.ts                      # optional: init / handle / handleError / socket
    app.html                    # optional: HTML shell override
    app.css                     # any CSS, imported from a layout/page
  svelte.config.js              # optional Svelte compiler options
  tsconfig.json
  package.json
  .env                          # Bun reads this automatically (e.g. DEBUG=belte:*)
  dist/                         # produced by `belte build`
```

Two import aliases are wired through the bundler in every mode (dev, build, compile):

- `$routes/...` → `src/routes/...`
- `$lib/...` → `src/lib/...`

```ts
import { getNow } from '$routes/time/endpoint.ts'
import { formatDate } from '$lib/formatDate.ts'
```

The sections below cover each file. Each has a **barebones** snippet (the literal default that ships with `bunx belte scaffold`) and a **full** snippet (a richer feature-set you might grow into).

---

### `src/routes/page.svelte`

A page is a Svelte 5 component. Folder name becomes the URL: `src/routes/page.svelte` mounts at `/`, `src/routes/posts/[id]/page.svelte` mounts at `/posts/:id`. Params from the URL are exposed via the `params` prop. Pages render on the server during SSR and then hydrate on the client; the same component code runs in both contexts.

**Barebones**

```svelte
<h1>Hello from belte</h1>
```

**Full**

```svelte
<script lang="ts">
import { cache } from 'belte/cache'
import { getPost } from './endpoint.ts'

let { params }: { params: { id: string } } = $props()

const post = await cache(getPost)({ id: params.id }).then((res) => res.json())
</script>

<svelte:head>
    <title>{post.title}</title>
</svelte:head>

<article>
    <h1>{post.title}</h1>
    <p>{post.body}</p>
</article>
```

### `src/routes/layout.svelte`

A layout wraps every page at or below its folder. Layouts compose root-to-leaf: a request for `/admin/users` runs `routes/layout.svelte` → `routes/admin/layout.svelte` → the page. Like pages, they run on the server during SSR and on the client during navigation. Use a layout for header/footer chrome, global CSS imports, and data needed everywhere below the folder.

**Barebones**

```svelte
<script lang="ts">
let { children }: { children: import('svelte').Snippet } = $props()
</script>

<main>{@render children()}</main>
```

**Full**

```svelte
<script lang="ts">
import '../app.css'
import { cache } from 'belte/cache'
import { getSession } from './session/endpoint.ts'

let { children }: { children: import('svelte').Snippet } = $props()

const session = await cache(getSession)().then((res) => res.json())
</script>

<svelte:head>
    <title>my app</title>
</svelte:head>

<header>
    <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
        {#if session?.user}
            <span>{session.user}</span>
            <form method="POST" action="/logout"><button type="submit">Log out</button></form>
        {:else}
            <a href="/login">Log in</a>
        {/if}
    </nav>
</header>
<main>{@render children()}</main>
```

### `src/routes/<path>/endpoint.ts`

An endpoint exposes HTTP-verb-bound functions at the folder's URL. The verb helpers from `belte/route/<VERB>` produce **remote functions** — typed callables that, on the server, run the handler directly, and on the client, fetch the corresponding URL. The bundler swaps the implementation per build target.

Argument handling is content-type-driven:

- `GET` / `DELETE` → args from the URL search params
- `POST` / `PUT` / `PATCH` with `application/json` → args from the JSON body
- `POST` / `PUT` / `PATCH` with form data → args from `FormData`

Type parameters are `<Args, Return>`. `Args` is what the caller passes in. `Return` types the JSON-decoded body at call sites (`response.json()` is `Promise<Return>`). Unhandled methods on the URL return `405` with an `Allow` header.

**Barebones**

```ts
import { GET } from 'belte/route/GET'

export const getHello = GET<undefined, { message: string }>(() =>
    Response.json({ message: 'Hello from belte' }),
)
```

**Full**

```ts
import { DELETE } from 'belte/route/DELETE'
import { GET } from 'belte/route/GET'
import { POST } from 'belte/route/POST'
import { db } from '$lib/db.ts'

export const getPost = GET<{ id: string }, { title: string; body: string }>(({ id }) =>
    Response.json(db.posts.get(id)),
)

export const createPost = POST<{ title: string; body: string }, { id: string }>(async (args) => {
    const id = await db.posts.insert(args)
    return Response.json({ id }, { status: 201 })
})

export const deletePost = DELETE<{ id: string }, never>(async ({ id }) => {
    await db.posts.delete(id)
    return new Response(null, { status: 204 })
})

/*
Server-only handlers — pass { hydrate: false } to skip the client proxy.
The client build replaces the export with a stub that throws if invoked,
so calling it from a browser-side module is a build-time-visible mistake
rather than a runtime fetch.
*/
export const stripeWebhook = POST<unknown, never>(
    async (_args, request) => {
        // verify signature, process event…
        return new Response(null, { status: 204 })
    },
    { hydrate: false },
)
```

If a folder has both `page.svelte` and `endpoint.ts`, the page handles `GET`/`HEAD` (rendering) and the endpoint handles its other verbs.

### `src/app.ts`

Optional application hooks. Every export is optional; delete the ones you don't need. Belte resolves this file via the `belte:app` virtual module — no import is needed from your own code.

- `init` runs once after `Bun.serve` is up. Optionally return a cleanup function that runs on SIGINT/SIGTERM.
- `handle` is middleware that wraps the default request pipeline (`next(request)` invokes it).
- `handleError` is your 500 fallback. Replaces belte's default stack-trace response.
- `socket` is the Bun WebSocket handler. `upgrade` runs per connection; returning `false` refuses. The path is always `/__belte/socket`.

Augment `belte/types/App`'s `SocketData` interface to type `ws.data` across your app.

**Barebones** — delete the whole file if you don't need any hooks.

```ts
import type { AppModule } from 'belte/types/AppModule'

export const init: AppModule['init'] = ({ server }) => {
    console.log(`listening on http://localhost:${server.port}`)
}
```

**Full**

```ts
import type { AppModule } from 'belte/types/AppModule'

declare module 'belte/types/App' {
    interface SocketData {
        id: number
    }
}

export const init: AppModule['init'] = async ({ server }) => {
    await db.connect()
    console.log(`listening on http://localhost:${server.port}`)
    return async () => {
        await db.disconnect()
    }
}

export const handle: AppModule['handle'] = async (request, next) => {
    if (new URL(request.url).pathname.startsWith('/admin')) {
        const auth = request.headers.get('authorization')
        if (!auth) {
            return new Response('Unauthorized', { status: 401 })
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

let nextId = 0

export const socket: AppModule['socket'] = {
    upgrade: () => ({ data: { id: ++nextId } }),
    open(ws) {
        ws.send(`hi #${ws.data.id}`)
    },
    message(ws, message) {
        ws.send(`echo: ${message}`)
    },
}
```

### `src/app.html`

Optional HTML shell. If present at `src/app.html`, belte uses it as the SSR template; otherwise a sensible default is used. Three comment markers are replaced per render:

- `<!--ssr:head-->` — head emitted by Svelte (`<svelte:head>` content, etc.)
- `<!--ssr:body-->` — rendered page body
- `<!--ssr:state-->` — cache snapshot + route info for hydration

**Barebones** — the default; delete the file to keep it.

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

**Full** — add a favicon, theme color, GTM snippet, whatever.

```html
<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#1f2937" />
<link rel="icon" href="/favicon.svg" />
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

### `src/app.css`

Any CSS the app cares about. It isn't picked up automatically — import it once from a layout (typically the root `layout.svelte`) so it ships with every page.

**Barebones**

```css
:root {
    font-family: system-ui, sans-serif;
}
```

**Full** — Tailwind v4. Add `bun-plugin-tailwind` and `tailwindcss` as devDependencies; belte's build picks up the plugin automatically.

```css
@import "tailwindcss";

@theme {
    --color-brand: #1f2937;
}
```

### `svelte.config.js`

Optional. Same shape as upstream Svelte's config. Delete the file to use defaults.

**Barebones** — opt in to async Svelte (enables top-level `await` inside components):

```js
/** @type {import('belte').SvelteConfig} */
export default {
    compilerOptions: {
        experimental: { async: true },
    },
}
```

**Full** — preprocessors, runes config, etc.

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('belte').SvelteConfig} */
export default {
    preprocess: vitePreprocess(),
    compilerOptions: {
        experimental: { async: true },
        runes: true,
    },
}
```

### `tsconfig.json`

The `$routes` / `$lib` aliases are bundler-wired regardless of TS; this `paths` section just teaches the editor and `tsc` about them.

**Barebones**

```json
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
            "$routes": ["./src/routes"],
            "$routes/*": ["./src/routes/*"],
            "$lib": ["./src/lib"],
            "$lib/*": ["./src/lib/*"]
        }
    },
    "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

### `package.json`

**Barebones**

```json
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

**Full** — adds Tailwind v4.

```json
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
    },
    "devDependencies": {
        "bun-plugin-tailwind": "latest",
        "tailwindcss": "^4.0.0"
    }
}
```

---

## Handling data

Belte has a single data primitive: `cache()` from `belte/cache`. It dedupes calls during SSR, replays into the client during hydration, and ties into Svelte's reactivity so a mutation can trigger refetches anywhere the same call is read.

### How a request flows

```
browser request
  │
  ▼
src/app.ts  handle?            optional middleware (wraps next call)
  │
  ▼
routes/layout.svelte           root-to-leaf chain of layouts
routes/**/layout.svelte        each runs top-level `await cache(fn)()` for its data
  │
  ▼
routes/<path>/page.svelte      page renders, can also `await cache(fn)()`
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
$derived.by(() => cache(fn)()) subscribes; cache.invalidate(fn) re-runs every subscriber
```

### Reading data (SSR + first paint)

A page or layout calls `cache(fn)()` at the top level of its `<script>`. The same line is the SSR entrypoint and the client-hydration read:

- **On the server**, the surrounding render is a single async pass. `cache()` checks the per-request store, runs `fn` once, and resolves with the Response. Multiple components calling `cache(getSession)()` in the same request share one entry — no duplicate work.
- **On the client during hydration**, the per-request snapshot is replayed into the client cache store. The same `cache(fn)()` call resolves immediately from the snapshot — no second network round-trip.

```svelte
<script lang="ts">
import { cache } from 'belte/cache'
import { getSession } from './session/endpoint.ts'

const session = await cache(getSession)().then((res) => res.json())
</script>

{#if session?.user}signed in as {session.user}{:else}signed out{/if}
```

Pages and layouts use top-level await for this to work. Enable Svelte's async compiler in `svelte.config.js`:

```js
compilerOptions: { experimental: { async: true } }
```

### Reactive reads (client)

Wrap a `cache()` call in `$derived.by` to subscribe the deriving scope to that cache key. After invalidation, every subscriber re-runs and fetches a fresh entry.

```svelte
<script lang="ts">
import { cache } from 'belte/cache'
import { getCounter, incrementCounter } from './state/endpoint.ts'

const counter = $derived.by(() => cache(getCounter)().then((res) => res.json()))

async function increment() {
    await incrementCounter()
    cache.invalidate(getCounter)   // every $derived subscribing to getCounter refetches
}
</script>

{#await counter}…{:then { count }}<p>{count}</p>{/await}
<button onclick={increment}>+1</button>
```

Two `$derived.by(() => cache(getCounter)())` calls anywhere on the page share one cache entry and update together.

### Mutations

Mutations are just remote function calls — `incrementCounter()` above goes over the wire on the client and runs in-process on the server. There's no special "form action" type. To refresh dependents after a mutation, call `cache.invalidate(fn)`.

`cache.invalidate` overloads:

- `cache.invalidate(fn)` — drops every entry for that remote function, regardless of args
- `cache.invalidate(key)` — drops a specific key (used with `cache(fn, { key })`)
- `cache.invalidate()` — clears the whole store

### `cache` options

```ts
cache(getNow, { ttl: 0 })()                  // dedupe only — drop entry once promise settles
cache(getNow, { ttl: 30_000 })()             // expire 30 s after resolve
cache(searchPosts, { key: 'posts' })({ q })  // collapse multiple call patterns onto one key
```

`ttl` semantics:

- `undefined` (default) — entry lives forever (or until invalidated)
- `0` — entry drops as soon as the promise settles (use it to dedupe concurrent reads in the same render)
- positive number — milliseconds-past-resolve before expiry

### Calling remote functions directly

The function returned by a verb helper also works without `cache()`:

```ts
import { getNow } from '$routes/time/endpoint.ts'

const res = await getNow()             // direct call — no cache, no dedupe
const { now } = await res.json()       // typed as { now: string }
```

You can also use `getNow.url` and `getNow.method` to drive a plain `fetch` — useful for embedding the URL in a `<form action>` or a third-party tool.

### Server-only handlers

For webhooks / server-to-server calls you don't want exposed to the browser, pass `{ hydrate: false }` to the verb helper. The client build replaces the export with a stub that throws on call, so accidentally invoking it from a browser module is a build-time-visible mistake.

```ts
export const stripeWebhook = POST<unknown, never>(
    async (_args, request) => {
        // verify signature, process event…
        return new Response(null, { status: 204 })
    },
    { hydrate: false },
)
```

### Caching defaults at the HTTP layer

Belte sets sensible `Cache-Control` defaults on every response it owns:

- Hashed chunks under `/_app/` → `public, max-age=31536000, immutable`
- Unhashed entry/asset files (`client.js`, `client.css`, …) → `public, max-age=0, must-revalidate`
- SSR HTML / JSON responses → `private, no-cache`
- Errors (`404`, `405`, `500`) → `no-store`

To override, return a `Response` from an endpoint handler — its headers are passed through untouched. Pre-gzipped sibling files are streamed automatically when the client sends `Accept-Encoding: gzip`.
