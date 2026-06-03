# Belte

Isomorphic multimodal http framework built for humans and machines in a single Bun runtime.

Belte builds one app and exposes it to every consumer that matters, from one Bun runtime:

- **Humans** reach it as a web app (Svelte SSR + SPA), a `cli`, or a native desktop `bundle`.
- **Machines** reach it as an `mcp` server or the same `cli`.
- The `cli` serves both — humans run it interactively, machines script it.

You write a remote function once. Belte makes it an HTTP endpoint, an MCP tool, a CLI command, and a typed client call — same name, same behaviour, both sides of the wire.

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

## What is an isomorphic multimodal framework

- **One runtime.** Server render, RPC handlers, sockets, MCP, and the build pipeline all run under a single Bun process — no separate API server, no second toolchain.
- **Declare once, consume anywhere.** A remote function is written one time; the bundler swaps its implementation by build target (real handler on the server, fetch proxy in the browser) and the same declaration is surfaced to MCP and the CLI for free.

Declare a remote function in `src/server/rpc/getPost.ts` — one export per file, named after the file:

```ts
import { GET } from 'belte/server/GET'
import { json } from 'belte/server/json'

export const getPost = GET<{ id: string }>(async ({ id }) => json(await db.post(id)))
```

Consume the same `getPost` on every surface:

| Surface | How |
| --- | --- |
| Browser / HTTP | `await getPost({ id: '1' })` — or `GET /rpc/getPost?id=1` |
| MCP | tool `getPost`, arguments `{ id }` |
| CLI | `my-app getPost --id 1` |

---

## Server

### RPC

One file under `src/server/rpc/` is one endpoint at `/rpc/<file path>`. Each file has exactly one export whose name matches the file stem. Path segments are flat — pass identifiers through args, not the URL.

#### Declaring

Import the verb that matches the HTTP method: `belte/server/GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`.

```ts
type Verb = <Return, InputSchema extends StandardSchema>(
  handler: (args: InferOutput<InputSchema>) => Response | Promise<Response>,
  opts?: VerbOptions<InputSchema>,
) => RemoteFunction<Args, Return>
```

| Option | Type | Purpose |
| --- | --- | --- |
| `inputSchema` | Standard Schema | Validates and types `args`; feeds OpenAPI params, MCP `inputSchema`, CLI flags |
| `outputSchema` | Standard Schema | Types the success body; feeds OpenAPI 200 + MCP `outputSchema` |
| `inputJsonSchema` | JSON Schema | Precomputed input schema override |
| `outputJsonSchema` | JSON Schema | Precomputed output schema override |
| `clients` | `{ browser?, mcp?, cli? }` | Which surfaces expose this verb (defaults to all) |

```ts
import { POST } from 'belte/server/POST'
import { json } from 'belte/server/json'

export const createPost = POST<Post, typeof PostInput>(async (input) => json(await db.create(input)), {
  inputSchema: PostInput,
})
```

`args` types from the handler (or `inputSchema`); `Return` infers from the response helper.

#### Response helpers

| Helper | Import | Content-Type | Notes |
| --- | --- | --- | --- |
| `json(data, init?)` | `belte/server/json` | `application/json` | `Cache-Control: no-store` default |
| `jsonl(iterable, init?)` | `belte/server/jsonl` | `application/jsonl` | One JSON value per line; errors emit a final `{"$error"}` frame |
| `sse(iterable, init?)` | `belte/server/sse` | `text/event-stream` | `data:` frames; 15s keepalive comment |
| `redirect(url, status?, init?)` | `belte/server/redirect` | — | Accepts relative URLs; default `302` |
| `error(status, message?, init?)` | `belte/server/error` | `text/plain` | `message` defaults to the status reason phrase |

```ts
if (!post) return error(404, 'post not found')
return redirect('/login')
```

#### Request context

| Function | Import | Returns |
| --- | --- | --- |
| `request()` | `belte/server/request` | The inbound `Request` for the current SSR/RPC pass |
| `server()` | `belte/server/server` | The active `Bun.serve` instance |

Both throw if called outside their scope (`request()` outside a request, `server()` before boot).

#### Consuming

Call the imported function. Args go in the query string for `GET` / `DELETE` / `HEAD`, in a JSON body for `POST` / `PUT` / `PATCH`. The plain call decodes the body by Content-Type and throws `HttpError` on a non-2xx response.

```ts
const post = await getPost({ id: '1' }) // decoded body, throws HttpError on failure
```

