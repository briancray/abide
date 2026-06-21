# AGENTS.md — abide complete surface map

> The exhaustive index of abide's public surface: every `exports` key appears once,
> grouped by namespace, with its import specifier and a one-line spec — so an agent
> grasps the whole API in one read and knows which file to open for depth. The README
> is the curated 3-primitive intro; this is the complete map.
>
> No barrels: every public name has its own module path, and the namespace marks the
> side it runs on — `abide/server/*` is server-only, `abide/ui/*` is client-only,
> `abide/shared/*` is isomorphic (same callable, same behaviour on both sides; the
> bundler swaps the runtime). Importing one name never drags in a side-effecting sibling.
>
> Package `@abide/abide`, runtime Bun `>= 1.3.0`, one dependency (`typescript`); the
> import specifier (`abide/server/GET`) is the `@abide/abide/...` `exports` key, not the
> on-disk file path.

## The premise

```text
                  getMessages   (one declaration)
                        │
   ┌──────────┬─────────┼─────────┬──────────────┐
   ▼          ▼         ▼         ▼              ▼
 SSR call   browser   MCP tool   CLI sub-     OpenAPI
cache(fn)()  fetch   (read-only) command      operation
```

A verb's `inputSchema` (any Standard Schema) unlocks the CLI and projects the OpenAPI op; a read-only `GET`/`HEAD` also auto-exposes an MCP tool. A mutating verb never auto-exposes to an agent — it opts in with `clients: { mcp: true }`. The same gating applies to sockets via their schema.

## File-based conventions

The bundler reads these paths; their location is their identity (no manifest to register).

| Path                           | Meaning                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `src/server/rpc/<name>.ts`     | One verb export per file; export name is the URL stem (`/rpc/<name>`)     |
| `src/server/sockets/<name>.ts` | One `socket()` export per file; topic `<name>`, ws at `/__abide/sockets`  |
| `src/mcp/prompts/<name>.md`    | MCP prompt: frontmatter (description + args) + `{{placeholder}}` body     |
| `src/mcp/resources/<name>`     | MCP resource files; embedded in the standalone binary                     |
| `src/server/config.ts`         | Optional `env(schema)` validation, eager-imported at boot                 |
| `src/app.ts`                   | Optional `AppModule` hooks (`init`/`handle`/`handleError`/`health`)       |
| `src/bundle/window.ts`         | Optional desktop `BundleWindow` default export                            |
| `src/ui/pages/**/page.abide`   | A route; URL is the folder path                                           |
| `src/ui/pages/**/layout.abide` | Wraps every page at/below its folder; nested chains apply outermost-first |
| `src/ui/app.html`              | Optional custom shell; entry refs rewritten to hashed names               |
| `src/ui/public/`               | Static assets served at site root; embedded when compiled                 |
| `src/.abide/*.d.ts`            | Framework codegen (`routes`/`rpc`/`sockets`/`publicAssets` types)         |
| `dist/_app/`                   | Client bundle output: hashed chunks + CSS, optional `.gz` siblings        |

## CLI

| Command                                      | Does                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `abide scaffold <name>`                      | Scaffold a project, install deps, and (in a TTY) start dev; `--no-install` / `--no-dev` opt out |
| `abide dev`                                  | Build the client + run the server with hot reload, watching `src/`                              |
| `abide build`                                | One-shot client build into `dist/_app/` (no server)                                             |
| `abide start`                                | Run the production server against a built `dist/`                                               |
| `abide run <file> [args]`                    | Run a script under the abide preload (`.abide` compile, `$server` resolution)                   |
| `abide compile [--target] [--out]`           | Build a standalone server executable (bytecode, embedded assets)                                |
| `abide cli [--target] [--out] [--platforms]` | Build the thin remote-client+server CLI binary, optionally cross-compiled                       |
| `abide bundle`                               | Build a self-contained desktop app bundle for this platform                                     |
| `abide check`                                | Type-check all `.abide` templates and props; non-zero on errors                                 |
| `abide lsp`                                  | Run the `.abide` language server over stdio                                                     |
| `abide init-agent`                           | Write/refresh a `CLAUDE.md` pointer to this surface map                                         |

Test suites compile `.abide` and rewrite verbs under `bun test` via `preload = ["@abide/abide/preload"]` in `bunfig.toml`'s `[test]` block.

## Server surface — `abide/server/*`

### RPC verbs — @documentation rpc

