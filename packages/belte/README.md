# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an HTTP framework for Bun + Svelte where a single declared function is
*simultaneously* an SSR call, a browser fetch, an MCP tool, a CLI subcommand, and
an OpenAPI operation. You don't wire up five surfaces. You write one handler; the
bundler swaps the runtime per target.

```ts
// src/server/rpc/getPost.ts — the filename is the export, the URL, and the command name
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'

export const getPost = GET<{ id: string }>(async ({ id }) => json(await db.post(id)))
```

That one file is now all of this:

```text
                              src/server/rpc/getPost.ts
                                        │
        ┌──────────────┬────────────────┼────────────────┬──────────────┐
     browser          http             cli              mcp           openapi
 cache(getPost)   GET /rpc/getPost   app getPost     tool "getPost"  GET /rpc/getPost
   ({ id })         ?id=1            --id 1          { id }          in /openapi.json
```

Don't take the diagram's word for it — belte prints the exact map at boot
(`DEBUG=belte`):

```sh
[belte] pages:
  page                   layout  error
  /                      /       ·
  /posts/[id]            /       ·
[belte] sockets:
  socket                 schema  browser  mcp  cli  publish
  chat                   ✓       ✓        ✓    ✓    ·
[belte] rpcs:
  http                   schema  browser  mcp  cli
  GET   /rpc/getPost     ✓       ✓        ✓    ✓
  POST  /rpc/createPost  ✓       ✓        ✓    ✓
  GET   /rpc/health      ·       ✓        ·    ·
```

Every surface a function reaches is auditable in one place — no surface is ever
exposed by accident. A `·` in the `schema` column is the gate: without a schema a
verb stays browser-only, because the schema is what makes the machine surfaces
(mcp/cli) safe to advertise.

## Why it's built this way

- **Zero runtime dependencies.** `package.json` declares no `dependencies` — belte
  runs on Bun and Web platform APIs (`Bun.serve`, `Bun.CookieMap`, `Request`/
  `Response`, `ReadableStream`, `AsyncLocalStorage`). Svelte is the only required
  peer; Tailwind is optional.
- **No magic strings.** The browser/server swap is a real tokenizer
  (`findExportCallSite`) that skips strings, templates, comments, regex, and
  generics — it rewrites the actual `export const x = GET(fn)` call site, not a
  text match.
- **Safe by default for machines.** A mutating verb (POST/PUT/PATCH/DELETE) never
  auto-exposes to MCP. Read-only verbs with a schema turn mcp/cli on; everything
  else opts in explicitly via `clients`.

## Scope — read this before you adopt

- **Bun-only, by design.** `engines.bun >= 1.3.0`. There is no Node fallback; the
  runtime uses Bun and Web APIs directly.
- **Svelte-only web surface.** Pages and layouts are Svelte 5 components.
- **Pre-1.0.** The core (rpc, sockets, pages, cache) is stable in shape; the newer
  satellites (mcp, cli, agent, desktop bundle) are younger. Expect sharp edges and
  breaking changes before 1.0.

## Install

```sh
bunx @belte/belte scaffold my-app
cd my-app
bun install
bun run dev
```

## The mental model

Three ideas carry the whole framework.

- **One runtime.** Dev and build run the same code path — no separate dev server
  semantics to drift from production.
- **Declare once.** A file under `src/server/rpc/` exports one function. Its
  filename is the export name, the URL (`/rpc/<path>`), and the CLI/MCP command
  name. You consume it the same way everywhere; the bundler swaps the
  implementation per target.
- **The namespace marks the side.** An import path tells you where a name runs.

| Namespace | Runs on | Examples |
| --- | --- | --- |
| `@belte/belte/server/*` | Server only | `GET`, `socket`, `json`, `request`, `agent` |
| `@belte/belte/browser/*` | Client only | `page`, `navigate`, `subscribe` |
| `@belte/belte/shared/*` | Both (isomorphic) | `cache`, `HttpError`, `log` |

There is no umbrella `index.ts` barrel. Every public name has its own module path,
so importing one name never drags side-effecting siblings into the bundle.

## One function, every surface

Declare a schema-bearing verb once:

```ts
// src/server/rpc/getProduct.ts
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import * as v from 'valibot'

export const getProduct = GET(async ({ id }) => json(await db.product(id)), {
    inputSchema: v.object({ id: v.string() }),
})
```

