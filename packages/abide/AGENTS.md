# AGENTS.md — abide complete surface map

> This file is the exhaustive map of abide's public surface: every `exports` key
> grouped by namespace, with its import specifier and a one-line spec, so an
> agent can grasp the whole API in one read. For the curated three-primitive
> intro read `README.md`; for the domain glossary read `CONTEXT.md`; for the
> rationale behind a decision read `docs/adr/`.
>
> Ground rule — **no barrels**. Every public name is its own module path; there
> is no umbrella `index.ts`, so importing one name never drags side-effecting
> siblings into the bundle. The namespace marks the side a name runs on:
> `abide/server/*` server-side, `abide/ui/*` client-side, `abide/shared/*`
> isomorphic (same callable, same behaviour on both sides). The package is
> `@abide/abide` (Bun ≥ 1.3.0, one direct dependency — TypeScript). Every import
> specifier below is `@abide/abide<exports-key>`; the file path after it is the
> source, not an import target.

## The premise

One declared RPC fans out to five surfaces:

```text
            export const getMessages = GET(fn, { schemas })
                               │
    ┌───────────┬──────────────┼──────────────┬─────────────┐
    ▼           ▼              ▼              ▼             ▼
 SSR call   browser fetch   MCP tool      CLI subcmd   OpenAPI op
 (bare,     (same call,     (read-only    abide-cli    /openapi.json
  in-proc)   swap to fetch)  from type)    getMessages
```

