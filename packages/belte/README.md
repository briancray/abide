# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an isomorphic, multimodal HTTP framework for Bun and Svelte 5. You declare a function once; the bundler swaps the runtime per target, so the same callable renders on the server, fetches from the browser, and exposes itself to machines.

```ts
// src/server/rpc/getProduct.ts — file path is the URL, export is the verb
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

export const getProduct = GET(({ id }) => json(products.find(id)), {
    inputSchema: z.object({ id: z.string() }),
})
```

That one declaration fans out across every surface — each line a real consume form:

```text
export const getProduct = GET(handler, { inputSchema })
        │
        ├── SSR call         await getProduct({ id: '1' })  in-process
        ├── browser call     await getProduct({ id: '1' })  real fetch
        ├── HTTP endpoint    GET /rpc/getProduct?id=1
        ├── OpenAPI op       GET /openapi.json
        ├── MCP tool         getProduct, via POST /__belte/mcp
        └── CLI subcommand   myapp getProduct --id 1
```

At boot the server prints the surface map — every page, socket, and rpc with the surfaces it reaches (`DEBUG=-belte` silences it):

```text
pages:
  page                      layout  error
  /                         /       /
  /products/[id]            /       /
sockets:
  socket                    schema  browser  mcp  cli  publish
  chat                      ✓       ✓        ✓    ✓    ·
rpcs:
  http                      schema  browser  mcp  cli
  GET   /rpc/getProduct     ✓       ✓        ✓    ✓
  POST  /rpc/createProduct  ✓       ✓        ·    ✓
```

`inputSchema` is the gate: without one, a declaration is browser-only; with one, CLI flips on, and MCP flips on for reads (GET/HEAD) — mutations need an explicit `clients: { mcp: true }`.

- Zero runtime dependencies; Svelte is the only required peer.
- One runtime: dev, build, and compiled binary run the same code paths.

```sh
bunx belte scaffold myapp   # scaffolds, installs, and starts the dev server
```

## Layout

Imports come from three namespaces — `@belte/belte/server/*` (server-only), `@belte/belte/browser/*` (client-only), and `@belte/belte/shared/*` (isomorphic: `cache`, `pending`, `refreshing`, `online`, `health`, `url`, `HttpError`, `withJsonSchema`, `log`, `trace`). Inside a project, `$server` / `$browser` / `$shared` / `$mcp` / `$cli` alias the matching `src/` directories. A project:

```text
src/
  app.ts                    optional hooks — see Reference
  server/
    config.ts               optional typed env — see Reference
    rpc/getProduct.ts       one verb per file → GET /rpc/getProduct
    sockets/chat.ts         one socket per file → "chat"
  browser/
    app.html                optional HTML shell override
    pages/
      page.svelte           /
      layout.svelte         wraps / and below (nearest wins)
      error.svelte          error boundary for / and below
      products/[id]/
        page.svelte         /products/[id]
    public/                 static files served at the site root
  mcp/
    prompts/review.md       one MCP prompt per file ({{name}} placeholders)
    resources/              files listed/read over MCP
  bundle/window.ts          optional desktop window config
  cli/                      optional banner.txt / footer.txt for the CLI
```

Nested rpc files keep their folders: `users/list.ts` mounts at `/rpc/users/list` and becomes the `users-list` tool/subcommand. `[...rest]` page folders catch all deeper segments.

## rpc

`GET` `POST` `PUT` `PATCH` `DELETE` `HEAD`, each from `@belte/belte/server/<VERB>`. The export name must match the filename; each file declares exactly one verb.

| option | effect |
| --- | --- |
| `inputSchema` | Standard Schema (zod, valibot, arktype, …); failures return 422 |
| `outputSchema` | feeds the OpenAPI 200 response and the MCP tool `outputSchema` |
| `filesSchema` | validates multipart `File` parts, merged into args; call with a `FormData` |
| `clients.browser` | default `true` |
| `clients.mcp` | default `true` for GET/HEAD with `inputSchema`, else `false` |
| `clients.cli` | default `true` with `inputSchema`, else `false` |
| `crossOrigin` | `true` exempts a mutating verb from the same-origin 403 |
| `maxBodySize` | per-verb cap on received body bytes (413 past it); omitted, Bun's server-wide ceiling applies |