| Form | Returns | Use |
| --- | --- | --- |
| `fn(args)` | `Promise<Return>` | Decoded body; throws `HttpError` on non-2xx |
| `fn.raw(args)` | `Promise<Response>` | Untouched `Response` — no decode, no throw |
| `fn.stream(args?)` | `Subscribable<Return>` | Frame-by-frame view of an `sse`/`jsonl` body (or the decoded body once) |

```ts
const res = await getPost.raw({ id: '1' }) // inspect status/headers yourself
for await (const frame of getPost.stream({ id: '1' })) render(frame)
```

`HttpError` (from `belte/browser/HttpError`) carries `status`, `statusText`, and the raw `response` for building error UI without opting into `.raw`.

**`GET /openapi.json`** serves an OpenAPI 3.1 document describing the `/rpc/*` surface (alongside `/swagger.json`).

### Sockets

One file under `src/server/sockets/` is one named broadcast topic. The same import resolves to a server-side fan-out and a client-side WebSocket proxy by build target, multiplexed onto one connection at `/__belte/sockets`.

#### Declaring

```ts
type socket = <T>(opts?: SocketOptions) => Socket<T>
```

| Option | Type | Purpose |
| --- | --- | --- |
| `history` | `number` | Frames buffered and replayed to new subscribers |
| `ttl` | `number` | Drop history entries older than `ttl` ms before replay |
| `clientPublish` | `boolean` | Allow `pub` frames from clients (off by default) |
| `schema` | Standard Schema | Validates publish payloads; types `T`; advertises payload to MCP/CLI |
| `clients` | `{ browser?, mcp?, cli? }` | Surfaces that advertise the socket (browser-only unless a schema is set) |

```ts
import { socket } from 'belte/server/socket'

export const chat = socket<ChatMessage>({ history: 50 })
```

#### Publishing

```ts
publish(message: T): void
```

`publish` is isomorphic: server code fans out in-process to remote subscribers; client code sends a `pub` frame (gated by `clientPublish`).

```ts
chat.publish({ user: 'ada', text: 'hello' })
```

#### Consuming

A `Socket<T>` is an `AsyncIterable<T>` — iterate it directly, with history replay if declared.

```ts
for await (const message of chat) render(message)
```

| Form | Replays |
| --- | --- |
| `for await (… of chat)` | Full declared `history` |
| `chat.tail(count?)` | Last `count` frames (default `0`), then live |

In Svelte, pass it to `subscribe()` for reactive reads (see Browser).

---

## Clients

### Browser

Pages live under `src/browser/pages/`. A `page.svelte` mounts at its folder path; a `layout.svelte` wraps that subtree; `[param]` / `[...rest]` segments become route params. Pages are Svelte 5 components rendered on the server and hydrated on the client.

```svelte
<!-- src/browser/pages/blog/[slug]/page.svelte -->
<script lang="ts">
  import { page } from 'belte/browser/page'
  import { cache } from 'belte/browser/cache'
  import { getPost } from '$server/rpc/getPost.ts'

  const post = $derived(cache(getPost)({ id: page.params.slug }))
</script>

{#await post then loaded}
  <h1>{loaded.title}</h1>
{/await}
```

#### cache

```ts
function cache<Args, Return>(
  fn: RemoteFunction<Args, Return>,
  options?: CacheOptions,
): (args?: Args) => Promise<Return>
```

| Option | Type | Purpose |
| --- | --- | --- |
| `key` | `string \| unknown[] \| object` | Override the auto-derived cache key |
| `ttl` | `number` | ms past resolve to keep the entry; omitted = forever, `0` = dedupe in-flight only |
| `scope` | `string \| string[]` | Tag entries so one `invalidate({ scope })` drops the group |

Reads register the surrounding `$derived`/`$effect`, so invalidating re-runs it. SSR-warm keys resolve synchronously (consume via `await`/`{#await}`, never `.then`).

| Invalidation | Drops |
| --- | --- |
| `cache.invalidate()` | Everything |
| `cache.invalidate(fn)` | All calls of one function |
| `cache.invalidate({ key })` / `{ scope }` | One entry / a tagged group |

#### subscribe

```ts
function subscribe<T>(source: Subscribable<T>): T | undefined
subscribe.error(source): Error | undefined
subscribe.status(source): 'pending' | 'open' | 'done' | 'error'
```

Reactive reader for a `Socket<T>` or an `fn.stream(args)`. The first `$derived` read opens the stream; the last to stop closes it; reads sharing a key share one subscription. A no-op during SSR.

```svelte
<script lang="ts">
  import { subscribe } from 'belte/browser/subscribe'
  import { chat } from '$server/sockets/chat.ts'

  const latest = $derived(subscribe(chat))
</script>
```