Now consume the same declaration from every surface:

```svelte
<!-- browser: SSR + hydration, via cache() -->
<script lang="ts">
  import { getProduct } from '../../server/rpc/getProduct.ts'
  import { cache } from '@belte/belte/shared/cache'
  const product = await cache(getProduct)({ id: '42' })
</script>
<h1>{product.name}</h1>
```

```sh
# http
curl 'http://localhost:3000/rpc/getProduct?id=42'

# cli (generated client; subcommand + schema-derived flags)
my-app getProduct --id 42

# openapi — the operation appears in the served document
curl http://localhost:3000/openapi.json
```

```json
// mcp — the tool "getProduct" with { id } input, served at /__belte/mcp
{ "method": "tools/call", "params": { "name": "getProduct", "arguments": { "id": "42" } } }
```

## Server / rpc

### Declaring

A verb helper rewrites `export const x = VERB(fn, opts?)` into a server handler or
a client stub by build target. Six helpers exist, one per HTTP method:
`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` (`@belte/belte/server/<METHOD>`).

```ts
type Verb = <Return, InputSchema>(
    fn: (args) => Return | Promise<Return>,
    opts?: {
        inputSchema?: InputSchema       // Standard Schema; validates args, projects to MCP/CLI/OpenAPI
        outputSchema?: StandardSchemaV1 // success-body schema → OpenAPI 200 + MCP outputSchema
        filesSchema?: StandardSchemaV1  // multipart File parts (body verbs); not JSON-Schema projected
        clients?: Partial<ClientFlags>  // override which surfaces expose this verb
    },
) => RemoteFunction<Args, Return>
```

| Option | Type | Effect |
| --- | --- | --- |
| `inputSchema` | Standard Schema | Validates args; `Args` infers from it. Its presence flips mcp/cli on for read-only verbs. Projected to MCP tool / CLI flags / OpenAPI via the schema's own `toJSONSchema()`. |
| `outputSchema` | Standard Schema | Describes the success body for the OpenAPI 200 response and the MCP tool `outputSchema`. |
| `filesSchema` | Standard Schema | Multipart uploads on body verbs. The handler receives text fields ∩ validated `File` parts in one args bag. Stays off the JSON-Schema projection. |
| `clients` | `{ browser?, mcp?, cli? }` | Explicit surface targeting. Explicit values always win over the schema-derived defaults. |

`ClientFlags` defaults: `browser` is on; `mcp`/`cli` turn on automatically only when
the declaration carries a schema **and** the method is read-only — a mutating verb
must opt in (`clients: { mcp: true }`).

Any [Standard Schema](https://standardschema.dev) library works (Zod, Valibot,
Arktype). For libraries without a native `toJSONSchema()`, wrap once at the
declaration:

```ts
import { withJsonSchema } from '@belte/belte/shared/withJsonSchema'
const schema = withJsonSchema(mySchema, (s) => toJsonSchema(s))
```

#### Response helpers

`@belte/belte/server/<name>`. Each returns a `Response` with rpc-friendly defaults
(`Cache-Control: no-store`) and a phantom-typed brand so `Return` infers from the
handler body.

| Helper | Produces | Notes |
| --- | --- | --- |
| `json(data, init?)` | `application/json` | Like `Response.json`, plus `no-store`. |
| `jsonl(iterable, init?)` | `application/jsonl` | One JSON value per line from an `AsyncIterable`. Errors emit a final `{"$error":"…"}` line. |
| `sse(iterable, init?)` | `text/event-stream` | `data: <json>\n\n` per frame; 15s keepalive comments; errors as an `event: error` frame. |
| `error(status, message?, init?)` | `text/plain` | `message` defaults to the status reason phrase. The caller's `await fn()` throws `HttpError`. |
| `redirect(url, status?, init?)` | 3xx | Accepts relative URLs; defaults to 302; `301/302/303/307/308`. |

```ts
import { GET } from '@belte/belte/server/GET'
import { error } from '@belte/belte/server/error'
import { json } from '@belte/belte/server/json'

export const getOrder = GET<{ id: string }>(async ({ id }) => {
    const order = await db.order(id)
    if (!order) return error(404, 'order not found')
    return json(order)
})
```

#### Request-scoped helpers

