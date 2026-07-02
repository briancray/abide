# AGENTS.md — abide complete surface map

> The exhaustive index of abide's public surface: every `exports` key appears
> once, grouped by namespace, with its import specifier and a one-line spec.
> This is the whole-API read; the README is the curated 3-primitive intro.
> CONTEXT.md is the glossary, `docs/adr/` the rationale.

**No barrels.** Every public name has its own module path
(`abide/server/GET`, `abide/shared/cache`, `abide/ui/scope`) — there is no
umbrella `index.ts`, so importing one name never drags side-effecting siblings
into the bundle. The namespace marks the side a name runs on: `abide/server/*`
is server-only, `abide/ui/*` is client-only, `abide/shared/*` is isomorphic
(same callable, same behaviour on both sides; the bundler swaps the runtime).

Package: `@abide/abide`, one runtime (Bun `>=1.3.0`), one direct dependency
(TypeScript). The bullets below name each export by its import specifier in the
`abide/…` shorthand — the published package is `@abide/abide`, so
`abide/server/GET` imports from `@abide/abide/server/GET`. These are import
specifiers, not source file paths.

## The premise

One typed RPC declaration fans out to every surface:

```text
                  export const getMessages = GET(fn, { inputSchema })
                                     │
       ┌───────────────┬─────────────┼─────────────┬───────────────┐
       ▼               ▼             ▼             ▼               ▼
   SSR call       browser fetch   MCP tool     CLI command     OpenAPI op
 cache(fn)()     typed proxy    (read-only)   getMessages …  /openapi.json
 (in-process)    (swapped fn())
```

A schema makes the handler safe to advertise off-browser: it turns the CLI on
for any method and auto-exposes read-only methods (`GET`/`HEAD`) as MCP tools.
A mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) never auto-exposes to MCP — it
needs an explicit `clients: { mcp: true }`. Explicit `clients` always wins.

## File-based conventions

The bundler reads meaning from these paths (the project's own `src/`, not the
package):

| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | One RPC; export name = file stem, URL = `/rpc/<path>` |
| `src/server/sockets/<name>.ts` | One socket; export name = file stem, name = path |
| `src/mcp/prompts/<name>.md` | An MCP prompt (front-matter + `{{placeholder}}` body) |
| `src/server/config.ts` | Eager-imported config module (the `env()` call site) |
| `src/app.ts` | Optional `AppModule` hooks (`init`/`handle`/`handleError`/`health`) |
| `src/bundle/window.ts` | Default-exported `BundleWindow` (desktop bundle config) |
| `src/ui/pages/**/page.abide` | A route; its URL is the folder path (`[name]` dynamic) |
| `src/ui/pages/**/layout.abide` | A layout; wraps the chain below via its outlet |
| `src/ui/public/` | Static assets, gzip-embedded and served at root |
| `src/.abide/*.d.ts` | Generated type augmentations (routes, rpc, sockets, health) |
| `dist/_app/` | Client build output |

## CLI

| Command | Does |
| --- | --- |
| `bunx abide scaffold <name>` | Scaffold a project, install, start dev (`--no-install` / `--no-dev` opt out; non-TTY never auto-starts) |
| `abide dev` | Build the client + run the server with hot reload (rebuild/restart on `src/` changes) |
| `abide build` | One client build into `dist/_app/` (no server) |
| `abide start` | Run the production server against a built `dist/` |
| `abide check` | Type-check every `.abide` template + props; non-zero exit on errors |
| `abide run <file> [args]` | Run a script under the abide preload (same runtime as the server) |
| `abide compile [--target] [--out]` | Build a standalone server executable |
| `abide cli [--target] [--out] [--platforms]` | Build the thin CLI binary (ships the server beside it) |
| `abide bundle` | Build a movable, self-contained desktop app bundle (unsigned) |
| `abide lsp` | Run the `.abide` language server over stdio (editor diagnostics) |
| `abide init-agent` | Write/refresh a root `CLAUDE.md` pointer to this surface map |

For `bun test`, add `preload = ["@abide/abide/preload"]` under `[test]` in
`bunfig.toml`.

## Authoring contracts