#### navigate

```ts
function navigate(href: string, options?: { replace?: boolean; scroll?: boolean }): Promise<void>
```

SPA navigation from `belte/browser/navigate`. Same-pathname `search`/`hash` changes skip the network round-trip; cross-origin or a failed resolve falls back to a hard navigation.

#### Page state

`import { page } from 'belte/browser/page'` exposes reactive `$state`:

| Field | Type | Notes |
| --- | --- | --- |
| `page.route` | route key | Discriminates `params` |
| `page.params` | route params | Shape inferred per route |
| `page.url` | `URL` | Live location; reassigned on every nav |

### MCP

The MCP server is generated automatically and served at **`POST /__belte/mcp`**. No extra wiring.

| Source | Becomes |
| --- | --- |
| `src/server/rpc/<name>.ts` | MCP tool `<name>` (input/output from its schema) |
| `src/server/sockets/<name>.ts` | MCP-advertised socket (when `clients.mcp` / schema allow) |
| `src/mcp/resources/**` | Resources at `belte://resources/<path>` |
| `src/mcp/prompts/<name>.md` | Prompt `<name>` |

**Resources** — drop any file under `src/mcp/resources/`. Text MIME types are returned inline; everything else as base64.

**Prompts** — a markdown file with optional frontmatter; the body interpolates `{{name}}` placeholders at render time.

```md
---
description: Summarize an order for support
arguments:
  - name: id
    required: true
---
Summarize order {{id}} for the support team.
```

### CLI

The CLI binary is generated automatically by `belte cli` — a thin remote client with the per-RPC manifest baked in, shipped beside the compiled server so it can also run a local instance.

| Source | Becomes |
| --- | --- |
| `src/server/rpc/<name>.ts` | command `<name>`, flags derived from its input schema |

**Flags** derive from each command's JSON Schema:

| Schema type | Flag form |
| --- | --- |
| `boolean` | `--name` / `--no-name` |
| `number` / `integer` | `--name <n>` |
| `array` | repeat `--name <v>` |
| other | `--name <value>` |
| any shape | `--json '<object>'`, or pipe a JSON object on stdin |

**Connection** — one rule: `/` manages the connection, a bare word runs a command. The connection verbs are `/`-prefixed only, so a bare word is always a command.

| Command | Does |
| --- | --- |
| `my-app /connect <url>` | Connect to a remote server, open a session |
| `my-app /start` | Start a local instance, open a session |
| `my-app /disconnect` | Forget the saved connection |
| `my-app` | Resume the saved connection in a session |
| `my-app <command> [--flags]` | One-shot dispatch (scripting) |

Inside a session the banner prints once, then a prompt: bare words run commands, while `/connect`, `/start`, `/disconnect`, `/help`, and `/exit` manage it. `src/cli/banner.txt` and `src/cli/footer.txt` wrap the help and session output.

| Env | Purpose |
| --- | --- |
| `APP_URL` | Default server URL (baked at install; shell-overridable) |
| `APP_TOKEN` | Sent as `Authorization: Bearer <value>` |

**Downloading** — a running server offers a one-line installer that fetches the right platform binary plus a baked `.env`:

```sh
curl -fsSL https://my-app.example.com/__belte/cli | sh
```

An **authenticated download** bakes the caller's bearer token into the binary's `.env`:

```sh
curl -fsSL -H "Authorization: Bearer $TOKEN" \
  https://my-app.example.com/__belte/cli/linux-x64 | tar -xz
```

### Bundle

`belte bundle` produces a movable, self-contained native desktop app for the host platform (a `.app` on macOS, a flat directory elsewhere). It ships the launcher, the compiled server, and a webview. It boots into a connect screen where the user **starts the embedded server** or **connects to a remote one**.

**Window** — optional `src/bundle/window.ts`, default-exported:

```ts
import type { BundleWindow } from 'belte/bundle/BundleWindow'

export default {
  title: 'My App',
  width: 1100,
  height: 800,
  menu: [{ label: 'View', items: [{ label: 'Reload', shortcut: 'cmd+r', emit: 'reload' }] }],
} satisfies BundleWindow
```

| Field | Type | Purpose |
| --- | --- | --- |
| `title` | `string` | Window title (defaults to the program name) |
| `width` / `height` | `number` | Initial size |
| `menu` | `BundleMenu[]` | Custom top-level menus; items `emit` a name |
| `config` | Standard Schema | First-run config form; answers persist to the data-dir `.env` |

