# belte

**Write one function. Get a web app, a CLI, and an AI tool — from the same line of code.**

belte is an HTTP framework for Bun + Svelte where a single declared function is
*simultaneously* an SSR call, a browser fetch, an MCP tool, a CLI subcommand, and
an OpenAPI operation. You don't wire up five surfaces. You write one handler; the
bundler swaps the runtime per target.

```ts
// src/server/rpc/getPost.ts — the filename is the export, the URL, and the command name
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'

export const getPost = GET<{ id: string }>(async ({ id }) => json(await db.post(id)))
```

That one file is now all of this:

```
                         ┌─ browser   await cache(getPost)({ id })   (SSR + hydrate, no refetch)
   src/server/rpc/       ├─ http      curl /rpc/getPost?id=1
   getPost.ts  ──────────┼─ cli       my-app getPost --id 1
   (one handler)         ├─ mcp       tool `getPost` at /__belte/mcp   (read-only verbs, opt-in)
                         └─ openapi   GET /rpc/getPost at /openapi.json
```

Don't take the diagram's word for it — with `DEBUG=belte`, belte prints the exact
map at boot:

```sh
$ DEBUG=belte bun dev
[belte] ready at http://localhost:3000
[belte] exposed surfaces:
  GET    /rpc/getPost → http, openapi, browser, mcp:getPost, cli:getPost
  POST   /rpc/createPost → http, openapi, browser  (add a schema → mcp/cli)
```

Every surface a function reaches is auditable in one place — no surface is ever
exposed by accident.

## Why it's built this way

- **Zero runtime dependencies.** belte declares no `dependencies` — only optional
  peers (Svelte, Tailwind). The framework rides Bun + Web APIs (`Request`,
  `Response`, `URL`, `FormData`, `structuredClone`, `bun:ffi`).
- **No magic strings.** The runtime swap is a real tokenizer that rewrites your rpc
  module per build target — it skips strings, templates, comments, regex, and
  generics, so a `GET` in a docstring is never mistaken for the real call. The stack
  stays greppable.
- **Safe by default for machines.** A verb only reaches MCP/CLI once it carries a
  schema, and a *mutating* verb (POST/PUT/PATCH/DELETE) never auto-exposes to an AI
  agent — a model can't `DELETE` just because a schema exists.

## Scope — read this before you adopt

belte is **Bun-only and Svelte-only, by design** (`engines.bun >= 1.3.0`). That
single bet is what makes the runtime swap honest and dependency-free — and it means
belte's blast radius is exactly Bun's. There is no Node fallback. It is **pre-1.0**
and primarily authored by one person; the core (rpc, SSR/SPA, cache) is stable, the
satellites (MCP, CLI, desktop bundle) are newer. If that trade fits, the rest of
this README is the reference.

## Try it

| Path | Steps |
| --- | --- |
| Scaffold a new app | `bunx @briancray/belte scaffold my-app` → `cd my-app && bun install` → `bun dev` |
| Kitchen-sink (every feature) | clone the repo → `cd examples/kitchen-sink && bun dev` |

The scaffold gives you a minimal project (one page, one rpc, one layout). The
kitchen-sink example exercises the full surface in one app.

---

## The mental model

Three ideas carry the whole framework:

- **One runtime.** Dev and build share the same server runtime and conventions —
  nothing behaves differently between `belte dev` and a compiled binary.
- **Declare once.** A function under `src/server/rpc/` *is* the HTTP endpoint, the
  typed browser call, the MCP tool, the CLI command, and the OpenAPI operation.
- **The namespace marks the side a name runs on.** The import path tells you — and
  the bundler — where code executes:

| Import namespace | Runs on | Examples |
| --- | --- | --- |
| `@briancray/belte/server/*` | server only | `GET`, `socket`, `json`, `request`, `cookies`, `env` |
| `@briancray/belte/browser/*` | client only | `page`, `navigate`, `subscribe` |
| `@briancray/belte/shared/*` | both (same callable, same behaviour) | `cache`, `HttpError`, `withJsonSchema`, `log` |

There is no umbrella `index.ts`. Every public name has its own module path, so
importing one name never drags side-effecting siblings into the bundle.

## One function, every surface

Declare a verb once, with a schema so the machine surfaces are safe to advertise:

```ts
// src/server/rpc/getOrder.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

export const getOrder = GET(async ({ id }) => json(await db.order(id)), {
  inputSchema: z.object({ id: z.string() }),
})
```

