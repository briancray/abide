# AGENTS.md — abide complete surface map

> This file is the exhaustive map of abide's public surface: every `exports` key,
> grouped by namespace, with its import specifier and a one-line spec. Where the
> `README.md` teaches the three foundational primitives (RPC, socket, component),
> this maps the whole API in one read. `CONTEXT.md` is the domain glossary and
> `docs/adr/` carries the rationale behind each decision.
>
> Ground rule: **no barrels.** Every public name has its own module path
> (`abide/server/GET`, `abide/shared/cache`, `abide/ui/state`, …) — there is no
> umbrella `index.ts`, so importing one name never drags side-effecting siblings
> into the bundle. The namespace marks the side a name runs on: `abide/server/*`
> is server-side, `abide/ui/*` is client-side, `abide/shared/*` is isomorphic
> (same callable, same intent both sides — usually identical behaviour, e.g.
> `HttpError`; sometimes a side-swapped runtime behind one intent, e.g. `cache`,
> `invalidate`, `refresh`).
>
> Package `@abide/abide` runs on **Bun ≥ 1.3.0** with **one direct dependency**
> (TypeScript). The surface bullets below write the short `abide/…` specifier for
> readability — the installable path prefixes the package name, so `abide/server/GET`
> imports from `@abide/abide/server/GET`. These are the public `exports` keys, not
> the on-disk file paths.

## The premise

One typed RPC declaration branches to every surface:

```text
        export const getMessages = GET(handler, { schemas })
                              │
   ┌──────────┬──────────────┼──────────────┬──────────────┐
   ▼          ▼              ▼              ▼              ▼
 SSR call   browser        MCP tool       CLI            OpenAPI op
 the bare   fetch          (read-only,    subcommand     in
 call,      typed proxy    auto-exposed)  abide cli      /openapi.json
 in-process fn(args)                      getMessages
```

A **typed handler input** flips those surfaces on: the input type is projected to
JSON Schema at build (ADR-0030), so a plainly-typed handler auto-exposes to the
CLI and — for read-only methods (`GET`/`HEAD`) — MCP with no hand-written
`schemas.input`. A declared `schemas.input` adds runtime validation (422) on top.
A mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) never auto-exposes to MCP —
opt it in with `clients: { mcp: true }`.

## File-based conventions

The bundler (`abideResolverPlugin`) reads these paths. Import aliases into the
tree: `$server`, `$ui`, `$shared`, `$mcp`, `$cli`.

| Path | Meaning |
|---|---|
| `src/server/rpc/<name>.ts` | One RPC endpoint per file; URL is `/rpc/<name>`. Export name = file stem. Flat — dynamic `[seg]` segments are rejected here (pass ids as args). |
| `src/server/sockets/<name>.ts` | One `socket(...)` per file; socket name = path under `sockets/` (nested kept, e.g. `orders/new`). Multiplexed over `/__abide/sockets`. |
| `src/ui/pages/<route>/page.abide` | Folder-based routed page; URL = directory path. Dynamic segments keep `[name]` / `[[name]]` / `[...rest]` shape → `page.params`. |
| `src/ui/pages/<route>/layout.abide` | Nested layout wrapping the route chain below; renders it at `{children()}`. |
| `src/ui/public/` | Static assets, served at site root; embedded for standalone compile. |
| `src/ui/app.html` | Custom document shell (optional; a bundled default is used otherwise). |
| `src/mcp/prompts/<name>.md` | Markdown MCP prompts; name = path minus `.md`, `/`→`-` (`code/review.md` → `code-review`). |
| `src/mcp/resources/` | MCP resources, embedded for standalone builds. |
| `src/server/config.ts` | Re-exported as `abide:config` for boot-time `env(schema)` validation (optional). |
| `src/app.ts` | Re-exported as `abide:app` — the `AppModule` request hooks (optional). |
| `src/bundle/window.ts` | Default-export `BundleWindow` config baked into the desktop launcher (optional). |
| `src/.abide/*.d.ts` | Editor `.d.ts` artifacts written by `build()` (not at boot). |
| `dist/` | Build output; client bundle → `dist/_app/` (dev: per-generation `dist/_app.gen-<id>`). |

## CLI