| Helper | Returns | Notes |
| --- | --- | --- |
| `request()` | `Request` | The inbound request for the current SSR/RPC pass. Throws outside a request scope. |
| `server()` | `Bun.Server` | The active server; a no-op stand-in during in-process CLI/MCP/test dispatch. |
| `cookies()` | `Bun.CookieMap` | Live cookie jar; reads parse `Cookie`, `set`/`delete` flush as `Set-Cookie` on return. |

SSR and in-process MCP calls forward only an allowlist of inbound headers onto the
synthesized request: `cookie`, `authorization`, `x-forwarded-for`,
`x-forwarded-proto`, `x-forwarded-host`. Extend it with `app.forwardHeaders`
(e.g. `accept-language`, `x-tenant-id`).

### Consuming

A declared verb is a `RemoteFunction`: callable on both sides, with the same
signature. The plain call decodes the body (content-type sniffed) and throws
`HttpError` on non-2xx.

| Form | Resolves to | Use |
| --- | --- | --- |
| `fn(args)` | decoded body | The default call. |
| `fn.raw(args)` | `Response` | Untouched response for status/header/streaming assertions. |
| `fn.stream(args?)` | `Subscribable<T>` | Iterable view of the body: `sse`/`jsonl` handlers yield each frame; non-streaming yields the decoded body once. Pass to `subscribe()`. |
| `fn.url` / `fn.method` | `string` | The mounted route. |

```ts
import { getProduct } from '../server/rpc/getProduct.ts'

const product = await getProduct({ id: '42' })          // decoded
const res = await getProduct.raw({ id: '42' })          // Response
```

Body verbs (POST/PUT/PATCH) also accept a `FormData` in place of typed args — the
upload escape hatch for a `filesSchema` verb.

`HttpError` (`@belte/belte/shared/HttpError`) carries `status`, `statusText`, and
the raw `response`, so a call site can render error UI without opting into `.raw`:

```ts
import { HttpError } from '@belte/belte/shared/HttpError'

try {
    await getProduct({ id: 'missing' })
} catch (e) {
    if (e instanceof HttpError && e.status === 404) showNotFound()
}
```

The OpenAPI document for every http-reachable verb is served at `/openapi.json`.

## Server / sockets

A socket is a bidirectional named broadcast primitive, declared once under
`src/server/sockets/` and multiplexed onto a single framework-owned WebSocket per
client at `/__belte/sockets`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'
import * as v from 'valibot'

export const chat = socket({
    schema: v.object({ user: v.string(), text: v.string() }),
    history: 50,          // replay last N to a new subscriber
    clientPublish: true,  // accept pub frames from clients (off by default)
})
```

| Option | Type | Effect |
| --- | --- | --- |
| `history` | `number` | Buffer size replayed on first iteration. |
| `ttl` | `number` | Per-frame TTL (ms); history entries older than `ttl` are evicted before replay. |
| `clientPublish` | `boolean` | Allow clients to publish (default off — server-only topics ignore wire pubs). |
| `schema` | Standard Schema | Validates publish payloads; gives mcp/cli a typed payload to describe. |
| `clients` | `{ browser?, mcp?, cli? }` | Which surfaces advertise the socket. Browser-only when schemaless; all surfaces when a schema is present. |

Publishing is isomorphic — server code fans out in-process; client code sends a
validated `pub` frame:

```ts
chat.publish({ user: 'ada', text: 'hello' })
```

Consuming iterates the socket (an `AsyncIterable`); `.tail(count)` replays the last
`count` items (default `0`) before tailing live. On the client, drive it reactively
with `subscribe()` (below).

```ts
for await (const message of chat) render(message)   // full history replay
for await (const message of chat.tail(10)) render(message)
```

> For sustained pub/sub use sockets, not an rpc stream — HTTP rpc isn't the place
> for long-lived multi-publisher subscriptions.

## Server / agent

`agent(engine, messages)` runs a provider model engine against the app's own MCP
surface and returns the engine's frame stream. It does not pick a transport — the
handler frames it with `jsonl()` or `sse()`, like any other streaming verb.

```ts
// src/server/rpc/chat.ts
import { POST } from '@belte/belte/server/POST'
import { jsonl } from '@belte/belte/server/jsonl'
import { agent } from '@belte/belte/server/agent'
import { engine } from '@belte/anthropic'
import * as v from 'valibot'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })

