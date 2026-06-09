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
        │
        ├─ browser   await getPost({ id })       same import in a .svelte file —
        │                                        the bundler swaps in a fetch
        ├─ http      GET /rpc/getPost?id=1       curl, fetch, anything
        ├─ cli       my-app getPost --id 1       generated standalone binary
        ├─ mcp       tool "getPost"              POST /__belte/mcp (JSON-RPC)
        └─ openapi   GET /openapi.json           one operation per verb
```

Don't take the diagram's word for it — belte prints the exact map at boot
(`DEBUG=belte`):

```sh
[belte] pages:
  page                   layout  error
  /                      /       /
  /post/[id]             /       /
[belte] sockets:
  socket                 schema  browser  mcp  cli  publish
  chat                   ✓       ✓        ✓    ✓    ✓
[belte] rpcs:
  http                   schema  browser  mcp  cli
  GET   /rpc/getPost     ✓       ✓        ✓    ✓
  POST  /rpc/addComment  ·       ✓        ·    ·
```

One declaration per row, one surface per column. The `schema` column gates the
machine surfaces — a schemaless declaration prints its `·` in red, because
that's the one thing standing between it and MCP/CLI exposure. Every surface a
function reaches is auditable in one place — no surface is ever exposed by
accident.

## Try it

```sh
bunx @belte/belte scaffold my-app
cd my-app && bun install && bun dev
```

Or run the demo app that exercises every feature in this README:

```sh
git clone https://github.com/briancray/belte
cd belte && bun install
cd examples/kitchen-sink && bun run dev
```

## Why it's built this way

- **Zero runtime dependencies.** `@belte/belte` has no `dependencies` — only
  peers (`svelte`, plus optional tailwind). Everything else is Web standards
  (`Request`, `Response`, `URL`, `ReadableStream`, `AsyncLocalStorage`) and Bun
  built-ins (`Bun.serve`, `Bun.CookieMap`, `Bun.YAML`, `Bun.zstdDecompress`).
- **No magic strings.** The per-target swap is driven by a real character-level
  scanner (`findExportCallSite`) that skips strings, template literals,
  comments, regex, and nested TypeScript generics — a `GET` mentioned in a
  docstring is never rewritten, and each rpc/socket file is enforced to declare
  exactly one export.
- **Safe by default for machines.** A read-only verb (GET/HEAD) with an
  `inputSchema` auto-exposes to MCP; a mutating verb never does — it requires an
  explicit `clients: { mcp: true }`, so a model can't delete data just because
  the handler carries a schema.

## Scope — read this before you adopt

- **Bun-only, by design.** `engines.bun >= 1.3`. The runtime leans on
  `Bun.serve` routes, `Bun.CookieMap`, native zstd, and Bun plugins. There is no
  Node fallback and none is planned.
- **Svelte-only web surface.** Pages, layouts, and error views are Svelte 5
  components (runes). No adapter layer for other view libraries.
- **Pre-1.0.** The core (rpc, pages, cache, sockets) is the most settled; the
  newer satellites (mcp, cli, desktop bundle, agent) move faster. Expect
  breaking changes at minor versions until 1.0.

## The mental model

Three ideas carry the whole framework:

1. **One runtime.** `belte dev` and the compiled production binary run the same
   server entry through the same plugins — dev adds a file-watching orchestrator
   and a live-reload channel, nothing else. What you debug is what you ship.
2. **Declare once.** A file under `src/server/rpc/` *is* its URL, export name,
   CLI subcommand, and MCP tool. There's no router file, no manifest to edit —
   the resolver plugin derives everything from the file path.
3. **The namespace marks the side.**

| Import prefix | Runs on | Examples |
| --- | --- | --- |
| `@belte/belte/server/*` | server only | `GET`, `socket`, `json`, `request`, `cookies`, `env`, `agent` |
| `@belte/belte/browser/*` | client only | `page`, `navigate`, `subscribe` |
| `@belte/belte/shared/*` | both — same callable, same name, same behavior | `cache`, `HttpError`, `log`, `withJsonSchema` |

There is no umbrella `index.ts` anywhere: every public name has its own module
path (see the `exports` map), so importing one name never drags side-effecting
siblings into your bundle.

## One function, every surface

Declare a verb with a schema:

```ts
// src/server/rpc/users/list.ts
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'

export const list = GET(async ({ limit }) => json(await db.users(limit)), {
    inputSchema: z.object({ limit: z.coerce.number().default(20) }),
})
```

Consume it from all five surfaces, no extra code:

```svelte
<script lang="ts">
// browser — same import; the bundler swapped in a fetch
import { list } from '$server/rpc/users/list.ts'

const users = await list({ limit: 10 })
</script>
```

```sh
# http — args ride the query string on GET/DELETE/HEAD
curl 'http://localhost:3000/rpc/users/list?limit=10'

# cli — nested folders join with `-`; flags derive from the schema
my-app users-list --limit 10

# mcp — the tool is named users-list; auth headers flow through
curl -X POST http://localhost:3000/__belte/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"users-list","arguments":{"limit":10}}}'

# openapi — one operation per verb, parameters from the schema
curl http://localhost:3000/openapi.json
```

## Server

### Server / rpc — declaring

Every file under `src/server/rpc/` exposes exactly one verb-bound remote
function. The filename is the export name and the URL path (under `/rpc/`); the
imported helper picks the method.

```ts
export const name = VERB<Args>(handler, options?)
```

| Piece | Rule |
| --- | --- |
| `VERB` | `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` — one import per verb from `@belte/belte/server/<VERB>` |
| `name` | must match the filename (`users/list.ts` → `export const list`); one export per file, enforced |
| URL | file path under `src/server/rpc/`, mounted at `/rpc/...` (`users/list.ts` → `/rpc/users/list`) |
| `Args` | inferred from `inputSchema` when present, else from the handler's parameter annotation |
| Return | inferred from the handler body via the `TypedResponse<T>` brand on the response helpers |

Options (all optional):

| Option | Type | Effect |
| --- | --- | --- |
| `inputSchema` | Standard Schema | validates args (422 with `{ issues }` on failure), infers `Args`, and unlocks the machine surfaces |
| `outputSchema` | Standard Schema | describes the success body for the OpenAPI 200 response and the MCP tool output |
| `filesSchema` | Standard Schema | validates the `File` parts of a multipart body and merges them into the handler's args — files stay out of `inputSchema` so its JSON-Schema projection never has to model a binary |
| `clients` | `{ browser?, mcp?, cli? }` | per-surface exposure; explicit values always win |

`clients` defaults: `browser` is always on; `cli` flips on for any verb with an
`inputSchema`; `mcp` flips on only for read-only verbs (GET/HEAD) with one —
mutating verbs require an explicit `clients: { mcp: true }`.

Response helpers — one per module path, all default `Cache-Control: no-store`:

| Helper | Content type | Notes |
| --- | --- | --- |
| `json(data, init?)` | `application/json` | `Response.json` with rpc-friendly defaults |
| `jsonl(iterable, init?)` | `application/jsonl` | one JSON value per line from an `AsyncIterable`; a generator throw emits a final `{"$error":"<message>"}` line |
| `sse(iterable, init?)` | `text/event-stream` | one `data:` event per frame; 15s keepalive comments; errors arrive as an `event: error` frame |
| `error(status, message?, init?)` | `text/plain` | message defaults to the status's reason phrase (`error(404)` → `Not Found`); the caller's `await fn()` throws `HttpError` |
| `redirect(url, status?, init?)` | — | relative URLs allowed; status defaults to 302 (301/303/307/308 accepted) |

Request-scope helpers — each throws when called outside an SSR render or rpc
handler:

| Helper | Returns |
| --- | --- |
| `request()` | the inbound `Request` |
| `cookies()` | the request's `Bun.CookieMap` — reads parse the `Cookie` header lazily; `set`/`delete` flush to `Set-Cookie` when the handler returns |
| `server()` | the live `Bun.serve` instance (`publish`, `timeout`, `requestIP`, …); inside an in-process call (CLI/MCP/tests) it's a no-op stand-in, so handler idioms run unchanged |

> **Header forwarding is an allowlist.** When SSR or an MCP call invokes a verb
> in-process, only `cookie`, `authorization`, and the `x-forwarded-*` hints are
> copied onto the synthesized Request. A handler that reads anything else
> (`accept-language`, a trace id, `x-tenant-*`) sees nothing — add those names
> via the `forwardHeaders` export in `src/app.ts`.

Uploads: a body verb (POST/PUT/PATCH) also accepts a `FormData` in place of
typed args — text fields become args (still schema-validated), `File` parts are
validated by `filesSchema` and merged in:

```ts
// src/server/rpc/uploadAvatar.ts
export const uploadAvatar = POST(
    async ({ userId, avatar }) => json(await storage.put(userId, avatar)),
    { inputSchema, filesSchema },
)
```

Schema libraries without a native JSON-Schema projection wrap once at the
declaration with `withJsonSchema` from `@belte/belte/shared/withJsonSchema`:

```ts
export const config = env(withJsonSchema(vSchema, (s) => toJsonSchema(s)))
```

### Server / rpc — consuming

A declared verb is callable with the same shape on both sides:

| Form | Resolves to | Notes |
| --- | --- | --- |
| `fn(args)` | the Content-Type-decoded body | throws `HttpError` on non-2xx |
| `fn.raw(args)` | the underlying `Response` | status/headers/body streaming; shares `fn`'s cache key |
| `fn.stream(args)` | a `Subscribable<Return>` | SSE/JSONL handlers yield each frame; non-streaming handlers yield the decoded body once; pass it to `subscribe()` |

```ts
import { HttpError } from '@belte/belte/shared/HttpError'

try {
    const users = await list({ limit: 10 })
} catch (e) {
    if (e instanceof HttpError) {
        console.error(e.status, await e.response.text())
    }
}
```

The app's public HTTP surface is described at `/openapi.json` — query
parameters from the schema on GET/DELETE/HEAD, a JSON (or multipart) request
body on the body verbs, and the `outputSchema` as the 200 response.

### Server / sockets — declaring

Every file under `src/server/sockets/` exposes exactly one named broadcast
socket. The filename is the export and the socket name.

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'

export const chat = socket<ChatMessage>({ history: 50, clientPublish: true })
```

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `history` | `number` | `0` | buffer replayed to new subscribers |
| `ttl` | `number` (ms) | — | history entries older than `ttl` are evicted lazily on read/append (no background timer) |
| `clientPublish` | `boolean` | `false` | accept `pub` frames from browser/machine clients; off = server-only topic |
| `schema` | Standard Schema | — | validates publish payloads; infers `T`; unlocks mcp/cli |
| `clients` | `{ browser?, mcp?, cli? }` | browser-only without a schema, all surfaces with one | per-surface exposure |

All browser sockets multiplex onto **one** framework-owned WebSocket per client
at `/__belte/sockets` (cross-origin upgrades are rejected). With
`clients.mcp`, a socket contributes a `<name>-tail` read tool, plus a
`<name>-publish` tool when `clientPublish` is set.

### Server / sockets — publishing and consuming

`publish` is isomorphic — server code fans out in-process and to remote
subscribers; client code sends a validated `pub` frame:

```ts
chat.publish({ user, text })
```

The socket itself is an `AsyncIterable`: iterating replays the full history
buffer, then tails live. `.tail(count)` replays only the last `count` items
(default `0`, clamped to the declared `history`):

```ts
for await (const message of chat) {
    await persist(message)
}
```

### Server / agent

```ts
type AgentEngine = (input: {
    surface: AgentSurface       // the app's gated tool/prompt/resource surface
    messages: NeutralMessage[]  // provider-neutral conversation turns
    origin: string
}) => AsyncIterable<AgentFrame> // text | tool_use | tool_result | done
```

`agent(engine, messages)` runs a model engine against the app's own MCP surface
and returns the engine's frame stream. It does **not** pick a transport — the
handler frames it with `jsonl()` or `sse()`, like any other streaming verb:

```ts
// src/server/rpc/chat.ts
import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

Engines live in provider packages — `@belte/anthropic` (a tool loop over the
Messages API) and `@belte/claude-code` (drives the Claude Agent SDK headless,
pointed at the app's MCP endpoint). An engine only sees the surface in and
frames out, so swapping providers never touches the verb or the UI. Permission
is decided server-side, not negotiated at runtime: the surface is already gated
by each verb's `clients.mcp` declaration plus its own per-call handler auth.

## Clients

### Shared

#### `cache()`

```ts
const read = cache(fn, options?)   // configure
const value = await read(args?)    // invoke — dedupes per key
```

`fn` is a remote function (`getPost`), its raw variant (`getPost.raw` — same
cache key, undecoded `Response`), or a plain producer (any
`(args?) => Promise<T>` — keyed by function reference, so hoist it to a stable
binding).

| Option | Values | Effect |
| --- | --- | --- |
| `ttl` | omitted | entry lives forever |
| | `0` | dedupe in-flight only — dropped once settled |
| | `n` (ms) | expires `n` ms after resolve |
| `scope` | `string \| string[]` | free-form tags grouping calls so one `cache.invalidate({ scope })` drops them together |
| `global` | `true` | process-level store on the server, so a value computed in one request is reused by later ones; the default request-scoped store keeps per-user data from leaking. No-op on the client (one tab store either way) |
| `invalidate` | `{ throttle: n }` or `{ debounce: n }` | coalesces an invalidation burst into fewer refetches and serves the stale value until the refetch resolves (stale-while-revalidate). Set at most one |

How you consume the read decides SSR behavior — there is no option:

```svelte
<script lang="ts">
const post = await cache(getPost)({ id })   // blocks render → baked into the SSR HTML
</script>

{#await cache(getPost)({ id }) then post}   <!-- pending branch renders; the value
    <h1>{post.title}</h1>                        streams in out-of-band when it lands -->
{/await}
```

Consume reads via `await` / `{#await}` only — the decoded read is typed
`Promise<Return> | Return` because a warm SSR-hydrated value returns
synchronously, so chaining `.then` on it is a compile error by design.

Selectors are shared by the three companions:

```ts
cache.invalidate()                  // drop everything
cache.invalidate(fn)                // one function's calls (fn and fn.raw match the same set)
cache.invalidate({ scope: 'feed' }) // every entry sharing the tag

const loading = $derived(cache.pending(fn))      // reactive: any matching call in flight
const updating = $derived(cache.refreshing(fn))  // reactive: reloading data it already had
```

Keys are auto-derived (`method + url + args` for remotes, reference + args for
producers) through a canonical encoder that distinguishes types JSON would
flatten — `Date`, `Map`, `Set`, and `bigint` all key distinctly, and object key
order never matters.

#### `HttpError`

Thrown by remote calls on non-2xx. Carries `status`, `statusText`, and the raw
`response` so error UI can read the body without opting the call site into
`.raw()`. Isomorphic — same class on both sides.

### Browser

Pages are Svelte 5 components at `src/browser/pages/**/page.svelte`; the
directory path is the route, `[name]` segments are params (passed as props),
`[...rest]` catches the remainder:

| File | Route | Props |
| --- | --- | --- |
| `pages/page.svelte` | `/` | — |
| `pages/post/[id]/page.svelte` | `/post/[id]` | `id` |
| `pages/docs/[...rest]/page.svelte` | `/docs/[...rest]` | `rest` (joined path) |

`layout.svelte` files wrap pages by directory prefix — **nearest-only**, the
deepest ancestor wins, no stacking. `error.svelte` files follow the same rule
and render for an unknown route (404) or a throw during a page render (500),
receiving `{ status, message, stack }` as props; the error document is static
(no hydration).

#### `subscribe()`

```ts
const latest = subscribe(subscribable)   // T | undefined
```

Reactive consumer for streaming sources — a declared socket or
`fn.stream(args)`. The first `$derived` read in a tracking scope opens the
underlying iterator (history replay on a socket, a fresh fetch on an rpc
stream); the last reader to stop closes it. Readers of the same source share
one subscription. A no-op during SSR (returns `undefined`) — seed initial HTML
via `cache()` and layer `subscribe()` on top for liveness:

```svelte
<script lang="ts">
import { subscribe } from '@belte/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'