| Command | Does |
|---|---|
| `abide scaffold <name> [--no-install] [--no-dev]` | Scaffold the bundled template, install, and (TTY only) start dev. |
| `abide dev` | Build the client + run the server with file-watch rebuild/restart and browser live-reload. |
| `abide build` | Single client build into `dist/_app/` (no server). |
| `abide check` | Type-check every `.abide` template + props via the shadow program; non-zero on errors. |
| `abide start` | Run the production server against a built `dist/`. |
| `abide run <file> [args…]` | Run a script under the abide preload (same runtime as the server). |
| `abide compile [--target=<bun-…>] [--out=<path>]` | Build a standalone server executable. |
| `abide cli [--target=] [--out=] [--platforms=a,b,c]` | Build the thin CLI binary (ships the server beside it); `--platforms` cross-compiles. |
| `abide bundle` | Assemble a movable, self-contained (unsigned) desktop app bundle for this platform. |
| `abide lsp` | Run the `.abide` language server over stdio (JSON-RPC) for editors. |
| `abide init-agent` | Write/refresh a `CLAUDE.md` pointer to this surface map (non-scaffolded projects). |

For tests, add `preload = ["@abide/abide/preload"]` under `[test]` in
`bunfig.toml` and run `bun test`.

## Authoring contracts

- **RPC** (`src/server/rpc/<name>.ts`) — `export const x = GET(handler, opts?)`.
  The handler receives `InferOutput<schemas.input>` (intersected with
  `InferOutput<schemas.files>` for multipart), or reads its arg shape structurally
  off the function when schemaless. Inside it, `request()` / `cookies()` reach the
  request scope; it returns `json` / `jsonl` / `sse` / `error` / `redirect` /
  `error.typed(...)` / a raw `Response`. `opts` (ADR-0020): `schemas: { input?,
  output?, files? }` (nested, **not** flat `inputSchema`/`filesSchema`; there is
  **no** `outbox` field), `clients: { browser, mcp, cli }`, `crossOrigin`,
  `timeout` (ms → 504), `maxBodySize`; read helpers add `cache` and `stream`
  (a compile error on mutating helpers). Query/path/form args auto-coerce from the
  endpoint's typed shape at build (ADR-0028) — no `z.coerce`; an unparseable value
  stays a string so the schema raises an honest 422.
- **Consume forms** — the **bare call `fn(args)` is the smart read** (cached,
  coalesced, reactive; in-process during SSR and baked into the HTML for warm
  hydration — there is no `cache()` wrapper). Around it: `fn.raw(args, opts?)`
  (raw `Response`), `fn.refresh` / `fn.invalidate` / `fn.patch` / `fn.peek` /
  `fn.pending` / `fn.refreshing` / `fn.error` / `fn.watch` / `fn.isError`. A
  streaming handler (`jsonl`/`sse`) makes the bare call return a
  `NamedAsyncIterable<Frame>` (the iterable IS the value; `await`-ing it is a
  compile error; `patch` is dropped).
- **Socket** (`src/server/sockets/<name>.ts`) — `export const x =
  socket<T>(opts?)`. `opts`: `tail` (retention depth; defaults to keeping the last
  frame), `ttl` (per-frame eviction ms), `clientPublish` (accept `pub` frames from
  the wire; off by default), `schema` (validates publishes, projects MCP/CLI),
  `clients`. `Socket<T>` is an `AsyncIterable<T>` — iterate for the live stream,
  `.tail(count?)` to seed from retention first.
- **Page / layout** (`.abide`) — dynamic `[id]` segments arrive on `page.params`;
  a `layout.abide` renders the route chain below at `{children()}`. Reactive
  navigation reads `page` (`route`/`params`/`url`/`navigating`) and writes via
  `navigate`.
- **`src/app.ts` / `src/server/config.ts`** — the `AppModule` hooks
  (`init`/`handle`/`handleError`/`health`/`forwardHeaders`) and the boot-time
  `env(schema)` config, respectively.

## .abide template grammar

A component is valid HTML: a leading `<script>` (module scope — imports hoist
here for the whole template), markup with `{expr}` interpolation and directive
attributes, `{#…}` control-flow blocks, and an optional root `<style>`. Reactive
primitives are **imported by their own module paths** and resolved by import
binding (alias-safe); the one ambient reader is `props()`.

A `<script>` and a `<style>` are **not** component-root-only: either may sit
inside a control-flow branch. A nested `<script>` declares branch-local
`state` / `state.computed` / `state.linked` (re-seeded per mount, no module
imports); a nested `<style>` scopes to its sibling subtree, not the whole
component. So a *root* `<style>` is component-scoped, a nested one is branch-scoped.

### Reactive state