| consume form | returns |
| --- | --- |
| `await getProduct(args)` | decoded body; non-2xx throws `HttpError` |
| `getProduct.raw(args)` | the raw `Response` |
| `getProduct.stream(args)` | a `Subscribable` for `tail()` over a `jsonl`/`sse` body |

> GET/DELETE/HEAD args travel as query strings — every value arrives as a string, so schema-coerce (`z.coerce.number()`) any non-string field.

If a schema library lacks `toJSONSchema()`, wrap it once at declaration: `withJsonSchema(schema, (s) => toJsonSchema(s))` (`@belte/belte/shared/withJsonSchema`).

## Response helpers

All from `@belte/belte/server/*`; each defaults to `Cache-Control: no-store` unless the caller overrides it, and each brands its `T` so the verb infers `Return` from the handler body.

| helper | response |
| --- | --- |
| `json(data, init?)` | `Response.json` with rpc defaults; `json(undefined)` emits 204, decoded back to `undefined` |
| `jsonl(iterable, init?)` | `application/jsonl`, one JSON value per line; generator errors become a final `{"$error":…}` line |
| `sse(iterable, init?)` | `text/event-stream` with a 15s keepalive comment; errors become an `event: error` frame |
| `error(status, message?, init?)` | `text/plain`; message defaults to the reason phrase |
| `redirect(url, status = 302, init?)` | accepts relative URLs; 301/302/303/307/308 |

## Request scope

All throw outside a request scope (module top level, `app.ts` init) rather than returning `undefined`.

| helper | returns |
| --- | --- |
| `request()` | the inbound `Request` for the in-flight SSR/rpc pass |
| `cookies()` | `Bun.CookieMap` over the inbound `Cookie` header; `set`/`delete` flush as `Set-Cookie` on the way out |
| `server()` | the live `Bun.serve` instance (a no-op stand-in under in-process dispatch: CLI, MCP, tests) |

> In-process calls (SSR, MCP) forward only an allowlist of inbound headers: `cookie`, `authorization`, `traceparent`, `tracestate`, `x-forwarded-for`, `x-forwarded-proto`, `x-forwarded-host`. A handler reading anything else during SSR sees nothing — add names via `forwardHeaders` in `src/app.ts`.

## Security defaults

- Browser mutations are same-origin by default: a non-GET/HEAD request whose `Origin` doesn't match the request's own host gets 403. `crossOrigin: true` opts a single verb out.
- The MCP endpoint and socket publishes get the same `Origin` check, so a hostile page can't ride a visitor's cookies into them; native clients send no `Origin` and pass.
- When MCP tools are exposed with no `app.handle` middleware, boot prints a warning — `app.handle` is the auth seam:

```ts
// src/app.ts
export async function handle(request: Request, next: (req: Request) => Promise<Response>) {
    if (!(await authenticated(request))) {
        return new Response('Unauthorized', { status: 401 })
    }
    return next(request)
}
```

> The `Origin` check compares against the request's own `Host` — a reverse proxy must pass the original `Host` or same-origin mutations will 403.

