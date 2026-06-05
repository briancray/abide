# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

One Bun runtime serves the same declared functionality to every surface a human or a machine reaches it through:

- **Humans** — web (Svelte SSR + SPA), an auto-generated cli, and a native desktop bundle.
- **Machines** — an auto-generated MCP server, and the same cli (scriptable).
- **The cli serves both** — humans run it interactively; machines pipe it in scripts.

Declare a function once; the bundler swaps the runtime so the same callable, with the same name and behaviour, runs on the server, in the browser, over MCP, and from the cli.

## Try it

The fastest path is a prebuilt example.

- **Scaffold a new app:**

  ```sh
  bunx @briancray/belte scaffold my-app
  cd my-app && bun install
  bun dev
  ```

- **Kitchen-sink (every feature in one app):**

  ```sh
  git clone https://github.com/briancray/belte
  cd belte/examples/kitchen-sink
  bun dev
  ```

Requires Bun ≥ 1.3.

## What is an isomorphic multimodal framework

- **A single runtime.** One `Bun.serve` process renders SSR, dispatches rpc, multiplexes sockets, answers MCP, and streams cli downloads — no separate API server, no separate build for each mode.
- **Declare once, use anywhere.** A function declared under `src/server/rpc/` becomes, for free: a typed remote callable in the browser, a JSON-over-HTTP endpoint, an MCP tool, and a cli command.
- **The namespace marks the side a name runs on.**

  | Import prefix | Runs | Examples |
  |---|---|---|
  | `@briancray/belte/server/*` | server only | `GET`, `socket`, `json`, `request`, `cookies` |
  | `@briancray/belte/browser/*` | client only | `page`, `navigate`, `subscribe` |
  | `@briancray/belte/shared/*` | both, identically | `cache`, `HttpError`, `withJsonSchema` |

There is no umbrella `index.ts` — every public name has its own module path, so importing one name never drags side-effecting siblings into the bundle.

### Declaration

Every file under `src/server/rpc/` exports exactly one verb-bound function. The filename is the export name and the URL (mounted under `/rpc/`); the imported verb picks the HTTP method.

```ts
// src/server/rpc/getOrder.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { error } from '@briancray/belte/server/error'

export const getOrder = GET<{ id: string }>(async ({ id }) => {
    const order = await db.getOrder(id)
    if (!order) {
        return error(404, 'order not found')
    }
    return json(order)
})
```

### Consuming the same declaration

| Surface | How |
|---|---|
| Browser / SSR | `import { getOrder } from '$server/rpc/getOrder.ts'` → `await getOrder({ id })` (the bundler swaps the server call for a fetch) |
| HTTP | `GET /rpc/getOrder?id=…` returns the JSON body |
| MCP | a `getOrder` tool (read-only verbs with a schema auto-expose) |
| cli | `app getOrder --id=…` |
| OpenAPI | described under `GET /openapi.json` |

