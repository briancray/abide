# AGENTS.md — abide complete surface map

> This file is the exhaustive map of abide's public surface: every `exports`
> key, grouped by namespace, with its import specifier and a one-line spec, plus
> the CLI, generated routes, env vars, and the `.abide` grammar. The README is
> the opposite — a curated intro to the three foundational primitives (RPCs,
> sockets, components). CONTEXT.md is the domain glossary; `docs/adr/` holds the
> rationale.
>
> **No barrels.** Every public name has its own module path — there is no
> umbrella `index.ts`, so importing one name never drags in side-effecting
> siblings. The namespace marks the side a name runs on: `abide/server/*` is
> server-only, `abide/ui/*` is client-only, `abide/shared/*` is isomorphic (same
> callable, same intent on both sides — usually identical behaviour, e.g.
> `HttpError`; sometimes a side-swapped runtime behind one intent, e.g.
> `invalidate`, `refresh`, `amend`).
>
> Package `@abide/abide`, one runtime (Bun ≥ 1.3.0), one direct dependency
> (TypeScript). Below, a leading `@abide/abide/...` is the **import specifier**
> (an `exports` key); a `src/...` path is a **file-based convention** the bundler
> reads.

## The premise

One typed RPC declaration fans out to every surface:

```text
                        getMessages  (src/server/rpc/getMessages.ts)
                              │
   ┌──────────────┬──────────┼───────────────┬───────────────────┐
   ▼              ▼          ▼               ▼                   ▼
 SSR call     browser      MCP tool        CLI               OpenAPI op
 (in-proc)    fetch        get_messages    app get-messages   GET /rpc/
 smart read   typed proxy  (read → auto)   --limit 20         getMessages
```

A **typed input** unlocks the CLI, and for a read-only method (GET/HEAD) the MCP
tool: the handler's input-parameter type is projected to JSON Schema at build
(ADR-0030), so a plainly-typed handler auto-exposes with no hand-written
`schemas.input`. A declared `schemas.input` (a Standard Schema) adds runtime
validation on top; it is not what flips the surfaces on. A mutating method
(POST/PUT/PATCH/DELETE) never auto-exposes to MCP — it needs explicit
`clients: { mcp: true }`.

## File-based conventions

The bundler reads these paths by convention (resolved by `abideResolverPlugin`):

| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | One RPC per file; the path is the URL (`/rpc/<name>`), the export name matches the file stem. |
| `src/server/sockets/<name>.ts` | One `socket(...)` per file; the socket name is the file stem, loaded lazily on first sub/pub frame. |
| `src/mcp/prompts/<name>.md` | A Markdown MCP prompt; `{{placeholder}}` args are substituted at render. |
| `src/mcp/resources/<name>` | A static MCP resource, gzip-embedded into the build. |
| `src/server/config.ts` | Boot-time `env(...)` schema, eager-imported so env validation runs at startup. |
| `src/app.ts` | Optional app hooks (`init`, `handle`, `handleError`, `health`, `forwardHeaders`) — the `AppModule` shape. |
| `src/ui/pages/**/page.abide` | A page route; `[name]` path segments become `page.params`. |
| `src/ui/pages/**/layout.abide` | A layout that wraps nested pages via the router outlet; persists across same-chain navigation. |
| `src/ui/public/` | Static assets, gzip-embedded and served from the app root. |
| `src/bundle/window.ts` | Optional desktop-bundle window config (default export, the `BundleWindow` shape). |
| `src/.abide/*.d.ts` | Generated editor/type artifacts (rpc route maps, prop shapes) written by `build`. |
| `dist/` | Build output; `dist/_app` is the server-loaded app dir (override with `ABIDE_APP_DIR`). |

## CLI

Every `abide <command>` (the `abide` bin):

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | Scaffold a project from the bundled template, install deps, and (on a TTY) start dev. `--no-install` / `--no-dev` opt out. |
| `abide dev` | Dev orchestrator: build the client, spawn the server, watch `src/`, rebuild + restart with browser live-reload. |
| `abide build` | One client build into `dist/_app/`, no server (CI / static deploys). |
| `abide start` | Run the production server against an already-built `dist/`. |
| `abide run <file> [args...]` | Run a script under the abide preload (same runtime as the server); argv after the file is forwarded. |
| `abide compile [--target] [--out]` | Build a standalone server executable (client assets embedded) for a platform. |
| `abide cli [--target] [--out] [--platforms]` | Build the thin remote-client CLI binary; `--platforms` cross-compiles per platform. |
| `abide bundle` | Assemble a self-contained (unsigned) desktop app bundle for the host platform. |
| `abide check` | Type-check every `.abide` component's template + props through its shadow program. |
| `abide lsp` | Run the `.abide` language server over stdio (JSON-RPC) for editor diagnostics. |
| `abide init-agent` | Write/refresh a `CLAUDE.md` pointer to this surface map for a non-scaffolded project. |

