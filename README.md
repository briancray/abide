# belte

A tiny SSR + SPA framework for [Bun](https://bun.sh) and [Svelte 5](https://svelte.dev).

Belte is built around three ideas:

1. **Filesystem routes.** Drop `.svelte` files in `src/routes/` for pages, `.ts` files for JSON APIs, and `_layout.svelte` / `_layout.ts` for nested layouts and data loaders.
2. **A single Bun process.** The dev server, production server, and compiled standalone binary all run on `Bun.serve`. No Node, no Vite, no separate bundler runtime.
3. **Svelte 5 throughout.** Server-rendered HTML hydrates into a Svelte 5 app and navigates client-side. Layout chains run on both sides.

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
    _layout.svelte     # optional root layout
    _layout.ts         # optional root resolve hook
    index.svelte       # GET /
    about.svelte       # GET /about
    time.ts            # GET /time → JSON API
  socket.ts            # optional WebSocket handler
```

Run it:

```sh
belte dev      # build client bundle + start hot-reloading server
belte build    # produce dist/_app/ client bundle
belte start    # run the server against dist/
belte compile  # bundle dist/ and a Bun runtime into a single executable
```

Working examples live in [`examples/`](examples):

- [`examples/barebones`](examples/barebones) — the smallest possible app (just `index.svelte`).
- [`examples/kitchen-sink`](examples/kitchen-sink) — layouts, resolve hooks, JSON APIs, a WebSocket, Tailwind, and a cookie-session auth flow with a protected route.

---

## Project layout in your app

```
your-app/
  src/
    routes/             # filesystem routes
    index.html          # optional shell override
    socket.ts           # optional WebSocket entry
  .env                  # picked up by Bun (e.g. DEBUG=belte:*)
  dist/                 # produced by `belte build`
```

### Routes

- `routes/foo.svelte` → `GET /foo` (page)
- `routes/index.svelte` → `GET /`
- `routes/posts/[id].svelte` → `GET /posts/:id` (params via Bun's `FileSystemRouter`)
- `routes/foo.ts` → JSON API (see below)

### Layouts

- `routes/_layout.svelte` wraps every page; `routes/admin/_layout.svelte` wraps everything under `/admin`. Layouts compose root-to-leaf.
- `routes/_layout.ts` exports a `resolve` hook that runs server-side per request. Its result is merged shallowly into `data` and exposed to layouts/pages as a prop. Resolve hooks may return `{ redirect: "/somewhere" }` to short-circuit.

```ts
// routes/_layout.ts
import type { ResolveHook } from 'belte/types/ResolveHook'

export const resolve: ResolveHook = ({ url, params }) => {
    return { data: { requestedAt: new Date().toISOString() } }
}
```

```svelte
<!-- routes/_layout.svelte -->
<script lang="ts">
import type { Snippet } from 'svelte'

let { data, children }: { data: { requestedAt: string }; children: Snippet } = $props()
</script>

<header>rendered at {data.requestedAt}</header>
<main>{@render children()}</main>
```

### API routes

A `.ts` file in `routes/` exports HTTP-method-named functions:

```ts
// routes/time.ts — standalone API (no sibling page)
import type { ApiHandler } from 'belte/types/ApiHandler'

export const GET: ApiHandler = () => Response.json({ now: new Date().toISOString() })
```

Standalone API handlers must return a `Response`.

If a page (`foo.svelte`) and an api (`foo.ts`) share the same path, the api becomes a per-method data loader / form action for the page. Layout `resolve` hooks run first, then the matching method handler — which may return:

- `Response` — sent as-is (full control over status, headers, body).
- `{ data, redirect }` — same shape as a layout `resolve` hook. `redirect` short-circuits (`302`, or `303` for non-`GET`/`HEAD`); JSON requests get `{ "redirect": "…" }` instead. Otherwise `data` is merged shallowly over the page's resolved data (api wins).

```ts
// routes/signup.ts — colocated with routes/signup.svelte
import type { ApiHandler } from 'belte/types/ApiHandler'

export const POST: ApiHandler = async (req) => {
    const form = await req.formData()
    if (!form.get('email')) {
        return { data: { error: 'email required' } }
    }
    return { redirect: '/thanks' }
}
```

Unhandled non-`GET` methods return `405` with an `Allow` header.

### Caching

Belte sets sensible `Cache-Control` defaults:

- Hashed chunks under `/_app/` → `public, max-age=31536000, immutable`
- Unhashed entry/asset files (`client.js`, `client.css`, …) → `public, max-age=0, must-revalidate`
- SSR HTML / JSON / redirect responses → `private, no-cache`
- Errors (`404`, `405`, `500`) → `no-store`

To override, return a `Response` from an api handler — its headers are passed through untouched.

### WebSockets

If `src/socket.ts` exists, belte wires it into the same server:

```ts
import type { SocketUpgrade } from 'belte/types/SocketUpgrade'
import type { WebSocketHandler } from 'bun'

export const upgrade: SocketUpgrade<{ id: number }> = () => ({ data: { id: 1 } })

export const socket: WebSocketHandler<{ id: number }> = {
    open(ws) { ws.send(`hi #${ws.data.id}`) },
    message(ws, msg) { ws.send(`echo: ${msg}`) },
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