- `abide/server/GET`, `abide/server/POST`, `abide/server/PUT`, `abide/server/PATCH`, `abide/server/DELETE`, `abide/server/HEAD` — declare a verb: `VERB(handler, opts?)`; the preload rewrites each to `defineVerb(method, url, …)` (server) or `remoteProxy` (client). `opts`: `inputSchema`, `outputSchema`, `filesSchema`, `clients`, `crossOrigin`, `maxBodySize`, `timeout`. The returned function is callable in-process and exposes `.raw(args)` (the `Response`), `.stream(args)` (frame iterable), and `.fetch(request)` (router entry).
- `abide/server/rpc/defineVerb` — the rewrite target the verb helpers expand to: validates args against `inputSchema` (422 on issues), enforces `timeout` (504 + abort), and registers the verb for MCP/CLI/OpenAPI/inspector discovery.

### Responses — @documentation response

- `abide/server/json` — `json(data, init?)`: `application/json`, `no-store`; `undefined` → `204` so `T | undefined` round-trips.
- `abide/server/jsonl` — `jsonl(asyncIterable, init?)`: newline-delimited JSON frames; errors emit a final `{"$error":…}` line.
- `abide/server/sse` — `sse(asyncIterable, init?)`: `text/event-stream` with 15s keepalives; errors emit an `event: error` frame.
- `abide/server/error` — `error(status, message?, init?)`: `text/plain` error `Response` typed `never` so error branches don't widen the inferred return.
- `abide/server/redirect` — `redirect(url, status=302, init?)`: redirect `Response` (accepts relative URLs), typed `never`.
- `abide/shared/HttpError` — `new HttpError(response)`: carries `status`/`statusText`/`response`; thrown by a proxy call on a non-2xx.

### Request scope — @documentation request-scope

- `abide/server/request` — `request()`: the inbound `Request` for the current SSR/RPC pass (`AsyncLocalStorage`); throws outside a request scope.
- `abide/server/cookies` — `cookies()`: live `Bun.CookieMap` with `.set`/`.delete` writing `Set-Cookie`.
- `abide/server/server` — `server()`: the active `Bun.serve` instance (an in-process stand-in under CLI/MCP/test dispatch).

### Configuration — @documentation configuration

- `abide/server/env` — `env(schema)`: validate `Bun.env` against a Standard Schema at module top level (boot fails loudly); also feeds the bundle setup form.

### Sockets — @documentation sockets

- `abide/server/socket` — `socket({ schema?, tail?, ttl?, clientPublish?, clients? })`: declare a broadcast topic. Returns a `Socket<T>` (isomorphic `AsyncIterable<T>`) with `.publish(msg)` and `.tail(count?, hooks?)`. `tail` retains frames for late joiners, `ttl` lazily evicts old ones, `clientPublish` (default `false`) gates the HTTP/ws publish, `schema` validates publishes and flips on the MCP/CLI read faces.
- `abide/server/sockets/defineSocket` — the server-side construction the preload rewrites `socket()` to; owns the retained buffer, fan-out via `server.publish`, and per-subscriber queues.

### App, agent, inspector — @documentation plumbing

- `abide/server/AppModule` — the type of `src/app.ts`'s optional hooks: `init` (boot + cleanup), `handle` (middleware), `handleError`, `health` (merges into `/__abide/health`), `forwardHeaders`.
- `abide/server/agent` — `agent(engine, messages)`: run a model engine against the current request's MCP surface (caller auth forwarded into every tool call), yielding neutral `AgentFrame`s to wrap in `jsonl`/`sse`.
- `abide/server/InspectorContext` — the capability bundle (`app`, `loadSurface`, `cacheSnapshot`, `onRecord`) handed to `@abide/inspector` when `ABIDE_ENABLE_INSPECTOR=true`.

### Prompts — @documentation plumbing

- `abide/server/prompts/definePrompt` — `definePrompt(name, { description?, jsonSchema?, render })`: the target the resolver compiles `src/mcp/prompts/<name>.md` to; registers an MCP prompt.
- `abide/server/prompts/renderPromptTemplate` — `renderPromptTemplate(template, args)`: substitute `{{name}}` placeholders (missing → empty string).

## Isomorphic surface — `abide/shared/*`

### Cache — @documentation cache

- `abide/shared/cache` — `cache(fn)`: a memoizing invoker. `cache(fn)(args)` reads (SSR-snapshotted, hydrated warm); `.raw`/`.stream` mirror the verb; `.invalidate(selector?, args?)` drops entries; `.patch(selector, updater, …)` optimistic-updates; `.on(subscribable, handler)` folds socket frames into cached values.

### Probes — @documentation probes

- `abide/shared/pending` — `pending(fn?, args?)`: `true` while a matching call is unsettled (read-only probe).
- `abide/shared/refreshing` — `refreshing(fn?, args?)`: `true` while a matching entry holds a value but a fresher fetch is in flight.
- `abide/shared/online` — `online()`: `navigator.onLine` (client) / offline-header (SSR); reactive.

### Templating — @documentation templating