| Form | Meaning |
|---|---|
| `import { state } from '@abide/abide/ui/state'` | The reactive-cell primitive; called bare (`let count = state(0)`). Read and reassigned as a plain variable — the compiler desugars to the cell. `state(v, transform?)` gates writes through `transform(next, previous)`. |
| `state.computed(() => …)` | Read-only derived cell (lazy, never serialized). |
| `state.linked(() => src, transform?)` | Writable cell reseeded when the thunk's deps change. |
| `import { watch } from '@abide/abide/ui/watch'` | The single reaction primitive — `watch(source, handler)` over a cell, a cell array, a socket/stream, or an rpc; bare `watch(thunk)` is an auto-tracked effect. Client-only, stripped from SSR. |
| `import { props } from '@abide/abide/ui/props'` | The prop reader — `const { name = fallback, ...rest } = props()`. A required import (not ambient, not `scope()`). |

A writable computed is expressed at the binding: `bind:value={{ get, set }}`.
`scope()` is internal plumbing now, never authored; `effect` is compiler-emitted —
authors write `watch`, not a bare `effect(...)`.

### Bindings & directives

| Syntax | Meaning |
|---|---|
| `{expr}` | Escaped text interpolation. |
| `{html\`…\`}` / `{html(str)}` | `html`-branded raw markup, inserted unescaped. |
| `name={expr}` | Attribute (or component prop) bound to an expression. |
| `on<event>={fn}` | Event listener (`onclick={…}`). |
| `bind:value` / `bind:checked` / `bind:group` | Two-way form binds. |
| `bind:value={{ get, set }}` | Derived two-way bind. |
| `class:name={cond}` | Toggle a class. |
| `style:property={value}` | Set one style property. |
| `attach={fn}` | Run a node-lifetime attachment against the element. |
| `{...spread}` | Spread an object's keys — props on a component, attributes on an element. |

### Control flow

Mustache `{#…}` blocks, not `<template>`. The rendered blocks are
`if`/`for`/`await`/`switch`/`try`; `snippet` is a declaration block.

| Block | Form |
|---|---|
| `{#if}` / `{:else if}` / `{:else}` / `{/if}` | Conditional chain (`{:else if}` has a space). |
| `{#for item, i of list by key}` / `{/for}` | Keyed list; `{#for await x of source}` iterates an AsyncIterable. |
| `{#await p}` / `{:then v}` / `{:catch e}` / `{:finally}` / `{/await}` | The explicit async opt-in (pending branch + `{:then}` narrowing). |
| `{#switch}` / `{:case}` / `{:default}` / `{/switch}` | Value switch. |
| `{#try}` / `{:catch}` / `{:finally}` / `{/try}` | Render error boundary. |
| `{#snippet name(args)}…{/snippet}` | Reusable builder; called `{name(args)}`. |

Async reads have no ceremony: the **bare call in an interpolation**
(`{getMessages({ limit })}`) is the documented default — a peek that reads
`undefined` while pending (auto-streaming on SSR), composing with `?? fallback`,
`?.`, `{#if}`, and attributes; pair it with `.pending(...)` / `.error(...)`
probes. `{await fn()}` is an inline read that blocks SSR until the value is in the
HTML. `{#await}` is the opt-in for branch structure and `{:then}` narrowing — not
the default.

Components are capitalised tags; the content nested in a component renders where
it calls `{children()}` (`{#if children}{children()}{:else}…{/if}` is the
fallback — no `<slot>` element, no named slots). The `<slot>` element, the
`<template name>` snippet form, and `<template if>`/`<template each>`/… control
flow were **removed** — a bare `<template>` is now an inert element, and using a
removed form throws a migration error.

## Server surface — abide/server/*

### RPC helpers — @documentation rpc

- `abide/server/GET` — read helper; `export const x = GET(fn, opts?)`. Adds
  `cache`/`stream` opts. Read-only, so a typed input auto-exposes it to MCP + CLI.
- `abide/server/HEAD` — read helper, same shape as `GET` (headers only, no body).
- `abide/server/POST` — mutating helper; `RpcSharedOpts` only (`cache`/`stream`
  are a compile error). Never auto-exposes to MCP.
- `abide/server/PUT` — mutating helper (idempotent replace); as `POST`.
- `abide/server/PATCH` — mutating helper (partial update); as `POST`.
- `abide/server/DELETE` — mutating helper (removal); as `POST`.

### Response helpers — @documentation response

- `abide/server/json` — `json<T>(data, init?)` → `TypedResponse<T>`; default
  `no-store`, honest-JSON encodes Set/Map/bigint/Date (ADR-0029); `undefined` body
  → 204.