Then consume it from every side without writing another line of glue:

```svelte
<!-- browser: SSR + hydrate, no second fetch -->
<script lang="ts">
import { cache } from '@briancray/belte/shared/cache'
import { getOrder } from '$server/rpc/getOrder.ts'
const order = await cache(getOrder)({ id: '1' })
</script>
<h1>Order {order.id}</h1>
```

```sh
# http — same handler over the wire
curl localhost:3000/rpc/getOrder?id=1

# cli — rpc becomes a subcommand, schema fields become flags
my-app getOrder --id 1

# mcp — read-only + schema, so it auto-registers as a tool at /__belte/mcp

# openapi — described at /openapi.json, operationId `getOrder`
```

The filename is the export name and the URL (`/rpc/getOrder`); the imported verb
picks the HTTP method; the schema gates the machine surfaces. That's the contract.

---

## Server

### Server / rpc

Every file under `src/server/rpc/` declares exactly one verb-bound remote function.
The export name must match the file stem; the URL is `/rpc/<path>`.

#### Declaring

```ts
type VerbHelper = <Return, InputSchema, FilesSchema>(
  handler: (args) => Response | TypedResponse<Return>,
  opts?: {
    inputSchema?: StandardSchema
    outputSchema?: StandardSchema
    filesSchema?: StandardSchema
    clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
  },
) => RemoteFunction<Args, Return>
```

| Verb import | Method | Args carried as |
| --- | --- | --- |
| `@briancray/belte/server/GET` | GET | query string |
| `@briancray/belte/server/HEAD` | HEAD | query string |
| `@briancray/belte/server/DELETE` | DELETE | query string |
| `@briancray/belte/server/POST` | POST | JSON body |
| `@briancray/belte/server/PUT` | PUT | JSON body |
| `@briancray/belte/server/PATCH` | PATCH | JSON body |

| Option | Effect |
| --- | --- |
| `inputSchema` | Standard Schema validating inbound args; failure → `422`. `Args` infers from it. |
| `outputSchema` | Standard Schema for the success body; feeds the OpenAPI `200` and the MCP tool output schema. |
| `filesSchema` | Standard Schema for multipart `File` parts (see below). |
| `clients` | Which surfaces expose the verb. Defaults: `browser` always; `cli` on when an `inputSchema` is present; `mcp` on for read-only (GET/HEAD) verbs with a schema. Explicit values win. |

Any Standard Schema library works (Zod, Valibot, Arktype) with no adapter. The
`clients` defaults are deliberately conservative — the boot-time surface map (above)
confirms exactly what each verb exposes.

```ts
// validated input, typed output, exposed to mcp because GET + schema
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

export const getOrder = GET(async ({ id }) => json(await db.order(id)), {
  inputSchema: z.object({ id: z.string() }),
})
```

**Response helpers** — each is its own module:

| Import | Returns | Content-Type | Notes |
| --- | --- | --- | --- |
| `@briancray/belte/server/json` | `json(data, init?)` | `application/json` | `Cache-Control: no-store` default |
| `@briancray/belte/server/error` | `error(status, message?, init?)` | `text/plain` | message defaults to the status reason phrase |
| `@briancray/belte/server/redirect` | `redirect(url, status?, init?)` | — | accepts relative URLs; 301/302/303/307/308 |
| `@briancray/belte/server/jsonl` | `jsonl(iterable, init?)` | `application/jsonl` | one JSON value per line |
| `@briancray/belte/server/sse` | `sse(iterable, init?)` | `text/event-stream` | `data:` events, 15s keepalive comments |

```ts
if (!order) return error(404, 'order not found')
return redirect('/login')
```

**Request-scoped helpers** — resolve only while an SSR render or rpc handler is in
flight; throw outside a request scope:

| Import | Signature | Use |
| --- | --- | --- |
| `@briancray/belte/server/request` | `request(): Request` | the inbound `Request` |
| `@briancray/belte/server/server` | `server(): Server` | the live `Bun.serve` instance |
| `@briancray/belte/server/cookies` | `cookies(): Bun.CookieMap` | read inbound `Cookie`; `set`/`delete` flush as `Set-Cookie` on the response |

```ts
const jar = cookies()
const session = jar.get('session')
jar.set('session', token, { httpOnly: true, sameSite: 'lax' })
```