**RPC** (`src/server/rpc/<name>.ts`) — `export const <name> = METHOD(handler, opts?)`.
The handler receives `InferOutput<inputSchema>` (or the bare arg type when
schemaless), reads `request()` / `cookies()` for request scope, and returns a
`json` / `jsonl` / `sse` / `error` / `redirect` helper Response or a raw
`Response`. `opts`: `inputSchema`, `outputSchema` (OpenAPI 200 + MCP
`outputSchema`), `filesSchema` (multipart File parts; send a `FormData`),
`errors` (declared error constructors handed to the handler), `clients`
(`{ browser, mcp, cli }`), `crossOrigin` (exempt a mutating RPC from the
same-origin CSRF gate), `timeout` (ms handler deadline → 504 every surface),
`maxBodySize` (received-byte ceiling → 413), and — mutating helpers only —
`outbox` (durable replay; `GET(fn, { outbox })` is a compile error). Query args
arrive as strings → use `z.coerce.*`. Consume: `cache(fn)(args)` in-process,
the swapped browser proxy `fn(args)`, `fn.raw(args)` for the `Response`,
`fn.stream(args)` for a frame `Subscribable`.

**Socket** (`src/server/sockets/<name>.ts`) — `export const <name> = socket(opts)`.
`opts`: `schema` (validates publishes, infers `T`, turns mcp/cli on), `tail`
(retained-frame count for replay), `ttl` (lazy eviction ms), `clientPublish`
(allow client `POST` publishes), `clients`. A `Socket<T>` is an
`AsyncIterable<T>` (bare `for await` = live, no replay); `.tail(count?)` opens a
replay-seeded subscription; `.publish(m)` is isomorphic.

**Page / layout** (`src/ui/pages/**`) — a `page.abide`'s URL is its folder path;
`[id]` segments arrive as `page.params.id`. A `layout.abide` wraps the layer
below at its outlet (`{children()}`). Read `page` for route/params/url, call
`url()` / `navigate()` for base-correct links.

**App** (`src/app.ts`) — optional `AppModule`: `init({ server })` (returns an
optional teardown), `handle(request, next)` (single middleware), `handleError`,
`health(request)` (fields merged into `/__abide/health`), `forwardHeaders`.
**Config** (`src/server/config.ts`) — `export const config = env(schema)` at
module top level.

**Isomorphism** — wrap an RPC in `cache(fn)(args)` so an SSR `await` bakes the
value into the initial HTML and the client hydrates warm off the serialized
snapshot; the same call in the browser dedupes and fetches.

## .abide template grammar

A component file is a leading `<script>` (module imports + reactive setup),
markup, and an optional root `<style>`. Ambient names the compiler injects (no
import): `scope`, `props`, `effect`, `snippet`. `html` is imported
(`abide/ui/html`). A *root* `<style>` is component-scoped; a `<script>` or
`<style>` nested inside a control-flow branch is scoped to that branch (a nested
`<script>` declares branch-local `scope().state/linked/computed`, re-seeded per
mount, and may not carry module imports — those hoist to the leading `<script>`).

**Reactive state** — reached only through `scope()`; the documented default is
the destructure-once idiom: `const { state, computed, linked, effect } = scope()`
at the top, then bare calls.

| Form | Meaning |
| --- | --- |
| `let x = state(v, transform?)` | Writable state; assign `x = …` to update |
| `const d = computed(() => …)` | Read-only derived |
| `const l = linked(fn, transform?)` | Writable, re-seeds when `fn`'s deps change |
| `effect(() => { … })` | Reaction re-run on dep change; client-only (SSR strips it) |
| `const { a = d, ...rest } = props()` | Ambient prop reader (defaults + rest) |

Bare `state`/`computed`/`linked`/`effect`/`derived` with no `scope()` destructure
in scope is a compile error. `computed` is always read-only — express a writable
computed at the binding (`bind:value={{ get, set }}`).

**Bindings / directives**

| Syntax | Meaning |
| --- | --- |
| `{expr}` | Escaped text interpolation |
| `{html(...)}` | `html`-branded raw markup, plain call or tagged template (unescaped) |
| `name={expr}` / `name="a {b}"` | Attribute value (plain or interpolated) |
| `on<event>={fn}` | Event listener (`onclick`, `onsubmit`, …) |
| `bind:value` / `bind:checked` / `bind:group` | Two-way form binds |
| `bind:value={{ get, set }}` | Derived two-way binding |
| `class:name={cond}` | Toggle a class |
| `style:property={value}` | Set one style property |
| `attach={fn}` | Run `fn(element)` at mount (returns optional teardown) |
| `{...spread}` | Spread object keys — props on a component, attributes on an element |