- `abide/server/jsonl` — `jsonl<Frame>(iterable, init?)`; JSON Lines stream
  (`application/jsonl`), cancellation calls `iter.return()`, a generator error
  emits a final `{"$error":…}` line.
- `abide/server/sse` — `sse<Frame>(iterable, init?)`; `text/event-stream` with a
  15 s keepalive comment; an error emits an `event: error` frame.
- `abide/server/error` — `error(status, message?, init?)` → `TypedResponse<never>`
  (positional status wins). `error.typed(name, status, schema?)` returns a typed
  error constructor driving `rpc.isError`; `schema` types `.data`, never validates.
- `abide/server/redirect` — `redirect(url, status = 302, init?)`; accepts relative
  URLs, sets `Location` + `no-store`.

### Request scope — @documentation request-scope

- `abide/server/request` — `request(): Request`; the inbound request from the ALS
  scope, throws outside one.
- `abide/server/cookies` — `cookies(): Bun.CookieMap`; live read + `.set` / `.delete`,
  flushed as `Set-Cookie` on return.
- `abide/server/server` — `server(): Server`; the active `Bun.serve`, an in-process
  no-op server under CLI/MCP/test, else throws.

### Server rendering — @documentation render

- `abide/server/render` — `render(path, params?, query?)`: SSR a page route to an
  HTML string from within a request scope; args mirror `url()`/`navigate`.

### Sockets — @documentation sockets

- `abide/server/socket` — `socket<T>(opts?)`: declare one broadcast topic per file
  under `src/server/sockets/`. Returns `Socket<T>` (isomorphic `AsyncIterable<T>`).

### Configuration — @documentation configuration

- `abide/server/env` — `env(schema)`: validate `Bun.env` against a Standard Schema
  at module top-level, returning typed config; fails boot loudly, sync-only.

### App hooks & inspector — @documentation plumbing

- `abide/server/AppModule` — `type AppModule`: the optional hooks exported from
  `src/app.ts` (`init`/`handle`/`handleError`/`health`/`forwardHeaders`).
- `abide/server/InspectorContext` — `type InspectorContext`: the capabilities core
  injects into `@abide/inspector` when `ABIDE_ENABLE_INSPECTOR=true`.

### RPC / socket registrars — @documentation plumbing

- `abide/server/rpc/defineRpc` — `defineRpc(method, url, handler, opts?)`: the real
  server-side RPC builder the bundler emits; runs validation → 422, timeout → 504,
  and registers the registry entry.
- `abide/server/sockets/defineSocket` — `defineSocket<T>(name, opts?)`: the server
  runtime `socket()` binds to; retention defaults to `tail ?? 1`, `ttl` evicts
  lazily, schema validates synchronously on publish.

## Isomorphic surface — abide/shared/*

### RPC schema helper — @documentation rpc

- `abide/shared/withJsonSchema` — `withJsonSchema(schema, toJsonSchema)`: attach a
  `toJSONSchema()` projection to a Standard Schema whose library lacks one; feeds
  OpenAPI / MCP / CLI.

### Response errors — @documentation response

- `abide/shared/HttpError` — `class HttpError extends Error`; thrown by remote
  calls on non-2xx. Carries `status`, `statusText`, `response`, optional `kind`
  (declared error name or `'validation'`) and `data`.
- `abide/shared/ValidationErrorData` — `type ValidationErrorData`: the
  `HttpError.data` shape when `kind === 'validation'` (422) — `{ issues, fields }`,
  `fields` mapping top-level field → first message.

### Cache — @documentation cache

Isomorphic per ADR-0041: local on the client, broadcast to every connected client
from the server.

- `abide/shared/invalidate` — `invalidate(selector?, args?)`: the drop verb — drop
  matching cached reads so the next read reloads lazily. Selector grammar:
  `(fn, args)` / `(fn)` / `({ tags })` / `()`.
- `abide/shared/patch` — `patch(fn, args?, updater)` / `patch({ tags }, updater)`:
  mutate the retained value of matching reads in place, reactive, no network (the
  optimistic-update / socket-frame primitive).
- `abide/shared/refresh` — `refresh(selector?, args?)`: refetch matching reads now,
  keeping the stale value visible (`refreshing()` true) until the fresh one swaps in.

### Probes — @documentation probes

Reactive, report-never-act — reading opens no fetch/stream.

- `abide/shared/pending` — `pending(selector?/subscribable?, args?): boolean` — "no
  value yet"; `()` = anything in flight.