The browser, MCP, and cli surfaces appear only when the verb is eligible (see [client targeting](#client-targeting)).

## Server

### Server / rpc

#### Declaring

```ts
type VerbHelper = <Return, InputSchema, FilesSchema>(
    handler: (args) => TypedResponse<Return>,
    opts?: VerbOptions,
) => RemoteFunction<Args, Return>
```

A verb helper (`GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD`) wraps a handler. Three call shapes:

| Call | `Args` source | `Return` source |
|---|---|---|
| `GET(fn)` | handler parameter type | inferred from `json`/`error`/… return |
| `GET(fn, { clients })` | handler parameter type | inferred; explicit surface targeting |
| `GET(fn, { inputSchema })` | `InferInput<InputSchema>` | inferred |

`opts`:

| Option | Type | Effect |
|---|---|---|
| `inputSchema` | Standard Schema | validates args; 422 on failure; feeds OpenAPI/MCP/cli |
| `outputSchema` | Standard Schema | describes the 200 body for OpenAPI + MCP `outputSchema` |
| `filesSchema` | Standard Schema | validates multipart `File` parts (see [uploads](#multipart-uploads)) |
| `clients` | `Partial<ClientFlags>` | which surfaces expose the verb (see [client targeting](#client-targeting)) |

Any [Standard Schema](https://standardschema.dev) library works (zod, valibot, arktype) with no adapter — same as `env()`.

```ts
import { POST } from '@briancray/belte/server/POST'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

export const createOrder = POST(({ sku, qty }) => json(db.insert({ sku, qty })), {
    inputSchema: z.object({ sku: z.string(), qty: z.number().int().positive() }),
})
```

**Response helpers** (each its own module under `@briancray/belte/server/*`):

| Helper | Returns | Default Content-Type |
|---|---|---|
| `json(data, init?)` | JSON body, `Cache-Control: no-store` | `application/json` |
| `error(status, message?, init?)` | plain-text error (reason phrase if no message) | `text/plain` |
| `redirect(url, status=302, init?)` | 3xx (relative URLs allowed) | — |
| `jsonl(asyncIterable, init?)` | streaming JSON Lines | `application/jsonl` |
| `sse(asyncIterable, init?)` | streaming Server-Sent Events (15s keepalive) | `text/event-stream` |

Return type carries `T` as a phantom brand (`TypedResponse<T>`), so `Return` infers from the handler body — no need to annotate it just to type the response. To short-circuit, `throw new Error(...)` or `throw new HttpError(error(...))`; the framework's `handleError` hook catches it.

**Request-scoped helpers** (call inside a handler or SSR render):

| Function | Returns | Notes |
|---|---|---|
| `request()` | the inbound `Request` | throws outside a request scope |
| `server()` | the live `Bun.Server` | throws before boot |
| `cookies()` | `Bun.CookieMap` | live `Map` + `.set(name, value, opts)` / `.delete(name)`; writes flush as `Set-Cookie` on return |

```ts
import { cookies } from '@briancray/belte/server/cookies'

const jar = cookies()
const session = jar.get('session')
jar.set('session', token, { httpOnly: true, sameSite: 'lax' })
```

##### Multipart uploads

Declare `filesSchema` alongside `inputSchema`. The handler receives the validated text fields intersected with the validated `File` parts; the caller sends a `FormData`. Files stay off the JSON-Schema projection (a `File` has no honest conversion), so only `inputSchema` feeds MCP/cli/OpenAPI.

```ts
export const upload = POST((args) => json({ saved: args.file.name }), {
    inputSchema: z.object({ title: z.string() }),
    filesSchema: z.object({ file: z.instanceof(File) }),
})
```

##### withJsonSchema

The framework probes a schema's `toJSONSchema()` to feed OpenAPI, MCP tool schemas, cli flag help, and the bundle setup form. Zod 4 / Effect / Arktype carry their own; wrap anything else once where it's declared:

```ts
import { withJsonSchema } from '@briancray/belte/shared/withJsonSchema'

export const config = env(withJsonSchema(vSchema, (s) => toJsonSchema(s)))
```

#### Consuming

The plain call **encodes args and decodes the response**:

- `GET` / `DELETE` / `HEAD` serialise args onto the query string; `POST` / `PUT` / `PATCH` send them as `application/json` (or a `FormData` body for uploads).
- The result is decoded by Content-Type: `application/json` → parsed JSON, `text/*` → string, `204`/empty → `undefined`, otherwise a `Blob`.
- Non-2xx throws `HttpError`, so the happy path never checks `.ok`.

```ts
const order = await getOrder({ id: '42' })   // Promise<Order>, throws HttpError on 4xx/5xx
```

**`.raw(args?)`** — the escape hatch. Same method/url/args, no decode, no throw; resolves to the underlying `Response` for callers that need status, headers, or body streaming.

```ts
const response = await getOrder.raw({ id: '42' })
if (response.status === 404) { /* … */ }
```

**`.stream(args?)`** — an iterable view of the response body. `sse`/`jsonl` handlers yield each frame; non-streaming handlers yield the decoded body once then complete. The result is a `Subscribable`, so it can be passed to `subscribe()`.

```ts
for await (const frame of orderFeed.stream({ since })) { /* … */ }
```

**HttpError** (`@briancray/belte/shared/HttpError`) carries the raw `Response`:

| Field | Type |
|---|---|
| `status` | `number` |
| `statusText` | `string` |
| `response` | `Response` |

**OpenAPI** — `GET /openapi.json` describes the public `/rpc/*` surface (verbs with schemas), at the conventional root path where external tooling looks.

### Server / sockets

Every file under `src/server/sockets/` exports exactly one `socket<T>()`. The filename is the export name and the socket's identity; the same import resolves to a server-side fan-out and a client-side ws proxy by build target.

#### Declaring

```ts
type socket = <T>(opts?: SocketOptions) => Socket<T>
```

| Option | Type | Effect |
|---|---|---|
| `history` | `number` | replay buffer size (replayed on first iteration) |
| `ttl` | `number` | evict history entries older than `ttl` ms (lazy, no timer) |
| `clientPublish` | `boolean` | allow clients to publish (off by default) |
| `schema` | Standard Schema | validates payloads on publish; `T` infers from it; advertises to MCP/cli |
| `clients` | `Partial<ClientFlags>` | which surfaces expose the socket |

```ts
// src/server/sockets/chat.ts
import { socket } from '@briancray/belte/server/socket'
import { z } from 'zod'

export const chat = socket({ history: 50, schema: z.object({ user: z.string(), text: z.string() }) })
```

#### Publishing

```ts
type publish = (message: T) => void
```

`publish` is isomorphic. Server-side it notifies in-process iterators and broadcasts to remote subscribers (over Bun's native `server.publish`); client-side (via the proxy) it sends a `pub` frame the dispatcher validates against `clientPublish`.

```ts
chat.publish({ user, text })
```

#### Consuming

A `Socket<T>` **is** the `AsyncIterable`. `for await (const m of chat)` replays the full history buffer then tails live. `.tail(count)` replays the last `count` items (default `0`, clamped to `history`) before tailing.

```ts
type Socket<T> = AsyncIterable<T> & {
    readonly name: string
    publish(message: T): void
    tail(count?: number): AsyncIterable<T>
}
```

```ts
for await (const message of chat) { /* history, then live */ }
for await (const message of chat.tail(10)) { /* last 10, then live */ }
```

In the browser pass a socket to `subscribe()` for a reactive view (below).

## Clients

### Shared

#### cache

`cache(fn, options?)` returns an invoker; calling it checks a store keyed on the call and returns a shared promise on hit, or invokes `fn` once on miss. Works identically on server and client (the bundler swaps the underlying remote impl). `fn` is a remote function (`getOrder`), its `.raw`, or a plain producer returning a Promise.

```ts
import { cache } from '@briancray/belte/shared/cache'

cache(getOrder)({ id })       // Promise<Order>     (decoded body)
cache(getOrder.raw)({ id })   // Promise<Response>  (raw escape hatch)
cache(fetchRates)()           // Promise<Rates>     (plain producer)
```

| Option | Type | Effect |
|---|---|---|
| `key` | `string \| unknown[] \| object` | override the auto-derived key |
| `ttl` | `number` | ms past resolve the entry stays live: omitted = forever, `0` = dedupe only, `N` = TTL |
| `scope` | `string \| string[]` | tag group(s) for `invalidate({ scope })` |
| `global` | `true` | use the process-level store (reuse across requests) instead of the request-scoped one |
| `invalidate` | `{ throttle?: N } \| { debounce?: N }` | coalesce invalidation bursts; serve stale until the refetch resolves |

**On the server**, the default store is request-scoped (per-user data can't leak across requests); `global: true` opts into a process-level store for memoising external endpoints. **On the client** there's one tab store, so `global` is a no-op.

`cache.invalidate(selector?)` drops matching entries and notifies readers; `cache.pending(selector?)` is a reactive in-flight probe. Both share a selector grammar: `undefined` → all, a remote `fn` → that function's calls, a producer → its calls, `{ key?, scope? }` → a named entry and/or tagged group.

**SSR** — how you consume the call decides inline vs streaming, per Svelte's `{#await}` rule:

```svelte
<script>
const order = await cache(getOrder)({ id })   <!-- blocks render → baked into initial HTML -->
</script>

{#await cache(getOrder)({ id }) then order}    <!-- shell flushes now, value streams in -->
    {order.total}
{/await}
```

#### HttpError

See [rpc consuming](#consuming). Importable on both sides as `@briancray/belte/shared/HttpError` for `instanceof` checks in shared error UI.

### Browser

#### Pages

Every folder under `src/browser/pages/` containing a `page.svelte` mounts at that folder's URL. Pages are Svelte 5 components and render on both the server (SSR) and the client (after hydration). Dynamic segments use `[id]` / `[...rest]` folders.

```svelte
<!-- src/browser/pages/page.svelte → GET / -->
<script lang="ts">
import { cache } from '@briancray/belte/shared/cache'
import { getHello } from '$server/rpc/getHello.ts'

const hello = await cache(getHello)()
</script>

<h1>{hello.message}</h1>
```

#### Layouts

A `layout.svelte` wraps every page below it. Layouts are **nearest-only**: the deepest matching layout runs and replaces ancestors (they don't stack). A nested error fallback is an `error.svelte` (nearest-only, same as layouts), rendered with `{ status, message, stack }` props on a 404 or a page-render throw.

```svelte
<script lang="ts">
let { children }: { children: import('svelte').Snippet } = $props()
</script>

<nav><a href="/">Home</a></nav>
<main>{@render children()}</main>
```

#### navigate

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

SPA navigation. Writes history (push by default), resolves the new view, and swaps the page component. Same-pathname changes (only `search`/`hash`) skip the network round-trip and just reassign `page.url`. Falls back to a hard navigation if the resolve fetch or page import fails; cross-origin hrefs hard-navigate.

```ts
import { navigate } from '@briancray/belte/browser/navigate'
await navigate('/orders/42')
```

#### Page state

`page` (from `@briancray/belte/browser/page`) is a reactive object describing the current location. It's a discriminated union keyed on `route`, so narrowing on `page.route` gives the matching `params` shape (the route table is codegen'd from your `pages/` tree).

| Field | Type |
|---|---|
| `route` | the matched route key |
| `params` | route params (`{ id }`, `{ rest }`, …) |
| `url` | live WHATWG `URL` (reassigned on every nav) |

```svelte
<script lang="ts">
import { page } from '@briancray/belte/browser/page'
</script>

{#if page.route === '/orders/[id]'}
    Order {page.params.id}
{/if}
```

#### subscribe

```ts
type subscribe = <T>(subscribable: Subscribable<T>) => T | undefined
```

Reactive consumer for streaming sources — both a `Socket<T>` and the result of `fn.stream(args)` satisfy `Subscribable`. The first `$derived` read in a tracking scope opens the underlying iterator; the last reader to stop closes it. Many `$derived`s reading the same source share one subscription (deduped by name). No-op during SSR.

```svelte
<script lang="ts">
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))               // socket
const tick = $derived(subscribe(tickFeed.stream()))    // rpc stream
</script>

{#if subscribe.status(chat) === 'open'}{latest?.text}{/if}
```

`subscribe.error(x)` surfaces a stream error (never thrown, so reading `latest` can't crash the component); `subscribe.status(x)` is `'pending' | 'open' | 'done' | 'error'`.

#### cache reactivity

`cache()` reactivity is implicit: the invoker subscribes the surrounding `$derived`/`$effect` to its key. A `cache.invalidate(...)` re-runs that scope, which calls `cache()` again and gets a fresh entry. Use `cache.pending(fn)` for a reactive per-route spinner. Outside a tracking scope the subscription is a no-op, so `cache()` behaves the same in plain code.

### MCP

Generated automatically — there is no user-authored MCP server. The endpoint is `POST /__belte/mcp`; auth inherits from the inbound request (bearer/cookie headers flow into each synthesized rpc request).

- **rpc are tools.** Every verb with `clients.mcp: true` becomes a tool; the HTTP verb feeds each tool's annotations. Read-only verbs (`GET`/`HEAD`) with a schema auto-expose; mutating verbs opt in explicitly.
- **sockets are tools too.** A schema'd socket exposes a `<name>-tail` read tool (and a `<name>-publish` tool when `clientPublish` is set).

**resources/** — files under `src/mcp/resources/` are served as MCP resources at `belte://resources/<path>`. Text MIME types return inline `text`; everything else returns base64 `blob`.

**prompts/** — each `src/mcp/prompts/<name>.md` becomes an MCP prompt. YAML frontmatter carries `description` and an `arguments` list; the body interpolates `{{name}}` placeholders at render time.

```markdown
---
description: Summarize an order for support
arguments:
  - name: orderId
    description: the order to summarize
    required: true
---
Summarize order {{orderId}} for a support agent.
```

### CLI

Generated automatically — every belte server ships a cli. The standalone binary (`belte cli`) is a thin remote client that talks to a running server over HTTP and can boot one beside it.

- **rpc are commands.** Args and flags derive from each verb's schema (`app getOrder --id=42`); `--json <object>` or piped stdin supplies the whole args bag. Sockets become `<name>-tail` / `<name>-publish` commands. Streaming responses print frame-by-frame as NDJSON.
- **Connection** is managed with `/`-prefixed verbs so a bare word is always a command:

  | Command | Effect |
  |---|---|
  | `app /connect <url>` | connect to a remote server, open a session |
  | `app /start` | boot a local instance, open a session |
  | `app /disconnect` | forget the saved connection |
  | `app` (TTY) | resume the saved connection in an interactive session |
  | `app <cmd> [--flags]` | one-shot rpc against the resumed target |

- **Environment** (shell overrides baked defaults):

  | Variable | Effect |
  |---|---|
  | `APP_URL` | default server URL (baked at install) |
  | `APP_TOKEN` | sent as `Authorization: Bearer <value>` |

- **Downloading.** `GET /__belte/cli` returns a platform-detecting install script; `GET /__belte/cli/<platform>` streams a gzipped tarball with the thin binary, its sibling server, and a `.env` carrying `APP_URL` (plus `APP_TOKEN` when the download request was authenticated).
- **Help chrome.** `src/cli/banner.txt` prints atop top-level help, `src/cli/footer.txt` below it. Both optional.

### Bundle

`belte bundle` assembles a movable, self-contained native desktop app for the host platform (a `.app` on macOS, a flat directory elsewhere) — the server binary, the launcher, and the webview lib together. It boots into a connect screen that can **start the embedded server** or **connect to a remote one**.

**window.ts** — default-export a `BundleWindow` from `src/bundle/window.ts` to configure the window:

| Field | Type | Effect |
|---|---|---|
| `title` | `string` | window title (defaults to the program name) |
| `width` / `height` | `number` | initial size |
| `menu` | `BundleMenu[]` | custom top-level menus (see below) |
| `config` | Standard Schema | overrides the first-run setup form's schema (default: the env schema) |

The standard App/Edit/Window menus plus a built-in File menu (Start server / Connect / Disconnect) are always installed.

```ts
// src/bundle/window.ts
import type { BundleWindow } from '@briancray/belte/bundle/BundleWindow'

export default {
    title: 'My App',
    width: 1100,
    menu: [{ label: 'Sync', items: [{ label: 'Sync now', shortcut: 's', emit: 'sync' }] }],
} satisfies BundleWindow
```

**disconnected.svelte** — drop a `src/bundle/disconnected.svelte` to override the default connect screen.

**onMenu** — custom menu items dispatch a `belte:menu` event into the page; subscribe with `onMenu`. Both forms return an unsubscribe, so they drop into a Svelte `$effect`:

```svelte
<script lang="ts">
import { onMenu } from '@briancray/belte/bundle/onMenu'

$effect(() => onMenu('sync', () => syncNow()))
$effect(() => onMenu((name) => { /* catch-all */ }))
</script>
```

A `BundleMenuItem` is a `{ separator }`, an `{ emit }` item (fires `belte:menu` into the page), or a `{ navigate }` item (repoints the window). `shortcut` is the Cmd-based key.

**icon.png** — drop a `src/bundle/icon.png` (or a ready-made `src/bundle/icon.icns`) and the macOS bundle converts and wires it as the app icon.

The bundle is unsigned; distribution still needs platform signing/notarization.

## Some details

### Config / env

`env(schema)` validates `Bun.env` against a Standard Schema at boot — a missing or malformed variable fails the boot loudly with every issue listed. Belte eager-imports `src/server/config.ts` (no import needed from your code); import the typed result anywhere via `$server/config`.

```ts
// src/server/config.ts
import { env } from '@briancray/belte/server/env'
import { z } from 'zod'

export const config = env(z.object({ DATABASE_URL: z.string(), PORT: z.coerce.number() }))
```

The same declaration drives the bundle's first-run setup form. Delete the file to read `Bun.env` untyped.

### App hooks

`src/app.ts` exports optional hooks (resolved at build time — no import needed). All optional.

| Hook | Signature | Runs |
|---|---|---|
| `init` | `({ server }) => void \| cleanup` | once after `Bun.serve` is up; returned cleanup runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | single middleware wrapping the request pipeline |
| `handleError` | `(error, request) => Response` | custom 500 fallback |

### Project layout

```
src/
  app.ts                     optional hooks (init / handle / handleError)
  server/
    config.ts                typed env (optional)
    rpc/<name>.ts            one verb-bound function per file
    sockets/<name>.ts        one socket per file
  browser/
    app.html                 shell (optional)
    app.css                  global styles
    pages/**/page.svelte     routed pages (folder path = URL)
    pages/**/layout.svelte   nearest-only layouts
    pages/**/error.svelte    nearest-only error views
    public/**                static files served at the site root
  mcp/
    prompts/<name>.md        MCP prompts
    resources/**             MCP resources
  cli/
    banner.txt / footer.txt  cli help chrome
  bundle/
    window.ts                bundle window config
    disconnected.svelte      connect-screen override
    icon.png                 app icon
```

Aliases resolve to these directories: `$server`, `$browser`, `$shared`, `$mcp`, `$cli`. `lib/` is userland — co-locate shared helpers under each surface (e.g. `src/server/lib/`, `src/browser/lib/`) and declare your own aliases for them.

### CLI commands

| Command | Effect |
|---|---|
| `bunx @briancray/belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte compile [--target] [--out]` | build a standalone server executable |
| `belte cli [--target] [--out] [--platforms=a,b,c]` | build the thin cli binary (ships the server beside it) |
| `belte bundle` | build a movable native app for this platform |

### public/ files

Files under `src/browser/public/` are served at the site root (`src/browser/public/favicon.ico` → `/favicon.ico`), sidestepping the request cache and `app.handle` middleware. Root-absolute `url(/…)` references in stylesheets resolve here at runtime.

### Bundling

The client builds to hashed chunks under `dist/_app/`, each written with a precompressed `.zst` sibling served to zstd-capable clients. `belte compile` embeds the chunks (and `public/`, `mcp/resources/`) zstd-compressed into a single binary. Long-lived idle assets are cached aggressively; rpc replies default to `Cache-Control: no-store`.

### Logging and DEBUG

The shared logger adds a `[belte]` prefix and per-method/per-status colouring to request lines.

| Variable | Effect |
|---|---|
| `DEBUG=belte` | enable request logging and the browser-only-route diagnostic |
| `BELTE_IDLE_TIMEOUT` | Bun's per-connection idle timeout in seconds (streaming responses opt out automatically) |
| `PORT` | pin the listener; unset, it scans upward from 3000 |

---

<a id="client-targeting"></a>**Client targeting.** Every verb and socket carries `ClientFlags` deciding which non-web surfaces advertise it. Defaults: a verb/socket with a schema exposes to the cli; read-only schema'd verbs (and schema'd sockets) also expose to MCP; mutating verbs require an explicit `clients.mcp`. The browser is exposed unless turned off. Pass `clients` to override — e.g. `{ browser: false }` for a server-internal rpc, or `{ mcp: true }` to expose a mutating verb as a tool.
