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
import { z } from 'zod'

export const getPost = GET(async ({ id }) => json(await db.post(id)), {
    inputSchema: z.object({ id: z.string() }),
})
```

That one file is now all of this:

```text
src/server/rpc/getPost.ts
  export const getPost = GET(fn, { inputSchema })
        │
        ├─ browser   await cache(getPost)({ id })          decoded body, SSR-hydrated
        ├─ http      GET /rpc/getPost?id=…                 the wire endpoint
        ├─ openapi   GET /rpc/getPost in /openapi.json     operationId: getPost
        ├─ mcp       tool "getPost"                        read-only ⇒ auto-exposed
        └─ cli       app getPost --id …                    schema ⇒ typed flags
```

A bare `GET(fn)` always reaches browser, http, and openapi. The MCP tool and CLI
subcommand turn on once the declaration carries a Standard Schema — the schema is
what makes a machine-facing surface safe to advertise.

Don't take the diagram's word for it — belte prints the exact map at boot
(`DEBUG=belte`):

```sh
pages:
  page                   layout  error
  /                      /       ·
  /posts/[id]            /       ·
sockets:
  socket                 schema  browser  mcp  cli  publish
  chat                   ✓       ✓        ✓    ✓    ✓
rpcs:
  http                   schema  browser  mcp  cli
  GET   /rpc/getPost     ✓       ✓        ✓    ✓
  POST  /rpc/createPost  ✓       ✓        ·    ✓
  GET   /rpc/listFeed    ·       ✓        ·    ·