const latest = $derived(subscribe(chat))
const status = $derived(subscribe.status(chat)) // 'pending' | 'open' | 'done' | 'error'
const failure = $derived(subscribe.error(chat)) // Error | undefined
</script>
```

#### `navigate()`

```ts
navigate(href, options?: { replace?: boolean; scroll?: boolean })
```

SPA navigation: resolves the target view *before* touching history, swaps the
page on a known route, hard-navigates (`location.href`) on anything else —
cross-origin URLs, unknown routes, raw endpoints. Same-pathname changes
(search/hash) skip the network entirely. `replace` rewrites the current entry;
`scroll` (default `true`) scrolls to top after a pushed navigation.

#### `page`

| Field | Type | Notes |
| --- | --- | --- |
| `page.route` | `string` | matched route in bracket form (`/post/[id]`) — a discriminant: narrowing on it types `params` via the generated `routes.d.ts` |
| `page.params` | `Record<string, string>` | decoded params |
| `page.url` | `URL` | live location; reassigned on every navigation so `$derived` re-runs |
| `page.navigating` | `boolean` | true while a pathname-changing SPA navigation resolves; always false on the server |

Reads are reactive on the client and per-request on the server — the same
import works inside any component, including layouts during SSR.

`cache()` and `subscribe()` reactivity both ride Svelte's `createSubscriber`,
so a `$derived` that reads them re-runs on invalidation/new frames with no
extra wiring.

### Mcp

The MCP server is fully framework-generated and mounted at `/__belte/mcp`
(JSON-RPC over POST) — there is no server module to author.

| Surface | Source |
| --- | --- |
| tools | every verb with `clients.mcp` (auto for schema-bearing GET/HEAD); every `clients.mcp` socket as `<name>-tail` (+ `<name>-publish` when `clientPublish`) |
| prompts | `src/mcp/prompts/**.md` |
| resources | `src/mcp/resources/**` at `belte://resources/<path>` — text MIME types inline as UTF-8, everything else as base64 blobs |

Auth inherits from the inbound request — bearer/cookie headers flow into every
tool dispatch, and `app.handle` middleware applies to the endpoint like any rpc
path.

A prompt is one markdown file: optional YAML frontmatter (`description`,
`arguments`), then the template body with `{{name}}` placeholders:

```md
---
description: Draft a release announcement
arguments:
  - name: version
    required: true
---
Write a short announcement for version {{version}}.
```

### Cli

`belte cli` compiles a standalone binary — a thin remote client with the rpc
manifest baked in and the compiled server shipped beside it.

| First positional | Meaning |
| --- | --- |
| `<cmd> [--flags]` | one-shot rpc against the saved connection |
| `/connect <url>` | connect to a remote server, open a session |
| `/start` | spawn the bundled local server, open a session |
| `/disconnect` | forget the saved connection |
| `/help [cmd]` | top-level or per-command help |
| none (TTY) | interactive session resuming the saved connection |

Subcommand names are the rpc URL with folders joined by `-`
(`users/list.ts` → `users-list`). Flags derive from the verb's JSON schema:

| Schema property type | Flag form |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name 3` (coerced) |
| `array` | repeated `--name v` |
| anything else | `--name value` (string) |
| nested / unions | `--json '<args>'` escape hatch; a JSON object piped on stdin seeds the whole args bag |

Connection env: `BELTE_APP_URL` / `BELTE_APP_TOKEN`, layered shell > data-dir >
binary-dir. A running server serves its own CLI: `GET /__belte/cli` returns a
platform-detecting install script, and `GET /__belte/cli/<platform>` streams the
tarball — when that download request carries a bearer token, it's baked into the
shipped `.env`, so the installed CLI is pre-authenticated. `src/cli/banner.txt`
prints atop top-level help; `src/cli/footer.txt` below it.

Cross-compile with `belte cli --platforms=darwin-arm64,linux-x64,...`.

### Bundle

`belte bundle` assembles a movable, self-contained desktop app for the host
platform — server binary, launcher, and native webview together (a `.app` on
macOS, a flat directory elsewhere). **Unsigned** — distributing to other users
still needs platform signing/notarization (macOS Gatekeeper will warn
otherwise). It boots into a connect screen: start the embedded server or
connect to a remote one.

```ts
// src/bundle/window.ts (optional)
import type { BundleWindow } from '@belte/belte/bundle/BundleWindow'

export default {
    title: 'My App',
    width: 1100,
    height: 760,
    menu: [{ label: 'View', items: [{ label: 'Reload', shortcut: 'r', emit: 'reload' }] }],
} satisfies BundleWindow
```

| Field | Effect |
| --- | --- |
| `title` / `width` / `height` | window chrome; default title is the program name |
| `menu` | custom top-level menus between the standard Edit and Window menus; items are `{ label, shortcut?, emit }` (dispatches a `belte:menu` event), `{ label, navigate }` (repoints the window), or `{ separator: true }` |
| `config` | overrides the first-run setup form's schema — by default the form derives from `src/server/config.ts`'s env schema, and answers persist to the data-dir `.env` |

Custom menu items are handled with `onMenu`:

```svelte
<script lang="ts">
import { onMenu } from '@belte/belte/bundle/onMenu'

$effect(() => onMenu('reload', () => location.reload()))
</script>
```

Other conventions: `src/bundle/disconnected.svelte` overrides the view shown
when the connection drops; `src/bundle/icon.png` becomes the app icon
(`icon.icns` used as-is on macOS). `bundled()` from
`@belte/belte/shared/bundled` answers "am I part of the bundle" on both sides
— the webview's init script on the client, the launcher's env marker on the
server.

## Some details

### Config and env

```ts
// src/server/config.ts
import { env } from '@belte/belte/server/env'

export const config = env(z.object({ DATABASE_URL: z.string(), PORT: z.coerce.number().optional() }))
```

`env(schema)` validates `Bun.env` at module top level — a missing or malformed
variable fails the boot with every issue listed at once. Validation must be
synchronous. The same declaration drives the bundle's first-run setup form.
`appDataDir()` from `@belte/belte/server/appDataDir` returns the
platform-standard per-user data directory (Application Support / `%APPDATA%` /
XDG), overridable with `BELTE_DATA_DIR`.

Environment variables belte itself reads:

| Variable | Effect |
| --- | --- |
| `PORT` | bind exactly this port (collision fails loudly); unset → scan upward from 3000 |
| `BELTE_IDLE_TIMEOUT` | Bun's per-connection idle timeout in seconds (default 10); streaming responses opt out per-request |
| `BELTE_DATA_DIR` | override the per-user data directory (absolute path) |
| `DEBUG` | logging namespaces (below) |
| `BELTE_APP_URL` / `BELTE_APP_TOKEN` | the CLI's connection target and bearer |

### App hooks

All optional, exported from `src/app.ts`:

| Export | Shape | Effect |
| --- | --- | --- |
| `forwardHeaders` | `string[]` | extra inbound header names forwarded onto in-process rpc Requests, on top of the built-in allowlist |
| `init` | `({ server }) => cleanup?` | boot-time setup; the returned cleanup runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | single middleware around every dynamic route (pages, rpc, mcp, cli endpoints) — branch on the URL, mutate the response, gate with auth |
| `handleError` | `(error, request) => Response` | fallback for a thrown handler; default is the framework 500 |

### Project layout

```text
src/
  app.ts                    optional hooks (above)
  server/
    config.ts               optional env(schema) — boot validation + bundle form
    rpc/**.ts               one verb-bound remote function per file
    sockets/**.ts           one broadcast socket per file
  browser/
    app.html                optional shell override (default provided)
    pages/**/page.svelte    routes; layout.svelte / error.svelte by prefix
    public/**               served at the site root
  mcp/
    prompts/**.md           MCP prompts
    resources/**            MCP resources
  cli/
    banner.txt, footer.txt  CLI help chrome
  bundle/
    window.ts, disconnected.svelte, icon.png
```

Path aliases `$server/*`, `$browser/*`, `$shared/*`, `$mcp/*`, `$cli/*`
resolve into `src/`; the build also generates a `routes.d.ts` so `page.route`
narrows `page.params`. Svelte compiler options load from
`svelte.config.{js,mjs,ts}`.

### CLI commands

| Command | Does |
| --- | --- |
| `bunx @belte/belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with watch and live reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file> [args...]` | run a script under the belte preload (same runtime as the server). For tests: `preload = ["@belte/belte/preload"]` under `[test]` in `bunfig.toml`, then `bun test` |
| `belte compile [--target] [--out]` | standalone server executable |
| `belte cli [--target] [--out] [--platforms]` | standalone CLI binary (+ server beside it) |
| `belte bundle` | movable desktop app bundle (unsigned) |

Compile targets: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64`,
`bun-linux-x64`, `bun-windows-x64` (the `bun-` prefix is optional on the flag).

### Logging

`log` from `@belte/belte/shared/log` is the framework's logger — `[belte]`
prefix, status/method-colored request lines. `DEBUG` follows the `debug`
package's conventions (`DEBUG=belte`, `DEBUG=belte:*`, `DEBUG=*`, comma
lists). `DEBUG=belte` enables request logging and prints the boot surface map
shown at the top of this README. A server also answers
`GET /__belte/identity` with `{ belte: true, name, version }` so tooling can
probe what it's talking to.