- `abide/shared/peek` — `peek(fn, args?)` / `peek(socket)` / `peek(cell)`: the
  retained value synchronously, no trigger; null-tolerant.
- `abide/shared/refreshing` — `refreshing(selector?, args?): boolean` — holding a
  prior value while a fresher source is in flight (distinct from `pending`).
- `abide/shared/done` — `done(subscribable): boolean` — stream-only, true once the
  source has closed.
- `abide/shared/online` — `online(): boolean` — reactive connectivity; browser
  reads `navigator.onLine`, server reflects the calling client's reported state.

### Observability — @documentation observability

- `abide/shared/health` — `health(): HealthState` — reactive backend-health read;
  polls `/__abide/health` only while a tracking scope reads it. Also exports
  `AppHealth` / `AppHealthMap` / `HealthState` types.
- `abide/shared/log` — `log: Log`, callable (`log(message, data?)` is the info-level
  speaker) with members `log.warn` / `log.error` / `log.trace(name, work)` /
  `log.channel(name)` (DEBUG-gated); records carry request-scope context, tsv or
  JSON under `ABIDE_LOG_FORMAT=json`. (No `log.info` — the base call is info.)
- `abide/shared/reachable` — `reachable(host?): Promise<boolean>`: isomorphic
  outbound reachability, HEADs the origin, caches per TTL; no host = the app's own
  backend (constant `true` on server).
- `abide/shared/trace` — `trace(): string | undefined`: the current request's W3C
  `traceparent` (server from the ALS scope, browser from `__SSR__`).

### Page & URL — @documentation page / url

- `abide/shared/page` — `page: PageSnapshot`: reactive proxy with `route` /
  `params` / `url` / `navigating` for the active page; reading a field in a tracked
  scope re-runs on navigation. (`@documentation page`)
- `abide/shared/url` — `url(path, ...args): string`: resolve any in-app URL to its
  base-correct form (RPC → query, page route → typed params, asset → bare path);
  throws on a missing required param. Also exports `RpcRoutes` / `PageRoutes` /
  `PublicAssets` / `PathParams`. (`@documentation url`)

### Templating — @documentation templating

- `abide/shared/snippet` — `snippet<Payload>(payload): SnippetValue`: brand a
  payload so a `{expr}` interpolation mounts it instead of escaping (client builder
  / server string). Also exports `snippetPayload` and the `Snippet` / `SnippetValue`
  types. (The `html` primitive lives under the UI surface.)

### Subscriber — @documentation plumbing

- `abide/shared/createSubscriber` — `createSubscriber(start)`: an
  open-on-first-read / close-on-last-reader primitive over abide's signal core, for
  building custom reactive sources.

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `abide/ui/state` — the `state(v, transform?)` writable cell plus members
  `state.computed` (read-only derived), `state.linked` (writable, reseeded from a
  thunk), and the context seam `state.share` / `state.shared`.
- `abide/ui/watch` — the single reaction primitive `watch(source, handler)` (and
  bare `watch(thunk)` auto-tracked effect); unifies effect / socket.on / cache.on /
  rpc-selector; client-only, returns a scope-tied disposer.
- `abide/ui/props` — `props()` prop reader; compiler-lowered inside a `.abide`
  component, throws if called directly.

### Templating — @documentation templating

- `abide/ui/html` — `html` marks a string as trusted raw HTML (`html(str)` or
  tagged `` html`…` ``) so a `{expr}` inserts nodes unescaped; nullish → empty.

### Navigation — @documentation navigate

- `abide/ui/navigate` — `navigate(path, params?, options?)`: typed client
  navigation through `url()`, writing history + the reactive route
  (`replace`/`keepScroll`). Also exports `navigatePath` and `NavigateOptions`.

### Effect — @documentation plumbing

- `abide/ui/effect` — the internal effect primitive the compiler emits (runs now,
  re-runs on change, supports teardown/async); authors use `watch`.

### Client entry, router & proxies — @documentation plumbing

- `abide/ui/startClient` — the official client entry: reads `window.__SSR__`, seeds
  cache/cell/doc state, installs slots, starts the router; returns a disposer.
- `abide/ui/router` — the History-API router: matches the path, imports page +
  layout chunks, mounts them as an outlet chain, diffs on navigation, restores scroll.
- `abide/ui/renderToStream` — server async generator for out-of-order SSR streaming:
  yields the shell, then one `<abide-resolve>` fragment per streaming await block.