```

Scan a column to spot a missing surface, a row to see one declaration's reach. A
schemaless verb (`listFeed`) reddens its `schema` cell — its machine surfaces are
gated until a schema lands. Every surface a function reaches is auditable in one
place; no surface is ever exposed by accident.

## Why it's built this way

- **Zero runtime dependencies.** `package.json` declares no `dependencies` — only
  optional `peerDependencies` (`svelte`, and `tailwindcss` / `bun-plugin-tailwind`
  for styling). Everything else is Web platform and `Bun.*` (`Bun.serve`,
  `Bun.CookieMap`, `Bun.zstdCompress`, `Bun.YAML`, `Bun.file`).
- **No magic strings.** The rpc/socket swap is a real tokenizer
  (`findExportCallSite`) that walks source character-by-character, skipping
  strings, templates, comments, regexes, and TypeScript generics — so a `GET`
  inside a docstring or a nested `GET<Map<K, V>>(` is never mistaken for the call.
- **Safe by default for machines.** A read-only verb (`GET`/`HEAD`) with a schema
  auto-exposes to MCP; a mutating verb (`POST`/`PUT`/`PATCH`/`DELETE`) never does
  unless you pass `clients: { mcp: true }` explicitly — a model can't delete data
  just because the handler carries a schema.

## Scope — read this before you adopt

- **Bun-only, by design.** `engines.bun >= 1.3.0`. There is no Node fallback; the
  runtime is built directly on `Bun.serve` and `Bun.*` APIs.
- **Svelte-only web surface.** Pages, layouts, and error pages are Svelte 5
  components; SSR runs through `svelte/server`. There is no other view layer.
- **Pre-1.0.** The core (rpc, pages, cache, sockets) is the mature center. The
  machine-facing satellites — MCP, the CLI binary, and the desktop bundle — are
  newer and move faster. APIs may still shift.

## The mental model

Three ideas carry the whole framework.

1. **One runtime — dev equals build.** `belte dev` and a compiled binary run the
   same server code over the same registry. There is no separate dev path to
   diverge from production.
2. **Declare once.** A file under `src/server/rpc/` holds exactly one
   `export const <name> = VERB(fn)`. The filename is the export name, the URL
   (`/rpc/<path>`), the MCP tool name, and the CLI subcommand. The HTTP verb you
   import picks the method.
3. **The namespace marks the side.** The import path tells you where a name runs.

| Namespace | Runs | Public names |
| --- | --- | --- |
| `belte/server/*` | server only | `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD`, `socket`, `json` `jsonl` `sse` `error` `redirect`, `request` `cookies` `server` `env` `appDataDir`, `AppModule` |
| `belte/browser/*` | client only | `page` `navigate` `subscribe` |
| `belte/shared/*` | isomorphic | `cache` `HttpError` `withJsonSchema` `bundled` `log` |
| `belte/bundle/*` | desktop launcher | `BundleWindow` `BundleMenu` `BundleMenuItem` `onMenu` |
| `belte/test/*` | tests | `createTestClient` `clearVerbRegistry` |

There is no umbrella `index.ts` and no `.` export. Every public name has its own
module path (`belte/server/json`, `belte/shared/cache`, …), so importing one name
never drags a side-effecting sibling into the bundle. `shared/*` names are the
same callable with the same behaviour on both sides; the bundler swaps only the
underlying runtime.

## One function, every surface

A single schema-bearing verb, consumed from all five surfaces.

```ts
// src/server/rpc/createOrder.ts
import { POST } from '@belte/belte/server/POST'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

export const createOrder = POST(async ({ sku, qty }) => json(await orders.create(sku, qty)), {
    inputSchema: z.object({ sku: z.string(), qty: z.number() }),
    clients: { mcp: true }, // a mutating verb must opt into MCP explicitly
})
```

```svelte
<!-- browser: SSR + hydrate -->
<script lang="ts">
    import { cache } from '@belte/belte/shared/cache'
    import { createOrder } from '$server/rpc/createOrder'
    const result = $derived(await cache(createOrder)({ sku: 'A1', qty: 2 }))
</script>
```

```sh
# http
curl -X POST localhost:3000/rpc/createOrder -d '{"sku":"A1","qty":2}'

# cli (schema → flags)
app createOrder --sku A1 --qty 2

# mcp — tool "createOrder", dispatched at POST /__belte/mcp

# openapi — POST /rpc/createOrder, operationId createOrder, in /openapi.json
```

## Server

### Server / rpc

#### Declaring

Each file under `src/server/rpc/` exports one verb-bound function. Import a verb
helper from its own path: `belte/server/GET`, `.../POST`, `.../PUT`, `.../PATCH`,
`.../DELETE`, `.../HEAD`.

```ts
type Verb = <Return = unknown, InputSchema = StandardSchemaV1>(
    handler: (args: InferOutput<InputSchema>) => Response | Promise<Response>,
    opts?: {
        inputSchema?: InputSchema       // validates args; 422 on failure
        outputSchema?: StandardSchemaV1 // describes the 200 body (OpenAPI + MCP)
        filesSchema?: StandardSchemaV1  // validates multipart File parts
        clients?: Partial<{ browser; mcp; cli }>
    },
) => RemoteFunction<InferInput<InputSchema>, Return>
```

| Option | Effect | Default |
| --- | --- | --- |
| `inputSchema` | Validates args (any Standard Schema lib). `Args` infers from it; replies 422 with `{ issues }` on failure. | none |
| `outputSchema` | Standard Schema for the success body — feeds the OpenAPI 200 response and the MCP tool `outputSchema`. | none |
| `filesSchema` | Validates the `File` parts of a multipart upload (kept out of the JSON-Schema projection). | none |
| `clients` | Which surfaces expose the verb: `{ browser, mcp, cli }`. | `browser: true`; `mcp`/`cli` auto-on with a schema (MCP only for read-only verbs) |

`Args` is inferred from `inputSchema` or from the handler's parameter type; `Return`
is inferred from the handler's return via the `TypedResponse<T>` brand on the
response helpers, so `GET(() => json({ ... }))` types end-to-end with no annotation.

**Response helpers** — one per file under `belte/server/*`. All default to
`Cache-Control: no-store` (intermediary caches shouldn't memoise rpc replies).

| Helper | Returns | Notes |
| --- | --- | --- |
| `json(data, init?)` | `application/json` | Like `Response.json` plus the no-store default. |
| `error(status, message?, init?)` | `text/plain` | `message` defaults to the status reason phrase. Body reaches `HttpError.response.text()` verbatim. |
| `redirect(url, status?, init?)` | 3xx | Accepts relative URLs; defaults to 302. Statuses `301/302/303/307/308`. |
| `jsonl(iterable, init?)` | `application/jsonl` | One JSON value per line from an `AsyncIterable`. Errors emit a final `{"$error":"…"}` line. |
| `sse(iterable, init?)` | `text/event-stream` | One `data:` event per frame, 15s keepalive comments. Errors emit an `event: error` frame. |

**Request-scoped helpers** — resolve only while an SSR render or rpc handler is in
flight (they throw at module top level or in `app.ts` `init`):

- `request()` → the inbound `Request` (`belte/server/request`).
- `cookies()` → the live `Bun.CookieMap`; `.set`/`.delete` flush as `Set-Cookie`
  when the handler returns (`belte/server/cookies`).
- `server()` → the active `Bun.Server` (`belte/server/server`).

In-process calls (SSR, MCP, CLI) forward only an allowlist of inbound headers onto
the synthesized rpc `Request`: `cookie`, `authorization`, `x-forwarded-for`,
`x-forwarded-proto`, `x-forwarded-host`. Every other header is dropped. Extend the
allowlist with the `forwardHeaders` export in `src/app.ts` (e.g. `accept-language`,
`x-tenant-id`).

**Multipart uploads** — pass `filesSchema` alongside `inputSchema`. The handler
receives the validated text fields merged with the validated `File` parts; the
call site sends a `FormData`. Files stay out of `inputSchema`, so its JSON-Schema
projection (OpenAPI/MCP/CLI) never has to model a binary.

**`withJsonSchema`** — attaches a `toJSONSchema()` projection to a schema whose
library doesn't expose one (Zod 4 / Effect / Arktype carry their own):

```ts
import { withJsonSchema } from '@belte/belte/shared/withJsonSchema'
export const fn = POST(handler, { inputSchema: withJsonSchema(vSchema, (s) => toJsonSchema(s)) })
```

#### Consuming

A verb's value is a `RemoteFunction` with the same call signature on both sides.

| Form | Resolves to | On non-2xx |
| --- | --- | --- |
| `fn(args)` | the Content-Type-decoded body (`Promise<Return>`) | throws `HttpError` |
| `fn.raw(args)` | the underlying `Response` | no throw — inspect status/headers/body |
| `fn.stream(args?)` | a `Subscribable<Return>` view of the body (SSE/JSONL frames, or the decoded body once) | surfaced via `subscribe.error` |

```ts
const post = await getPost({ id })          // decoded body, throws HttpError on 4xx/5xx
const res = await getPost.raw({ id })        // Response; res.status, res.headers
const live = orderFeed.stream({ since })     // Subscribable — pass to subscribe()
```

**`HttpError`** (`belte/shared/HttpError`) carries `status`, `statusText`, and the
raw `response` so a call site can render error UI without opting into `.raw`.

**OpenAPI** — every verb is described at `/openapi.json` (OpenAPI 3.1) regardless
of which machine clients it advertises. `GET`/`DELETE`/`HEAD` args become query
parameters; `POST`/`PUT`/`PATCH` args become a JSON request body (or
`multipart/form-data` when `filesSchema` is set). `operationId` is the
folder-prefixed command name.

### Server / sockets

A bidirectional named broadcast primitive. One file per socket under
`src/server/sockets/`; import the helper from `belte/server/socket`.

```ts
type socket = <T>(opts?: {
    history?: number          // messages replayed to a new subscriber (default 0)
    ttl?: number              // ms; history entries older than this are evicted lazily
    clientPublish?: boolean   // allow clients to publish over the wire (default false)
    schema?: StandardSchemaV1 // validates publish payloads; infers T; unlocks mcp/cli
    clients?: Partial<{ browser; mcp; cli }>
}) => Socket<T>
```

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

export const chat = socket({
    history: 50,
    clientPublish: true,
    schema: z.object({ user: z.string(), text: z.string() }),
})
```

**Publishing** is isomorphic: `chat.publish(msg)` notifies in-process iterators and
fans out to remote subscribers via Bun's native `server.publish`. With a `schema`,
publish validates synchronously and throws on a bad payload.

**Consuming** — a `Socket<T>` is an `AsyncIterable<T>`:

```ts
for await (const msg of chat) { /* replays history, then tails live */ }
for await (const msg of chat.tail(10)) { /* last 10, then live */ }
```

`.tail(count)` replays the last `count` items (default `0`, clamped to the configured
`history`) before tailing. In a Svelte component, layer `subscribe()` on top instead
of iterating by hand.

## Clients

### Shared

**`cache(fn, options?)`** (`belte/shared/cache`) returns an invoker; calling it
checks a store and shares the in-flight promise on a hit, or runs `fn` once on a
miss. `fn` is a verb helper, `fn.raw`, or a plain producer.

```ts
type cache = (fn, options?: {
    ttl?: number              // ms past resolve: omitted = forever, 0 = dedupe only
    scope?: string | string[] // tags for grouped cache.invalidate({ scope })
    global?: boolean          // process-level store instead of request-scoped (server)
    invalidate?: { throttle?: number } | { debounce?: number } // coalesce refetches
}) => (args?) => Promise<Return>
```

```ts
// server (SSR) or client
const post = await cache(getPost)({ id })        // decoded body
const res  = await cache(getPost.raw)({ id })     // raw Response, same cache key
const rates = await cache(fetchRates)()           // plain producer (hoist for dedupe)
```

`cache.invalidate(selector?)`, `cache.pending(selector?)`, and
`cache.refreshing(selector?)` share one selector grammar: omitted = all, a function
= that function's calls, `{ scope }` = a tagged group. Keys are auto-derived from
`method + url + args` (or `producer-ref + args`); arg keys distinguish `Date`,
`Map`, `Set`, and `bigint` from look-alike values via `canonicalJson` (a `Date`
never aliases its ISO string; a `Map` never aliases a plain object).

**SSR mode is chosen by how you read** — per Svelte's `{#await}` rule:

```svelte
<script>const post = await cache(getPost)({ id })</script>  <!-- blocks render → inlined in initial HTML -->

{#await cache(getPost)({ id }) then post}                    <!-- pending → shell flushes, value streams in -->
    {post.title}
{/await}
```

A top-level `await` flips the whole component instance into await-everything mode;
to mix blocking and streaming reads, isolate each blocking read in its own child
component. Reactivity is implicit — the invoker registers the surrounding
`$derived`/`$effect` via `createSubscriber`, so `cache.invalidate` re-runs it.

**`bundled()`** (`belte/shared/bundled`) returns whether the code is running inside
the desktop bundle — `true` in the bundle's webview or its embedded server process,
`false` in a plain browser tab or a standalone server binary. Same name, same
meaning on both sides; each side detects it differently (client: the webview's init
script; server: the launcher's `BELTE_PARENT_PID`). Branch UI or behaviour on it
without threading a flag through your code.

### Browser

**Pages** are Svelte 5 components. Routing is file-based under `src/browser/pages/`:
every leaf lives in its own folder as `page.svelte`, `layout.svelte`, or
`error.svelte`. Dynamic segments use `[id]` / `[...rest]` folder names.

- **Layouts** are nearest-only: the deepest `layout.svelte` ancestor wraps a page.
- **Error pages** (`error.svelte`) render server-side for a 404 (unknown route) or
  a throw during a page render, nearest-only, with `{ status, message, stack }`
  props. The document ships static (no hydration).

**`navigate(href, options?)`** (`belte/browser/navigate`) is the SPA navigation
entry point.

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

A same-pathname change (search/hash only) skips the network round-trip; a
cross-origin or non-SPA target hard-navigates cleanly.

**`page`** (`belte/browser/page`) is reactive route state — a discriminated union
on `route`, so narrowing `page.route` types `page.params`.

| Field | Type | Notes |
| --- | --- | --- |
| `page.route` | the matched route key | discriminant |
| `page.params` | param shape for that route | typed from the generated routes |
| `page.url` | live `URL` | reassigned on every nav so `$derived` re-runs |

**`subscribe(subscribable)`** (`belte/browser/subscribe`) reactively reads a
streaming source — a `Socket<T>` or `fn.stream(args)`:

```svelte
<script lang="ts">
    import { subscribe } from '@belte/belte/browser/subscribe'
    import { chat } from '$server/sockets/chat'
    const latest = $derived(subscribe(chat))             // T | undefined
    const status = $derived(subscribe.status(chat))      // 'pending' | 'open' | 'done' | 'error'
    const err = $derived(subscribe.error(chat))          // Error | undefined
</script>
```

It opens the iterator on the first `$derived` read and closes it when the last
reader stops; many `$derived`s reading the same source share one subscription
(deduped by name). It's a no-op during SSR — seed initial HTML via `cache()` against
an HTTP rpc and layer `subscribe()` on top for live updates after hydration.

### Mcp

The MCP server is fully framework-generated at `/__belte/mcp` (JSON-RPC, protocol
`2025-06-18`) — there is no module to author.

- **Tools** come from every verb with `clients.mcp` (read-only + schema → auto;
  mutating → explicit `clients.mcp`) and from every mcp-exposed socket: a
  `<base>-tail` read tool plus a `<base>-publish` tool when `clientPublish` is set.
  The HTTP verb feeds each tool's annotations (`readOnlyHint`/`destructiveHint`/
  `idempotentHint`). Tool calls run through the same `verb.fetch` seam as the HTTP
  router, inheriting forwarded auth headers.
- **Resources** are files under `src/mcp/resources/`, served under the
  `belte://resources/<path>` URI namespace (text inline, binary as base64).
- **Prompts** are `.md` files under `src/mcp/prompts/`. YAML frontmatter carries
  `description` and an `arguments` list; the body interpolates `{{name}}`
  placeholders at `prompts/get`.

```md
---
description: Summarize a thread
arguments:
  - name: topic
    description: what to focus on
    required: true
---
Summarize the discussion, focusing on {{topic}}.
```

### Cli

`belte cli` builds a thin remote-client binary (no handler code) that ships the
compiled server beside it. It talks to a running server over HTTP, or boots a local
one with `<name> /start`.

| First arg | Action |
| --- | --- |
| `--help` / `-h`, `/help [cmd]` | top-level or per-command help |
| (none) on a TTY | interactive session, resuming the saved connection |
| `/connect <url>` | connect to a remote server, open a session |
| `/start` | boot a local instance, open a session |
| `/disconnect` | forget the saved connection |
| `<cmd> [--flags]` | one-shot rpc against the resumed target |

Connection target comes from `BELTE_APP_URL` / `BELTE_APP_TOKEN` (precedence: shell
> data-dir `.env` > binary-dir `.env`). The token sets a `Bearer` auth header, so an
authenticated server's CLI (and its authenticated binary downloads via
`/__belte/cli`) work the same.