## Sockets

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ user: z.string(), text: z.string() }),
    tail: 50,
})
```

| option | effect |
| --- | --- |
| `tail` | retain the last N frames; late joiners seed via `chat.tail(count?)` |
| `ttl` | retained frames older than `ttl` ms are evicted lazily |
| `clientPublish` | default `false` — browsers may publish only when set |
| `schema` | validates publishes (sync only); flips `mcp`/`cli` on |
| `clients` | per-surface exposure, same shape as rpc |

`chat.publish(msg)` is isomorphic — server-side it notifies in-process iterators and broadcasts; client-side it sends a publish frame the server validates. Server code consumes live frames with `for await (const msg of chat)`; browsers read via `tail(chat)`. Every socket multiplexes over one framework connection per client.

## cache

`cache(fn, options?)(args?)` — from `@belte/belte/shared/cache` — dedupes identical in-flight calls and optionally retains the result. `fn` is a remote function, its `.raw`, or any named promise-returning producer.

```ts
const product = await cache(getProduct, { ttl: 60_000 })({ id })
const create = cache(createProduct, { ttl: 0 }) // mutation idiom: coalesce, retain nothing
cache.on(chat, (msg, { invalidate }) => invalidate(getProduct, { id: msg.id })) // event-driven
```

| option | effect |
| --- | --- |
| `ttl` | omitted = keep forever; `0` = dedupe only; N = expire N ms after resolve |
| `scope` | tag(s) so `cache.invalidate({ scope })` drops a group |
| `global` | process-level store (server) — reuse across requests; tab-scoped no-op on the client |
| `invalidate` | `{ throttle: N }` or `{ debounce: N }` — coalesce invalidations into stale-while-revalidate refetches |

`cache.invalidate(fn?, args?)` (or `{ scope }`, or bare for everything) drops matching entries; readers in a `$derived`/`$effect` re-run and refetch. `cache.on(source, handler)` runs the handler once per frame of a socket or rpc stream, with a scoped `invalidate` — the declarative "this event stales that data" binding. On transport loss it re-invalidates everything it has covered (a missed frame is a missed invalidation), then reconnects; it's a no-op during SSR.

How you consume a read during SSR decides inline vs streaming: `await cache(getProduct)({ id })` blocks the render and bakes into the HTML; `{#await cache(getProduct)({ id })}` flushes the shell now and streams the value in on the same response.

> - Warm SSR keys return synchronously — the decoded form is typed `Promise<Return> | Return`, so consume via `await`/`{#await}`, never `.then`.
> - A top-level `await` flips that component instance to await-everything — a sibling `{#await}` gets inlined too. Isolate blocking reads in child components to mix both on one page.
> - Producers key by function reference: hoist them to a named binding, or they never coalesce (anonymous producers log a warning).
> - An `invalidate` policy re-runs the call unprompted, so it refuses writes at wrap time — only GET replays; SSR snapshots likewise replay GET entries only.

## pending / refreshing

```ts
import { pending } from '@belte/belte/shared/pending'
import { refreshing } from '@belte/belte/shared/refreshing'

const saving = $derived(pending(createProduct))
const updating = $derived(refreshing(getProduct, { id }))
```

`pending` answers "is there no value yet?" — any in-flight call or first-frame-pending stream. `refreshing` answers "is a held value being superseded?" — a revalidating cache entry or a reconnecting stream. Both take no args (global), a function, `(fn, args)`, `{ scope }`, or a socket — and report, never act: probing opens no fetch and no stream.

## online / health

```ts
import { online } from '@belte/belte/shared/online'
import { health } from '@belte/belte/shared/health'

const connected = $derived(online())  // browser online/offline events
const backend = $derived(health())    // { reachable, belte, name, version, ...hook fields }
```

`online()` reports the browser's connectivity reactively; constant `true` on the server, which is its own backend. `health()` returns `reachable` plus the `/__belte/health` payload whole — the framework identity (`belte`/`name`/`version`) and the `health(request)` hook's fields, typed via the generated `AppHealth` — polled only while a tracking scope reads it: every 10s, paused in hidden tabs, probed immediately when the tab returns or the network comes back, with `reachable` composed against `navigator.onLine` so a lost network reports instantly. A page that read `health()` during SSR ships the payload in the document — hydration seeds from it and the first poll waits a full interval instead of re-probing the server that just responded. Last-known fields persist while unreachable — "was authenticated, currently unreachable" stays distinguishable from "reachable, not authenticated".

## Pages

- Folders under `src/browser/pages/` are routes: `page.svelte` renders, `[id]` captures a param, `[...rest]` catches all deeper segments. Page params arrive as component props.
- `layout.svelte` wraps every route at its prefix and below — nearest ancestor only, no stacking.
- `error.svelte` is the boundary for its prefix: a throw during render swaps it in with `{ status, message, stack }` props.

```svelte
<script>
    import { page } from '@belte/belte/browser/page'
    import { navigate } from '@belte/belte/browser/navigate'
    import { url } from '@belte/belte/shared/url'
</script>

<a href={url('/products/[id]', { id: 7 })} class:active={page.url.pathname.startsWith(url('/products'))}>
```

`page` exposes `route` / `params` / `url` / `navigating`, reactive on the client and request-scoped on the server. `navigate(href, { replace?, scroll? })` resolves SPA navigations and falls back to a hard navigation for anything else; `url()` types path params and rpc query args, and prefixes the `APP_URL` mount base — `page.url` is browser-space on both sides, so compare it against `url()` output as above.

## tail

```ts
import { tail } from '@belte/belte/browser/tail'

const latest = $derived(tail(chat))               // T | undefined, latest frame
const recent = $derived(tail(chat, { last: 20 })) // T[], rolling window
const ticks = $derived(tail(feed.stream({ id }))) // rpc jsonl/sse stream
```

Readers of the same source share one subscription, opened on first `$derived` read and closed on the last. `tail.status(x)` is `pending` → `open` → `done` | `error`; `tail.error(x)` returns the failure instead of throwing into your component. A dropped socket connection is not an error: the window is retained, `refreshing` flips on, and the reconnect's replay commits atomically over the held frames.

> `tail` is a no-op during SSR (`undefined` / `[]`) — seed initial HTML with `cache()` against an rpc read, layer `tail()` for liveness after hydration.

## agent

```ts
// src/server/rpc/chat.ts
import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

`agent(engine, messages)` runs a model engine against the app's own MCP surface — already gated by each declaration's `clients.mcp` plus your `app.handle` auth — and returns a stream of typed `AgentFrame`s (`text` deltas, `tool_use`, `tool_result`, `done`) the handler wraps in `jsonl()`/`sse()`. Engines are provider packages (`@belte/<provider>`); swapping one never touches the verb or the UI.

## MCP / CLI / bundle

| surface | get it | what it serves |
| --- | --- | --- |
| MCP | mounted at `/__belte/mcp` | exposed verbs as tools (`users/list.ts` → `users-list`), socket `<name>-tail` / `<name>-publish` tools, prompts from `src/mcp/prompts/*.md` (`{{name}}` placeholders), resources from `src/mcp/resources/` |
| CLI | `belte cli`, or the install script at `/__belte/cli` | one subcommand per cli-exposed verb with schema-typed flags (`--json` and piped-JSON stdin as escape hatches); a thin remote client — `BELTE_APP_URL` / `BELTE_APP_TOKEN` aim it — that can also `start` its bundled local server |
| bundle | `belte bundle` | a movable desktop app — native webview + embedded server, boots to a connect screen; configure via `src/bundle/window.ts` (`BundleWindow`, menus typed by `BundleMenu`/`BundleMenuItem`), react to menu clicks with `onMenu()`, detect with `bundled()` (all under `@belte/belte/bundle/*`) |

## Logging & tracing

```ts
import { log } from '@belte/belte/shared/log'
import { trace } from '@belte/belte/shared/trace'

log('order created', { id })                            // always-on app channel
log.channel('shop:billing')('charge retried')           // DEBUG-gated channel
await log.trace('charge', () => stripe.charge(order))   // timed, rethrows
reportError({ traceparent: trace() })
```

Every record carries its channel plus — inside a request — the trace id, elapsed ms, and verb+path; `warn`/`error` are presentation levels, never gates. The app's own channel and belte's are on by default (`DEBUG=-<name>` silences); `log.channel(name)` emits only when `DEBUG` matches (browser: the `belte-debug` localStorage key). Lines render as tab-separated values, or one JSON object per line under `BELTE_LOG_FORMAT=json`.

`trace()` returns the current W3C `traceparent` on either side — in the browser, the trace of the request that rendered the page — ready for your own telemetry or `propagation.extract`; outside any request scope it is `undefined`.

## Deploy

A belte app is one process: the `global` cache store, socket retention, and fan-out are process memory, so run a single instance per app (scale the machine, or partition apps) rather than load-balancing replicas. `belte compile` builds the client and embeds it — `_app` chunks, `public/` files, MCP resources, all zstd-compressed — into a standalone binary (targets: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64`, `bun-linux-x64`, `bun-windows-x64`), so the runtime image needs nothing but the binary:

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bunx belte compile --out=server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/server /usr/local/bin/app
ENV PORT=3000
EXPOSE 3000
CMD ["app"]
```

To run from source instead, build the image on `oven/bun:1` with `bunx belte build` and `CMD ["bunx", "belte", "start"]`.

`PORT` pins the port (unset, the server scans upward from 3000); `BELTE_IDLE_TIMEOUT` raises Bun's per-connection idle timeout (seconds, default 10 — streaming responses opt out automatically); `BELTE_MAX_REQUEST_BODY_SIZE` sets Bun's server-wide request body ceiling, which per-verb `maxBodySize` tightens.

## Reference

| command | does |
| --- | --- |
| `bunx belte scaffold <name>` | new project: copy template, install, start dev (`--no-install` / `--no-dev`) |
| `belte dev` | build + run with rebuild-and-restart on change, browser live-reload |
| `belte build` | client build into `dist/_app/` |
| `belte start` | production server against `dist/` |
| `belte run <file> [args…]` | run a script under the belte preload — same runtime as the server |
| `belte compile [--target] [--out]` | standalone server executable |
| `belte cli [--target] [--out] [--platforms a,b]` | standalone CLI binary (+ per-platform server beside it) |
| `belte bundle` | self-contained desktop app for the host platform (unsigned) |

| route | serves |
| --- | --- |
| `/__belte/health` | `{ belte, name, version }` + the app `health()` hook's fields, always unauthenticated; `/__belte/identity` is the legacy alias |
| `/__belte/sockets` | the multiplexed WebSocket hub |
| `/__belte/sockets/<name>` | HTTP face of a socket: GET tail (SSE/JSON), POST publish |
| `/__belte/mcp` | JSON-RPC MCP endpoint |
| `/__belte/cli`, `/__belte/cli/<platform>` | CLI install script + binary download |
| `/openapi.json` | OpenAPI document for the `/rpc/*` surface |

Typed env — declare once in `src/server/config.ts`; boot fails loudly on a bad environment (every issue listed at once), and the desktop bundle derives its first-run setup form from the same schema:

```ts
// src/server/config.ts
import { env } from '@belte/belte/server/env'
import { z } from 'zod'

export const config = env(z.object({ DATABASE_URL: z.string(), PORT: z.coerce.number().optional() }))
```

Other env vars: belte's framework channel — the boot surface map and per-request closing records — is on by default, `DEBUG=-belte` silences it, and `DEBUG=<channel>` enables diagnostic channels like `belte:cache`; `APP_URL` sets the public origin and mount base; `BELTE_DATA_DIR` overrides the per-app data dir (`appDataDir()` from `@belte/belte/server/appDataDir`); `BELTE_INSPECT` enables the bundle webview's inspector.

`src/app.ts` hooks (all optional): `init({ server })` with an optional cleanup return, `handle(request, next)` middleware, `handleError(error, request)`, `health(request)` fields for the health payload, and the `forwardHeaders` allowlist extension.

Testing — in-process, no server; the preload gives `bun test` the same module resolution as the runtime:

```toml
# bunfig.toml
[test]
preload = ["@belte/belte/preload"]
```

```ts
import { createTestClient } from '@belte/belte/test/createTestClient'
import '$server/rpc/getProduct'

const api = createTestClient({ headers: { authorization: 'Bearer test' } })
const product = await api.getProduct({ id: '1' }) // decoded; .raw() for the Response
```

MIT