**Control flow** — mustache blocks, not `<template>`:

| Block | Form |
| --- | --- |
| If | `{#if c}…{:else if d}…{:else}…{/if}` |
| For | `{#for item, i of list by key}…{/for}` |
| For-await | `{#for await item of source}…{/for}` (over an `AsyncIterable`) |
| Await | `{#await p}…{:then v}…{:catch e}…{:finally}…{/await}` |
| Switch | `{#switch s}{:case x}…{:default}…{/switch}` |
| Try | `{#try}…{:catch e}…{:finally}…{/try}` |
| Snippet | `{#snippet name(args)}…{/snippet}`, called `{name(args)}` |

A capitalised tag is a child component; nested content renders where the child
calls `{children()}` — the single slot, with `{#if children}…{:else}…{/if}` as
the fallback form. No named slots.

> Removed forms throw a migration error: the `<slot>` element (use
> `{children()}`), `<template name>` snippets (use `{#snippet}`), and all
> `<template if>` / `<template each>` / `<template await>` / … control flow (use
> the `{#…}` blocks). A bare `<template>` is now an inert element.

## Server surface — abide/server/*

### RPC — @documentation rpc

- `abide/server/GET` — read RPC helper; `GET(fn, opts?)`, bound by the bundler from `src/server/rpc/`.
- `abide/server/POST` — create/mutate RPC helper; accepts `outbox` for durable replay.
- `abide/server/PUT` — replace RPC helper (mutating).
- `abide/server/PATCH` — partial-update RPC helper (mutating).
- `abide/server/DELETE` — delete RPC helper (mutating).
- `abide/server/HEAD` — read RPC helper, no body (auto-exposes to MCP like GET).

### Sockets — @documentation sockets

- `abide/server/socket` — `socket(opts)` declares a broadcast topic; one export per file under `src/server/sockets/`.

### Response — @documentation response

- `abide/server/json` — JSON `Response` with `Cache-Control: no-store` default; same shape as `Response.json`.
- `abide/server/jsonl` — wraps an `AsyncIterable<Frame>` as a JSON Lines (`application/jsonl`) streaming Response.
- `abide/server/sse` — wraps an `AsyncIterable<Frame>` as Server-Sent Events (`text/event-stream`).
- `abide/server/error` — plain-text error Response; `error(status, message?)`, message defaults to the status reason phrase.
- `abide/server/redirect` — redirect Response; accepts relative URLs, defaults to 302.

### Request scope — @documentation request-scope

- `abide/server/request` — the inbound `Request` for the current SSR/RPC pass (AsyncLocalStorage; throws outside a scope).
- `abide/server/cookies` — the request's cookie jar (Bun `CookieMap`); writes flush as `Set-Cookie` on return.
- `abide/server/server` — the active `Bun.serve` instance (a no-op in-process server under CLI/MCP/test dispatch).

### Configuration — @documentation configuration

- `abide/server/env` — validate `Bun.env` against a Standard Schema at module top level; returns typed config or fails boot loudly.

### Observability — @documentation observability

- `abide/server/reachable` — `await reachable(host)` outbound reachability probe with warm TTL polling (server-only).

### Agent — @documentation agent

- `abide/server/agent` — `agent(engine, messages)` runs a model engine against the app's own MCP surface, returning the engine's `AgentFrame` stream (wrap in `jsonl()`/`sse()`); also exports `NeutralMessage`, `AgentFrame`, `AgentSurface`, `AgentEngine`.

### Server plumbing — @documentation plumbing

- `abide/server/AppModule` — type of the optional `src/app.ts` hooks (`init`/`handle`/`handleError`/`health`/`forwardHeaders`).
- `abide/server/InspectorContext` — type the capabilities core injects into `@abide/inspector` when enabled.
- `abide/server/rpc/defineRpc` — the runtime the RPC helpers compile to (method + URL + handler → `RemoteFunction`); not called directly.
- `abide/server/sockets/defineSocket` — the server-side `socket()` implementation the bundler binds the file name into.
- `abide/server/prompts/definePrompt` — the runtime each `src/mcp/prompts/<file>.md` compiles to (registers an MCP prompt).
- `abide/server/prompts/renderPromptTemplate` — substitutes `{{name}}` placeholders in a markdown prompt body (missing → empty).