> **Header forwarding on the SSR/MCP path.** When SSR (or an MCP tool call) invokes
> a verb in-process, belte forwards only an allowlist of inbound headers — cookies,
> `authorization`, and the `x-forwarded-*` hints. Any other header a handler reads
> (`accept-language`, an idempotency key, a custom `x-tenant-*`) is dropped unless
> you name it via `forwardHeaders` in `src/app.ts` (see [App hooks](#app-hooks)).

**`filesSchema` (multipart uploads)** — a body verb also accepts a `FormData`.
`inputSchema` validates the text fields; `filesSchema` validates the `File` parts;
both merge into one args bag. Files stay off the JSON-Schema projection
(OpenAPI/MCP/CLI), since a `File` has no honest schema mapping.

```ts
export const upload = POST(async ({ title, avatar }) => json(await save(title, avatar)), {
  inputSchema: z.object({ title: z.string() }),
  filesSchema: z.object({ avatar: z.instanceof(File) }),
})
```

**`withJsonSchema()`** — attach a `toJSONSchema()` projection to a schema whose
library doesn't expose one (Zod 4 / Effect / Arktype carry their own):

```ts
type withJsonSchema = <Schema>(schema: Schema, toJsonSchema: (s: Schema) => object) => Schema
```

```ts
import { withJsonSchema } from '@briancray/belte/shared/withJsonSchema'
const schema = withJsonSchema(valibotSchema, (s) => toJsonSchema(s))
```

#### Consuming

A verb value is a `RemoteFunction<Args, Return>`. On the server the call runs the
handler directly; on the client the bundler swaps it for an HTTP fetch — same
signature either way.

| Form | Resolves to | On non-2xx |
| --- | --- | --- |
| `fn(args)` | Content-Type-decoded body | throws `HttpError` |
| `fn.raw(args)` | underlying `Response` | resolves (no throw) |
| `fn.stream(args)` | `Subscribable<T>` of body frames | surfaced via `subscribe` |

```ts
const post = await getPost({ id })          // decoded body, throws on error
const res = await getPost.raw({ id })         // Response — inspect status/headers
const live = getPost.stream({ id })           // iterable view, pass to subscribe()
```

Body verbs also accept a `FormData` in place of typed args, for uploads:

```ts
const form = new FormData()
form.set('title', t)
form.set('avatar', file)
await upload(form)
```

**`.stream(args)`** yields each SSE/JSONL frame for streaming handlers, or the
decoded body once for non-streaming handlers. The result is a `Subscribable`, so it
dedupes and shares across reactive readers (see `subscribe`).

**`HttpError`** — thrown by `fn(args)` on a non-2xx response. Carries the raw
`Response`:

```ts
import { HttpError } from '@briancray/belte/shared/HttpError'
try {
  await getPost({ id })
} catch (e) {
  if (e instanceof HttpError) console.log(e.status, await e.response.text())
}
```

**`openapi.json`** — an OpenAPI document describing every `/rpc/*` verb is served at
`/openapi.json` (the conventional root path, not under `/__belte/`). `operationId`
matches the MCP tool / CLI subcommand name.

### Server / sockets

Every file under `src/server/sockets/` declares exactly one named broadcast socket.
The export name matches the file stem; the file path becomes the socket's identity.

#### Declaring

```ts
type socket = <T>(opts?: {
  history?: number          // items replayed to a new subscriber
  ttl?: number              // ms; history entries older than this are evicted lazily
  clientPublish?: boolean   // allow publish() from clients over the wire (default false)
  schema?: StandardSchema   // validates publish payloads; T infers from it
  clients?: Partial<{ browser: boolean; mcp: boolean; cli: boolean }>
}) => Socket<T>
```

Defaults: browser-only when schemaless; all surfaces when a schema is present (a
`<base>-tail` read tool, plus `<base>-publish` when `clientPublish` is set).

```ts
// src/server/sockets/chat.ts
import { socket } from '@briancray/belte/server/socket'

export const chat = socket<{ user: string; text: string }>({ history: 50 })
```

#### Publishing

```ts
type publish = (message: T) => void
```

`publish` is isomorphic. Server-side it notifies in-process iterators and fans out
to remote subscribers via Bun's native `server.publish`; client-side (when
`clientPublish` is set) it sends a `pub` frame the server validates.

```ts
chat.publish({ user, text })
```

#### Consuming

A `Socket<T>` is itself an `AsyncIterable<T>`. Iterating replays history (if
configured) then tails live. `.tail(count)` replays the last `count` items
(default `0`) before tailing.

```ts
// AsyncIterable — full history replay then live
for await (const message of chat) {
  render(message)
}

// tail the last 10 then live
for await (const message of chat.tail(10)) {
  /* … */
}
```

In a Svelte component, drive it reactively with `subscribe` (below).

---

## Clients

### Shared

**`cache()`** — request-scoped (server) / tab-scoped (client) memoisation and SSR
hydration for remote calls and plain producers. Reactive: a read inside a
`$derived`/`$effect` re-runs when its key is invalidated.

```ts
type cache = <Args, Return>(
  fn: RemoteFunction<Args, Return> | RawRemoteFunction<Args> | ((args?: Args) => Promise<Return>),
  options?: {
    ttl?: number                                  // ms past resolve; omit = forever, 0 = dedupe only
    scope?: string | string[]                     // invalidation group tags
    global?: boolean                              // process-level store (server); no-op on client
    invalidate?: { throttle?: number } | { debounce?: number }  // coalesce refetch-after-invalidate
  },
) => (args?: Args) => Promise<Return>

cache.invalidate(selector?): void    // selector: a remote fn, a producer, { scope }, or nothing (all)
cache.pending(selector?): boolean    // reactive: is a matching call in flight? (no value yet)
cache.refreshing(selector?): boolean // reactive: is a matching entry serving stale during an invalidate refetch?
```

```ts
import { cache } from '@briancray/belte/shared/cache'

// server (SSR): top-level await bakes the value into the initial HTML
const post = await cache(getPost)({ id })

// browser: same call hydrates from the snapshot, then drives reactivity
const posts = $derived(await cache(listPosts)({ page }))
cache.invalidate(listPosts) // drop entries → next read refetches
const busy = $derived(cache.pending()) // any rpc in flight
const updating = $derived(cache.refreshing(listPosts)) // stale-while-revalidate badge
```

SSR rendering mode follows Svelte's `{#await}` rule, not a config flag: a top-level
`await` blocks render and inlines the value; an `{#await}` block flushes the shell
and streams the value in on the same response.

> **Cache keys are derived from your args.** belte builds a deterministic key from
> the argument object that distinguishes `Date`, `Map`, `Set`, and `bigint` values
> — so two calls that differ only by one of those don't collide. Keep args to plain,
> serialisable data; functions and symbols can't key anything meaningful.

**`HttpError`** — see [Server / rpc → Consuming](#consuming). Importable from
`@briancray/belte/shared/HttpError` on either side.

### Browser

**Pages** — every folder under `src/browser/pages/` containing a `page.svelte`
mounts at that folder's URL. Svelte 5 components; top-level `await` runs during SSR.

```svelte
<!-- src/browser/pages/posts/page.svelte → GET /posts -->
<script lang="ts">
import { cache } from '@briancray/belte/shared/cache'
import { listPosts } from '$server/rpc/listPosts.ts'
const posts = await cache(listPosts)()
</script>
{#each posts as post}<a href="/posts/{post.id}">{post.title}</a>{/each}
```

**Layouts** — a `layout.svelte` wraps the pages beneath it. Nearest-only: the
deepest matching layout runs and replaces ancestors (they don't stack). Runs on both
server and client.

```svelte
<script lang="ts">
let { children }: { children: import('svelte').Snippet } = $props()
</script>
<nav><a href="/">Home</a></nav>
<main>{@render children()}</main>
```

**Error pages** — an `error.svelte` renders for an unknown route (404) or a throw
during a page render; nearest-only like layouts. Receives `{ status, message, stack }`
props (nothing is serialized to `__SSR__` — they reach the browser only where your
template renders them).

**`subscribe`** — reactive consumer for a `Subscribable<T>` (a `Socket<T>` or
`fn.stream(args)`). The first read in a tracking scope opens the iterator; the last
reader to stop closes it. Many reads of the same source share one subscription
(keyed by name). No-op during SSR.

```ts
type subscribe = <T>(subscribable: Subscribable<T>) => T | undefined
subscribe.error(subscribable): Error | undefined
subscribe.status(subscribable): 'pending' | 'open' | 'done' | 'error'
```

```svelte
<script lang="ts">
import { subscribe } from '@briancray/belte/browser/subscribe'
import { chat } from '$server/sockets/chat.ts'
const latest = $derived(subscribe(chat))
const status = $derived(subscribe.status(chat))
</script>
{#if latest}<p>{latest.user}: {latest.text}</p>{/if}
```

**`navigate`** — SPA navigation. Pushes (or replaces) history, resolves the new
view, and reassigns `page.url` so `$derived` consumers re-run. Search/hash-only
changes skip the network round-trip. Falls back to a hard navigation on failure.

```ts
type navigate = (href: string, options?: { replace?: boolean; scroll?: boolean }) => Promise<void>
```

```ts
import { navigate } from '@briancray/belte/browser/navigate'
await navigate('/posts/1')
await navigate('?sort=new', { replace: true })
```

**Page state** — `page` from `@briancray/belte/browser/page` is a `$state` object
reflecting the current location. Discriminated on `route`, so narrowing `page.route`
types `page.params`.

| Field | Type | Meaning |
| --- | --- | --- |
| `page.route` | route key | the matched route |
| `page.params` | params shape | route params (typed per route via codegen) |
| `page.url` | `URL` | live location; reassigned on every nav |

```svelte
<script lang="ts">
import { page } from '@briancray/belte/browser/page'
const id = $derived(page.params.id)
</script>
```

**`cache()` reactivity** — `cache()`, `cache.pending()`, and `subscribe()` all
register the surrounding `$derived`/`$effect` via Svelte's `createSubscriber`.
Invalidating a key, a settling rpc, or a new socket frame re-runs the reading scope
automatically.

### Mcp

The MCP server is generated automatically and served at `/__belte/mcp` — there is no
server module to author. Server name/version default from `package.json`. Auth
inherits from the inbound request (bearer/cookie headers flow into each synthesized
rpc Request).

| MCP primitive | Source |
| --- | --- |
| Tools | every verb with `clients.mcp: true` (auto-on for read-only schema-bearing verbs; mutating verbs opt in) and every socket with `clients.mcp: true` (`<base>-tail`, plus `<base>-publish` when `clientPublish`) |
| Resources | files under `src/mcp/resources/` |
| Prompts | markdown files under `src/mcp/prompts/` |

**Resources** — files under `src/mcp/resources/` are served as MCP resources at
`belte://resources/<relative-path>`. Text MIME types return inline as `text`;
everything else as base64 `blob`.

```
src/mcp/resources/style-guide.md   →  belte://resources/style-guide.md
```

**Prompts** — each `src/mcp/prompts/<name>.md` becomes one MCP prompt. YAML
frontmatter declares `description` and `arguments`; the body interpolates `{{name}}`
placeholders at render time.

```md
<!-- src/mcp/prompts/summarize.md -->
---
description: Summarize a document in a given tone
arguments:
  - name: tone
    description: e.g. formal, casual
    required: true
---
Summarize the attached document in a {{tone}} tone.
```

### Cli

The CLI binary is generated automatically (`belte cli`) — a thin remote client with
the command manifest baked in. It ships the compiled server beside it so it can talk
to a remote server or boot a local one.

**Connection** — resolved from env, layered shell > data-dir `.env` > binary-dir
`.env`:

| Env var | Meaning |
| --- | --- |
| `BELTE_APP_URL` | server URL the CLI calls |
| `BELTE_APP_TOKEN` | bearer token forwarded on every call (verbatim; the framework neither issues nor refreshes) |

| Invocation | Behaviour |
| --- | --- |
| `<name>` (TTY) | interactive session, resuming the saved connection |
| `<name> <cmd> [--flags]` | one-shot rpc against the resolved target |
| `<name> /connect <url>` | connect to a remote server, open a session |
| `<name> /start` | boot a local instance, open a session |
| `<name> /disconnect` | forget the saved connection |
| `<name> /help [cmd]` | help, per-command with an arg |

**Commands** — each rpc with `clients.cli: true` (auto-on for any verb carrying an
`inputSchema`) becomes a subcommand. Flags derive from the schema:

| Schema property type | Flag form |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name <n>` (coerced) |
| `array` | repeated `--name <v>` |
| other | `--name <value>` |
| complex / nested | `--json '<args>'` escape hatch; or pipe a JSON object on stdin |

```sh
my-app getOrder --id 1
echo '{"id":"1"}' | my-app getOrder
```

**Downloading** — a running server serves a platform-detecting install script and
per-platform tarballs:

| Endpoint | Returns |
| --- | --- |
| `GET /__belte/cli` | shell install script (`curl <url>/__belte/cli \| sh`) |
| `GET /__belte/cli/<platform>` | gzipped tarball: thin CLI + server binary + a `.env` |

The baked `.env` always carries `BELTE_APP_URL`; an **authenticated** download
(request with `Authorization: Bearer …`) also bakes `BELTE_APP_TOKEN`, so the
installed binary resumes against the same server with the caller's credential.

**Banner / footer** — `src/cli/banner.txt` prints above the interactive session and
top-level help; `src/cli/footer.txt` prints below help.

### Bundle

`belte bundle` assembles a movable, self-contained native desktop app for the host
platform (a `.app` on macOS, a flat directory elsewhere) — the server binary, the
launcher, and the webview lib together. The app boots into a connect screen: start
the embedded server or connect to a remote one.

> Desktop bundles are **unsigned** and the surface is newer than the web/CLI paths.
> On macOS, Gatekeeper will prompt on first open unless you sign the `.app` yourself.

**`window.ts`** — optional `src/bundle/window.ts` default-exports the window config:

```ts
type BundleWindow = {
  title?: string
  width?: number
  height?: number
  menu?: BundleMenu[]        // custom top-level menus, inserted between Edit and Window
  config?: StandardSchema    // override the first-run setup form's schema (default: the env schema)
}
```

```ts
// src/bundle/window.ts
import type { BundleWindow } from '@briancray/belte/bundle/BundleWindow'
export default { title: 'My App', width: 1100, height: 720 } satisfies BundleWindow
```

The standard App/Edit/Window menus plus a built-in File menu (Start server /
Connect / Disconnect) are always installed.

**`disconnected.svelte`** — drop a `src/bundle/disconnected.svelte` to replace the
default connect screen. It talks to the launcher's control server (`POST /connect`,
`POST /start`), each replying with a `{ redirect }` to follow.

**`onMenu`** — subscribe to clicks on custom menu items (each dispatches a
`belte:menu` event). Returns an unsubscribe, so it drops into a Svelte `$effect`.
Inert during SSR and in a plain browser tab.

```ts
type onMenu = ((handler: (name: string) => void) => () => void)
            & ((name: string, handler: () => void) => () => void)
```

```ts
import { onMenu } from '@briancray/belte/bundle/onMenu'
$effect(() => onMenu('reload', () => location.reload()))
```

A menu item is a separator, an `emit` item (fires `belte:menu` into the page), or a
`navigate` item (repoints the window). `shortcut` is the Cmd-based key (e.g. `'r'`
→ Cmd-R).

**`icon.png`** — `src/bundle/icon.png` is the app icon (converted to the platform
format at build).

---

## Some details

### Config / env / appDataDir

**`env()`** validates `Bun.env` against a Standard Schema at boot, returning the
typed config. Declare it in `src/server/config.ts` (eager-imported by the framework
— no import needed from your code); a missing/malformed variable fails the boot with
every issue listed.

```ts
// src/server/config.ts
import { env } from '@briancray/belte/server/env'
import { z } from 'zod'
export const config = env(z.object({ DATABASE_URL: z.string(), PORT: z.coerce.number() }))
```

The same schema drives the bundle's first-run setup form. Validation is synchronous
(boot can't await), so coercion lives in the schema.

**`appDataDir()`** returns the bundle's per-user data dir (macOS Application Support,
Windows `%APPDATA%`, XDG elsewhere), keyed by program name — cwd-independent, so a
launched `.app` finds it. This is where a bundle keeps its DB/cache and the user's
saved `.env`.

```ts
import { appDataDir } from '@briancray/belte/server/appDataDir'
const dbPath = `${appDataDir()}/app.db`
```

`BELTE_DATA_DIR` overrides the location on every platform (used as-is). It must come
from a layer above the data-dir `.env` (shell, CWD `.env`, or binary-dir `.env`).

### App hooks

Optional `src/app.ts` exports (all optional, resolved at build time — no import
needed):

| Export | Signature | Runs |
| --- | --- | --- |
| `forwardHeaders` | `string[]` | extra inbound header names forwarded onto in-process rpc Requests (SSR/MCP), on top of belte's built-in cookie/auth/`x-forwarded-*` set |
| `init` | `({ server }) => void \| cleanup \| Promise<…>` | once after `Bun.serve` boots; returned cleanup runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | middleware wrapping the request pipeline |
| `handleError` | `(error, request) => Response` | custom 500 fallback |

```ts
import type { AppModule } from '@briancray/belte/server/AppModule'

// forward the headers your handlers read during SSR / MCP calls
export const forwardHeaders = ['accept-language', 'x-request-id']

export const handle: AppModule['handle'] = async (request, next) => next(request)
```

WebSockets aren't exposed here — the sockets hub (`@briancray/belte/server/socket`)
is the only native WebSocket surface, multiplexed onto one connection per client at
`/__belte/sockets`.

### Project layout

```
src/
  app.ts                       # optional app hooks
  server/
    config.ts                  # env() schema (optional)
    rpc/<name>.ts              # one verb-bound remote function per file
    sockets/<name>.ts          # one broadcast socket per file
    lib/                       # your server-only helpers
  browser/
    app.html  app.css          # shell + global styles
    pages/**/page.svelte       # routed pages (folder path = URL)
    pages/**/layout.svelte     # nearest-only layouts
    pages/**/error.svelte      # nearest-only error pages ({ status, message, stack })
    public/                    # static files served at the site root
    lib/                       # your client-only helpers
  mcp/
    prompts/<name>.md          # MCP prompts (frontmatter + {{placeholders}})
    resources/**               # MCP resources (belte://resources/…)
  cli/
    banner.txt  footer.txt     # CLI session/help chrome
  bundle/
    window.ts                  # window config (optional)
    disconnected.svelte        # custom connect screen (optional)
    icon.png                   # app icon
```

Directory aliases for imports: `$server`, `$browser`, `$shared`, `$mcp`, `$cli`
(e.g. `$server/rpc/getPost.ts`). `lib/` is userland — declare your own aliases there.

### CLI commands

| Command | Does |
| --- | --- |
| `bunx @briancray/belte scaffold <name>` | scaffold a new project |
| `belte dev` | build the client, run the server, and live-reload the browser on any `src/` change |
| `belte build` | build the client into `dist/_app/` |
| `belte start` | run the production server against `dist/` |
| `belte run <file> [args...]` | run a script under the belte preload (same runtime as the server) |
| `belte compile [--target] [--out]` | build a standalone server executable |
| `belte cli [--target] [--out] [--platforms a,b,c]` | build the thin CLI binary (ships the server beside it) |
| `belte bundle` | build a movable, self-contained desktop app (unsigned) |

For tests, add `preload = ["@briancray/belte/preload"]` under `[test]` in
`bunfig.toml`, then use `bun test` — the preload gives test code the same runtime as
the server.

### public/ files

Files under `src/browser/public/` are served at the site root with long-lived cache
headers (e.g. `src/browser/public/robots.txt` → `/robots.txt`). Dotfiles are kept
(`.well-known/…`). The path set is snapshotted at boot. Under `belte dev` the
orchestrator restarts the server on any `src/` change, so a newly added public file
is picked up after the restart; `belte start` and compiled binaries need a manual
restart.

### Bundling

| Target | Command | Output |
| --- | --- | --- |
| Static client | `belte build` | `dist/_app/` for a static deploy |
| Server binary | `belte compile` | one standalone executable (assets/resources embedded) |
| CLI | `belte cli` | thin remote client + sibling server binary |
| Desktop app | `belte bundle` | movable native app for the host platform |

Compiled binaries embed `_app` assets, public files, and MCP resources as zstd
bytes; the same conventions resolve at runtime as in dev.

### Logging and DEBUG

`log` from `@briancray/belte/shared/log` is the shared logger (ANSI colour,
`[belte]` prefix), usable on both sides:

| Method | Use |
| --- | --- |
| `log.info(msg)` / `log.success(msg)` / `log.warn(msg)` | leveled lines |
| `log.error(value)` | prints an Error's full stack |
| `log.detail(msg)` | dimmed secondary line |
| `log.debug(scope, msg)` | gated by `DEBUG` |

`DEBUG` follows the `debug` package convention: `DEBUG=belte`, `DEBUG=belte:*`,
`DEBUG=*`, or a comma-separated list. Request logs are coloured per method and
status. With `DEBUG=belte`, belte also prints the **exposed-surfaces map** at boot
(see the top of this README) — the authoritative answer to which of your functions
are reachable as MCP tools, CLI commands, and OpenAPI operations.
