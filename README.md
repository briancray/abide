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

A working example lives in [`apps/example`](apps/example).

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

### API routes

A `.ts` file in `routes/` exports HTTP-method-named functions:

```ts
// routes/time.ts
export function GET(): Response {
    return Response.json({ now: new Date().toISOString() })
}

export function POST(req: Request, params: Record<string, string>): Response {
    // ...
}
```

Unhandled methods return `405` with an `Allow` header.

### WebSockets

If `src/socket.ts` exists, belte wires it into the same server:

```ts
import type { SocketUpgrade } from 'belte/server'
import type { WebSocketHandler } from 'bun'

export const path = '/ws'

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

---

## Package entry points

`belte`'s `package.json` exposes three subpath imports plus the main barrel:

| Import                | Purpose                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `belte`               | Main barrel — all public types and functions below.                                |
| `belte/server`        | Just `createServer` and its hook types. Use in `_layout.ts`, `socket.ts`, etc.     |
| `belte/client`        | Just `startClient`. The generated client entry imports this.                       |
| `belte/preload`       | Bun preload that registers the Svelte and resolver plugins. Used by the CLI.       |

---

## Public API

Everything below is exported from `belte` (the main barrel). Where it makes sense it is also re-exported from a narrower subpath (`belte/server`, `belte/client`).

### `createServer(options) → Promise<Bun.Server>`

Starts the SSR/SPA server. The compiled `serverEntry.ts` calls this for you; you only call it directly if you're building a custom entrypoint.

```ts
import { createServer } from 'belte/server'