export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), {
    inputSchema: v.object({ messages: v.array(v.any()) }),
})
```

The engine — provider-specific, in a `@belte/<provider>` package (`@belte/anthropic`,
`@belte/claude-code`) — only sees the surface in and yields `AgentFrame`s out, so
swapping providers never touches the verb or the UI. Permission is decided
server-side: the surface is already gated by each verb's `clients.mcp` plus its own
per-call handler auth — nothing is negotiated at runtime.

| Type | Shape |
| --- | --- |
| `NeutralMessage` | `{ role: 'user', text }` · `{ role: 'assistant', text?, toolUses? }` · `{ role: 'tool', results }` |
| `AgentFrame` | `{ type: 'text', delta }` · `{ type: 'tool_use', … }` · `{ type: 'tool_result', … }` · `{ type: 'done', stop }` |

## Shared

Isomorphic names — same callable and behaviour on both sides.

### cache()

`cache(fn, options?)` returns an invoker; calling it with args checks a store and
returns a shared promise on hit, or invokes `fn` once and stores it on miss. `fn`
is a remote function or a plain producer.

```ts
import { cache } from '@belte/belte/shared/cache'

cache(getPost)({ id })       // → Promise<Post>      decoded body
cache(getPost.raw)({ id })   // → Promise<Response>  raw escape hatch
cache(fetchRates)()          // → Promise<Rates>     plain producer (hoist for dedupe)
```

| Option | Type | Effect |
| --- | --- | --- |
| `ttl` | `number` | ms past resolve the entry lives. Omit = forever; `0` = dedupe only; `>0` = expire after. |
| `scope` | `string \| string[]` | Free-form tags grouping calls so one `cache.invalidate({ scope })` drops them all. |
| `global` | `true` | Use the process-level store (reuse across requests) instead of the default request-scoped one. No `false` form. |
| `invalidate` | `{ throttle?, debounce? }` | Coalesce a burst of invalidations and serve the stale value until the refetch resolves (stale-while-revalidate). Set at most one. |

Companions sharing the same selector grammar:

| Call | Returns |
| --- | --- |
| `cache.invalidate(fn?\|{scope}?)` | Drop matching entries (or coalesce refetch per policy) and notify readers. |
| `cache.pending(fn?\|{scope}?)` | Reactive: is any matching call in flight? |
| `cache.refreshing(fn?\|{scope}?)` | Reactive: is any matching entry reloading data it already had? |

Cache keys are canonical (`Date`, `Map`, `Set`, `bigint` are distinguished from
their plain-object look-alikes), so distinct args never collide on one entry.

**SSR mode is decided by how you read it**, per Svelte's `{#await}` rule — there is
no `ssr` option:

```svelte
<script>
  const post = await cache(getPost)({ id })   // blocks render → baked into initial HTML
</script>

{#await cache(getPost)({ id }) then post}     <!-- shell flushes now, value streams in -->
  {post.title}
{/await}
```

The two don't mix in one component instance (a top-level `await` sweeps in every
promise created there, inlining a sibling `{#await}` too). Isolate each blocking
read in its own child component to combine them. Reactivity is implicit: a read
inside a `$derived`/`$effect` re-runs when its key is invalidated.

### HttpError