Each rpc becomes a subcommand; the input schema derives the flags:

| Schema type | Flag form |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name <n>` (coerced) |
| `array` | repeated `--name <v>` |
| anything else | `--name <value>` |
| complex / nested | `--json '<args>'`, or pipe a JSON object on stdin |

Optional `src/cli/banner.txt` prints above top-level help; `src/cli/footer.txt`
below it.

### Bundle

`belte bundle` assembles a movable, self-contained desktop app for the host
platform — the server binary, the launcher, and the webview lib together (a `.app`
on macOS, a flat directory elsewhere). On macOS the `.app` is **ad-hoc
code-signed** (`codesign --sign -`, no certificate) so it launches on other Macs; a
quarantined copy may still need `xattr -cr <app>` once. Full distribution still
needs a Developer ID signature and notarization.

The app boots into a connect screen that either starts the embedded server or
connects to a remote one. Customize via files under `src/bundle/`:

- **`window.ts`** default-exports a `BundleWindow` (`belte/bundle/BundleWindow`):
  `title`, `width`, `height`, custom `menu` (`BundleMenu` / `BundleMenuItem`), and a
  `config` schema override for the first-run setup form (defaults to the
  `src/server/config.ts` env schema).
- **`disconnected.svelte`** overrides the connect screen.
- **`onMenu`** (`belte/bundle/onMenu`) subscribes to custom menu clicks, returning
  an unsubscribe for `$effect`:

```ts
$effect(() => onMenu('reload', () => location.reload()))
```

- **`icon.png`** is the app icon.

## Some details

**Config / env** — optional `src/server/config.ts` calls `env(schema)`
(`belte/server/env`) to validate `Bun.env` against a Standard Schema at boot; a
missing/malformed var fails the boot with every issue listed. belte eager-imports
the file (no import from your code); import `config` from `$server/config`
server-side. `appDataDir()` (`belte/server/appDataDir`) returns the bundled app's
per-user data directory.

**App hooks** — optional exports from `src/app.ts` (`belte/server/AppModule` types
them):

| Export | Runs |
| --- | --- |
| `forwardHeaders` | extra inbound header names to forward onto in-process rpc Requests |
| `init({ server })` | once after `Bun.serve` is up; return a cleanup for SIGINT/SIGTERM |
| `handle(request, next)` | middleware wrapping the request pipeline |
| `handleError(error, request)` | custom 500 fallback |

**Project layout**

```text
src/
  app.ts                      optional hooks
  server/
    config.ts                 optional env(schema), eager-imported at boot
    rpc/<name>.ts             one verb-bound function per file → /rpc/<path>
    sockets/<name>.ts         one socket per file
    lib/                      userland (declare your own aliases)
  browser/
    app.html                  optional shell override
    pages/**/page.svelte      routes (layout.svelte, error.svelte nearest-only)
    public/                   served at the site root
  mcp/
    prompts/*.md              MCP prompts
    resources/**              MCP resources
  bundle/
    window.ts                 BundleWindow config
    disconnected.svelte       connect-screen override
    icon.png
  cli/
    banner.txt  footer.txt    CLI help chrome
```

Aliases `$server`, `$browser`, `$shared`, `$mcp`, `$cli` resolve to the top-level
project directories; `lib/` is userland.

**CLI commands**

| Command | Does |
| --- | --- |
| `bunx belte scaffold <name>` | scaffold a new project |
| `belte dev` | build the client + run the server with browser live-reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file> [args]` | run a script under the belte preload (same runtime as the server) |
| `belte compile [--target] [--out]` | build a standalone server executable |
| `belte cli [--target] [--out] [--platforms a,b,c]` | build the thin CLI binary (ships the server beside it) |
| `belte bundle` | build a movable, self-contained desktop app (macOS `.app` ad-hoc signed) |

**Bundling targets**

| Target | Output | Surface |
| --- | --- | --- |
| `belte build` | `dist/_app/` client assets | web (with `belte start`) |
| `belte compile` | one server executable | self-hosted HTTP |
| `belte cli` | thin client binary + sibling server | CLI / scripting |
| `belte bundle` | movable app (`.app` on macOS) | desktop |

**`public/` files** under `src/browser/public/` are served at the site root,
bypassing the request scope and middleware.

**Logging** — `log` (`belte/shared/log`) wraps `console.*` with a `[belte]` prefix
and per-method/status coloring. `DEBUG` follows the `debug` convention; `DEBUG=belte`
turns on request logging and prints the boot surface map.

**Environment variables**

| Var | Effect |
| --- | --- |
| `PORT` | bind this exact port; unset scans upward from 3000 |
| `BELTE_IDLE_TIMEOUT` | Bun per-connection idle timeout (seconds; default 10) |
| `DEBUG` | `belte` enables request logs + the surface map |
| `BELTE_APP_URL` / `BELTE_APP_TOKEN` | CLI binary's default server + bearer token |