await createServer({
    routes,        // Routes
    apis,          // ApiRoutes | undefined
    layouts,       // Layouts | undefined
    shell,         // string — HTML template with <!--ssr:head--> / <!--ssr:body--> / <!--ssr:state--> markers
    socket,        // Bun WebSocketHandler | undefined
    socketUpgrade, // SocketUpgrade<T> | undefined
    socketPath,    // string, defaults to "/__belte/socket"
    assets,        // Record<string, Uint8Array> of pre-gzipped assets, or undefined to read from disk
    distDir,       // string, defaults to `${cwd}/dist`
    port,          // number, defaults to PORT env or 3000
})
```

The server handles:

- `/_app/*` — gzipped static assets (in-memory if `assets` is provided, otherwise from `${distDir}/_app/`)
- `/__belte/resolve?p=<pathname>` — JSON endpoint the client uses to resolve a route during SPA navigation
- `/__belte/socket` (or `socketPath`) — WebSocket upgrade endpoint when `socket` is set
- everything else — page render (SSR) or API route dispatch

### `startClient({ routes, layouts }) → Promise<void>`

Hydrates the SSR'd page, then takes over navigation. Intercepts same-origin `<a>` clicks and `popstate`, fetches `/__belte/resolve` for the new route, swaps the page + layout chain, and resets scroll. Falls back to a full navigation on failure.

The generated `clientEntry.ts` calls this; you only call it directly if you're customizing the client bootstrap.

### `build({ cwd? }) → Promise<void>`

Bundles the client into `${cwd}/dist/_app/` using `Bun.build`:

- entry: belte's `clientEntry.ts`
- target: `browser`, minified, code-split, source-mapped
- plugins: `sveltePlugin({ generate: 'client' })`, `belteResolverPlugin({ cwd })`, and `bun-plugin-tailwind` if installed
- gzips every output and writes `<file>.gz` siblings

### `compile({ cwd?, target?, outfile? }) → Promise<string>`

Calls `build`, then `Bun.build({ compile: { target, outfile } })` against `serverEntry.ts` with `belteResolverPlugin({ embedAssets: true })`. Produces a single executable that embeds the gzipped client bundle. Returns the output path.

Helpers:

- `detectTarget(): CompileTarget` — picks the right `bun-<platform>-<arch>` for the host.
- `normalizeTarget(input: string): CompileTarget` — accepts `darwin-arm64` or `bun-darwin-arm64`.

### `sveltePlugin({ generate })`

`BunPlugin` that compiles `.svelte` and `.svelte.{js,ts}` files via `svelte/compiler`. `generate` is `'client'` or `'server'`. CSS is injected (no separate stylesheet step).

### `belteResolverPlugin({ cwd?, embedAssets? })`

`BunPlugin` that resolves the virtual modules belte's entry files import — `_virtual/routes`, `_virtual/apis`, `_virtual/layouts`, `_virtual/shell`, `_virtual/socket`, `_virtual/assets`. Scans `${cwd}/src/routes/` and generates lazy `import()` maps so route splitting works out of the box.

When `embedAssets: true` (set during `compile`), it inlines the gzipped contents of `${cwd}/dist/_app/*.gz` as base64 so the binary is self-contained.

### `routePrefixes(route: string) → string[]`

For a route key like `"posts/[id]/comments"` returns `["", "posts", "posts/[id]"]` — the directory prefixes from root to leaf, with the leaf basename dropped. Used internally to walk layout chains.

### `log`

Colorized logger built on `Bun.color`. Auto-disables ANSI when `Bun.enableANSIColors` is `false` (non-TTY or `NO_COLOR`).

```ts
import { log } from 'belte'

log.info('routes resolved')
log.warn('something looks off')
log.error(err)                                // accepts Error or any value
log.success('ready at http://localhost:3000')
log.detail('  - dist/_app/index.js')          // dim, no prefix
log.debug('belte:router', 'matched /foo')     // gated by DEBUG env (see below)
log.request('GET', '/foo', 200, 1.42)         // METHOD path STATUS Nms, all colorized
```

All methods except `request` prefix output with a bold magenta `[belte]`.

### `isDebugEnabled(name: string) → boolean`

Matches the conventions of the [`debug`](https://www.npmjs.com/package/debug) npm package against `process.env.DEBUG`:

- `DEBUG=belte` enables `belte`
- `DEBUG=belte:*` enables `belte` and any `belte:foo`
- `DEBUG=*` enables everything
- `DEBUG=a,belte` comma-separated list

The server uses this to gate per-request logging (`DEBUG=belte` turns on the `METHOD path STATUS Nms` line for every request).

### Types

#### Routes & APIs

```ts
type Routes = Record<string, () => Promise<{ default: any }>>

type ApiHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>
type ApiModule  = Partial<Record<string, ApiHandler>>   // keyed by HTTP method
type ApiRoutes  = Record<string, () => Promise<ApiModule>>
```

#### Layouts

```ts
type LayoutViewModule = { default: any }
type LayoutDataModule = { resolve?: ResolveHook }

type LayoutEntry = {
    view?:    () => Promise<LayoutViewModule>
    resolve?: () => Promise<LayoutDataModule>
}

type Layouts = Record<string, LayoutEntry>   // key is directory prefix; "" = root
```

#### Resolve hook

```ts
type ResolveContext = {
    req: Request
    url: URL
    route: string
    params: Record<string, string>
}

type ResolveResult = {
    data?: Record<string, unknown>
    redirect?: string
}

type ResolveHook = (ctx: ResolveContext) => ResolveResult | Promise<ResolveResult>
```

Layouts run root-to-leaf. Each `data` object is shallow-merged into the running result and passed to the page as a prop. Returning `{ redirect }` short-circuits the chain and sends a 302 (server) or `history.replaceState` + re-navigate (client).

#### WebSocket upgrade

```ts
type SocketUpgrade<T> = (req: Request) => false | { data: T } | Promise<false | { data: T }>
```

Return `false` to reject the upgrade with a 403, or `{ data }` to attach per-connection state.

#### Compile target

```ts
type CompileTarget =
    | 'bun-darwin-arm64'
    | 'bun-darwin-x64'
    | 'bun-linux-arm64'
    | 'bun-linux-x64'
    | 'bun-windows-x64'
```

---

## Environment variables

| Variable             | Effect                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `PORT`               | Server port. Defaults to `3000`.                                                      |
| `DEBUG`              | Enables `log.debug(scope, …)` and request logging. See `isDebugEnabled` for patterns. |
| `NO_COLOR`           | Disables ANSI colors in `log`. Standard `NO_COLOR` semantics.                         |
| `BELTE_SVELTE_MODE`  | `server` (default) or `client`. Used by `belte/preload` to pick the Svelte target.    |

Bun auto-loads `.env` from the cwd, so dropping `DEBUG=belte:*` in `.env` is enough to enable verbose logging in development.