A typed input unlocks the **CLI** on any RPC and **MCP** for read-only methods
(`GET`/`HEAD`): the handler's input type is projected to JSON Schema at build
(ADR-0030), so a plainly-typed handler auto-exposes with no hand-written
`schemas.input` (a declared `schemas.input` adds runtime validation on top, it
isn't what flips the surfaces on). A mutating method
(`POST`/`PUT`/`PATCH`/`DELETE`) never auto-exposes to MCP — it needs an explicit
`clients: { mcp: true }`. Explicit `clients` values always win; `browser`
defaults on. A socket with a `schema` auto-exposes to MCP and CLI regardless of
direction.

## File-based conventions

The bundler and route resolver read these paths by convention (dir aliases
`$server`, `$ui`, `$shared`, `$mcp`, `$cli` point at the matching `src/` dirs):

| Path                                       | Meaning                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/rpc/<name>.ts`                 | One RPC per file; filename = export name = URL under `/rpc/`. The method helper picks the verb. Rewritten to `defineRpc` (server) / `remoteProxy` (client).               |
| `src/server/sockets/<name>.ts`             | One socket per file (`export const <name> = socket(...)`); path → socket name. Rewritten to `defineSocket` (server) / `socketProxy` (client).                             |
| `src/mcp/prompts/<name>.md`                | Markdown MCP prompt: frontmatter (description + arguments) + `{{arg}}` template body, compiled to `definePrompt`.                                                         |
| `src/mcp/resources/*`                      | MCP resource files served by the generated MCP server.                                                                                                                    |
| `src/server/config.ts`                     | Optional typed-env module: `export const config = env(schema)` validates `Bun.env` at boot (or the floor `export const config = Bun.env`). Eager-imported; deletable.     |
| `src/app.ts`                               | Optional app hooks (`AppModule` shape): `init` / `handle` / `handleError` / `health` / `forwardHeaders`. Deletable.                                                       |
| `src/ui/pages/**/page.abide`               | Folder-based route: a folder's `page.abide` mounts at that folder's URL. `[name]` / `[[name]]` (optional) / `[...rest]` (catch-all) are dynamic segments → `page.params`. |
| `src/ui/pages/**/layout.abide`             | Wraps every page at/below its folder; renders the page where it calls `{children()}`; kept mounted across navigation.                                                     |
| `src/ui/app.html`, `src/ui/app.css`        | Custom document shell and root stylesheet.                                                                                                                                |
| `src/ui/public/`                           | Static assets, served at the site root (`/<file>`).                                                                                                                       |
| `src/bundle/window.ts`                     | Optional default-exported `BundleWindow` for the desktop bundle (plus optional `src/bundle/disconnected.abide` connect-screen override).                                  |
| `src/cli/banner.txt`, `src/cli/footer.txt` | CLI help chrome.                                                                                                                                                          |
| `src/.abide/*.d.ts`                        | Generated ambient types (`rpc.d.ts`, `routes.d.ts`, `health.d.ts`, `publicAssets.d.ts`, `testRpc.d.ts`, `testSockets.d.ts`). Do not hand-edit.                            |
| `dist/`                                    | Build output: `dist/_app/` (prod client) or `dist/_app.gen-<id>/` (dev), `dist/app` (compiled binary), `dist/cli-*`.                                                      |

## CLI

`abide <command>` (the `abide` bin):

| Command                                                  | Does                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abide scaffold <name> [--no-install] [--no-dev]`        | Scaffold a project from the bundled template, install it, and (TTY only) start dev.                                                                |
| `abide dev`                                              | Dev orchestrator: build client, spawn the server child, watch `src/`, rebuild + restart on change, browser live-reload.                            |
| `abide build`                                            | Single client build into `dist/_app/`, no server (CI / static deploys).                                                                            |
| `abide start`                                            | Run the production server against an already-built `dist/`.                                                                                        |
| `abide run <file> [args...]`                             | Run an arbitrary script under the abide preload (same runtime as the server); argv after the file is forwarded verbatim.                           |
| `abide compile [--target=<bun-…>] [--out=<path>]`        | Build a standalone server executable.                                                                                                              |
| `abide cli [--target=…] [--out=…] [--platforms=<a,b,c>]` | Build the thin CLI binary (manifest baked in, ships the compiled server beside it); `--platforms` cross-compiles into `dist/cli-thin/<platform>/`. |
| `abide bundle`                                           | Assemble a self-contained desktop app bundle for the host platform (`.app` on macOS), unsigned.                                                    |
| `abide check`                                            | Type-check the project: every `.abide` component's template + props through its shadow program, plus the project's own `.ts` files; non-zero on error. |
| `abide lsp`                                              | Run the `.abide` language server over stdio (JSON-RPC) for editor diagnostics.                                                                     |
| `abide init-agent`                                       | Write/refresh the abide agent-guide pointer in the project root `CLAUDE.md`.                                                                       |

For tests, add `preload = ["@abide/abide/preload"]` under `[test]` in
`bunfig.toml` and run `bun test`.

## Authoring contracts

**RPC** (`src/server/rpc/<name>.ts`). `export const x = METHOD(handler, opts?)`.
The handler receives the validated args — `StandardSchemaV1.InferOutput<schemas.input>`
when a schema is present, otherwise its own declared first parameter (or `undefined`
for a nullary handler); you never pass `<Args, Return>` call generics. It reaches
request context via `request()` (the inbound `Request`) and `cookies()` (the jar),
and returns a `Response` — canonically `json(...)` (success body → the caller's
`Return`), `jsonl(...)`/`sse(...)` (streaming), `error(...)` / `error.typed(...)()`
(non-2xx, body typed `never`), `redirect(...)`, or a hand-built `Response`
(`Return` falls back to `unknown`). Typed errors are inferred from the
`error.typed(...)` branches a handler returns — there is no `errors:` option.

`opts` (`RpcSharedOpts`, all optional): `schemas: { input?, output?, files? }`
(the ADR-0020 namespace — `input` validates args and drives their type, `output`
is the success-body schema for OpenAPI 200 / MCP `outputSchema` and never drives
arg inference, `files` validates multipart File parts and merges them into the
args bag); `clients: { browser?, mcp?, cli? }` (surface-exposure flags);
`crossOrigin` (exempt a mutating RPC from the same-origin CSRF gate); `maxBodySize`
(pre-parse body-byte cap, 413 past it); `timeout` (per-RPC handler deadline in ms,
a 504 on every surface, composed into `request().signal`). Read helpers (GET/HEAD)
additionally accept `cache` (`ttl`/`tags`/`throttle`/`debounce`/`shared`) and
`stream` (replay depth); these are a compile error on the mutating helpers. There
is **no** `outbox` option. Query/path/form args auto-coerce from the endpoint's
typed shape (ADR-0028 build-time plan) — no `z.coerce` needed; a value that will
not parse stays a string so the schema raises an honest 422.

Consume forms (`RemoteFunction`): the bare `fn(args)` **is** the smart read —
cached, coalesced, SWR-reactive; decodes by Content-Type, throws `HttpError` on
non-2xx. There is no call-site options argument on the bare call. Members:
`fn.raw(args, opts?)` (raw `Response`, no decode/throw), `fn.invalidate(args?)`
(drop so the next read reloads), `fn.refresh(args?)` (refetch keeping the stale
value visible), `fn.patch(...)` (in-place cache mutation; fetch-only, absent on
streaming RPCs), `fn.peek(args?)` (retained value,
sync), `fn.pending(args?)`, `fn.refreshing(args?)`, `fn.error(args?)` (this RPC's
last typed error), `fn.isError(caught, 'name')` (typed guard), and client-only
`fn.watch(handler)` / `fn.watch(args, handler)`. A streaming handler
(`jsonl`/`sse`) makes the bare call return a `NamedAsyncIterable<Frame>`
synchronously — `for await (… of fn(args))`, never `await`.

**Socket** (`src/server/sockets/<name>.ts`). `export const x = socket(opts?)`.
`opts` (`SocketOptions`): `tail` (retention count — kept frames for late joiners
/ reconnects; server default 1), `ttl` (evict retained frames older than N ms,
lazy), `clientPublish` (allow publishes over the wire; off by default), `schema`
(validate publish payloads; flips mcp/cli `clients` on), `clients`. A `Socket<T>`
extends `AsyncIterable<T>` (bare `for await` is the live stream, no replay) with
`publish(frame)`, `tail(count?)` (subscription seeded from the retained tail),
`peek()`, `pending()`/`refreshing()`/`done()`/`error()`, `refresh()`, and
`watch(handler)`. HTTP face at `/__abide/sockets/<name>`: `GET` reads the retained
tail, `POST` publishes (only when `clientPublish`).

**Page / layout** (`src/ui/pages/**`). `page` (isomorphic `PageSnapshot` proxy)
exposes `route`, `params`, `url` (browser-space `URL`, base-prefixed), and
`navigating`; read a field inside an effect/derived and it re-runs on navigation.
`url(path, params?, query?)` builds base-correct links; `navigate(path, …)`
performs typed in-app SPA navigation (params first for `[name]` routes, then
`{ replace?, keepScroll? }`). A layout renders the active page via `{children()}`.

**`app.ts` / `config.ts`.** `app.ts` default- or named-exports the `AppModule`
hooks (all optional; `init({ server })` may return a cleanup run on
SIGINT/SIGTERM; `handle(request, next)` is single middleware; `health(request)`
merges into `/__abide/health`, runs before `handle`, and is public). `config.ts`
exports `config` — `env(schema)` (validated, typed, throws on bad config at boot)
or the unvalidated `Bun.env` floor.

**The isomorphism move.** There is no `cache()` wrapper. A bare smart RPC call
read inline during SSR is captured in the per-request cache; the runtime
snapshots each settled entry into a wire-safe form serialized into the HTML, and
the client seeds its store from it on hydration — the same call hydrates warm
instead of re-firing. Streaming reads are snapshotted again after the stream
drains and seeded over the wire. Plain `state(initial)` rides the same move: each
rendered scope's document snapshot is serialized into `__SSR__.docs` keyed by its
render-path id, and on hydration the first write to each slot adopts the server
value — so a nondeterministic init (`state(crypto.randomUUID())`, `state(Date.now())`)
carries the server's value through instead of recomputing a divergent one client-side.

## .abide template grammar

A `.abide` component is HTML with a leading `<script>` (its component script);
`<script>` and `<style>` may also sit **inside a control-flow branch**, scoped to
that branch (a nested `<script>` declares branch-local `state`/`state.computed`/
`state.linked`, re-seeded per mount, and takes **no** module imports — imports
live only in the leading script; a nested `<style>` scopes to its sibling
subtree). A _root_ `<style>` is component-scoped. Reactive primitives are reached
through their own imported bindings (alias-safe) — `state` from `abide/ui/state`,
`watch` from `abide/ui/watch`, `html` from `abide/ui/html`, `snippet` from
`abide/shared/snippet`, `props` from `abide/ui/props` — never through `scope()`
(internal plumbing). Every one of these, `props()` included, is a required import:
a missing one surfaces as `Cannot find name '…'`.

Reactive state:

| Form                           | Meaning                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state(initial, transform?)`   | Writable cell; read/write via `.value`; `transform(next, prev)` gates writes.                                                                     |
| `state.computed(fn)`           | Read-only cell derived from other cells (lazy, never serialized).                                                                                 |
| `state.linked(fn, transform?)` | Writable cell reseeded when the thunk's deps change.                                                                                              |
| `watch(source, handler)`       | The single reaction primitive: over a cell, a cell array, a socket/stream, or an RPC; bare `watch(thunk)` is an auto-tracked effect. Client-only. |
| `props()`                      | Ambient prop reader: `const { name = fallback, ...rest } = props()`.                                                                              |

Bindings and directives (attribute kinds `event` / `bind` / `class` / `style` /
`attach` / spread, plus plain `expression` / static):

| Form                                         | Meaning                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `{expr}`                                     | Reactive text (escaped); an `html`-branded value inserts unescaped raw HTML. |
| `name={expr}`                                | Reactive attribute.                                                          |
| `on<event>={fn}`                             | Event listener (`onclick`, `oninput`, `onsubmit`, …).                        |
| `bind:value` / `bind:checked` / `bind:group` | Two-way form binds.                                                          |
| `bind:value={{ get, set }}`                  | Derived two-way binding.                                                     |
| `class:name={cond}`                          | Toggle a class.                                                              |
| `style:property={value}`                     | Set one style property.                                                      |
| `attach={fn}`                                | Run `fn(element)` at mount; its return is the teardown.                      |
| `{...spread}`                                | Spread an object's keys as attributes (element) or props (component).        |

Control flow — mustache `{#…}` blocks (NOT `<template>`):

| Block          | Form                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Conditional    | `{#if}` / `{:else if}` / `{:else}` / `{/if}`                                                                                            |
| Keyed list     | `{#for item, i of list by key}` / `{/for}`                                                                                              |
| Async list     | `{#for await item of source}` / `{/for}` (over an `AsyncIterable`)                                                                      |
| Promise        | bare peek `{fn()}` is the default (below); `{#await p}` / `{:then v}` / `{:catch e}` / `{:finally}` / `{/await}` is the explicit opt-in |
| Switch         | `{#switch subject}` / `{:case v}` / `{:default}` / `{/switch}`                                                                          |
| Error boundary | `{#try}` / `{:catch}` / `{:finally}` / `{/try}`                                                                                         |
| Snippet        | `{#snippet name(args)}…{/snippet}`, called `{name(args)}`                                                                               |

Reading async data does **not** require `{#await}`. A promise/async-cell-typed
`{expr}` is a **peek** — `undefined` while pending (auto-streamed on SSR), composing
with `?? fallback` / `?.` / `{#if}` / attributes in every position (ADR-0032), paired
with the `.pending()` / `.error()` probes for affordances; `{await expr}` blocks SSR
inline (the shorthand for a `{#await … then}` head). The `{#await}` block above is the
opt-in reserved for a distinct pending branch, a local `{:catch}`, or `{:then}`
type-narrowing — ADR-0019 narrowed its authored role to exactly that.

Components are capitalised tags; content nested in them renders where the
component calls `{children()}` (`{#if children}{children()}{:else}…{/if}` is the
fallback). The `<slot>` element, the `<template name>` snippet form, and
`<template if>` / `<template each>` / … control flow were **removed** — a bare
`<template>` is now an inert element, and any removed form throws a migration
error. The branch keyword is `{:else if}` (a space).

## Server surface — abide/server/*

### RPC helpers — @documentation rpc

- `@abide/abide/server/GET` — declares a read (GET) RPC; accepts `RpcReadOpts`
  (shared opts + `cache`/`stream`); query args. Bundler-rewritten; calling the
  bare helper throws.
- `@abide/abide/server/POST` — declares a mutating (POST) RPC; `RpcSharedOpts`
  only (`cache`/`stream` are a compile error); JSON-body (or FormData) args.
- `@abide/abide/server/PUT` — mutating PUT RPC; body args; `RpcSharedOpts`.
- `@abide/abide/server/PATCH` — mutating PATCH RPC; body args; `RpcSharedOpts`.
- `@abide/abide/server/DELETE` — mutating DELETE RPC; query args; `RpcSharedOpts`.
- `@abide/abide/server/HEAD` — read HEAD RPC alongside GET; query args;
  `RpcReadOpts`.

### Responses — @documentation response

- `@abide/abide/server/json` — `json(data, init?)`: JSON `TypedResponse<T>` with
  RPC defaults (`no-store`), wire-encoding Set/Map/bigint/Date; `json(undefined)`
  → 204. `T` drives `Return` inference.
- `@abide/abide/server/jsonl` — `jsonl(iterable, init?)`: wraps an
  `AsyncIterable<Frame>` as `application/jsonl` (one JSON value per line); a
  generator error emits a final `{"$error":…}` line.
- `@abide/abide/server/sse` — `sse(iterable, init?)`: wraps an
  `AsyncIterable<Frame>` as `text/event-stream` with 15s keepalive comments;
  errors emit an `event: error` frame.
- `@abide/abide/server/error` — `error(status, message?, init?)`:
  `text/plain` `TypedResponse<never>`. `error.typed(name, status, schema?)`
  declares a reusable typed-error constructor driving `fn.isError(e, 'name')`.
- `@abide/abide/server/redirect` — `redirect(url, status=302, init?)`:
  `TypedResponse<never>`, accepts relative URLs, `no-store`, status restricted to
  301/302/303/307/308.

### Render — @documentation render

- `@abide/abide/server/render` — `render(path, params?, query?): Promise<string>` —
  renders a page route to its HTML string in-process, through the same pipeline
  (app.html shell, layout chain, params, inline rpc reads) an HTTP GET of that URL
  runs, so a page stays directly linkable and its emailed form is one call away.
  Arg shape mirrors `url()`/`navigate`: a `[name]` route takes its params first,
  then optional query; a paramless route takes optional query directly. Renders in
  a fresh nested request scope like an in-process rpc call — `app.handle` middleware
  and gzip are not applied. A page baking content inline (top-level `await` /
  blocking `{#await expr then value}`) returns complete, self-contained HTML; a
  streaming `{#await}` page returns the shell plus trailing `<abide-resolve>`
  fragments a browser reassembles, so use blocking awaits for a no-JS surface (email).

### Request scope — @documentation request-scope

- `@abide/abide/server/request` — `request(): Request` — the in-flight inbound
  request (ALS-scoped); throws outside a request scope.
- `@abide/abide/server/cookies` — `cookies(): Bun.CookieMap` — the request's
  cookie jar; reads parse `Cookie`, writes flush as `Set-Cookie` on return.
- `@abide/abide/server/server` — `server(): Bun.Server` — the active server; a
  no-op in-process server for CLI/MCP/test dispatch; throws before init.

### Configuration — @documentation configuration

- `@abide/abide/server/env` — `env(schema)`: validate `Bun.env` against a Standard
  Schema at module top level (synchronous; all issues at once) and return the
  typed config; also registers the schema for the launcher setup form.

### Sockets — @documentation sockets

- `@abide/abide/server/socket` — `socket(opts?)` / `socket({ schema })` declares a
  broadcast topic returning `Socket<T>`; opts `tail`/`ttl`/`clientPublish`/
  `schema`/`clients` (server-only; the client stub discards them).

### Agent — @documentation agent

- `@abide/abide/server/agent` — `agent(engine, messages): AsyncIterable<AgentFrame>`
  runs a provider `AgentEngine` against the current request's MCP surface
  (forwarding caller auth); the handler picks transport via `jsonl`/`sse`. Exports
  `NeutralMessage`, `AgentFrame`, `AgentSurface`, `AgentEngine` types.

### Server plumbing — @documentation plumbing

- `@abide/abide/server/AppModule` — type of the optional `src/app.ts` hooks
  (`forwardHeaders`/`init`/`handle`/`handleError`/`health`).
- `@abide/abide/server/InspectorContext` — type of the capability object core
  injects into `@abide/inspector` when `ABIDE_ENABLE_INSPECTOR=true`.
- `@abide/abide/server/rpc/defineRpc` — bundler-emitted RPC builder: resolves
  `clients`, validates input/files, applies `timeout`, registers the entry.
- `@abide/abide/server/sockets/defineSocket` — bundler-emitted socket builder:
  per-subscriber queue + retained tail, optional `ttl`/`schema`, Bun-native
  fan-out.
- `@abide/abide/server/prompts/definePrompt` — resolver-emitted prompt builder
  from `src/mcp/prompts/<name>.md`; registers with the MCP dispatcher.
- `@abide/abide/server/prompts/renderPromptTemplate` — substitutes `{{name}}`
  placeholders in a prompt template body (missing args → empty string).

## Isomorphic surface — abide/shared/*

### RPC schema projection — @documentation rpc

- `@abide/abide/shared/withJsonSchema` — `withJsonSchema(schema, toJsonSchema)`
  attaches a `toJSONSchema()` projection to a Standard Schema whose library lacks
  one native (feeds OpenAPI / MCP / CLI / setup form).

### Error responses — @documentation response

- `@abide/abide/shared/HttpError` — the error class thrown by a remote call on
  non-2xx: `status`, `statusText`, raw `response`, optional `kind`/`data` (set for
  a typed error or a 422 validation failure).
- `@abide/abide/shared/ValidationErrorData` — type of `HttpError.data` when
  `kind === 'validation'`: `{ issues, fields }` (raw Standard Schema issues + a
  field→first-message map).

### Cache mutation — @documentation cache

- `@abide/abide/shared/patch` — `patch(fn, args?, updater)` / `patch({tags},
updater)`: reactively mutate the retained value of matching cached reads in
  place, no network — the optimistic-update / real-time primitive.
- `@abide/abide/shared/invalidate` — `invalidate(selector?, args?)`: DROP every
  matching cached read so the next read reloads lazily (a mounted retained reader
  revalidates stale-in-place). Isomorphic (ADR-0041): applied locally on the
  client, broadcast to every connected client from the server.
- `@abide/abide/shared/refresh` — `refresh(selector?, args?)`: REFETCH every
  matching cached read now, keeping the stale value visible (`refreshing()` true)
  until fresh swaps in. Isomorphic (ADR-0041): applied locally on the client,
  broadcast to every connected client from the server.

### Page — @documentation page

- `@abide/abide/shared/page` — `page`: isomorphic reactive `PageSnapshot` proxy
  (`route`/`params`/`url`/`navigating`); reading a field in a tracking scope
  re-runs on navigation.

### Probes — @documentation probes

- `@abide/abide/shared/pending` — `pending(source?, args?): boolean` — reactive
  "no value yet" over cached calls and tail streams.
- `@abide/abide/shared/peek` — `peek(source, args?)` — the currently-retained
  value synchronously, triggering nothing; `undefined` when nothing retained.
- `@abide/abide/shared/refreshing` — `refreshing(source?, args?): boolean` —
  reactive "holding a value while a fresher source is in flight".
- `@abide/abide/shared/done` — `done(subscribable): boolean` — reactive terminal
  read: true once a stream closed.
- `@abide/abide/shared/online` — `online(): boolean` — reactive connectivity
  probe (browser online/offline; server reflects the caller's reported state).

### URL — @documentation url

- `@abide/abide/shared/url` — `url(path, ...args): string` resolves any in-app URL
  base-correctly (RPC query, page params, or asset); external paths pass through.
  Exports `PathParams` and augmentable `RpcRoutes`/`PageRoutes`/`PublicAssets`.

### Templating — @documentation templating

- `@abide/abide/shared/snippet` — `snippet(payload)` brands a snippet payload so a
  `{expr}` interpolation mounts it (the compiler wraps a `{#snippet}` body); also
  exports `SnippetValue` and `Snippet<Args>` types.

### Observability — @documentation observability

- `@abide/abide/shared/health` — `health(): HealthState` — reactive backend-health
  read (reachability + the app's `health()` fields), reader-driven poll of
  `/__abide/health`; composes `navigator.onLine`.
- `@abide/abide/shared/log` — `log`: the unified request-scope-aware logger
  (`log(...)`, `.warn`/`.error`/`.trace`, `.channel(name)` for a DEBUG-gated
  channel); TSV by default, JSON under `ABIDE_LOG_FORMAT=json`.
- `@abide/abide/shared/reachable` — `reachable(host?): Promise<boolean>` —
  isomorphic outbound reachability HEAD probe, cached per TTL; any response counts
  reachable, only connection failure/timeout is not.
- `@abide/abide/shared/trace` — `trace(): string | undefined` — the current
  request's W3C `traceparent` (server from ALS, browser from `__SSR__`).

### Isomorphic plumbing — @documentation plumbing

- `@abide/abide/shared/createSubscriber` — `createSubscriber(start)`: abide-ui
  subscriber grounded in the signal core (open-on-first-tracked-read,
  close-on-last-reader).

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `@abide/abide/ui/state` — `state(initial, transform?)` writable cell (read/reassigned as a plain variable; compiler desugars to `.value`);
  members `state.computed(fn)` (read-only derived), `state.linked(fn, transform?)`
  (writable, reseeded from a thunk), `state.share(key, value)` / `state.shared(key)`
  (ambient scope context).
- `@abide/abide/ui/watch` — `watch(source, handler)` the single reaction primitive
  (cell / cell array / socket-stream / RPC); bare `watch(thunk)` is an auto-tracked
  effect; returns a scope-tied disposer; SSR-inert.
- `@abide/abide/ui/props` — `props()` prop reader (a required import, like the other
  reactive names); compiler-lowered inside a component; throws if called directly.

### Templating — @documentation templating

- `@abide/abide/ui/html` — `html\`…\``(or`html(string)`) returns branded
**unescaped** raw HTML for `{expr}` insertion; interpolations are not
  auto-escaped; nullish → empty.

### Navigate — @documentation navigate

- `@abide/abide/ui/navigate` — `navigate(path, ...rest)` typed in-app SPA
  navigation (params first for `[name]` routes, then `{ replace?, keepScroll? }`);
  builds through `url()`.

### UI plumbing — @documentation plumbing

- `@abide/abide/ui/effect` — `effect(fn)` internal reactive effect (tracks reads,
  re-runs, returns a disposer); compiler-emitted — authors use `watch`.
- `@abide/abide/ui/currentScope` — `scope()` resolves the current lexical scope;
  the internal lowering host the compiler targets.
- `@abide/abide/ui/enterRenderScope` — `enterScope()` establishes a fresh isolated
  SSR-render scope, returning the previous.
- `@abide/abide/ui/exitRenderScope` — `exitScope(previous)` restores the scope
  `enterScope` saved.
- `@abide/abide/ui/router` — `router(host, loaders, layoutLoaders?, probe?)` the
  History-API client router: match, code-split, mount a diffed outlet chain, drive
  SPA nav with scroll restoration.
- `@abide/abide/ui/startClient` — `startClient(routes, layoutRoutes?, target)` the
  client entry: read `window.__SSR__`, seed cache/streamed/warm state, start the
  router; returns a disposer.
- `@abide/abide/ui/renderToStream` — `renderToStream(render)` out-of-order SSR
  streaming generator: shell first, then one `<abide-resolve>` fragment per
  streaming `{#await}` in completion order.
- `@abide/abide/ui/remoteProxy` — `remoteProxy(method, url, options?)`
  bundler-target client substitute for a server RPC (fetch over the network; does
  the client pre-flight input validation; attaches the real `.watch`).
- `@abide/abide/ui/socketProxy` — `socketProxy(name)` bundler-target client
  substitute for a server socket (subscribes over the multiplexed ws).
- `@abide/abide/ui/settleAsyncCells` — the SSR await-barrier draining the
  request-scoped pending-cell list; client no-op.
- `@abide/abide/ui/flight` — server-only flight-starter hoisting a hoistable
  await's promise into the sync prefix so independent flights overlap.
- `@abide/abide/ui/isolateCellBarrier` — runs a hoisted child render under its own
  async-cell barrier so its cells isolate from siblings; client passthrough.
- `@abide/abide/ui/finalizeStreamedChildren` — the when-to-stream decision run
  after a component body walk; fills each hoistable child's reserved output slot.
- `@abide/abide/ui/runtime/withPath` — pushes one escaped render-path segment for
  the duration of a synchronous build.
- `@abide/abide/ui/runtime/renderPath` — composes a streamed child's ordinal
  segment onto the ambient render path and returns the boundary id.
- `@abide/abide/ui/runtime/escapeKey` — escapes one key to an RFC 6901
  JSON-Pointer token so a `/`-bearing key survives a `/`-joined render path.
- `@abide/abide/ui/runtime/nextBlockId` — the next await/try block id in the
  current render pass, namespaced by render path.
- `@abide/abide/ui/runtime/blockId` — allocates a render-path-namespaced await/try
  block id with a per-path document-order counter.
- `@abide/abide/ui/runtime/enterRenderPass` — marks entry into a render/mount;
  depth 0 clears the per-path block-id counters.
- `@abide/abide/ui/runtime/exitRenderPass` — marks exit, unwinding the render-pass
  depth.
- `@abide/abide/ui/dom/mount` — mounts a top-level page/layout into a host under an
  ownership scope; returns a disposer.
- `@abide/abide/ui/dom/mountChild` — mounts a `<Child/>` as a marker-bounded range
  (no wrapper element).
- `@abide/abide/ui/dom/mountStreamedChild` — client adopter for a hoistable child:
  adopts an inlined range or a streamed boundary.
- `@abide/abide/ui/dom/mergeProps` — composes a child's props from ordered layers
  (explicit runs, spreads, trailing `children`), last-wins per key.
- `@abide/abide/ui/dom/spreadProps` — wraps a `{...source}` spread layer so each
  key resolves to a live value thunk.
- `@abide/abide/ui/dom/restProps` — the live `...rest` of a `props()` destructure.
- `@abide/abide/ui/dom/bindProp` — parent half of a component `bind:prop`
  (annotates the prop thunk with a write-back channel).
- `@abide/abide/ui/dom/bindableProp` — child half of a two-way prop (the writable
  cell the child writes/forwards).
- `@abide/abide/ui/dom/spreadAttrs` — spreads an object's keys onto a native
  element (`on<event>` keys attach listeners, others bind as reactive attrs).
- `@abide/abide/ui/dom/readCall` — guarded method call on a reactive-document read
  so throws name the authored scope path.
- `@abide/abide/ui/dom/readCell` — unified read for a `computed`/`linked`
  reference (async peek / derive call / sync `.value`).
- `@abide/abide/ui/dom/cellPending` — whether a `{#if}`/`{#switch}` async subject
  is still loading (render no branch while pending).
- `@abide/abide/ui/dom/mutateDocContainer` — in-place container mutation lowered to
  clone-mutate-replace so a patch emits and readers wake.
- `@abide/abide/ui/dom/hydrate` — adopts server-rendered DOM in place with a claim
  cursor (attach listeners/effects, no re-render); returns a disposer.
- `@abide/abide/ui/dom/appendText` — reactive `{expr}` interpolation (escaped text
  / snippet builder / `html\`\`` raw).
- `@abide/abide/ui/dom/appendTextAt` — reactive `{expr}` mounted at a skeleton
  anchor comment, interleaved with element siblings.
- `@abide/abide/ui/dom/appendSnippet` — mounts a `{snippet(args)}` builder's nodes
  in a marker-bounded range.
- `@abide/abide/ui/dom/appendStatic` — a static text node, created or claimed from
  SSR text.
- `@abide/abide/ui/dom/cloneStatic` — appends a fully-static bindingless subtree via
  one cached-template deep clone.
- `@abide/abide/ui/dom/skeleton` — clones a template and locates its bound
  holes/anchors for a subtree carrying bindings/control-flow.
- `@abide/abide/ui/dom/anchorCursor` — positions a skeleton-anchored control-flow
  block or slot at its `<!--a-->` anchor.
- `@abide/abide/ui/dom/mountSlot` — mounts a component's `{children()}` content
  (parent children or fallback) as a marker-bounded range.
- `@abide/abide/ui/dom/outlet` — a layout's outlet boundary the router fills with
  the next chain layer.
- `@abide/abide/ui/dom/attr` — binds an element attribute to `read()` via one
  effect (`name={expr}`).
- `@abide/abide/ui/dom/on` — attaches an event listener pinned to the owning scope
  (`on<event>`).
- `@abide/abide/ui/dom/attach` — runs an `attach={fn}` against an element and
  registers its teardown.
- `@abide/abide/ui/dom/bindSelectValue` — two-way `bind:value` for `<select>`
  (reactive selection + change write-back; `multiple` = array membership).
- `@abide/abide/ui/dom/each` — keyed list binding (`{#for … by key}`),
  marker-range rows reconciled by key with minimal DOM moves.
- `@abide/abide/ui/dom/eachAsync` — async keyed list over an AsyncIterable
  (`{#for await}`); rows append as it yields; SSR renders none.
- `@abide/abide/ui/dom/when` — conditional swappable range (`{#if}`/`{:else}`) with
  an optional pending state.
- `@abide/abide/ui/dom/awaitBlock` — await-block runtime across
  pending/resolved/error branches with SSR resume adoption (`{#await}`).
- `@abide/abide/ui/dom/tryBlock` — error-boundary block catching thrown/async-cell
  errors into a catch branch (`{#try}`).
- `@abide/abide/ui/dom/switchBlock` — multi-branch swappable range (first matching
  `{:case}` else `{:default}`; also backs `{:else if}` chains).

## Build / tooling

### Building — @documentation building

- `@abide/abide/build` — `build(opts?)` builds the client bundle into `dist/` and
  concurrently writes `src/.abide/*.d.ts`; never throws. Options `cwd`/`minify`/
  `compress`/`clean`/`exitOnFailure`/`dev`.
- `@abide/abide/compile` — `compile(opts?)` produces a standalone Bun server
  executable (runs the client build first to embed assets); returns the binary
  path.

### Tooling — @documentation plumbing

- `@abide/abide/ui-plugin` — the `abide-ui` `BunPlugin` that loads and compiles
  `.abide` components (and pulls scoped `<style>` into browser bundles).
- `@abide/abide/preload` — the Bun preload module registering the UI plugin, the
  resolver plugin, and the `.css` no-op loader (used by `bunfig` `[test]` and the
  CLI `--preload`).
- `@abide/abide/resolver-plugin` — `abideResolverPlugin({ cwd?, embedAssets?,
target? })` wiring every `abide:*` virtual module, the `$server`/`$ui`/`$shared`/
  `$mcp`/`$cli` aliases, and the per-target RPC/socket rewrite (with the
  client-side server-code-leak guard).
- `@abide/abide/tsconfig` — the base `tsconfig.app.json` for consuming apps to
  `extends`.

## Desktop bundle — @documentation bundle

- `@abide/abide/server/appDataDir` — `appDataDir()` returns the bundle's per-user
  data dir keyed by the injected program name; cwd-independent, pure.
- `@abide/abide/bundle/BundleWindow` — type of the default export from
  `src/bundle/window.ts`: `{ title?, width?, height?, menu?, config? }`.
- `@abide/abide/bundle/BundleMenu` — `{ label, items: BundleMenuItem[] }`, a
  top-level bundle menu.
- `@abide/abide/bundle/BundleMenuItem` — a menu entry: separator, or `emit` (a
  page `abide:menu` event), or `navigate`.
- `@abide/abide/bundle/onMenu` — `onMenu(handler)` / `onMenu(name, handler)`
  subscribes to bundle menu-click events; returns an unsubscribe; inert in a
  plain tab / SSR.
- `@abide/abide/bundle/bundled` — `bundled(): boolean` — am I part of the abide
  desktop bundle (client reads `window.__ABIDE_BUNDLE__`, server the parent-pid
  env).

## MCP — @documentation mcp

- `@abide/abide/mcp/createMcpServer` — `createMcpServer(opts?)` constructs the
  framework-generated MCP server bound to the RPC/socket registries; returns
  `{ handle(request) }` (the `/__abide/mcp` handler). Tools derive from surfaces
  with `clients.mcp`.

## Testing

### Testing — @documentation testing

- `@abide/abide/test/createTestApp` — `createTestApp()` boots the real app on an
  ephemeral port; returns `{ origin, fetch, rpc, sockets, health, stop,
[Symbol.asyncDispose] }` (`rpc`/`sockets` typed by generated d.ts). Use
  `await using`.

### Testing plumbing — @documentation plumbing

- `@abide/abide/test/createScriptedSurface` — `createScriptedSurface(tools?)` a
  scripted `AgentSurface` for engine tests; records every `call`.
- `@abide/abide/test/assertAgentFrameConformance` — collects an engine frame
  stream and asserts the neutral `AgentFrame` contract (one terminal `done`; every
  `tool_use` answered), throwing on violation.

## Generated machine surfaces

Runtime routes the framework serves:

| Route                | Serves                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/openapi.json`      | OpenAPI spec for the public `/rpc/*` surface, built lazily from the frozen RPC registry.                                      |
| `/__abide/mcp`       | MCP endpoint (POST → `mcp.handle`), through the app auth/CSRF pipeline; mounted when an MCP is configured.                    |
| `/__abide/health`    | Health/identity probe answered ahead of app middleware (framework identity + `app.health()` fields), `no-store`.              |
| `/__abide/identity`  | Compatibility alias of the health payload, stamped `{ abide: true }` for legacy probers.                                      |
| `/__abide/inspector` | Operator inspector UI + data/SSE routes, gated by `ABIDE_ENABLE_INSPECTOR` (optional `@abide/inspector`).                     |
| `/__abide/sockets`   | WebSocket upgrade for the socket multiplex hub; `/__abide/sockets/<name>` is one socket's HTTP face (GET tail, POST publish). |
| `/__abide/cli`       | GET returns the platform-detecting install script; `/__abide/cli/<platform>` streams the built CLI binary tarball.            |

## Environment variables

| Variable                      | Effect                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `PORT`                        | Exact TCP port to bind; unset/invalid scans from 3000.                                       |
| `APP_URL`                     | Derives the server's mount base path from its pathname (e.g. `/v2`).                         |
| `ABIDE_APP_URL`               | Default server URL the CLI connects to; its pathname sets the mount base.                    |
| `ABIDE_APP_TOKEN`             | Sent as `Authorization: Bearer <value>` on CLI→server requests.                              |
| `ABIDE_APP_DIR`               | Overrides the dir the server serves chunks/shell/assets from (set per dev build generation). |
| `ABIDE_DATA_DIR`              | Overrides the app data directory on all platforms, used as-is (no program-name suffix).      |
| `ABIDE_CLIENT_TIMEOUT`        | RPC client timeout in ms (1–600000), shipped to the browser transport.                       |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide max request body size.                                                           |
| `ABIDE_IDLE_TIMEOUT`          | Bun per-connection idle timeout in seconds (default 10).                                     |
| `ABIDE_LOG_FORMAT`            | `json` renders log records as JSON instead of TSV.                                           |
| `ABIDE_ENABLE_INSPECTOR`      | `true` mounts the opt-in operator inspector UI/routes.                                       |
| `ABIDE_INSPECT`               | Enables webview devtools/inspect for desktop bundles.                                        |
| `ABIDE_DEV_SURFACE`           | `1` forces the worker to print its surface map (set by the dev orchestrator).                |
| `DEBUG`                       | npm-debug-style channel gate for diagnostic log channels (e.g. `abide:cache`, `hydrate`, `-abide`); `hydrate` reports SSR↔client hydration divergences with their render-path (browser: `localStorage['abide-debug']`). |

---

Mirrors `package.json`'s `exports`; run
`bun run packages/abide/scripts/readmeSurfaces.ts` after adding or renaming an
export to keep this map honest.
