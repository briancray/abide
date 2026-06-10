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
  /                      /       ·
  /post/[id]             /       ·
[belte] sockets:
  socket                 schema  browser  mcp  cli  publish
  chat                   ✓       ✓        ✓    ✓    ·
[belte] rpcs:
  http                   schema  browser  mcp  cli
  GET   /rpc/getPost     ✓       ✓        ✓    ✓
  GET   /rpc/health      ·       ✓        ·    ·
  POST  /rpc/createPost  ✓       ✓        ·    ✓
```

One declaration per row, one surface per column. The `schema` column gates the
machine surfaces — a schemaless declaration prints its `·` in red, because
that's the one thing standing between it and MCP/CLI exposure. And note the
`POST` row: a schema alone doesn't put a mutation in front of a model. Every
surface a function reaches is auditable in one place — no surface is ever
exposed by accident.

## Why it's built this way

- **Zero runtime dependencies.** belte's `package.json` has no `dependencies`
  field. The framework stands on Web standards (`Request`, `Response`, `URL`,
  `ReadableStream`, `AsyncIterable`, `EventTarget`) and Bun natives
  (`Bun.serve`, `Bun.CookieMap`, `bun build`). Svelte is the one required peer;
  the Tailwind peers are optional.
- **No magic strings.** The bundler's rewrite of your rpc and socket exports is
  a real character-level tokenizer that skips strings, templates, comments,
  regex, and nested TypeScript generics — a `GET` mentioned in a docstring is
  never mistaken for the call, and each module must declare exactly one matching
  export or the build fails loudly.
- **Safe by default for machines.** Only read-only verbs (GET/HEAD) with a
  declared `inputSchema` auto-expose to MCP; a mutating verb requires an
  explicit `clients: { mcp: true }` no matter what it declares. The same
  read-only test feeds each MCP tool's `readOnlyHint` annotation, and SSR
  snapshots replay GET only — a write never re-fires unprompted.

## Scope — read this before you adopt

- **Bun-only, by design** (`engines.bun >= 1.3.0`). Runtime, bundler, test
  runner, and compile-to-binary are all Bun's. There is no Node fallback.
- **Svelte-only web surface** (Svelte 5, runes). Pages, layouts, and the
  reactive consumers assume it.
- **Pre-1.0.** The core (rpc, pages, cache, sockets) is the most settled; the
  newer satellites (MCP, generated CLI, desktop bundle, agent engines) move
  faster. Minor versions may break APIs; the changelog says when.

## Try it

```sh
bunx @belte/belte scaffold my-app
cd my-app && bun install
belte dev
```

## The mental model

Three ideas carry the whole framework:

1. **One runtime.** `belte dev` and `belte start` run the same server entry
   against the same build pipeline — dev adds a file watcher and a live-reload
   channel, nothing else. What you debug is what you deploy.
2. **Declare once.** A file's path is its identity: the filename is the export
   name, the URL, the MCP tool name, and the CLI subcommand —
   `src/server/rpc/users/list.ts` is `/rpc/users/list` over HTTP and
   `users-list` everywhere a `/` can't go.
3. **The namespace marks the side.** Every public name has its own module path —
   there is no umbrella `index.ts`, so importing one name never drags
   side-effecting siblings into a bundle.

| Import prefix | Runs | Examples |
| --- | --- | --- |
| `@belte/belte/server/*` | server only | `GET`, `socket`, `json`, `request`, `env`, `agent` |
| `@belte/belte/browser/*` | client only | `page`, `navigate`, `tail` |
| `@belte/belte/shared/*` | both sides, same behavior | `cache`, `pending`, `refreshing`, `HttpError` |
| `@belte/belte/bundle/*` | desktop bundle client | `BundleWindow`, `onMenu`, `bundled` |
| `@belte/belte/test/*` | tests | `createTestClient`, `assertAgentFrameConformance` |

Inside your project, five aliases mirror the source tree — `$server`,
`$browser`, `$shared`, `$mcp`, `$cli` — so a page imports its rpc as
`import { getPost } from '$server/rpc/getPost'`. `lib/` directories under each
are yours; belte claims no names there.

## One function, every surface

The verb at the top of this page, consumed back-to-back:

```svelte
<!-- src/browser/pages/post/[id]/page.svelte — SSR and SPA, same line -->
<script>
    import { getPost } from '$server/rpc/getPost'
    import { cache } from '@belte/belte/shared/cache'
    import { page } from '@belte/belte/browser/page'

    const post = await cache(getPost)({ id: page.params.id })
</script>

<h1>{post.title}</h1>
```

```sh
# http — query args for GET/DELETE, JSON body for the rest
curl 'http://localhost:3000/rpc/getPost?id=1'

# cli — flags generated from the schema
my-app getPost --id 1

# openapi — one operation per exposed verb
curl http://localhost:3000/openapi.json
```

```json
{ "method": "tools/call", "params": { "name": "getPost", "arguments": { "id": "1" } } }
```

(mcp — `tools/call` against `POST /__belte/mcp`; the caller's auth headers are
forwarded into the handler.)

The schema does the work everywhere: it validates args (`422 { issues }` on
failure), types the handler, and projects the CLI flags, the MCP tool input,
and the OpenAPI parameters from one declaration.

## Server

### Declaring rpcs

Every `.ts` file under `src/server/rpc/` declares exactly one remote function:
`export const <filename> = VERB(handler, opts?)`. The verbs — `GET`, `POST`,
`PUT`, `PATCH`, `DELETE`, `HEAD` — each live on their own import path.

```ts
type VerbOptions = {
    inputSchema?: StandardSchemaV1   // validates args; unlocks cli/mcp/openapi
    outputSchema?: StandardSchemaV1  // documents the 200 body (OpenAPI + MCP outputSchema)
    filesSchema?: StandardSchemaV1   // validates multipart File parts
    clients?: { browser?: boolean; mcp?: boolean; cli?: boolean }
}
```

| Option | Default | Effect |
| --- | --- | --- |
| `inputSchema` | — | Any Standard Schema (zod, valibot, arktype, …). The handler receives the parsed output type; failures return `422 { issues }`. |
| `outputSchema` | — | Documentation only; never validates at runtime. |
| `filesSchema` | — | Validates the `File` parts of a multipart body and merges them into the handler's args. The call site sends a `FormData`. Files stay out of the JSON-Schema projection. |
| `clients.browser` | `true` | Expose to browser/SSR. |
| `clients.mcp` | `true` for GET/HEAD with a schema | Mutations must opt in explicitly. |
| `clients.cli` | `true` with a schema | A human invokes the CLI deliberately. |

Schemas project to JSON Schema through their own `toJSONSchema()`. Zod 4,
Effect, and Arktype carry one natively; wrap anything else once, where the
schema is declared:

```ts
import { withJsonSchema } from '@belte/belte/shared/withJsonSchema'

const schema = withJsonSchema(valibotSchema, (s) => toJsonSchema(s))
```

#### Response helpers

| Helper | Content-Type | Notes |
| --- | --- | --- |
| `json(data, init?)` | `application/json` | `Cache-Control: no-store` unless overridden. Brands the body type so the verb's `Return` infers from the handler. |
| `jsonl(iterable, init?)` | `application/jsonl` | One JSON value per line from an `AsyncIterable`. Consumer cancellation flows into the generator's `finally`; a thrown error emits a final `{"$error":"…"}` line (full error logged server-side). |
| `sse(iterable, init?)` | `text/event-stream` | One `data:` event per frame, `: keepalive` comment every 15s so proxies don't drop idle streams, errors as an `event: error` frame. |
| `error(status, message?, init?)` | `text/plain` | Message defaults to the standard reason phrase — `error(404)` body is `Not Found`. Return it; thrown errors belong to `app.handleError`. |
| `redirect(url, status?, init?)` | — | Accepts relative URLs, defaults to 302. Statuses: 301, 302, 303, 307, 308. |

`error()` and `redirect()` type as `TypedResponse<never>`, so a handler that
branches between `error(...)` and `json(data)` still infers its `Return` from
the success branch alone.

#### Request context

| Function | Returns | Notes |
| --- | --- | --- |
| `request()` | the inbound `Request` | Throws outside a request scope — top-level module code can't read it. |
| `cookies()` | `Bun.CookieMap` | Parses the `Cookie` header lazily on first call; `set`/`delete` flush as `Set-Cookie` when the handler returns. |
| `server()` | the `Bun.serve` instance | In-process dispatch (CLI, MCP, tests) gets a no-op stand-in, so handler idioms like `server().requestIP(...)` run unchanged. |

> **Header forwarding is an allowlist.** When SSR or MCP invokes a verb
> in-process, the synthesized Request carries only `cookie`, `authorization`,
> and the `x-forwarded-*` hints. A handler that reads anything else during SSR —
> `accept-language`, a trace id, `x-tenant-*` — sees nothing. Add the names you
> rely on via the `forwardHeaders` export in `src/app.ts`.

### Consuming rpcs

| Form | Resolves to | Use when |
| --- | --- | --- |
| `await getPost(args)` | the decoded body | The default. Non-2xx throws `HttpError`. |
| `await getPost.raw(args)` | the `Response` | You need status, headers, or body streaming. |
| `tail(feed.stream(args))` | the latest frame | The handler returns `jsonl()` / `sse()`. |

`HttpError` carries `status`, `statusText`, and the raw `response`, so error UI
can read the body without opting the call site into `.raw`:

```ts
import { HttpError } from '@belte/belte/shared/HttpError'

try {
    await createPost(draft)
} catch (caught) {
    if (caught instanceof HttpError && caught.status === 409) {
        message = await caught.response.text()
    }
}
```

### Sockets

Every `.ts` file under `src/server/sockets/` declares one broadcast socket:
`export const <filename> = socket(opts?)`.

```ts
// src/server/sockets/chat.ts
import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

export const chat = socket({
    schema: z.object({ from: z.string(), text: z.string() }),
    tail: 50,
    clientPublish: true,
})
```

```ts
type SocketOptions = {
    tail?: number              // retained-tail size (default 0 — no retention, pure live pipe)
    ttl?: number               // ms before a retained frame expires (lazy eviction, no timers)
    clientPublish?: boolean    // allow client publishes (default false)
    schema?: StandardSchemaV1  // sync-validates every publish; unlocks mcp/cli
    clients?: { browser?: boolean; mcp?: boolean; cli?: boolean }
}
```

- `chat.publish(message)` is isomorphic: server-side it notifies in-process
  iterators and broadcasts over Bun's native pub/sub; client-side it sends a
  frame the server validates against `clientPublish` and the schema.
- The socket is the `AsyncIterable`: `for await (const m of chat)` is the live
  stream — no replay. Replay is `.tail`'s job: `chat.tail(n)` seeds with the
  last `n` retained frames then goes live; `chat.tail()` with no count seeds
  with the whole retained tail.
- `tail: n` opts the topic into retention. Retention exists for readers who
  weren't there — late joiners, reconnects, and the HTTP/MCP/CLI read faces;
  an undeclared socket retains nothing and storage is the consumer's concern.
- All sockets multiplex one framework-owned WebSocket per client at
  `/__belte/sockets`; each socket also has an HTTP face at
  `/__belte/sockets/<name>`.
- With a schema, MCP gets a `<name>-tail` read tool returning the retained
  tail — plus `<name>-publish` when `clientPublish` is set.

### Agent

`agent(engine, messages)` runs a model engine against the app's *own* MCP
surface and returns the engine's frame stream. It doesn't pick a transport —
the handler frames it, like any other streaming verb:

```ts
// src/server/rpc/chat.ts
import { POST } from '@belte/belte/server/POST'
import { jsonl } from '@belte/belte/server/jsonl'
import { agent } from '@belte/belte/server/agent'
import { engine } from '@belte/anthropic'

const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })

export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })
```

Engines live in provider packages (`@belte/anthropic`, `@belte/claude-code`) and
see only the surface in / frames out (`text`, `tool_use`, `tool_result`,
`done`), so swapping providers never touches the verb or the UI. Permission is
decided server-side, not negotiated at runtime: the surface an engine sees is
already gated by each verb's `clients.mcp` plus the handler's own per-call auth.

## Clients

### Shared

belte keeps two registries. The **cache** holds calls — data at rest, in a
per-request store on the server and a tab store in the browser. The **tail
registry** holds streams — data in motion. `cache.invalidate` is the bridge from
push events to pulled state, and the probes (`pending()`, `refreshing()`) read
both.

#### `cache()`

```ts
import { cache } from '@belte/belte/shared/cache'

type Cache = <Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    options?: CacheOptions,
) => (args?: Args) => Promise<Return> | Return

type CacheOptions = {
    ttl?: number                  // retention dial — see table
    global?: boolean              // process-level store instead of request/tab-scoped
    scope?: string | string[]     // declared identity tags for invalidate/probes
    invalidate?: { throttle: number } | { debounce: number }  // stale-while-revalidate
}
```

Coalescing is always on — identical in-flight calls share one flight. `ttl` is
purely the retention added on top:

| `ttl` | Behavior |
| --- | --- |
| omitted | Cached until invalidated. |
| `n` | Expires `n` ms after the promise resolves. |
| `0` | Nothing retained beyond the store's atomic unit: the whole request on the server (one render, one effect), the in-flight window in the tab. |

`ttl: 0` is the **mutation idiom** — double-submit coalescing and probe
visibility, with nothing cached:

```svelte
<script>
    import { cache } from '@belte/belte/shared/cache'
    import { pending } from '@belte/belte/shared/pending'
    import { createPost } from '$server/rpc/createPost'

    const submit = cache(createPost, { ttl: 0 })
</script>

<button disabled={pending(createPost)} onclick={() => submit(draft)}>Save</button>
```

How you consume a read decides its SSR mode, per Svelte's `{#await}` rule:

```svelte
<script>
    const post = await cache(getPost)({ id })   // blocks render → baked into the SSR HTML
</script>

{#await cache(getComments)({ id }) then comments}
    <!-- renders the pending branch → shell flushes now, value streams in -->
{/await}
```

The two don't mix inside one component — a top-level `await` sweeps every
promise in that component instance into blocking mode. Put blocking reads in
child components to combine both on a page.

The rest of the cache contract, one line each:

- Remote calls key on `method + url + args`; plain async functions ("producers")
  key on the function reference + args — hoist the producer to a stable binding
  (an inline arrow mints a fresh identity per call and never coalesces; belte
  warns once per call site).
- Keys distinguish `Date`, `Map`, `Set`, and `bigint` — argument types
  `JSON.stringify` would flatten or drop produce distinct keys.
- `scope` tags are declared identity: any module can
  `cache.invalidate({ scope: 'posts' })` or `pending({ scope: 'posts' })`
  without importing the wrapped function.
- `global: true` opts into the process-level store (memoize an external endpoint
  across requests); the default request-scoped store keeps one user's data from
  leaking into another's response.
- Server-rendered GET reads ship in the page snapshot and hydrate warm — the
  first client read returns synchronously and matches the SSR DOM. Only GET
  replays from a snapshot; a write never re-fires from hydration.
- A hydrated entry adopts the first reading call site's `ttl` (the snapshot
  carries no options): omitted keeps it, `n` starts the clock at that read,
  `0` serves the hydration pass and evicts.

`invalidate: { throttle: n }` / `{ debounce: n }` turn an invalidation hit into
revalidate-in-place instead of drop-and-refetch: the stale value stays visible
until the refetch lands, throttle refetches at most once per window under a
continuous event stream, debounce once after the events go quiet. A policy
declares "this call is safe to re-run unprompted", and `cache()` enforces the
contract at wrap time: a policy on a non-GET remote throws, `ttl: 0` with a
policy throws (nothing retained, nothing to revalidate), both knobs at once
throws. A producer under a policy must be a pure read — that part is yours.

#### `pending()` and `refreshing()`

Standalone reactive probes spanning both registries — their own import paths,
not properties of `cache`:

```ts
import { pending } from '@belte/belte/shared/pending'
import { refreshing } from '@belte/belte/shared/refreshing'

type Probe = (
    arg?: RemoteFunction | Producer | { scope: string | string[] } | Subscribable,
) => boolean
```

| Call | Answers |
| --- | --- |
| `pending()` | anything in flight, either registry (global activity bar) |
| `pending(getPost)` | any call of that function in flight |
| `pending({ scope: 'posts' })` | a tagged group |
| `pending(chat)` | that stream awaiting its first frame |
| `refreshing()` | anything reloading data it already had |
| `refreshing(getFeed)` | that function revalidating (policy refetch or drop-then-reload) |
| `refreshing(chat)` | that stream reconnecting with its last value retained |

`pending` means "no value yet". `refreshing` means "value held, fresher source
in flight" — never a merely-open stream. **Probes report, never act:** reading
one opens no fetch and no stream; inside `$derived`/`$effect` they re-run on
state changes, outside a tracking scope they return the current value.

### Browser

**Pages.** Every folder under `src/browser/pages/` with a `page.svelte` is a
route; the folder path is the URL, brackets are params
(`pages/post/[id]/page.svelte` → `/post/[id]`). `layout.svelte` wraps pages —
**nearest-only**: the deepest ancestor layout wins, layouts never stack.
`error.svelte` follows the same nearest rule.

**`page`** — reactive page state, side-aware (the client reads a tab singleton,
the server reads its own request scope, so concurrent renders never share):

| Property | Type | Notes |
| --- | --- | --- |
| `page.route` | `string` | Bracket form (`/post/[id]`). Narrowing on it types `params`. |
| `page.params` | per-route | The generated `Routes` interface types each route's params. |
| `page.url` | `URL` | Reassigned on every nav so `$derived` re-runs. |
| `page.navigating` | `boolean` | True while a pathname-changing SPA nav resolves; always false on the server. |

**`navigate(href, options?)`** — SPA navigation;
`{ replace?: boolean; scroll?: boolean }` (defaults `false` / `true`).
Same-pathname changes (search/hash) skip the network round-trip; cross-origin
targets and non-SPA routes fall back to a hard navigation; the target view is
resolved *before* history is written, so back/forward never strands a stale
document.

**`tail(subscribable, options?)`** — the reactive consumer for streaming
sources, taking a socket or an rpc `fn.stream(args)`. Bare, it is the
latest-wins read; with `{ last: n }`, a live window of the last ≤ `n` frames:

```svelte
<script>
    import { tail } from '@belte/belte/browser/tail'
    import { chat } from '$server/sockets/chat'

    const latest = $derived(tail(chat))                 // newest frame
    const recent = $derived(tail(chat, { last: 20 }))   // last ≤20 frames, live
</script>
```

| Form | Returns | Notes |
| --- | --- | --- |
| `tail(x)` | `T \| undefined` | `undefined` until the first frame. |
| `tail(x, { last: n })` | `T[]` | `[]` while pending — never `undefined`. `n` is an integer ≥ 1, capped live as frames arrive. |
| `tail.status(x, options?)` | `'pending' \| 'open' \| 'done' \| 'error'` | Pass the same options to address the same entry. |
| `tail.error(x, options?)` | `Error \| undefined` | Surfaces a stream error without throwing into markup. |

- Lifecycle mirrors `cache()`: the first `$derived` read opens the underlying
  iterator, the last reader to stop closes it, and readers of the same source
  and window size share one subscription — the bare form and each `last` are
  independent.
- Seeding follows retention: a socket declared `{ tail: n }` seeds the read by
  replaying up to `last` retained frames (one for the bare form), and the seed
  lands as a single update — never a frame-by-frame rebuild. A source with no
  retention (an rpc stream, an undeclared socket) starts live-only; the window
  fills from what arrives.
- **Transport loss self-heals.** If the socket channel drops, the held value or
  window is retained, `refreshing(chat)` reports true across the gap, and the
  stream reopens under the channel's backoff — status never degrades to
  `'error'` for a disconnect. On reconnect the replay commits over the window
  atomically; when nothing was retained, the held window stays and live frames
  append. Application errors stay terminal.
- `tail()` returns `undefined` (bare) or `[]` (window) on the server — SSR
  can't hold a stream open. Seed the initial HTML with `cache()` against an
  HTTP rpc, then layer `tail()` on top for liveness after hydration.

### Mcp

Generated — there is no server module to author. `POST /__belte/mcp` serves
tools, prompts, and resources:

- **Tools** from every verb and socket with `clients.mcp: true`, named after the
  rpc path (`users/list.ts` → `users-list`). The HTTP verb feeds each tool's
  annotations; inbound bearer/cookie auth flows into every tool dispatch.
- **Prompts** from `src/mcp/prompts/<name>.md` — each markdown file is one MCP
  prompt, its declared arguments interpolated into the body.
- **Resources** from `src/mcp/resources/**`, served under `belte://resources/` —
  text MIME types inline as UTF-8, everything else as base64 blobs.

### Cli

`belte cli` builds a standalone binary: a thin remote client with the command
manifest baked in — it carries no handler code, but ships the compiled server
beside it. One rule governs the first positional: `/` manages the connection, a
bare word runs a command.

| Invocation | Does |
| --- | --- |
| `my-app getPost --id 1` | one-shot rpc against the saved connection |
| `my-app` (TTY) | interactive session, resuming the saved connection |
| `my-app /connect <url>` | connect to a remote server, open a session |
| `my-app /start` | boot the bundled local server, open a session |
| `my-app /disconnect` | forget the saved connection |
| `my-app /help [cmd]` | help — per-command with an argument |

Flags derive from each verb's JSON Schema: `--id <string>`, booleans bare,
arrays as `--tag <value...>`; required flags print bare, optional in `[ ]`.
`BELTE_APP_URL` / `BELTE_APP_TOKEN` layer shell > data-dir > binary-dir, so a
downloaded binary resumes against its baked default. The running server serves
its own CLI at `/__belte/cli` (install page) and `/__belte/cli/<platform>`
(tar.gz, server included), rebuilt on demand when sources change.
`src/cli/banner.txt` and `src/cli/footer.txt` frame the generated help.

### Bundle

`belte bundle` assembles a movable, self-contained desktop app for the host
platform — server binary, launcher, and webview together (a `.app` on macOS, a
flat directory elsewhere). Unsigned: distributing to other machines still needs
platform signing/notarization (macOS Gatekeeper warns otherwise). The bundle
boots into a connect screen — start the embedded server or connect to a remote
one.

An optional `src/bundle/window.ts` default-exports the window config:

```ts
type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]          // custom menus, installed between Edit and Window
    config?: StandardSchemaV1    // overrides the first-run setup form (replaces, not merges)
}
```

The first-run setup form is projected from `src/server/config.ts`'s `env()`
schema by default — one declaration drives boot validation and the form. The
form shows when Start is clicked with a required key unset; answers persist to
the per-user data-dir `.env` the server loads at boot. Each property maps to one
env var: `title` labels the field, `description` hints, `format: 'password'`
masks, `default` pre-fills.

Custom menu items dispatch `belte:menu` events; listen with `onMenu` — both
forms return an unsubscribe, so they drop straight into `$effect`:

```svelte
<script>
    import { onMenu } from '@belte/belte/bundle/onMenu'

    $effect(() => onMenu('reload', () => location.reload()))
</script>
```

`bundled()` (from `@belte/belte/bundle/bundled`) is true on both sides exactly
when the code runs as part of the desktop bundle — the webview marks every
document it loads, the launcher marks its embedded server process. A plain
browser tab reads false even against the embedded server. `src/bundle/icon.png`
sets the app icon.

## Some details

**Config.** `env(schema)` in `src/server/config.ts` validates `Bun.env` at boot
— synchronously, every issue reported at once — and returns the typed config.
`appDataDir()` is the running app's per-user data directory, keyed by the
program name and independent of the working directory.

**App hooks** — all optional, exported from `src/app.ts`:

| Export | Shape | Does |
| --- | --- | --- |
| `forwardHeaders` | `string[]` | Extra inbound headers forwarded onto in-process rpc Requests, on top of cookie / authorization / `x-forwarded-*`. |
| `init` | `(ctx: { server }) => cleanup?` | Runs at boot; the returned cleanup runs on SIGINT/SIGTERM. |
| `handle` | `(request, next) => Response` | Single middleware with `next` — branch on the URL or mutate the response. |
| `handleError` | `(error, request) => Response` | Catches errors thrown by handlers. |

**Project layout.**

```text
src/
  app.ts                   optional hooks
  server/
    config.ts              env(schema) — typed config
    rpc/                   one verb export per file → /rpc/<path>
    sockets/               one socket export per file
  browser/
    app.html  app.css
    pages/                 page.svelte / layout.svelte / error.svelte per folder
    public/                static files served at the site root
  shared/                  isomorphic project code ($shared)
  mcp/
    prompts/*.md           MCP prompts
    resources/**           MCP resources (belte://resources/)
  cli/
    banner.txt footer.txt  CLI help framing
  bundle/
    window.ts  icon.png    desktop bundle config
```

**Framework commands.**

| Command | Does |
| --- | --- |
| `bunx @belte/belte scaffold <name>` | scaffold a new project |
| `belte dev` | build + run with hot reload |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file> [args...]` | run a script under the belte preload — same runtime as the server |
| `belte compile [--target] [--out]` | standalone server executable |
| `belte cli [--target] [--out] [--platforms a,b,c]` | standalone CLI binary, server shipped beside it |
| `belte bundle` | movable desktop app bundle for this platform |

For tests, add `preload = ["@belte/belte/preload"]` under `[test]` in
`bunfig.toml` and run `bun test`.

**Compile targets:** `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64`,
`bun-linux-x64`, `bun-windows-x64` — the `bun-` prefix is optional on the flag.

**Logging.** `DEBUG` follows the `debug` package conventions (`belte`,
`belte:*`, `*`, comma-separated lists). `DEBUG=belte` prints the boot surface
map.

## License

MIT