## Isomorphic surface — abide/shared/*

### Cache — @documentation cache

- `abide/shared/cache` — `cache(fn, options?)(args)` request/tab-scoped read with coalescing, `ttl`, `swr`, `tags`, `global`; SSR snapshot for warm hydration. Carries `cache.invalidate(selector?, args?)` and `cache.on(source, handler)` (event-driven invalidation).

### Response — @documentation response

- `abide/shared/HttpError` — thrown on a non-2xx remote call; carries the raw `Response` plus `kind`/`data`.
- `abide/shared/ValidationErrorData` — the `data` payload (`kind: 'validation'`, status 422) of a validation failure: raw `issues` + form-friendly `fields`.

### RPC — @documentation rpc

- `abide/shared/withJsonSchema` — attach a `toJSONSchema()` projection to a Standard Schema whose library lacks one (feeds OpenAPI/MCP/CLI).

### Templating — @documentation templating

- `abide/shared/snippet` — brands a payload so a `{expr}` interpolation mounts it (client builder / SSR string); the runtime behind `{#snippet}`. Also `Snippet<Payload>`, `snippetPayload`.

### Probes — @documentation probes

- `abide/shared/pending` — reactive in-flight probe over cache + tail registries; `pending()`, `pending(fn)`, `pending(fn, args)`, `pending({ tags })`.
- `abide/shared/refreshing` — reactive revalidation probe (holding a value while a fresher one loads); same selector grammar as `pending`.
- `abide/shared/online` — reactive network-connectivity probe (`navigator.onLine`, offline-reliable).

### Page — @documentation page

- `abide/shared/page` — reactive page proxy: `route`, `params`, `url` (browser-space), `navigating`; isomorphic.

### URL — @documentation url

- `abide/shared/url` — `url(path, args?)` resolves a base-correct, typed in-app URL (RPC query / page params / asset); also `RpcRoutes`, `PageRoutes`, `PublicAssets`, `PathParams` (augmentable typing seams).

### Observability — @documentation observability