- `abide/shared/html` — `html\`…\``(or`html(str)`): mark a string as trusted raw HTML so interpolation injects rather than escapes.
- `abide/shared/snippet` — `snippet(payload)`: brand a payload so an interpolation mounts it instead of escaping (the runtime side of `<template name>`).
- `abide/shared/withJsonSchema` — `withJsonSchema(schema, toJsonSchema)`: attach a JSON Schema to a Standard Schema for OpenAPI/MCP/CLI/form projection.

### Page & URL — @documentation page · url

- `abide/shared/page` — `page`: a reactive proxy of `route`/`params`/`url`/`navigating` (server reads request scope, client reads the router).
- `abide/shared/url` — `url(path, ...args)`: typed, base-correct URL builder for RPC paths, page routes, and assets.

### Observability — @documentation observability

- `abide/shared/health` — `health()`: reactive `{ reachable, … }` polled from `/__abide/health`, composing app `health()` fields and `navigator.onLine`.
- `abide/shared/log` — `log`/`.warn`/`.error`/`.trace(label, fn)` on the always-on channel; `log.channel(name)` is `DEBUG`-gated; TSV by default, JSON under `ABIDE_LOG_FORMAT=json`.
- `abide/shared/trace` — `trace()`: the W3C `traceparent` for the current request, or `undefined` outside scope.
- `abide/shared/createSubscriber` — `createSubscriber(start)`: open-on-first-read / close-on-last-reader resource lifecycle for reactive sources.
- `abide/server/reachable` — `reachable(host)` (server-only): cached liveness probe; HEADs the origin and background-polls per `ABIDE_REACHABLE_TTL`, so reads resolve instantly off the warm value.

## UI surface — `abide/ui/*` (client-only)

### Reactive state — @documentation reactive-state

- `abide/ui/scope` — `scope()`: the sole reactive surface. `.state(initial?, transform?)` (writable cell), `.computed(fn)` (read-only), `.linked(seed, transform?)` (local draft reseeded from upstream). Bare `state`/`computed`/`linked` are a compile error; a writable computed is expressed at the binding (`bind:value={{ get, set }}`). Also carries doc/persistence/undo/broadcast methods.

### Effect — @documentation effect

- `abide/ui/effect` — `effect(fn)`: run now, re-run when a read cell changes; `fn` may be async and may return a teardown. Returns a disposer. In scope inside `.abide` without import.

### Tail & navigate — @documentation tail · navigate

- `abide/ui/tail` — `tail(subscribable)`: latest frame of a `Socket`/stream (reactive); window form `tail(s, { last })` → array; `tail.error`/`tail.status` probes.
- `abide/ui/navigate` — `navigate(path, replace?)`: client navigation through the router.

### Outbox — @documentation ui

- `abide/ui/outbox` — `outbox({ key, send, store?, online?, onDrop? })`: a durable FIFO mutation queue (`.enqueue`/`.pending`/`.flush`) for offline-tolerant writes.

### Runtime & client entry — @documentation plumbing

- `abide/ui/enterScope`, `abide/ui/exitScope` — push/pop the lexical scope around an SSR render.
- `abide/ui/router`, `abide/ui/startClient`, `abide/ui/renderToStream` — the client router, the official client entry (reads `window.__SSR__`, seeds cache, starts the router), and the out-of-order SSR streamer.
- `abide/ui/remoteProxy`, `abide/ui/socketProxy` — the bundler-emitted client substitutes that swap a server verb/socket import for a `fetch` proxy / ws-multiplexed `Socket`.
- `abide/ui/dom/*` — the compiled-template DOM runtime (one node-builder per construct): `mount`, `mountChild`, `mountSlot`, `hydrate`, `skeleton`, `cloneStatic`, `anchorCursor`, `text`, `appendText`, `appendTextAt`, `appendSnippet`, `appendStatic`, `attr`, `on`, `attach`, `each`, `eachAsync`, `when`, `awaitBlock`, `tryBlock`, `switchBlock`, `applyResolved`.
- `abide/ui/runtime/*` — render-pass helpers: `escapeKey` (JSON-Pointer key escaping), `nextBlockId`, `enterRenderPass`, `exitRenderPass`.

## Build / tooling — @documentation building

- `abide/build` — `build({ cwd?, minify?, compress?, clean? })`: build the client bundle to `dist/_app`, emitting gzip siblings when `compress`.
- `abide/compile` — `compile({ cwd?, target?, outfile?, buildClient? })`: produce a standalone Bun server executable (bytecode, embedded compressed assets).
- `abide/preload` — the Bun preload (`bunfig.toml`) that installs the `.abide`, resolver, and CSS-noop plugins and rewrites verb/socket imports.
- `abide/resolver-plugin` — `abideResolverPlugin({ cwd?, embedAssets?, target? })`: virtualizes every generated module and rewrites verbs/sockets per side.
- `abide/ui-plugin` — `abideUiPlugin`: the Bun loader compiling `.abide` SFCs to ES modules (scoped `<style>` via virtual imports; `layout.abide` → `<abide-outlet>`).
- `abide/tsconfig` — `tsconfig.app.json` for consumers to extend (`bundler` resolution, `strict`, `noEmit`, `bun` types).