For tests, don't use `abide run` — add `preload = ["@abide/abide/preload"]` under
`[test]` in `bunfig.toml` and use `bun test`, so tests run in the server runtime.

## Authoring contracts

- **RPC** (`src/server/rpc/<name>.ts`). Declare one `export const <name> =
  GET|POST|PUT|PATCH|DELETE|HEAD(handler, opts?)`. The handler receives the typed
  input (`InferOutput<schemas.input>` when a schema is declared, else its own
  parameter type), reads request context via `request()` / `cookies()` /
  `server()`, and returns `json` / `jsonl` / `sse` / `error` / `redirect` / a raw
  `Response`. `opts` is `{ schemas: { input?, output?, files? }, clients: {
  browser?, mcp?, cli? }, crossOrigin?, maxBodySize?, timeout?, cache? }` — plus
  `stream?` on the read helpers only (a write has no replayable stream). There is
  no flat `inputSchema`/`filesSchema` and no `outbox`. Query / path / form args
  auto-coerce from the endpoint's typed shape (ADR-0028) — no `z.coerce`.
- **Consuming an RPC.** The bare call `fn(args)` is the smart read — cached,
  coalesced, reactive, in-process during SSR (its value is baked into the HTML
  for warm hydration) and swapped to `fetch` in the browser (there is no
  `cache()` wrapper). Also: `fn.raw(args, init?)` → the raw `Response`;
  `fn.refresh` / `fn.invalidate` / `fn.amend` / `fn.peek` / `fn.pending` /
  `fn.refreshing` / `fn.error` / `fn.watch`; a `jsonl`/`sse` handler makes the
  bare call return a `Subscribable`. Typed errors come from returning an
  `error.typed(name, status, schema?)` branch and narrow via `fn.isError`.
- **Socket** (`src/server/sockets/<name>.ts`). `export const <name> =
  socket<T>(opts?)` — a `Socket<T>` (isomorphic `AsyncIterable<T>`). Opts (server
  only): `tail` (retain the last N frames), `ttl` (evict retained frames older
  than N ms), `clientPublish` (allow client publishes), `schema` (validate
  payloads + type `T`), `clients` (expose to mcp/cli). HTTP face at
  `/__abide/sockets/<name>`; all sockets multiplex onto one ws.
- **Page / layout** (`.abide`). A `[id]` path segment lands in `page.params.id`;
  a layout renders its nested route at the router outlet. Read the active route
  via `page` (`page.url`, `page.params`, `page.navigating`), move with `navigate`
  and build hrefs with `url`.
- **`app.ts` / `config.ts`.** `app.ts` default-exports the `AppModule` hooks;
  `config.ts` runs `env(schema)` at module top level so boot fails fast on bad
  env.

## .abide template grammar

A `.abide` component is a leading `<script>` (module imports + setup), then
HTML-with-mustaches, then optional `<style>`. The reactive primitives are
imported by their own module paths and resolved by import binding (alias-safe):
`state` (`abide/ui/state`, with `.computed` / `.linked`), `watch`
(`abide/ui/watch`), `html` (`abide/ui/html`), `snippet` (`abide/shared/snippet`).
The one ambient reader is `props()` (`abide/ui/props`) — a required import, not
`scope()` (which is internal plumbing now, never authored). In `.abide` source a
`state` cell is read and reassigned as a **plain variable** (`count`,
`count += 1`); the compiler desugars that to the cell — `.value` is not the
authoring surface.

**Reactive state**

| Form | Meaning |
| --- | --- |
| `let x = state(v, transform?)` | Writable cell; `transform` gates every write. Read/assign as a plain variable. |
| `state.computed(() => …)` | Read-only derived cell (lazy, never serialized). |
| `state.linked(() => src, transform?)` | Writable cell reseeded when the thunk's deps change. |
| `watch(source, handler)` | The single reaction primitive (client-only) over a cell, a cell array, a socket/stream, or an rpc; bare `watch(thunk)` is an auto-tracked effect. |
| `const { name = fallback, ...rest } = props()` | The prop reader (ambient; required import). |

**Bindings / directives**

| Form | Meaning |
| --- | --- |
| `{expr}` | Reactive text interpolation (escaped). |
| `{html(...)}` / `{html\`…\`}` | Insert trusted raw HTML unescaped. |
| `name={expr}` | Reactive attribute (present/absent for booleans). |
| `on<event>={fn}` | Event listener (`onclick={fn}`). |
| `bind:value` / `bind:checked` / `bind:group` | Two-way form binds. |
| `bind:value={{ get, set }}` | Derived two-way bind. |
| `class:name={cond}` | Toggle a class. |
| `style:property={value}` | Set one style property. |
| `attach={fn}` | Run `fn(node)` on mount; its return is the teardown. |
| `{...expr}` | Spread an object's keys as props (component) or attributes (element). |