- `abide/ui/remoteProxy` — the client-side RPC substitute: a `RemoteFunction` that
  fetches over the network (input pre-flight validation, timeout/abort merge, output
  decode). Also exports `RemoteProxyOptions`.
- `abide/ui/socketProxy` — the client-side `Socket` substitute over the multiplexed
  ws channel (iterate / `.tail` / `.publish` / real `.watch`).

### Scope & render-pass plumbing — @documentation plumbing

- `abide/ui/currentScope` — resolve the current lexical reactive scope (mints a
  detached root outside any scope).
- `abide/ui/enterRenderScope` — establish a fresh per-render SSR scope, returning the
  previous to restore.
- `abide/ui/exitRenderScope` — restore the scope `enterRenderScope` saved.
- `abide/ui/settleAsyncCells` — SSR await-barrier draining the request-scoped
  pending-cell list; no-op on client.
- `abide/ui/flight` — start a hoisted SSR flight from a thunk with a synchronous
  `settled`/`value`/`error` snapshot so flights overlap. Also exports `FlightPromise`.
- `abide/ui/isolateCellBarrier` — run a hoisted child render under its own async-cell
  barrier list; inert passthrough on client.
- `abide/ui/finalizeStreamedChildren` — the ADR-0039 when-to-stream decision after a
  body walk (inline a settled flight, rethrow a rejected one, or stream). Also
  exports `StagedChild`.
- `abide/ui/runtime/withPath` — push one escaped render-path segment for a
  synchronous `build`, restoring after.
- `abide/ui/runtime/renderPath` — compose a child's ordinal segment onto the ambient
  path, returning the render-path string (the streamed-child boundary id).
- `abide/ui/runtime/escapeKey` — escape one path key to an RFC-6901 JSON-Pointer token.
- `abide/ui/runtime/nextBlockId` — allocate the next await/try block id in the current
  render pass, namespaced by the ambient path.
- `abide/ui/runtime/blockId` — allocate a render-path-namespaced block id
  (`${path}:${n}`) from a counters map.
- `abide/ui/runtime/enterRenderPass` — mark entry into a render/mount, clearing the
  per-path block-id counters at the outermost depth.
- `abide/ui/runtime/exitRenderPass` — mark exit from a render/mount, unwinding the depth.

### DOM runtime helpers — @documentation plumbing

Compiler-emitted; an author never imports these directly.

- `abide/ui/dom/mount` — mount a top-level page/layout into a host under an ownership
  scope + render pass; returns a disposer.
- `abide/ui/dom/mountChild` — mount a child component as a marker-bounded range (no
  wrapper), filing its dispose with the owner.
- `abide/ui/dom/mountStreamedChild` — dual-mode adopter for a hoistable child: adopt an
  inlined range, claim a streamed boundary, or create-mount fresh.
- `abide/ui/dom/mountSlot` — mount a component's slot content as a marker-bounded range
  (create fills, hydrate adopts); runs once.
- `abide/ui/dom/mergeProps` — compose a child's props from ordered layers (runs,
  spreads, slot) into one last-layer-wins Proxy bag.
- `abide/ui/dom/spreadProps` — wrap a `{...source}` spread as a live Proxy of value
  thunks (keys/membership re-evaluated live; `children` hidden).
- `abide/ui/dom/restProps` — live Proxy of the unconsumed props for `{ ...rest }`,
  excluding destructured keys and `children`.
- `abide/ui/dom/bindProp` — the parent half of a component `bind:prop`: annotate the
  value thunk with a `.set` write-back channel.
- `abide/ui/dom/bindableProp` — the child half of a two-way prop: pass-through when the
  parent bound it, else a local reseeding `linked` cell.
- `abide/ui/dom/spreadAttrs` — spread a thunk's keys onto a native element (`on*` →
  listeners, others → reactive attributes); `exclude` skips explicit attrs.
- `abide/ui/dom/readCall` — guarded non-optional method call on a reactive-document
  read, with legible authored-scope errors.
- `abide/ui/dom/readCell` — unified read of a `computed`/`linked`/derive reference
  (async → throwing peek, function → call, sync → `.value`).
- `abide/ui/dom/writeCell` — unified write of a `linked` reference from an author
  assignment (async → `.set`, sync → `.value =`).
- `abide/ui/dom/cellPending` — whether a control-flow subject is a still-loading async
  cell, so a block renders no branch while loading.
- `abide/ui/dom/mutateDocContainer` — apply an in-place container mutation
  (`splice`/`sort`/`add`/…) on a reactive-document value by clone-mutate-`replace`.