- `abide/shared/health` — typed `health()` probe of `/__abide/health` (fields augmented from the app's `health()` hook); also `AppHealthMap`, `AppHealth`, `HealthState`.
- `abide/shared/log` — unified logger carrying request-scope context; `log`/`.warn`/`.error`/`.trace` on the app channel, `log.channel(name)` for DEBUG-gated channels.
- `abide/shared/trace` — the current request's W3C `traceparent`, or undefined outside a request scope; isomorphic.

### Isomorphic plumbing — @documentation plumbing

- `abide/shared/createSubscriber` — abide-native open-on-first-read / close-on-last-reader subscriber over the signal core (cache/tail substrate).

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `abide/ui/scope` — `scope()` resolves the current lexical scope; the sole reactive entry, carrying `state`/`computed`/`linked`/`effect` + data/context/capability methods (walk to the tree root via the handle's `.root()`).

### Templating — @documentation templating

- `abide/ui/html` — `html(string)` / `` html`…` `` marks trusted raw HTML so a `{expr}` inserts nodes instead of escaped text.

### Tail — @documentation tail

- `abide/ui/tail` — reactive streaming consumer of a `Subscribable<T>` (socket / `fn.stream`); bare = latest frame, `{ last: n }` = window; `tail.error`, `tail.status`. No-op on the server.

### Navigate — @documentation navigate

- `abide/ui/navigate` — `navigate(path, params?, options?)` typed in-app navigation through `url()`; `replace`/`keepScroll`. Also `navigatePath` (already-resolved path) and `NavigateOptions`.

### UI — @documentation ui

- `abide/ui/outbox` — global reactive view of every durable RPC's parked writes; callable for the list, `outbox.retry()` to drain. Also `GlobalOutbox`, `GlobalOutboxEntry`.

### UI plumbing — @documentation plumbing

- `abide/ui/effect` — the from-scratch effect primitive `scope().effect` lowers to (and the SSR strip target).
- `abide/ui/enterScope` — opens an isolated lexical scope for an SSR render; returns the previous one.
- `abide/ui/exitScope` — restores the scope `enterScope` saved (closes an SSR render's scope).
- `abide/ui/remoteProxy` — client-side substitute for a server RPC (typed fetch over HTTP); also `DurableOptions`.
- `abide/ui/socketProxy` — client-side substitute for a server `Socket` (subscribe over the multiplexed ws).
- `abide/ui/router` — the client router: outlet boundaries, chain mounting, history-driven navigation.
- `abide/ui/startClient` — boot entry that consumes the server's `__SSR__` payload and hydrates the page.
- `abide/ui/renderToStream` — out-of-order SSR streaming: shell first, then one resolved fragment per streaming await block.
- `abide/ui/dom/mount` — mount a top-level page/layout into a host under an ownership scope; returns a disposer.
- `abide/ui/dom/mountChild` — mount a child component as a marker-bounded range (no wrapper element).
- `abide/ui/dom/mergeProps` — compose a child's props from ordered explicit/spread/`$children` layers (last wins).
- `abide/ui/dom/spreadProps` — wrap a `{...source}` prop-spread layer as live value thunks.
- `abide/ui/dom/restProps` — the unconsumed props of a `const { a, ...rest } = props()` destructure.
- `abide/ui/dom/spreadAttrs` — spread an object's keys onto a native element (`<div {...rest}>`).
- `abide/ui/dom/readCall` — guarded method call on a reactive-doc read (legible throw naming the authored path).
- `abide/ui/dom/hydrate` — adopt server-rendered DOM in place instead of rebuilding; returns a disposer.
- `abide/ui/dom/text` — a text node tracking a `read()` (plain-text fast path).
- `abide/ui/dom/appendText` — a reactive `{expr}` interpolation (escaped text / `{snippet}` / `html` raw).
- `abide/ui/dom/appendTextAt` — `appendText` mounted at a skeleton anchor comment (text interleaved with elements).
- `abide/ui/dom/appendSnippet` — mount a `{snippet(args)}` builder's nodes in a marker range, reactive in its args.
- `abide/ui/dom/appendStatic` — a static (non-reactive) text node, claimed on hydrate.
- `abide/ui/dom/cloneStatic` — append a fully-static subtree, byte-identical to the SSR markup.
- `abide/ui/dom/skeleton` — clone a bound element's static skeleton with located holes/anchors.
- `abide/ui/dom/anchorCursor` — position a skeleton-anchored control-flow block or slot.
- `abide/ui/dom/mountSlot` — mount a component's `{children()}` content (or fallback) as a marker range.
- `abide/ui/dom/outlet` — a layout's outlet boundary the router fills with the next chain layer.
- `abide/ui/dom/attr` — bind one element attribute to a `read()` (present/absent boolean semantics).
- `abide/ui/dom/on` — attach an event listener, owned by the current scope (the `onclick={…}` target).
- `abide/ui/dom/attach` — run an `attach={fn}` against an element at build, owning its teardown.
- `abide/ui/dom/each` — keyed list runtime (`{#for … by key}`); each row a marker-bounded range.
- `abide/ui/dom/eachAsync` — async keyed list runtime (`{#for await … }`) over an `AsyncIterable`.
- `abide/ui/dom/when` — conditional runtime (`{#if}` + optional `{:else}`).
- `abide/ui/dom/awaitBlock` — async runtime (`{#await}` → pending / then / catch ranges).
- `abide/ui/dom/tryBlock` — synchronous error-boundary runtime (`{#try}`).
- `abide/ui/dom/switchBlock` — multi-branch runtime (`{#switch}`, strict `===`, default fallback).
- `abide/ui/dom/applyResolved` — bundle-side consumer of an SSR stream chunk (streaming nav / socket SSR).
- `abide/ui/runtime/escapeKey` — escape one object key into a JSON-Pointer reference token (RFC 6901).
- `abide/ui/runtime/nextBlockId` — the next block id in the current render pass (await/try, document order).
- `abide/ui/runtime/enterRenderPass` — mark entry into a render/mount (resets the block-id counter at depth 0).
- `abide/ui/runtime/exitRenderPass` — mark exit from a render/mount, unwinding the depth.

## Build / tooling

### Building — @documentation building

- `abide/build` — build the client bundle into `dist/_app` (the `.abide` loader, virtual resolver, optional Tailwind, optional gzip).
- `abide/compile` — produce a standalone Bun server executable (runs `build` first, embeds compressed assets).

### Build plumbing — @documentation plumbing

- `abide/preload` — the Bun preload that installs the `.abide` loader + resolver for the server/scripts/tests.
- `abide/resolver-plugin` — resolves `$`-aliased / extensionless / directory imports Node-style; also the build's virtual-module loaders.
- `abide/ui-plugin` — the Bun plugin that compiles `.abide` single-file components into ES modules.
- `abide/tsconfig` — the shippable base `tsconfig.app.json` projects extend.

## Desktop bundle

### Bundle — @documentation bundle

- `abide/server/appDataDir` — the running bundle's per-user data dir (keyed by program name; cwd-independent; server-side).
- `abide/bundle/BundleWindow` — type of the default-exported `src/bundle/window.ts` window config (title/size/menus).
- `abide/bundle/BundleMenu` — a top-level macOS menu (`label` + `items`).
- `abide/bundle/BundleMenuItem` — a single menu entry (divider or a click that dispatches an `abide:menu` event).
- `abide/bundle/onMenu` — subscribe to bundle menu clicks (catch-all or filtered); returns an unsubscribe.
- `abide/bundle/bundled` — true when running inside the desktop bundle rather than a plain browser (isomorphic).

## MCP

### MCP — @documentation mcp

- `abide/mcp/createMcpServer` — construct the MCP server bound to the RPC registry (tools from `clients.mcp` RPCs + prompts + resources); `handle(request)` backs `/__abide/mcp`. Framework-internal.

## Testing

### Testing — @documentation testing

- `abide/test/createTestApp` — boot an in-process app for tests: typed `app.rpc.<rpc>` / `app.sockets.<name>` off the project's real surface. Also `TestApp`, `RpcClient`, `SocketClient`.

### Testing plumbing — @documentation plumbing

- `abide/test/createScriptedSurface` — a scripted MCP surface for driving an `AgentEngine` in tests.
- `abide/test/assertAgentFrameConformance` — assert an engine's frame stream satisfies the neutral `AgentFrame` contract.

## Generated machine surfaces

Runtime routes the framework serves (the internal `/__abide/config|dev|reload|…`
routes are deliberate plumbing and not listed):

| Route | Serves |
| --- | --- |
| `/openapi.json` | OpenAPI 3 document, generated from every schema-bearing RPC |
| `/__abide/mcp` | MCP endpoint (streamable HTTP): tools, prompts, resources |
| `/__abide/health` | Health JSON (the app's `health()` hook merged in) |
| `/__abide/sockets` | Multiplexed WebSocket hub; HTTP face `/__abide/sockets/<name>` (GET tail, POST publish) |
| `/__abide/cli` | CLI binary download (per-platform thin client + server) |
| `/__abide/hot` | Dev hot-update stream the browser bridge consumes for HMR |
| `/__abide/identity` | App identity (name/version) for CLI/bundle connect handshakes |
| `/__abide/inspector` | Opt-in inspector UI (gated by `ABIDE_ENABLE_INSPECTOR`) |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | Server listen port |
| `APP_URL` | Public origin; its pathname becomes the mount base (e.g. `/v2`) for `url()`/routing |
| `ABIDE_APP_URL` | Default remote server URL the CLI/bundle connects to |
| `ABIDE_APP_TOKEN` | Bearer token the CLI/bundle sends to a remote abide server |
| `ABIDE_CLIENT_TIMEOUT` | ms ceiling on a browser/CLI remote RPC call (1–600000) |
| `ABIDE_IDLE_TIMEOUT` | Bun per-connection idle timeout, seconds (default 10) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide max request body bytes |
| `ABIDE_REACHABLE_TIMEOUT` | ms per `reachable()` probe (default 3000, 100–60000) |
| `ABIDE_REACHABLE_TTL` | ms `reachable()` freshness / poll cadence (default 30000, 1000–600000) |
| `ABIDE_DATA_DIR` | Override the per-user app data dir on every platform |
| `ABIDE_LOG_FORMAT` | `json` emits structured log records instead of human lines |
| `ABIDE_ENABLE_INSPECTOR` | `true` mounts the inspector (requires `@abide/inspector`) |
| `ABIDE_INSPECT` | Non-empty enables the desktop webview devtools |
| `DEBUG` | Enable diagnostic channels (`abide:cache`, `abide:rpc`, …); `-abide` silences all |

---

Mirrors the `exports` map in `package.json`; run
`bun run packages/abide/scripts/readmeSurfaces.ts` after adding or renaming an
export to catch any untagged export and re-derive the slug grouping.