**Control flow** — mustache blocks, not `<template>`:

| Block | Branches |
| --- | --- |
| `{#if}` … `{/if}` | `{:else if cond}`, `{:else}` |
| `{#for item, i of list by key}` … `{/for}` | `{#for await item of source}` over an `AsyncIterable`; `{:catch e}` on the async form |
| `{#await p}` … `{/await}` | `{:then v}`, `{:catch e}`, `{:finally}` |
| `{#switch subj}` … `{/switch}` | `{:case value}`, `{:default}` |
| `{#try}` … `{/try}` | `{:catch e}`, `{:finally}` |
| `{#snippet name(args)}` … `{/snippet}` | A reusable builder, called `{name(args)}` |

Async reads have no ceremony: the bare call `{fn(args)}` is the documented way —
a peek reading `undefined` while pending (auto-streams on SSR), composing with
`?.` / `??` / `{#if}` / attributes, paired with the `.pending()` / `.error()`
probes. `{await fn()}` inline blocks SSR until the value is in the HTML;
`{#await}` is the explicit opt-in for a distinct pending branch, a local
`{:catch}`, or `{:then}` narrowing.

Components are capitalised tags; the content nested in them renders where the
component calls `{children()}` — the single slot (the `<slot>` element was
removed; `{#if children}{children()}{:else}…{/if}` is the fallback form, no named
slots). Snippets are a `{#…}` block, not `<template>`: the `<template name>`
snippet form and all `<template if>`/`<template each>`/… control flow were
removed (a bare `<template>` is now an inert element; a removed form throws a
migration error).