**`src/bundle/disconnected.svelte`** overrides the default connect screen. **`src/bundle/icon.png`** supplies the app icon (converted to `.icns` on macOS).

**onMenu** — handle custom menu emits from a page:

```ts
type onMenu = {
  (handler: (name: string) => void): () => void
  (name: string, handler: () => void): () => void
}
```

```svelte
<script lang="ts">
  import { onMenu } from 'belte/bundle/onMenu'
  $effect(() => onMenu('reload', () => location.reload()))
</script>
```

---

## Some details

### App hooks

Optional `src/app.ts` exports, all optional:

| Hook | Signature | Runs |
| --- | --- | --- |
| `init` | `({ server }) => void \| (() => void)` | Once at boot; the returned function runs on SIGINT/SIGTERM |
| `handle` | `(request, next) => Response` | Single middleware around every request |
| `handleError` | `(error, request) => Response` | Fallback for thrown errors |

```ts
// src/app.ts
export async function handle(request: Request, next: (req: Request) => Promise<Response>) {
  if (new URL(request.url).pathname.startsWith('/admin') && !authed(request)) {
    return new Response('forbidden', { status: 403 })
  }
  return next(request)
}
```

### Project layout

```
src/
  app.ts                          # init / handle / handleError (optional)
  server/
    rpc/<name>.ts                 # one verb export → /rpc/<name>
    sockets/<name>.ts             # one socket export
  browser/
    app.html                      # SSR shell (optional; default provided)
    app.css                       # global stylesheet
    pages/**/page.svelte          # route at the folder path
    pages/**/layout.svelte        # layout for that subtree
    pages/blog/[slug]/page.svelte # dynamic segment → page.params
    public/**                     # static files served at /
  mcp/
    prompts/<name>.md             # MCP prompt
    resources/**                  # MCP resources (belte://resources/<path>)
  cli/
    banner.txt  footer.txt        # CLI help/session chrome
  bundle/
    window.ts                     # BundleWindow (optional)
    disconnected.svelte           # custom connect screen (optional)
    icon.png                      # app icon (optional)
  shared/                         # cross-side code
```

`tsconfig.json` extends `belte/tsconfig` and maps a path alias per `src/` folder — `$server`, `$browser`, `$shared`, `$mcp`, `$cli`. A page imports a remote function as `import { getPost } from '$server/rpc/getPost.ts'`. Each surface can keep a `lib/` folder beside it for helpers that aren't endpoints — only the convention files above are scanned as routes/commands/tools.

### CLI commands

| Command | Does |
| --- | --- |
| `bunx @briancray/belte scaffold <name>` | Scaffold a new project |
| `belte dev` | Build the client and run the server with hot reload |
| `belte build` | Build the client into `dist/_app` |
| `belte start` | Run the production server against `dist/` |
| `belte compile [--target=<bun-…>] [--out=<path>]` | Standalone server binary |
| `belte cli [--target] [--out] [--platforms=<a,b,c>]` | CLI binary (ships the server beside it) |
| `belte bundle` | Native desktop app bundle for this platform |

### Public files

Anything under `src/browser/public/` is served from the site root (`src/browser/public/logo.svg` → `/logo.svg`).

### Bundling

`belte bundle` runs `belte compile` for the server, builds the launcher and connect screen, and assembles them with the webview into one movable app. The bundle is unsigned — distribution to other users still needs platform signing/notarization. Per-user config, the saved connection, and any data live in the platform data dir (macOS `Application Support`, Windows `%APPDATA%`, XDG elsewhere), not inside the bundle.

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server bind port | Scans upward from `3000` |
| `BELTE_IDLE_TIMEOUT` | Per-connection idle timeout (seconds) | `10` |
| `APP_URL` | CLI target / baked default server URL | — |
| `APP_TOKEN` | CLI bearer token | — |
| `DEBUG` | Enable debug scopes (e.g. `belte`, `belte:*`, `*`) | off |
| `BELTE_INSTALL_DIR` | Where the CLI installer drops the binary | `~/.local/bin` |

### Logging and DEBUG

`belte/shared/log` is the shared logger: `info`, `warn`, `error`, `success`, `detail`, `request`, and `debug(scope, message)`. It prefixes `[belte]`, colours by method/status, and prints stack traces for `Error` values.

`debug` lines print only when `DEBUG` enables their scope, matching the `debug` npm conventions:

| `DEBUG` | Enables |
| --- | --- |
| `belte` | exactly `belte` |
| `belte:*` | `belte` and `belte:anything` |
| `a,belte` | comma-separated list |
| `*` | everything |