## Desktop bundle — @documentation bundle

- `abide/bundle/BundleWindow` — the type for `src/bundle/window.ts`'s default export: `{ title?, width?, height?, menu?, config? }`, baked into the launcher.
- `abide/bundle/BundleMenu`, `abide/bundle/BundleMenuItem` — a custom top-level menu and its entries (`separator` / `emit` a `abide:menu` event / `navigate`; optional Cmd `shortcut`).
- `abide/bundle/onMenu` — `onMenu(handler)` / `onMenu(name, handler)`: subscribe to menu clicks (inert in SSR and plain browser tabs); returns an unsubscribe.
- `abide/bundle/bundled` — `bundled()`: `true` when running inside the abide desktop bundle (isomorphic).
- `abide/server/appDataDir` — `appDataDir()`: the per-user data dir keyed by program name (pure; where abide stores `.env` / last-connection).

## MCP — @documentation mcp

- `abide/mcp/createMcpServer` — `createMcpServer(opts?)`: the framework-internal MCP server behind `/__abide/mcp`; tools derive from `clients.mcp` verbs (auto-on for read-only) and sockets (`<name>-tail`, `<name>-publish`), with inbound-request auth and an optional `authorize` hook.

## Testing — @documentation testing

- `abide/test/createTestApp` — `createTestApp(cwd?)`: a test harness with typed `app.rpc.<verb>` / `app.sockets.<name>` maps over the project's virtual modules.
- `abide/test/createScriptedSurface` — `createScriptedSurface(tools?)`: a scripted `AgentSurface` recording every tool `call` for agent-engine tests.
- `abide/test/assertAgentFrameConformance` — `assertAgentFrameConformance(stream)`: assert a frame stream meets the neutral `AgentFrame` contract (one terminal `done`, paired `tool_use`/`tool_result`).

## Generated machine surfaces

| Route                              | Purpose                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `GET /openapi.json`                | OpenAPI spec of the public RPC surface, built on first request                  |
| `POST /__abide/mcp`                | MCP JSON-RPC endpoint (tools from verbs/sockets, prompts, resources)            |
| `GET/POST /__abide/sockets`        | WebSocket multiplex upgrade (one connection per client)                         |
| `GET/POST /__abide/sockets/<name>` | A socket's HTTP face: `GET` retained tail, `POST` publish                       |
| `GET /__abide/health`              | Health probe JSON (identity + app `health()` fields), pre-auth                  |
| `GET /__abide/identity`            | Legacy-shaped alias of the health payload                                       |
| `GET /__abide/cli`                 | Platform-detecting install script; `/__abide/cli/<platform>` streams the binary |
| `GET /__abide/inspector`           | Opt-in inspector UI + data (when enabled and `@abide/inspector` installed)      |
| `GET /__abide/hot/<id>`            | Dev-only component hot-module fetch (`.abide` HMR)                              |

## Environment variables

| Var                           | Effect                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| `PORT`                        | Bind port; unset scans upward from 3000                                 |
| `APP_URL`                     | Base URL whose pathname becomes the mount base (default `/`)            |
| `ABIDE_APP_URL`               | Base URL baked into the downloaded CLI binary                           |
| `ABIDE_APP_TOKEN`             | Bearer token baked into the CLI binary (only if the request was authed) |
| `ABIDE_CLIENT_TIMEOUT`        | Client RPC timeout, ms (1–600000); unset is unbounded                   |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server request-body ceiling (default ~128MB)                            |
| `ABIDE_IDLE_TIMEOUT`          | Per-connection idle timeout, s (0–255, default 10)                      |
| `ABIDE_REACHABLE_TIMEOUT`     | Per-probe `reachable()` timeout, ms (default 3000)                      |
| `ABIDE_REACHABLE_TTL`         | `reachable()` poll cadence, ms (default 30000)                          |
| `ABIDE_DATA_DIR`              | Override the app data dir (used as-is, no program name appended)        |
| `ABIDE_LOG_FORMAT`            | `json` emits log records as JSON instead of TSV                         |
| `DEBUG`                       | Gate diagnostic log channels (e.g. `abide`, `abide:build`, `-abide`)    |
| `ABIDE_ENABLE_INSPECTOR`      | `true` activates the opt-in inspector surface                           |
| `ABIDE_INSPECT`               | Enable webview devtools in the desktop bundle                           |

---

This map mirrors `package.json`'s `exports`. After adding or renaming an export, run `bun run packages/abide/scripts/readmeSurfaces.ts` to re-derive the slugs and catch any untagged export, then regenerate this file.