- `abide/ui/dom/hydrate` — adopt existing server-rendered DOM in place with a claim
  cursor active (no re-render); returns a disposer.
- `abide/ui/dom/appendText` — a reactive `{expr}` interpolation: escaped text,
  `html`-branded raw, or a snippet call; create-appends or claims the SSR text node.
- `abide/ui/dom/appendTextAt` — a reactive `{expr}` mounted just after a skeleton
  anchor comment (text interleaved with element siblings).
- `abide/ui/dom/appendSnippet` — mount a `{snippet(args)}` builder in a marker-bounded
  range, reactive in its args.
- `abide/ui/dom/appendStatic` — a static (non-reactive) text node; create-appends or
  claims the merged SSR text node.
- `abide/ui/dom/cloneStatic` — append a fully-static binding-free subtree by cloning a
  cached template (create) / advancing the claim cursor (hydrate).
- `abide/ui/dom/skeleton` — realize a compiled skeleton (static subtree with located
  holes) and return its element + anchor holes.
- `abide/ui/dom/anchorCursor` — position a skeleton-anchored block/slot: the create
  insertion reference after the anchor and the hydrate claim cursor.
- `abide/ui/dom/outlet` — a layout outlet: insert/claim an empty `abide:outlet` comment
  boundary; returns `{ open, close }`.
- `abide/ui/dom/attr` — bind an element attribute to `read()` via one effect
  (boolean-present/absent + stringify semantics).
- `abide/ui/dom/on` — attach an event listener (`onclick={…}` target), scope-pinned and
  batched, removal registered on the owner.
- `abide/ui/dom/attach` — run an `attach={…}` attachment against an element at build
  time and register its teardown (the dual of `on`).
- `abide/ui/dom/bindSelectValue` — two-way `bind:value` for `<select>` (effect drives
  selection re-applied via MutationObserver; `change` writes back; `multiple` → array).
- `abide/ui/dom/each` — keyed list runtime (`{#for … by key}`): each row a
  marker-bounded range, reconciled by key with minimal DOM moves.
- `abide/ui/dom/eachAsync` — async keyed list runtime (`{#for await … of …}`):
  append/reconcile as the iterator yields; mid-stream rejection routes to the catch.
- `abide/ui/dom/when` — conditional runtime (`{#if}`/`{:else}`): a swappable range
  tracking `condition()`, with an optional pending state for a bare async subject.
- `abide/ui/dom/awaitBlock` — `{#await}` runtime: render pending then swap to
  resolved/error; reactive re-runs on cache invalidation; hydration resumes or rebuilds.
- `abide/ui/dom/tryBlock` — `{#try}` reactive error-boundary runtime: catch build /
  read / re-run throws, swap to the catch branch, re-arm on recovery.
- `abide/ui/dom/switchBlock` — `{#switch}` / `{:else if}` runtime: a swappable range
  selecting the first matching (`===`) case (or default), with per-case async gating.

## Build / tooling

### Building — @documentation building

- `abide/build` — `build({ cwd, … })`: build the client bundle into `dist/_app`
  (optional gzip/Tailwind), and write `src/.abide/*.d.ts`.
- `abide/compile` — `compile({ cwd, target?, outfile? })`: build the client then a
  standalone Bun server executable; returns the binary path.

### Plumbing — @documentation plumbing

- `abide/preload` — the Bun preload registering `abideUiPlugin` +
  `abideResolverPlugin` + a css-noop loader; `ABIDE_TARGET` selects server/client mode.
- `abide/resolver-plugin` — `abideResolverPlugin({ cwd, embedAssets, target })`: the
  BunPlugin wiring the `abide:*` virtuals and rewriting rpc/socket/prompt modules.
- `abide/ui-plugin` — `abideUiPlugin`: the BunPlugin that loads `.abide` components
  (compiles to an ES module; a `layout.abide` lowers its outlet to the router).
- `abide/tsconfig` — the consumer-extendable `tsconfig.app.json`.

## Desktop bundle

### Desktop bundle — @documentation bundle

- `abide/bundle/BundleWindow` — `type BundleWindow`: the default-export window config
  (title/size/menu) from `src/bundle/window.ts`, baked into the launcher.
- `abide/bundle/BundleMenu` — `type BundleMenu`: a `{ label, items }` top-level menu
  inserted between the Edit and Window menus.