See [Consuming](#consuming) — thrown on non-2xx, carries the raw `Response`.

### log

`@belte/belte/shared/log` — an isomorphic logger: ANSI-coloured with a `[belte]`
prefix on the server, plain in the browser.

| Method | Use |
| --- | --- |
| `log.info / warn / error / success` | Prefixed lines (colour by severity on the server). |
| `log.detail(message)` | Dimmed continuation line. |
| `log.debug(scope, message)` | Gated by the `DEBUG` env (`DEBUG=<scope>`). |
| `log.request(method, path, status, ms)` | Coloured request line. |

## Browser

Client-only names.

### Pages and layouts

Pages are Svelte 5 components under `src/browser/pages/**`. The file path is the
route; `[param]` segments capture dynamic params.

| File | Route |
| --- | --- |
| `pages/page.svelte` | `/` |
| `pages/posts/page.svelte` | `/posts` |
| `pages/posts/[id]/page.svelte` | `/posts/:id` |
| `pages/layout.svelte` | wraps every route below it (nearest-only) |
| `pages/error.svelte` | error boundary for routes below it |

A layout wraps its subtree; the **nearest** layout applies (they don't nest). An
`error.svelte` is the error boundary for its subtree.

### page state

`page` (`@belte/belte/browser/page`) is read-only request/route state. It's a
discriminated union keyed on `route`, so narrowing on `page.route` types
`page.params`.

| Field | Type |
| --- | --- |
| `page.route` | the matched route key |
| `page.params` | the route's param shape |
| `page.url` | live WHATWG `URL` (reassigned on every nav) |

### navigate()

```ts
import { navigate } from '@belte/belte/browser/navigate'

await navigate('/posts/42')
await navigate('/posts/42', { replace: true, scroll: false })
```

`navigate(href, { replace?, scroll? })` does SPA navigation. Same-pathname changes
(search/hash only) skip the network and just reassign `page.url`. A non-SPA target
(raw endpoint, unknown route, failed import) falls back to a hard navigation
cleanly.

### subscribe()

Reactive consumer for streaming sources — a `Socket<T>` or `fn.stream(args)`. The
first `$derived` read opens the iterator; the last to stop closes it
(`createSubscriber`); many readers of the same key share one subscription.

```svelte
<script lang="ts">
  import { subscribe } from '@belte/belte/browser/subscribe'
  import { chat } from '../server/sockets/chat.ts'
  import { tickFeed } from '../server/rpc/tickFeed.ts'

  const latest = $derived(subscribe(chat))                 // socket
  const tick = $derived(subscribe(tickFeed.stream()))      // rpc stream
</script>
```

| Call | Returns |
| --- | --- |
| `subscribe(src)` | latest value (`undefined` until the first frame; `undefined` on the server). |
| `subscribe.error(src)` | the surfaced `Error`, if any (errors aren't thrown). |
| `subscribe.status(src)` | `'pending' \| 'open' \| 'done' \| 'error'`. |

Subscribe is a no-op during SSR. For a value seeded in the initial HTML, fetch via
`cache()` against an http rpc and layer `subscribe()` on top for live updates.

## MCP

The MCP server is generated and served at `/__belte/mcp` — there is no module to
author. Tools are derived from every schema-bearing verb with `clients.mcp` (auto
for read-only schema verbs; mutating verbs opt in) and from sockets (`<name>-tail`
read tool, plus `<name>-publish` when `clientPublish` is set). Auth on each tool
call inherits from the inbound request.

| Surface | Authored in | Becomes |
| --- | --- | --- |
| Tools | `src/server/rpc/*`, `src/server/sockets/*` | `tools/list` + `tools/call` |
| Resources | `src/mcp/resources/**` (any file) | `belte://resources/<path>`; text inline, binary as base64 |
| Prompts | `src/mcp/prompts/*.md` | `prompts/list` + `prompts/get` (via `definePrompt`) |

## CLI

`belte cli` (and the compiled standalone binary) is a generated thin client over
the running server's surface. Each schema-bearing verb with `clients.cli` becomes a
subcommand with flags derived from its schema.

```sh
my-app getProduct --id 42                 # flags from the schema
my-app getProduct --json '{"id":"42"}'    # full args bag as JSON
echo '{"id":"42"}' | my-app getProduct    # or piped on stdin
my-app getProduct --help                  # per-command flag help
```

| Connection | Meaning |
| --- | --- |
| `my-app /connect <url>` | connect to a remote server |
| `my-app /start` | start a local instance |
| `my-app /disconnect` | forget the saved connection |
| `my-app` | resume the saved connection |

| Env var | Effect |
| --- | --- |
| `BELTE_APP_URL` | default server URL (baked at install; shell-overridable) |
| `BELTE_APP_TOKEN` | sent as `Authorization: Bearer <value>` |

`src/cli/banner.txt` and `src/cli/footer.txt` top and tail the top-level help.

## Bundle

`belte bundle` produces a movable native desktop app. It is **unsigned** —
first-launch needs a Gatekeeper bypass on macOS. The window either embeds the
server or connects to a remote one; the built-in File menu offers Start / Connect /
Disconnect.

```ts
// src/bundle/window.ts (optional)
import type { BundleWindow } from '@belte/belte/bundle/BundleWindow'

export default {
    title: 'My App',
    width: 1100,
    height: 720,
    menu: [/* custom top-level menus → belte:menu events */],
} satisfies BundleWindow
```

| Field | Effect |
| --- | --- |
| `title` / `width` / `height` | Window basics (default to the program name / openWebview defaults). |
| `menu` | Custom top-level menus inserted between Edit and Window; items emit `belte:menu`. |
| `config` | Override the first-run setup form schema (defaults to `src/server/config.ts`'s env schema). |

Handle menu events with `onMenu` (`@belte/belte/bundle/onMenu`). A
`src/bundle/disconnected.svelte` customises the connect/disconnected screen;
`src/bundle/icon.png` sets the app icon.

## Testing

`createTestClient()` (`@belte/belte/test/createTestClient`) is an in-process client
for an app's own tests. It discovers verbs from the registry (populated by the
test's imports) and routes through the same synthesize-and-fetch path the CLI and
MCP surfaces use, so calls can't drift from production.

```ts
import { createTestClient } from '@belte/belte/test/createTestClient'
import '../src/server/rpc/getProduct.ts'   // importing the module registers the verb

const client = createTestClient({ headers: { authorization: 'Bearer test-token' } })

const product = await client.getProduct({ id: '42' })   // decoded; throws HttpError on non-2xx
const res = await client.getProduct.raw({ id: '42' })   // underlying Response
```

Each property is keyed by command name.

Each call runs inside a real request scope — fresh per-request `cache()`, the
cookie jar, `request()`/`server()`, and `app.handleError`. There is no `url`; it
never hits the network.

## Some details

### Config and env

`env(schema)` validates `Bun.env` against a Standard Schema at module top level, so
a missing or malformed variable fails the boot loudly. Scaffolds live in
`src/server/config.ts`.

```ts
// src/server/config.ts
import { env } from '@belte/belte/server/env'
import * as v from 'valibot'

export const config = env(v.object({ DATABASE_URL: v.string(), ANTHROPIC_API_KEY: v.string() }))
```

The schema is also projected into the desktop bundle's first-run setup form, so one
declaration drives both boot validation and the form.

`appDataDir()` (`@belte/belte/server/appDataDir`) returns the running bundle's
per-user data dir, keyed by program name and cwd-independent — so an app's DB/cache
lands beside belte's own config.

### App hooks

Optional exports from `src/app.ts` (all optional; defaults apply when missing):

| Hook | Signature | Use |
| --- | --- | --- |
| `forwardHeaders` | `string[]` | Extra inbound headers to forward onto in-process rpc requests. |
| `init` | `({ server }) => cleanup?` | Run at boot; the returned function runs on SIGINT/SIGTERM. |
| `handle` | `(request, next) => Response` | Single middleware: mutate the response or branch on the URL. |
| `handleError` | `(error, request) => Response` | Custom error/500 response for thrown handler errors. |

### Project layout

```text
src/
  app.ts                      # optional hooks
  server/
    config.ts                 # env(schema)
    rpc/<name>.ts             # one verb per file → /rpc/<name>
    sockets/<name>.ts         # one socket per file → /__belte/sockets
  browser/
    pages/**/page.svelte      # routes (+ layout.svelte / error.svelte)
    app.html, app.css
  mcp/
    resources/**              # belte://resources/<path>
    prompts/*.md              # MCP prompts
  cli/banner.txt, footer.txt  # CLI help chrome
  bundle/window.ts, icon.png  # desktop bundle config
public/                       # static assets served at /
```

### CLI commands

| Command | Does |
| --- | --- |
| `belte scaffold <name>` | Create a new project. |
| `belte dev` | Build + serve with the dev runtime. |
| `belte build` | Build to `dist/`. |
| `belte start` | Serve a built app. |
| `belte run` | Build and run in one step. |
| `belte compile` | Compile a standalone binary. |
| `belte cli` | Run the generated CLI client. |
| `belte bundle` | Build the desktop bundle. |

### Compile targets

`belte compile` defaults to the host target; cross-compile with `--target`:
`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64`, `bun-linux-x64`,
`bun-windows-x64`.

### Logging

belte logs requests and lifecycle through the shared `log`. `DEBUG=belte` turns on
the boot surface-map (the three tables above) plus framework debug lines;
`DEBUG=<scope>` scopes it.