`<script>` and `<style>` are **not** component-root-only. Either may sit inside a
control-flow branch, scoped to that branch's lexical scope: a nested `<script>`
declares branch-local `state` / `state.computed` / `state.linked` (re-seeded per
mount, no module imports — it reuses the leading script's imports), and a nested
`<style>` scopes to its sibling subtree. So a *root* `<style>` is
component-scoped; a nested one is branch-scoped.

## Server surface — abide/server/*

### RPC — @documentation rpc

- `@abide/abide/server/GET` — read-only RPC helper `GET(fn, opts?)`; infers args from the handler parameter and Return/Errors from its `TypedResponse`/`error.typed` returns; opts `{ schemas, clients, crossOrigin, maxBodySize, timeout, cache, stream }`. Bundler-rewritten; throws if called unprocessed.
- `@abide/abide/server/HEAD` — read-only RPC helper, identical to `GET`.
- `@abide/abide/server/POST` — mutating RPC helper; same inference as `GET` but opts omit `stream` (writes aren't replayable), still accept `cache` (a no-ttl write coalesces only).
- `@abide/abide/server/PUT` — mutating RPC helper, identical to `POST`.
- `@abide/abide/server/PATCH` — mutating RPC helper, identical to `POST`.
- `@abide/abide/server/DELETE` — mutating RPC helper, identical to `POST`.
- `@abide/abide/shared/withJsonSchema` — attaches a `toJSONSchema()` projection to a Standard Schema lacking a native one, feeding OpenAPI / MCP / CLI / bundle-form generation; mutates and returns the same schema. (Isomorphic — lives in `shared/`.)

### Response — @documentation response

- `@abide/abide/server/json` — `json(data, init?)` → `TypedResponse<T>` with honest-JSON wire encoding (Set/Map/bigint) and default `Cache-Control: no-store`; caller `content-type` / `cache-control` override.
- `@abide/abide/server/jsonl` — `jsonl(iterable, init?)` streams an `AsyncIterable<Frame>` as `application/jsonl` (one JSON line/frame); consumer cancel flows to `iter.return()`, a throw emits a final `{"$error":…}` line.
- `@abide/abide/server/sse` — `sse(iterable, init?)` streams frames as `text/event-stream` (`data: <json>\n\n`) with a 15s keepalive comment; a throw emits an `event: error` frame carrying only the message.
- `@abide/abide/server/error` — `error(status, message?, init?)` → a `text/plain` `TypedResponse<never>` (message defaults to the status reason phrase, positional status wins); member `error.typed(name, status, schema?)` returns a constructor for a named typed error (`{$abideError,data}`) that `fn.isError(e, name)` narrows.
- `@abide/abide/server/redirect` — `redirect(url, status=302, init?)` → a `TypedResponse<never>` redirect accepting relative URLs, status restricted to 301/302/303/307/308, positional status wins over `init.status`.
- `@abide/abide/shared/HttpError` — error thrown by remote-function calls on non-2xx, carrying `status`, `statusText`, the raw `response`, and optional `kind`/`data` for typed / validation (422) errors. (Isomorphic.)
- `@abide/abide/shared/ValidationErrorData` — type of the `data` on a `kind: 'validation'` (422) `HttpError`: `{ issues, fields }` (raw Standard Schema issues plus a field→first-message map). (Isomorphic.)

### Sockets — @documentation sockets

- `@abide/abide/server/socket` — declares one named `Socket<T>` per `src/server/sockets/` file (`socket<T>(opts?)` or a `{ schema }` overload inferring `T`); server-only opts `tail`/`ttl`/`clientPublish`/`schema`/`clients`. Throws if called outside a sockets module.

### Request scope — @documentation request-scope

- `@abide/abide/server/request` — `request()` returns the inbound `Request` for the current SSR/RPC pass (AsyncLocalStorage); throws outside a request scope.
- `@abide/abide/server/cookies` — `cookies()` returns the request's lazily-materialized `Bun.CookieMap` jar (reads parse inbound Cookie; `set`/`delete` flush as `Set-Cookie` on return); throws outside a request scope.
- `@abide/abide/server/server` — `server()` returns the active `Bun.serve` instance (or a no-op in-process server for in-scope dispatch without a booted server); throws before init outside any request scope.

### Render — @documentation render

- `@abide/abide/server/render` — `render(path, params?, query?)` renders a page route to its HTML string in a fresh nested request scope; inline / blocking-await pages return complete HTML, streaming `{#await}` pages return the shell plus `<abide-resolve>` fragments. For a no-JS surface (email) use blocking awaits.

### Configuration — @documentation configuration

- `@abide/abide/server/env` — `env(schema)` validates `Bun.env` against a Standard Schema at module top level, returning the typed config and reporting all issues at once on failure; registers the schema for the launcher setup form.

### Beyond the browser — @documentation agent · bundle

- `@abide/abide/server/agent` — `agent(engine, messages)` runs an `AgentEngine` against the current request's gated MCP surface (forwarding caller auth) and returns its `AgentFrame` stream for a handler to frame via `jsonl()`/`sse()`; must run inside an RPC request scope. Exports the `NeutralMessage`/`AgentFrame`/`AgentSurface`/`AgentEngine` types.
- `@abide/abide/server/appDataDir` — `appDataDir()` returns the desktop bundle's per-user data dir, keyed by the injected program name; cwd-independent, filesystem-pure.

### Plumbing — @documentation plumbing

- `@abide/abide/server/rpc/defineRpc` — `defineRpc(method, url, handler, opts?)` builds the runtime `RemoteFunction` the bundler targets on the server; the bundler stamps the JSON-schema projections, `coerce`, and `streaming` flags. (Authored code uses `GET`/`POST`/…, not this.)
- `@abide/abide/server/sockets/defineSocket` — `defineSocket(name, opts?)` is the bundler-targeted server `Socket` implementation: per-subscriber queues, a shared retained tail (default 1, lazy `ttl` eviction), schema-validated `publish` fanning out via `server.publish`, and `tail`/`peek`.
- `@abide/abide/server/prompts/definePrompt` — `definePrompt(name, opts)` builds a `Prompt` (name/description/render) from a resolver-generated `src/mcp/prompts/<file>.md` module and registers it for MCP.
- `@abide/abide/server/prompts/renderPromptTemplate` — `renderPromptTemplate(template, args)` substitutes `{{name}}` placeholders (missing args → empty string); used by the generated `.md` prompt render closure.
- `@abide/abide/server/AppModule` — type of the optional `src/app.ts` hooks (`forwardHeaders`, `init` with cleanup, `handle` middleware, `handleError`, `health`), all optional with framework defaults.
- `@abide/abide/server/InspectorContext` — type of the capability bundle core injects into `@abide/inspector` when `ABIDE_ENABLE_INSPECTOR=true`: `app`, `loadSurface`, `cacheSnapshot`, `inFlightSnapshot`, `onRecord`.

## Isomorphic surface — abide/shared/*

### Cache — @documentation cache

- `@abide/abide/shared/invalidate` — the drop verb: discards cached reads matching the selector so the next read reloads lazily (retained readers revalidate stale-in-place); `invalidate(asyncCell)` aliases `cell.refresh()`. Side-swapped (ADR-0041): local on the client, broadcast to all clients from the server.
- `@abide/abide/shared/refresh` — the refetch verb: refetches matching reads while keeping the stale value visible until fresh data swaps in (pair with `refreshing()`). Side-swapped (ADR-0041): local on the client, broadcast eagerly to all clients from the server.
- `@abide/abide/shared/amend` — mutate a retained cached value in place, reactively and without network (optimistic / real-time), via a replacement value or `(current) => Return` updater. Side-swapped (ADR-0043): local on the client; the value form broadcasts from the server, the updater form stays local.

### Probes — @documentation probes

- `@abide/abide/shared/pending` — reactive "no value yet" probe over cache calls and stream tails (`pending()` / `pending(fn)` / `pending(fn, args)` / `pending({ tags })` / `pending(subscribable)`); reports, never fetches.
- `@abide/abide/shared/refreshing` — reactive "holding an old value while a fresher one is in flight" probe over cache and streams; distinguishes revalidation from `pending()`'s "no value yet".
- `@abide/abide/shared/peek` — the value member: synchronously returns the retained cache value or a stream's latest frame (`T | undefined`), reactive in a tracking scope, triggering nothing; null-tolerant.
- `@abide/abide/shared/done` — reactive stream-only terminal-state reader: true once a subscribable's tail has closed; not-done when no prober is registered (server render).
- `@abide/abide/shared/online` — reactive connectivity probe: on the client re-runs on `online`/`offline` and returns `navigator.onLine`; on the server reflects the calling client's reported connectivity, defaulting true during SSR and outside any request scope.

### Templating — @documentation templating

- `@abide/abide/shared/snippet` — brands a payload as a mountable snippet value (client DOM builder / server HTML string) so a `{expr}` interpolation mounts it instead of escaping; the compiler wraps snippet bodies with it.

### Observability — @documentation observability

- `@abide/abide/shared/health` — reactive backend-health read returning `{ reachable }` plus the app `health()` hook's fields, polled from `/__abide/health` only while a tracking scope reads it; constant `{ reachable: true }` on the server.
- `@abide/abide/shared/log` — the request-scope-aware logger, `Object.assign`-composed: callable `log(...)` on the always-on channel, plus `log.info` / `log.warn` / `log.error` / `log.trace` and `log.channel(name)` for a `DEBUG`-gated channel; tsv or JSON per `ABIDE_LOG_FORMAT`.
- `@abide/abide/shared/reachable` — isomorphic outbound reachability: `await reachable(host)` HEADs the host origin and caches the verdict for one TTL; constant true for no host (own backend) and loopback. Answers "can I connect," not "is my endpoint healthy."
- `@abide/abide/shared/trace` — returns the current request's W3C `traceparent` string, or undefined outside a request scope; isomorphic (server ALS / client `__SSR__`-stamped).

### Page — @documentation page

- `@abide/abide/shared/page` — reactive isomorphic page proxy exposing `route`, `params`, `url` (browser-space both sides), and `navigating`; getters resolve per-side and re-run readers on navigation.

### URL — @documentation url

- `@abide/abide/shared/url` — base-correct, typed in-app URL resolver keyed off path kind (rpc args → query, page-route params, or bare asset/raw path); prefixes the mount base only for rooted internal paths, leaves external URLs untouched.

### Plumbing — @documentation plumbing

- `@abide/abide/shared/createSubscriber` — abide-ui-native open-on-first-read / close-on-last-reader subscriber built on abide's signal core: `start(update)` opens the resource and returns cleanup; `subscribe()` registers a tracked reader that re-runs when `update` fires.

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `@abide/abide/ui/state` — abide's from-scratch writable reactive cell `state(initial, transform?)`, plus `.computed` (read-only derived) / `.linked` (writable, reseeded) and `.share` / `.shared` ambient-scope context. Read and reassigned as a plain variable inside `.abide`.
- `@abide/abide/ui/watch` — the single reaction primitive: `watch(source, handler)` names a trigger (cell / cell array / socket / rpc) and runs the handler on change; bare `watch(thunk)` is the compiler's auto-tracked binding form. Client-only, SSR-stripped.
- `@abide/abide/ui/props` — the prop reader `props<T>()`; compiler-lowered inside a `.abide` component, throws when called directly.

### Templating — @documentation templating

- `@abide/abide/ui/html` — marks a string as trusted raw HTML (plain call or tagged template) so a `{expr}` interpolation inserts its nodes verbatim instead of escaped text.

### Navigate — @documentation navigate

- `@abide/abide/ui/navigate` — navigates to a typed in-app path (interpolating `[name]` params through `url()`) via the History API, with `replace` / `keepScroll` options.

### Reaction plumbing — @documentation plumbing

- `@abide/abide/ui/effect` — abide's effect primitive (runs `fn` capturing reads, re-runs on change, teardown-returning); internal — authors use `watch`, and the compiler emits `effect`.
- `@abide/abide/ui/currentScope` — resolves the current lexical scope (minting a detached root outside any); the lowering host the compiler targets for `state`/`effect`/`share`.
- `@abide/abide/ui/enterRenderScope` — establishes a fresh nested lexical scope for an SSR render and returns the previous one to restore.
- `@abide/abide/ui/exitRenderScope` — restores the scope `enterRenderScope` saved, closing an SSR render's scope.

### Client entry / router plumbing — @documentation plumbing

- `@abide/abide/ui/startClient` — the abide-ui client entry: reads `window.__SSR__`, seeds the tab cache / doc / cell / socket warm partitions, then starts the router; returns a disposer.
- `@abide/abide/ui/router` — a minimal History-API client router that matches the path, code-splits and mounts the page + its layout chain, diffs chains across navigation, and restores scroll.
- `@abide/abide/ui/renderToStream` — out-of-order SSR streaming generator: yields the shell first, then one resolved fragment per streaming `await` block in completion order.
- `@abide/abide/ui/remoteProxy` — client-side substitute for an RPC handler: builds a `RemoteFunction` that fetches over the network (pre-flight validation, cache policy, abort/timeout).
- `@abide/abide/ui/socketProxy` — client-side substitute for a server `Socket`: subscribes over the multiplexed ws channel, warm-seeded from the SSR retained frame, producing the identical `Socket` surface.

### DOM binding plumbing — @documentation plumbing

Everything the compiler emits from the template; authors never call these.

- `@abide/abide/ui/dom/mount` — mounts a top-level page/layout into a host under an ownership scope and render pass, returning a disposer.
- `@abide/abide/ui/dom/mountChild` — the compiler's only child-component mount: a marker-bounded range adopter probing the hydration cursor for inlined vs streamed content, else create-mode.
- `@abide/abide/ui/dom/hydrate` — adopts existing server-rendered DOM in place by running `build` with a claim cursor active, attaching listeners/effects without re-rendering; returns a disposer.
- `@abide/abide/ui/dom/mergeProps` — composes a child's props from ordered explicit/spread/slot layers into one live proxy bag, last-layer-wins.
- `@abide/abide/ui/dom/spreadProps` — wraps a `{...source}` spread layer so every key resolves to a live value thunk.
- `@abide/abide/ui/dom/restProps` — exposes the unconsumed props of `const { foo, ...rest } = props()` as a live object, excluding consumed keys and `children`.
- `@abide/abide/ui/dom/bindProp` — the parent half of a component `bind:prop`: annotates the prop's value thunk with a `set` write-back channel.
- `@abide/abide/ui/dom/bindableProp` — the child half of a two-way prop: a writable pass-through to the parent's target, or a local reseeding `linked` cell when unbound.
- `@abide/abide/ui/dom/spreadAttrs` — spreads an object's keys onto a native element (`{...rest}`): `on*` keys attach as listeners, others bind as reactive attributes.
- `@abide/abide/ui/dom/attr` — binds one element attribute to `read()` via an effect, with present/absent boolean semantics, suspense handling, and a hydration divergence check.
- `@abide/abide/ui/dom/on` — attaches an event listener (the `onclick={…}` target) pinned to the current scope with batched writes; skips non-function handlers.
- `@abide/abide/ui/dom/attach` — runs an `attach={…}` against an element at build time and registers its (possibly async) teardown with the ownership scope.
- `@abide/abide/ui/dom/bindSelectValue` — two-way `bind:value` for a `<select>` (single or `multiple`), re-applying on value / option-set changes and writing back on `change`.
- `@abide/abide/ui/dom/readCall` — guarded non-optional method call on a reactive-document read, throwing a TypeError naming the authored scope path instead of the engine's opaque error.
- `@abide/abide/ui/dom/readCell` — the unified read for a `state`/`computed`/`linked` reference: returns the retained value, throwing a `SuspenseSignal` for a pending blocking cell or an `AsyncCellError` for a settled error.
- `@abide/abide/ui/dom/writeCell` — the unified write for a `linked` reference: `.value` for a sync cell or `.set(value)` for an async one.
- `@abide/abide/ui/dom/cellPending` — reports whether a control-flow subject is a still-loading async cell, so `{#if}`/`{#switch}` render no branch instead of flashing the falsy one.
- `@abide/abide/ui/dom/awaitSubject` — normalizes an `{#await}` block's bare cell subject so it awaits the async cell's resolution instead of peeking its pending `undefined`.
- `@abide/abide/ui/dom/mutateDocContainer` — lowers an in-place-mutating container method (splice/sort/…) on a reactive-document value to clone-mutate-`replace`, emitting a patch so readers wake.
- `@abide/abide/ui/dom/appendText` — a reactive `{expr}` interpolation under a parent, rendering escaped text, a snippet builder, or `html`-branded raw markup (create or hydrate-claim).
- `@abide/abide/ui/dom/appendTextAt` — a reactive `{expr}` interpolation mounted at a kept skeleton anchor (text interleaved with element siblings), delegating to `appendText`.
- `@abide/abide/ui/dom/appendSnippet` — mounts a `{snippet(args)}` builder's nodes in a marker-bounded range, reactive in its arguments.
- `@abide/abide/ui/dom/appendStatic` — appends a static text node under a parent (create), or claims the merged server text node (hydrate).
- `@abide/abide/ui/dom/cloneStatic` — appends a fully-static subtree by cloning a cached template once (create), or advances the claim cursor past the run (hydrate).
- `@abide/abide/ui/dom/skeleton` — realizes a compiled skeleton (a bound element subtree) under a parent and returns its element + anchor holes.
- `@abide/abide/ui/dom/anchorCursor` — positions a skeleton-anchored control-flow block/slot, returning the create insertion reference and parking the hydrate claim cursor.
- `@abide/abide/ui/dom/mountSlot` — mounts a component's `{children()}` content as a marker-bounded range positioned like a control-flow block, running once.
- `@abide/abide/ui/dom/outlet` — a layout's outlet as an empty `<!--abide:outlet-->` boundary the router fills; hydrate claims and skips the server child content.
- `@abide/abide/ui/dom/each` — keyed list binding (the compiler target for `{#for … by key}`): reconciles marker-bounded row ranges by key with minimal DOM moves and hydrate-in-place adoption.
- `@abide/abide/ui/dom/eachAsync` — async keyed list (the target for `{#for await … by key}`): appends/reconciles row ranges as an `AsyncIterable` yields, with generation-guarded drains and catch-branch handling.
- `@abide/abide/ui/dom/when` — conditional binding (the target for `{#if}`/`{:else}`): a swappable range tracking `condition()`, with an optional third pending state so a loading async subject flashes no branch.
- `@abide/abide/ui/dom/awaitBlock` — async binding (the target for `{#await}`): renders pending then swaps to the resolved value cell or catch branch on settle; adopts streamed-resume / warm-sync values on hydrate.
- `@abide/abide/ui/dom/tryBlock` — reactive error boundary (the target for `{#try}`): catches build / initial-read / re-run throws, swaps to the catch branch, and rebuilds on recovery.
- `@abide/abide/ui/dom/switchBlock` — multi-branch binding (the target for `{#switch}` / `{:else if}` chains): a swappable range selecting the first matching (or default) case, with per-case pending gating.

### Render runtime plumbing — @documentation plumbing

- `@abide/abide/ui/settleAsyncCells` — the SSR await-barrier: drains this render's pending async-cell list to a fixpoint so blocking `await` cells resolve before render; a client no-op.
- `@abide/abide/ui/flight` — server-only flight-starter that hoists an await's promise into the synchronous render prefix, normalizing sync throws and keeping pre-consumer rejections non-fatal.
- `@abide/abide/ui/isolateCellBarrier` — runs a hoisted child render under its own async-cell barrier list (server ALS), isolating its cell registration/drain from siblings; a client passthrough.
- `@abide/abide/ui/finalizeStreamedChildren` — the when-to-stream decision (ADR-0039): fills each hoisted child's reserved slot inline if its flight settled, else emits a streaming boundary.
- `@abide/abide/ui/runtime/renderPath` — computes the render-path (streamed-boundary id) a child mounts under by composing its ordinal onto the ambient path; server-emit-only.
- `@abide/abide/ui/runtime/withPath` — pushes one `escapeKey`-escaped render-path segment for the duration of a synchronous `build`, restoring after.
- `@abide/abide/ui/runtime/escapeKey` — escapes one object key into a JSON-Pointer token (`~`→`~0`, `/`→`~1`) so a key with `/` survives a `/`-joined render path.
- `@abide/abide/ui/runtime/blockId` — allocates an await/try block id namespaced by the ambient render-path (`${path}:${n}`) from a per-render-pass counter map.
- `@abide/abide/ui/runtime/nextBlockId` — allocates the next await/try block id in the current client render pass, over the shared `blockId`.
- `@abide/abide/ui/runtime/enterRenderPass` — marks entry into a render/mount, clearing per-path block-id counters at the outermost depth so each pass restarts ids at 0.
- `@abide/abide/ui/runtime/exitRenderPass` — marks exit from a render/mount, unwinding the depth `enterRenderPass` raised.

## Build / tooling

### Building — @documentation building

- `@abide/abide/build` — `build()` runs `Bun.build` to emit the client bundle into `dist` (`_app` in prod via atomic staging-swap, per-generation dirs in dev) with the `.abide` loader, virtual-module resolver, optional Tailwind and gzip; returns `{ appDir }` or `false`.
- `@abide/abide/compile` — `compile()` produces a standalone Bun server executable (client assets embedded), defaulting the target to the host platform; returns the emitted binary path.

### Plumbing — @documentation plumbing

- `@abide/abide/preload` — side-effect Bun preload registering the `.abide` UI plugin, the virtual-module resolver (mode from `ABIDE_TARGET`), and a `.css` no-op loader; add it under `[test]` `preload` in `bunfig.toml`.
- `@abide/abide/resolver-plugin` — `abideResolverPlugin()` is the Bun plugin supplying abide's `abide:*` virtual modules and rewriting `src/server/rpc` + `src/server/sockets` modules to server impls or client proxies.
- `@abide/abide/ui-plugin` — `abideUiPlugin` is the Bun plugin that loads `.abide` single-file components, compiling each (via `compileModule`) to an ES module with scoped `<style>` bundled to a virtual CSS module on the browser build.
- `@abide/abide/tsconfig` — shareable TS config (`tsconfig.app.json`): ESNext target/module, bundler resolution, strict + `isolatedModules` + `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`, Bun types.

## Desktop bundle

### Bundle — @documentation bundle

- `@abide/abide/bundle/BundleWindow` — type for the default-exported `src/bundle/window.ts` config (title/width/height, custom `menu`, optional `config` Standard Schema overriding the setup form), baked into the launcher.
- `@abide/abide/bundle/BundleMenu` — type for a top-level bundle menu (`label` + `items`) inserted into the macOS menu bar between Edit and Window.
- `@abide/abide/bundle/BundleMenuItem` — serializable union type for a menu entry: a separator, an `emit` item dispatching an `abide:menu` event into the page, or a `navigate` item, with optional Cmd-`shortcut`.
- `@abide/abide/bundle/onMenu` — subscribes to bundle-menu clicks (catch-all `onMenu(handler)` or filtered `onMenu(name, handler)`), returning an unsubscribe; inert during SSR and in a plain browser tab.
- `@abide/abide/bundle/bundled` — `bundled()` returns true when running inside the abide desktop bundle (client: webview flag; server: `ABIDE_PARENT_PID`); isomorphic, false in a plain browser tab or remote server.

## MCP

### MCP — @documentation mcp

- `@abide/abide/mcp/createMcpServer` — `createMcpServer(opts)` builds the framework-internal MCP server bound to the project's rpc registry, returning `{ handle(request) }` for the `/__abide/mcp` route; tools derive from rpcs/sockets with `clients.mcp`, auth inherits from the inbound request, with an optional `authorize` hook.

## Testing

### Testing — @documentation testing

- `@abide/abide/test/createTestApp` — `createTestApp()` boots the real app on an ephemeral port (same wiring as `serverEntry`) from the project's virtual manifests, returning a disposable `TestApp` with `origin`, `fetch`, typed `rpc`/`sockets`, `health`, and `stop`.

### Plumbing — @documentation plumbing

- `@abide/abide/test/createScriptedSurface` — `createScriptedSurface(tools)` returns a scripted `AgentSurface` (declarative tool stubs) that records every `call` so engine tests can assert dispatched tools and args.
- `@abide/abide/test/assertAgentFrameConformance` — `assertAgentFrameConformance(stream)` collects an engine's `AgentFrame` stream and asserts the neutral contract (one trailing `done`, matched `tool_use`/`tool_result` pairs, string text deltas).

## Generated machine surfaces

Runtime routes the framework serves (`DOCUMENT` set; internal `/__abide/*`
routes are omitted):

| Route | Serves |
| --- | --- |
| `/openapi.json` | The generated OpenAPI 3.1 document for the RPC surface. |
| `/__abide/mcp` | The MCP server endpoint (tools from mcp-exposed rpcs/sockets). |
| `/__abide/sockets` | The multiplexed WebSocket; `/__abide/sockets/<name>` is the per-socket HTTP face (tail over SSE/JSON, publish). |
| `/__abide/health` | Health probe: `{ reachable }` plus the app `health()` hook's fields, ahead of app middleware. |
| `/__abide/identity` | The health payload under the legacy `{ abide: true }` shape, for already-shipped probers. |
| `/__abide/cli` | The platform-detecting install script; `/__abide/cli/<platform>` streams the thin-CLI tarball. |
| `/__abide/inspector` | The operator inspector surface, gated by `ABIDE_ENABLE_INSPECTOR`. |

## Environment variables

| Var | Effect |
| --- | --- |
| `PORT` | Server listen port. |
| `APP_URL` | Public app URL; its path derives the mount base for all in-app URLs. |
| `ABIDE_APP_DIR` | Override the built app dir the server loads (default `dist/_app`). |
| `ABIDE_DATA_DIR` | Override the per-user app data dir (`appDataDir`). |
| `ABIDE_CLIENT_TIMEOUT` | Client-side RPC fetch timeout in ms (bounded 1–600000). |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide max request body bytes (per-RPC `maxBodySize` overrides). |
| `ABIDE_IDLE_TIMEOUT` | WebSocket idle timeout in seconds (default 10). |
| `ABIDE_LOG_FORMAT` | `json` switches `log` output to JSON lines (else tsv). |
| `DEBUG` | Enable diagnostic log channels (e.g. `abide:rpc`). |
| `ABIDE_DEV_SURFACE` | `1` logs requests even under `abide dev`. |
| `ABIDE_ENABLE_INSPECTOR` | `true` enables the `@abide/inspector` capability injection + `/__abide/inspector`. |
| `ABIDE_INSPECT` | Enable inspector debug instrumentation. |
| `ABIDE_APP_URL` | The app URL the remote CLI / bundle client targets. |
| `ABIDE_APP_TOKEN` | Bearer token the remote CLI / bundle client sends to reach its app. |

---

This map mirrors the `exports` map in `package.json`. After adding or renaming an
export, run `bun run packages/abide/scripts/readmeSurfaces.ts` and update this
file so every export, route, and env var stays accounted for.