- `abide/bundle/BundleMenuItem` — `type BundleMenuItem`: a divider or clickable item
  (`emit` dispatches an `abide:menu` event, `navigate` repoints the window, `shortcut`
  = Cmd-key).
- `abide/bundle/onMenu` — `onMenu(handler)` / `onMenu(name, handler)`: subscribe to
  `abide:menu` clicks, returns unsubscribe; inert in SSR / a plain browser tab.
- `abide/bundle/bundled` — `bundled(): boolean`: true when running inside the abide
  desktop bundle (isomorphic).
- `abide/server/appDataDir` — `appDataDir()`: the running bundle's per-user data dir
  keyed by program name (pure, cwd-independent). (`@documentation bundle`)

## MCP

### MCP server — @documentation mcp

- `abide/mcp/createMcpServer` — `createMcpServer(opts?)`: construct the framework MCP
  server bound to the RPC registry; `handle(request)` is what `/__abide/mcp` invokes.
  Tools come from rpcs/sockets with `clients.mcp: true`; optional `authorize`.

### Agent — @documentation agent

- `abide/server/agent` — `agent(engine, messages)`: run a model engine against the
  app's own MCP surface, returning the neutral `AgentFrame` stream (no transport — wrap
  in `jsonl()` / `sse()`).

### Prompts — @documentation plumbing

- `abide/server/prompts/definePrompt` — `definePrompt(name, opts)`: build + register a
  `Prompt`; called by the resolver-generated module for each `src/mcp/prompts/*.md`.
- `abide/server/prompts/renderPromptTemplate` — `renderPromptTemplate(template, args)`:
  substitute `{{name}}` placeholders (missing → empty string).

## Testing

### Testing — @documentation testing

- `abide/test/createTestApp` — the augmentable typed test app exposing
  `app.rpc.<rpc>` / `app.sockets.<name>` (types arrive from `src/.abide/` after a build).

### Plumbing — @documentation plumbing

- `abide/test/createScriptedSurface` — `createScriptedSurface(...)`: a scripted
  `AgentSurface` with declarative tool stubs for engine tests; records every `call`.
- `abide/test/assertAgentFrameConformance` — `assertAgentFrameConformance(...)`: assert
  the neutral `AgentFrame` contract (single terminal `done`, matched
  `tool_use`/`tool_result`, string deltas).

## Generated machine surfaces

Runtime routes served by the framework:

| Route | Serves |
|---|---|
| `/openapi.json` | The generated OpenAPI document. |
| `/__abide/mcp` | The generated MCP server endpoint (`createMcpServer().handle`). |
| `/__abide/sockets` | The sockets hub (ws multiplex); `/__abide/sockets/<name>` is the per-socket HTTP/SSE face (GET tail, POST publish). |
| `/__abide/health` | Health JSON, aggregating the app's optional `health(request)` hook. |
| `/__abide/identity` | Server identity (name / version). |
| `/__abide/cli` | CLI binary download; `/__abide/cli/<platform>` streams the thin cli + server. |
| `/__abide/inspector` | Inspector surface, mounted only when `ABIDE_ENABLE_INSPECTOR=true`. |

## Environment variables

| Var | Effect |
|---|---|
| `PORT` | Server listen port. |
| `APP_URL` | Derives the server's mount base path / public URL. |
| `ABIDE_APP_DIR` | Overrides the client-asset dir (default `dist/_app`). |
| `ABIDE_APP_URL` | Default remote server URL the CLI targets when no saved connection. |
| `ABIDE_APP_TOKEN` | Bearer token the CLI sends to the target server. |
| `ABIDE_DATA_DIR` | Overrides the app's per-user data dir. |
| `ABIDE_CLIENT_TIMEOUT` | Client transport timeout in ms (bounded 1–600000). |
| `ABIDE_IDLE_TIMEOUT` | Server socket idle timeout in seconds (default 10). |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Caps the max request body size. |
| `ABIDE_LOG_FORMAT` | `json` emits structured JSON log records (else tsv). |
| `ABIDE_DEV_SURFACE` | `1` enables request logging even under dev. |
| `ABIDE_ENABLE_INSPECTOR` | `true` mounts the inspector at `/__abide/inspector`. |
| `ABIDE_INSPECT` | Truthy opens the bundle webview with devtools enabled. |
| `DEBUG` | Enables debug logging; the value is the namespace filter (supports negation). |

---

This map mirrors `package.json`'s `exports`. After adding, renaming, or removing an
export, run `bun run packages/abide/scripts/readmeSurfaces.ts` and update this file.
