# AGENTS.md — abide complete surface map

> The exhaustive index of abide's public surface: every `exports` key appears
> once, grouped by namespace, with its import specifier and a one-line spec, so
> an agent grasps the whole API in one read. The README is the curated
> three-primitive intro (RPCs, sockets, components); this map is complete.
> `CONTEXT.md` is the glossary; `docs/adr/` holds the rationale.
>
> **No barrels.** Every public name has its own module path —
> `@abide/abide/server/GET`, `@abide/abide/shared/cache`, `@abide/abide/ui/scope`.
> The namespace marks the side a name runs on: `@abide/abide/server/*` is
> server-only, `@abide/abide/ui/*` is client-only, `@abide/abide/shared/*` is
> isomorphic (same callable, same behaviour on both sides — the bundler swaps the
> runtime). There is no umbrella `index.ts`, so importing one name never drags in
> side-effecting siblings.
>
> Package `@abide/abide`, runtime Bun ≥ 1.3.0, one direct dependency
> (`typescript`); `tailwindcss` + `bun-plugin-tailwind` are optional peers.
> Import specifiers below are `package.json` `exports` keys, not file paths —
> `@abide/abide/server/GET` resolves to `src/lib/server/GET.ts`.

## The premise

One typed verb declaration fans out to every consumer:

```text
              getMessages = GET(fn, { inputSchema })
                              │
      ┌─────────────┬─────────┼──────────┬──────────────┐
      ▼             ▼         ▼          ▼              ▼
  SSR call      browser    MCP tool   CLI sub-      OpenAPI
  cache(fn)()   fetch       (read)    command       operation
                proxy
```

A Standard Schema unlocks the CLI for every verb and MCP for read-only verbs
(`GET` / `HEAD`); a mutating verb never auto-exposes to MCP — it opts in with
`clients: { mcp: true }`. The same gating applies to sockets: a schema flips the
MCP/CLI read faces on.

## File-based conventions

The bundler reads these paths by convention (`cwd` is the app root):

| Path                            | Meaning                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/server/rpc/<name>.ts`      | One RPC verb per file; export name = filename = URL under `/rpc/`. Server: real handler; client: `remoteProxy`.     |
| `src/server/sockets/<name>.ts`  | One socket per file; export name = filename. Server: `defineSocket`; client: `socketProxy`.                         |
| `src/server/config.ts`          | Optional. Eager-imported for boot-time `env()` validation (virtual `abide:config`).                                 |
| `src/mcp/prompts/*.md`          | MCP prompts; frontmatter (description, JSON Schema) + `{{name}}` body. Rewritten to `definePrompt`.                 |
| `src/mcp/resources/**`          | MCP resource files, gzip-embedded into the standalone binary.                                                       |
| `src/app.ts`                    | Optional `AppModule` — `init` / `handle` / `handleError` / `health` / `forwardHeaders` hooks (virtual `abide:app`). |
| `src/bundle/window.ts`          | Optional desktop-bundle config (`BundleWindow`); baked into the launcher.                                           |
| `src/bundle/disconnected.abide` | Optional custom connect screen; falls back to the built-in component.                                               |
| `src/ui/pages/**/page.abide`    | A page; its folder path is the route. `[id]` folder = dynamic segment → `page.params.id`.                           |
| `src/ui/pages/**/layout.abide`  | A layout wrapping pages at/below its folder; its `<slot/>` is the router outlet.                                    |
| `src/ui/public/**`              | Static assets served at site root; gzip-embedded into the standalone binary.                                        |
| `src/.abide/*.d.ts`             | Generated types written each build — `routes`, `rpc`, `sockets`, `health`, `publicAssets`, and test surfaces.       |
| `dist/_app/`                    | Client bundle output (hashed chunks; prod adds precompressed `.gz` siblings).                                       |

## CLI

```text
abide scaffold <name>   scaffold the bundled template, install deps, start dev
abide dev               build client + run server with hot reload
abide build             single client build into dist/_app
abide start             run the production server against a built dist/
abide run <file> [...]  run a script under the abide preload (same runtime)
abide compile           build a standalone server executable
abide cli               build a thin CLI binary (remote client + bundled server)
abide bundle            build a movable self-contained desktop app bundle
abide check             type-check every .abide template + props
abide lsp               run the .abide language server over stdio (JSON-RPC)
abide init-agent        write/refresh the CLAUDE.md pointer to this surface map
```

`scaffold` takes `--no-install` / `--no-dev` to skip those steps; without a TTY
it scaffolds only. `bun test` in a scaffolded app preloads abide via
`bunfig.toml` (`[test] preload = ["@abide/abide/preload"]`) so `.abide` modules
resolve.

## Authoring contracts

**RPC verb** — `export const <name> = GET(handler, opts?)` (same shape for
`POST` / `PUT` / `PATCH` / `DELETE` / `HEAD`). The handler receives the parsed
args bag (`InferOutput<inputSchema>`, merged with validated files when
`filesSchema` is set) plus a `{ errors }` ctx (its declared error constructors),
may read `request()` / `cookies()` / `server()` from request scope, and returns
`json` / `jsonl` / `sse` / `error` / `redirect` or a raw `Response`. `opts`:
`inputSchema` (validates args, infers the type, gates CLI + read-MCP),
`outputSchema` (documents the 200 body for OpenAPI/MCP), `filesSchema` (multipart
File parts), `errors` (name-keyed `{ status, data? }` map — typed errors:
`return error(errors.invalidCoupon({ … }))` serializes `{ $abideError, data }` at
the declared status, surfacing on the client's thrown `HttpError` as `.kind` /
`.data`; a validation 422 rides the same shape with `kind: 'validation'` and a
field-keyed message map), `clients: { browser, mcp, cli }` (explicit surface
targeting; explicit wins over schema auto-flip), `crossOrigin` (exempt a mutating
verb from the same-origin gate), `maxBodySize` (per-verb 413 ceiling), `timeout`
(handler deadline in ms; 504 on every surface). Query args arrive as strings —
use `z.coerce.*`. Consume four ways: `cache(verb)(args)` in-process, the swapped
browser `fetch`, `verb.raw(args)` for the `Response`, `verb.stream(args)` to
iterate a streaming body.

**Socket** — `export const <name> = socket({ schema?, tail?, ttl?,
clientPublish?, clients? })`. `tail` retains the last N frames for late joiners
and the read faces; `ttl` lazily evicts frames older than N ms; `clientPublish`
(default off) gates browser publishes; `schema` validates publishes
synchronously and flips MCP/CLI on. Isomorphic `AsyncIterable<T>`: bare
iteration is the live stream, `.tail(count?)` seeds from retention,
`.publish(msg)` fans out in-process + over the multiplexed ws.

**Page / layout** — a `[id]` folder segment becomes `page.params.id`. A layout's
`<slot/>` is the outlet the next layer fills. Read `page` (route, params, url,
navigating) and call `navigate(path)` (or `navigate('/p/[id]', { id })` for a route
with params) for SPA transitions.

**App / config** — `src/app.ts` default-exports an `AppModule`;
`src/server/config.ts` runs `env(schema)` at boot.

**Isomorphism move** — wrap an SSR read in `cache(fn)()` so the value serializes
into the document and the client hydrates warm instead of refetching.

## .abide template grammar

A component file is `<script>` (module-level JS: imports, handlers, reactive
declarations) + optional `<template name="…">` snippet definitions + markup + an
optional component-scoped `<style>`. Control flow is `{#…}` blocks (Svelte-free
HTML). Ambient in-scope names need no import: `scope`, `props` / `prop`,
`effect`, `html`, `snippet`.

**Reactive state** — destructure the primitives off `scope()` once at the top, the
documented default (`const { state, computed, linked } = scope()`), then call them
bare (`const count = state(0)`); `scope().state(v)` and a captured handle
(`const s = scope(); s.state(v)`) are equivalent — receiver-agnostic, the method name
marks the binding reactive. A bare `state(v)` with no `scope()` destructure in scope is
a compile error. Reach for `scope(address).state(v)` only to target a non-current scope.

| Form                               | Meaning                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `state(v)`                         | Writable reactive cell (`{ value }`); the sole writable surface.                   |
| `computed(fn)`                     | Read-only derived cell; re-runs when its reads change.                             |
| `linked(initial, reseed?)`         | Cell bound to a reactive-document path; reflects/drives the root doc.              |
| `effect(fn)`                       | Runs now, re-runs on dep change; may return a teardown; returns a disposer.        |
| `props()` / `prop(name)`           | Read the component's props (thunks for reactivity), e.g. `const { id } = props()`. |

`scope()` also destructures its capability methods — `undo` / `redo` / `canUndo` /
`canRedo` / `record` / `persist` / `broadcast` — used bare the same way.

**Bindings**

| Form                        | Meaning                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `{expr}`                    | Escaped text interpolation; raw markup via the `html` tag; `{snippet(args)}` mounts a snippet. |
| `name={expr}`               | Reactive attribute (boolean `true` sets bare, falsy removes).                                  |
| `on<event>={fn}`            | Event listener, e.g. `onclick={handler}`; handler writes batch and flush once on exit.         |
| `bind:value={x}`            | Two-way input binding.                                                                         |
| `bind:checked={x}`          | Two-way checkbox binding.                                                                      |
| `bind:group={x}`            | Radio/checkbox group (radio → one value, checkbox → array).                                    |
| `bind:value={{ get, set }}` | Writable computed at the binding site.                                                         |
| `{...expr}`                 | Spread keys as attributes (elements) or props (components).                                    |
| `attach={fn}`               | Build-time element attachment with optional teardown.                                          |

**Control flow** — `{#…}` blocks (each head reads as the JS clause it lowers to):

| Form                                                                  | Meaning                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `{#if c}` / `{:else if c}` / `{:else}` / `{/if}`                      | Conditional, source-order, re-evaluated reactively.                                                   |
| `{#for x of list}` / `{#for x, i of list by x.id}` / `{/for}`         | Keyed list (`for…of`); `, i` index reactive; `by` key reconciles rows in place; key defaults to item. |
| `{#for await x of asyncIter by x.id}` … `{:catch e}` / `{/for}`       | Async keyed list (`for await…of`); rows append as the iterator yields.                                |
| `{#await p}` / `{:then v}` / `{:catch e}` / `{:finally}` / `{/await}` | Promise branches; pending content (before `{:then}`) streams.                                         |
| `{#await p then v}` / `{/await}`                                      | Blocking: no pending, resolved inline (SSR settles before the first flush).                           |
| `{#switch s}` / `{:case v}` / `{:default}` / `{/switch}`              | First strict (`===`) match wins.                                                                      |
| `{#try}` / `{:catch e}` / `{:finally}` / `{/try}`                     | Synchronous render error boundary.                                                                    |

**Reusable markup** — `<template>`:

| Form                                                | Meaning                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<template name="row" args={item}>` … `{row(item)}` | Named template (snippet) definition + call; without `name` it is an inert reusable fragment. A `<template>` carrying a control-flow attribute (`if`/`each`/`await`/…) is a migration error — use the `{#…}` block. |

**Components & slots** — a capitalised tag (`<Card title={x}>`) mounts a child;
attributes become props, children fill the child's `<slot>` (with fallback when
empty). `<style>` is scoped to the component and its children. Component files
end in `.abide`. A block's binding names (`{:then v}`, `{#for x of …}`) lexically
shadow same-named component state inside the block.

## Server surface — abide/server/\* (server-only)

### RPC — @documentation rpc

- `@abide/abide/server/GET` — declare a `GET` verb; args from the query string. Schema auto-exposes CLI + read-MCP.
- `@abide/abide/server/POST` — declare a `POST` verb; args from JSON/form/multipart body (body wins on collision).
- `@abide/abide/server/PUT` — declare a `PUT` verb (body args; mutating).
- `@abide/abide/server/PATCH` — declare a `PATCH` verb (body args; mutating).
- `@abide/abide/server/DELETE` — declare a `DELETE` verb (query args; mutating).
- `@abide/abide/server/HEAD` — declare a `HEAD` verb (query args; read-only, headers-only response).

### Response — @documentation response

- `@abide/abide/server/json` — `json(data, init?)`: JSON `TypedResponse` (`Cache-Control: no-store`); `undefined` → 204.
- `@abide/abide/server/jsonl` — `jsonl(asyncIterable, init?)`: JSONL stream, one value per line; errors emit a `{"$error"}` final line.
- `@abide/abide/server/sse` — `sse(asyncIterable, init?)`: Server-Sent Events with 15s keepalive comments; errors as an `error` event.
- `@abide/abide/server/error` — `error(status, message?, init?)`: plain-text error `TypedResponse<never>` (narrows out of the success union).
- `@abide/abide/server/redirect` — `redirect(url, status=302, init?)`: redirect accepting relative URLs; `TypedResponse<never>`.

### Request scope — @documentation request-scope

- `@abide/abide/server/request` — `request()`: the inbound `Request` from request-scoped ALS; throws outside scope.
- `@abide/abide/server/cookies` — `cookies()`: live `Bun.CookieMap`; writes flush to `Set-Cookie`; throws outside scope.
- `@abide/abide/server/server` — `server()`: the active `Bun.serve` instance (in-process shim for CLI/MCP/test dispatch).

### Configuration — @documentation configuration

- `@abide/abide/server/env` — `env(schema)`: validate `process.env` against a Standard Schema at boot (synchronous; reports all issues).

### Sockets — @documentation sockets

- `@abide/abide/server/socket` — `socket({ schema?, tail?, ttl?, clientPublish?, clients? })`: declare a broadcast topic; isomorphic `Socket<T>`.

### Agent — @documentation agent

- `@abide/abide/server/agent` — `agent(engine, messages)`: run an `AgentEngine` against the request's MCP surface; yields `AgentFrame`s (wrap in `jsonl`/`sse`). Exports the `AgentEngine` / `AgentSurface` / `NeutralMessage` / `AgentFrame` types; provider engines ship in `@abide/<provider>`.

### Observability — @documentation observability

- `@abide/abide/server/reachable` — `reachable(host)`: cached outbound reachability HEAD (first call probes, then polls every TTL); any HTTP response counts as up. Tuned by `ABIDE_REACHABLE_TTL` / `ABIDE_REACHABLE_TIMEOUT`.

### Plumbing — @documentation plumbing

- `@abide/abide/server/AppModule` — type of `src/app.ts`: optional `forwardHeaders`, `init`, `handle`, `handleError`, `health` hooks.
- `@abide/abide/server/InspectorContext` — type of the capability bundle the core injects into `@abide/inspector` when `ABIDE_ENABLE_INSPECTOR=true`.
- `@abide/abide/server/rpc/defineVerb` — `defineVerb(method, url, handler, opts?)`: low-level builder the GET/POST/… helpers wrap.
- `@abide/abide/server/sockets/defineSocket` — `defineSocket(name, opts?)`: server-side `Socket` construction (per-subscriber queue, shared retained tail).

## Isomorphic surface — abide/shared/\* (same callable both sides)

### Cache — @documentation cache

- `@abide/abide/shared/cache` — `cache(fn, opts?)`: coalesce/memoize a remote verb or producer per store (request-scoped server, tab-scoped client). `opts`: `global` (process store), `ttl`, `swr`. Methods: `cache.invalidate`, `cache.on`, `cache.patch`. Warm SSR reads resolve synchronously on hydrate.

### Templating — @documentation templating

- `@abide/abide/shared/html` — `html` (tagged template or `html(str)`): mark a string as trusted raw HTML so `{expr}` inserts nodes verbatim (no auto-escape).
- `@abide/abide/shared/snippet` — `snippet(payload)`: brand a snippet payload (client DOM builder / server HTML string) so `{expr}` mounts it.

### Response — @documentation response

- `@abide/abide/shared/HttpError` — `class HttpError extends Error`: thrown by remote calls on non-2xx; carries `status`, `statusText`, the raw `response`.

### RPC — @documentation rpc

- `@abide/abide/shared/withJsonSchema` — `withJsonSchema(schema, toJsonSchema)`: attach a `toJSONSchema()` method (for schemas lacking one) feeding OpenAPI/MCP/CLI/bundle forms.

### Page — @documentation page

- `@abide/abide/shared/page` — reactive `page` proxy: `{ route, params, url, navigating }`; server reads per-request store, client reads the router snapshot.

### URL — @documentation url

- `@abide/abide/shared/url` — `url(path, ...args)`: base-correct, typed in-app URLs for RPCs (args → query), page routes (`[name]` params), and assets; external URLs pass through untouched.

### Probes — @documentation probes

- `@abide/abide/shared/pending` — `pending(selector?, args?)`: reactive — any/specific/exact/tagged call in flight, or a stream awaiting its first frame.
- `@abide/abide/shared/refreshing` — `refreshing(selector?, args?)`: reactive — a value held while fresh data is in flight (SWR refetch / reconnect with retained value).
- `@abide/abide/shared/online` — `online()`: reactive connectivity (client `navigator.onLine`; server reads the caller's reported state); reports, never acts.

### Observability — @documentation observability

- `@abide/abide/shared/health` — `health()`: reactive backend health (`reachable` + app fields) polled from `/__abide/health` only while read; SSR-seeded.
- `@abide/abide/shared/log` — `log(...)` / `.warn` / `.error` / `.trace(label, fn)` / `.channel(name)`: request-scoped logger; TSV or JSON (`ABIDE_LOG_FORMAT`).
- `@abide/abide/shared/trace` — `trace()`: the current request's W3C `traceparent`, or `undefined` outside request scope; isomorphic.

### Plumbing — @documentation plumbing

- `@abide/abide/shared/createSubscriber` — `createSubscriber(start)`: open-on-first-read / close-on-last-reader resource lifecycle on the signal core.

## UI surface — abide/ui/\* (client-only)

### Reactive state — @documentation reactive-state

- `@abide/abide/ui/scope` — `scope(address?)`: resolve the lexical reactive scope; `.state` / `.computed` / `.linked` are the reactive cells (see grammar).

### Effect — @documentation effect

- `@abide/abide/ui/effect` — `effect(fn)`: run now, re-run on dep change, optional teardown return; returns a disposer.

### Tail — @documentation tail

- `@abide/abide/ui/tail` — `tail(subscribable, opts?)`: reactive consumer of a `Socket<T>` or `fn.stream` result (latest-wins, or windowed via `{ last }`); seeds from retention; no-op on the server.

### Navigate — @documentation navigate

- `@abide/abide/ui/navigate` — `navigate(path, params?, { replace?, keepScroll? })`: client navigation; route literals with `[name]` segments take typed params, built base-correct through `url()` (a dynamic `/p/${id}` falls through its paramless branch); writes history and re-mounts the page chain.

### UI — @documentation ui

- `@abide/abide/ui/outbox` — `outbox({ key, send, store, online, onDrop })`: durable FIFO mutation queue for local-first writes; drains while online, retries on reconnect, at-least-once.

### Plumbing — @documentation plumbing

- `@abide/abide/ui/enterScope` — `enterScope()`: open a fresh lexical scope for an SSR render; returns the previous to restore.
- `@abide/abide/ui/exitScope` — `exitScope(previous)`: restore the scope `enterScope` saved.
- `@abide/abide/ui/router` — `router(host, loaders, layoutLoaders, probe?)`: History-API router; diffs the layout/page chain on nav. Returns a disposer.
- `@abide/abide/ui/startClient` — `startClient(routes, layoutRoutes, target)`: official client entry; reads `__SSR__`, seeds cache, starts the router.
- `@abide/abide/ui/renderToStream` — `renderToStream(render)`: out-of-order SSR streaming; yields the shell, then one `<abide-resolve>` fragment per streaming await.
- `@abide/abide/ui/remoteProxy` — `remoteProxy(method, url)`: client substitute for a verb handler; identical `RemoteFunction` shape so `cache()` matches both sides.
- `@abide/abide/ui/socketProxy` — `socketProxy(name)`: client substitute for a server `Socket`; subscribes over the multiplexed ws channel.
- `@abide/abide/ui/dom/mount` — mount a top-level page/layout into a host under an ownership scope; returns a disposer.
- `@abide/abide/ui/dom/mountChild` — mount a child component as a marker-bounded range (no wrapper element); records the instance for hot reload.
- `@abide/abide/ui/dom/mergeProps` — compose child props from ordered layers (thunks, spreads, slot) via a Proxy; last layer wins.
- `@abide/abide/ui/dom/spreadProps` — wrap a `{...source}` spread so each key resolves to a live thunk.
- `@abide/abide/ui/dom/restProps` — the unconsumed rest of a component's props as a live, enumerable object.
- `@abide/abide/ui/dom/spreadAttrs` — spread an object onto a native element: `on*` keys as listeners, others as reactive attributes.
- `@abide/abide/ui/dom/readCall` — guarded reactive-doc method call with scope-path error messages.
- `@abide/abide/ui/dom/hydrate` — adopt server-rendered DOM, attaching listeners/effects in place with a claim cursor.
- `@abide/abide/ui/dom/text` — a text node whose content tracks `read()`.
- `@abide/abide/ui/dom/appendText` — reactive `{expr}` interpolation (escaped text, raw `html`, or snippet).
- `@abide/abide/ui/dom/appendTextAt` — reactive `{expr}` at a skeleton anchor comment, interleaved with element siblings.
- `@abide/abide/ui/dom/appendSnippet` — `{snippet(args)}` interpolation in a marker-bounded range; re-reads args reactively.
- `@abide/abide/ui/dom/appendStatic` — a static (non-reactive) text node, created or claimed from SSR.
- `@abide/abide/ui/dom/cloneStatic` — append a fully-static subtree by template clone (create) or claim (hydrate).
- `@abide/abide/ui/dom/skeleton` — realize a compiled skeleton under a parent; returns element holes (by path) and anchors (in order).
- `@abide/abide/ui/dom/anchorCursor` — position a skeleton-anchored control-flow block; parks the claim cursor (hydrate) or returns a create reference.
- `@abide/abide/ui/dom/mountSlot` — mount a component's `<slot>` content in a marker-bounded range (rendered once).
- `@abide/abide/ui/dom/outlet` — a layout's `<slot/>` outlet (comment-bounded boundary the router fills with the next layer).
- `@abide/abide/ui/dom/attr` — bind an element attribute to `read()` (boolean present/absent semantics).
- `@abide/abide/ui/dom/on` — attach an event listener pinned to its ownership scope.
- `@abide/abide/ui/dom/attach` — run a build-time attachment against an element with optional teardown.
- `@abide/abide/ui/dom/each` — keyed list binding; reconciles by key, reorders/re-keys in place; claims SSR rows on hydrate.
- `@abide/abide/ui/dom/eachAsync` — async keyed list over an `AsyncIterable`; rows append/reconcile as the iterator yields.
- `@abide/abide/ui/dom/when` — conditional binding; swaps the range on truthy↔falsy flips; adopts the server branch on hydrate.
- `@abide/abide/ui/dom/awaitBlock` — async binding (pending/then/catch); patches a re-settling `then` value in place rather than rebuilding.
- `@abide/abide/ui/dom/tryBlock` — synchronous error boundary; builds the catch subtree if the guarded one throws (rendered once).
- `@abide/abide/ui/dom/switchBlock` — multi-branch binding; picks the first matching case, else default; swaps on subject change.
- `@abide/abide/ui/dom/applyResolved` — bundle-side consumer of an SSR stream chunk; routes cache-seed/resolve frames into await boundaries.
- `@abide/abide/ui/runtime/escapeKey` — escape one object key into a JSON-Pointer token (`~`→`~0`, `/`→`~1`).
- `@abide/abide/ui/runtime/nextBlockId` — the next block id in the current render pass (await/try blocks, document order).
- `@abide/abide/ui/runtime/enterRenderPass` — mark entry into a render/mount pass; depth 0 resets the block-id counter.
- `@abide/abide/ui/runtime/exitRenderPass` — mark exit from a render/mount pass, unwinding the depth.

## Build / tooling

### Building — @documentation building

- `@abide/abide/build` — `build(opts)`: build the client bundle into `dist/_app` (optional gzip); returns success.
- `@abide/abide/compile` — `compile(opts)`: build a standalone server executable (runs the client build first); returns the binary path.

### Plumbing — @documentation plumbing

- `@abide/abide/preload` — the Bun plugin stack (`abideUiPlugin` + resolver) registered via `bunfig.toml` preload.
- `@abide/abide/resolver-plugin` — `abideResolverPlugin({ cwd, embedAssets, target })`: resolves the `abide:*` virtual modules and convention dirs.
- `@abide/abide/ui-plugin` — `abideUiPlugin`: Bun plugin that compiles `.abide` single-file components (with scoped CSS) to ES modules.
- `@abide/abide/tsconfig` — `tsconfig.app.json`: the app TypeScript config (ESNext, DOM lib, Bun types, strict, no-emit).

## Desktop bundle

### Bundle — @documentation bundle

- `@abide/abide/server/appDataDir` — `appDataDir()`: the running bundle's per-user data directory (keyed by injected program name; cwd-independent). Overridable via `ABIDE_DATA_DIR`.
- `@abide/abide/bundle/BundleWindow` — type of `src/bundle/window.ts`: window config (title, size, menu, `configSchema`).
- `@abide/abide/bundle/BundleMenu` — type of a top-level menu-bar menu (label + items).
- `@abide/abide/bundle/BundleMenuItem` — type of one menu entry (divider, emit event, or navigate URL).
- `@abide/abide/bundle/onMenu` — `onMenu(name?, handler)`: subscribe to bundle menu clicks (`abide:menu` CustomEvent).
- `@abide/abide/bundle/bundled` — `bundled()`: true when running inside the abide desktop bundle.

## MCP

### MCP — @documentation mcp

- `@abide/abide/mcp/createMcpServer` — `createMcpServer(opts)`: MCP server bound to the project registry; derives tools from verbs/sockets, handles auth.

### Prompts — @documentation plumbing

- `@abide/abide/server/prompts/definePrompt` — `definePrompt(name, opts)`: build a `Prompt` from an `src/mcp/prompts/*.md` file (the bundler emits the call).
- `@abide/abide/server/prompts/renderPromptTemplate` — `renderPromptTemplate(template, args)`: substitute `{{name}}` placeholders (missing → empty string).

## Testing

### Testing — @documentation testing

- `@abide/abide/test/createTestApp` — `createTestApp(opts)`: in-memory test server with a typed `app.rpc.<verb>` / `app.sockets.<name>` surface.

### Plumbing — @documentation plumbing

- `@abide/abide/test/createScriptedSurface` — `createScriptedSurface(tools)`: a scripted `AgentSurface` for engine tests (records calls, stubs results).
- `@abide/abide/test/assertAgentFrameConformance` — `assertAgentFrameConformance(stream)`: assert engine frame-stream invariants (done frame, tool use/result pairing).

## Generated machine surfaces

Runtime routes the framework serves:

| Route                | Serves                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `/openapi.json`      | OpenAPI document for the `/rpc/*` HTTP surface.                                           |
| `/__abide/mcp`       | MCP endpoint (POST) routed to `createMcpServer`.                                          |
| `/__abide/health`    | Unauthenticated health payload (`reachable` + `src/app.ts` `health` fields).              |
| `/__abide/sockets`   | WebSocket multiplex for every declared socket; `/<name>` adds the HTTP tail/publish face. |
| `/__abide/cli`       | CLI download (`/<platform>`): gzipped tarball with the thin binary + `.env`.              |
| `/__abide/hot/<id>`  | Dev-only hot-module endpoint for edited `.abide` components.                              |
| `/__abide/identity`  | Server identity (app name + version) for CLI connectivity probes.                         |
| `/__abide/inspector` | Inspector UI, gated by `ABIDE_ENABLE_INSPECTOR` and the installed package.                |

## Environment variables

| Variable                      | Effect                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `PORT`                        | Port the server binds (scans upward from the default if taken).                               |
| `APP_URL`                     | Request origin the CLI download writes into the downloaded `.env` (`ABIDE_APP_URL`).          |
| `ABIDE_APP_URL`               | Server URL baked into a CLI binary at build time; runtime-overridable.                        |
| `ABIDE_APP_TOKEN`             | Bearer token written into the CLI download's `.env` when the request carries `Authorization`. |
| `ABIDE_CLIENT_TIMEOUT`        | Client-side RPC fetch timeout in ms (1–600000); shipped via `__SSR__`.                        |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide request body ceiling in bytes.                                                    |
| `ABIDE_IDLE_TIMEOUT`          | Per-connection idle timeout in seconds (0–255, default 10); streaming opts out.               |
| `ABIDE_REACHABLE_TIMEOUT`     | `reachable()` probe timeout in ms (100–60000, default 3000).                                  |
| `ABIDE_REACHABLE_TTL`         | `reachable()` poll cadence / freshness in ms (1000–600000, default 30000).                    |
| `ABIDE_DATA_DIR`              | Override for the app data directory (used as-is, no program name appended).                   |
| `ABIDE_LOG_FORMAT`            | `json` for one JSON object per line; default is tab-separated.                                |
| `DEBUG`                       | Diagnostic channel gate (e.g. `DEBUG=abide:*` or `abide:build`).                              |
| `ABIDE_ENABLE_INSPECTOR`      | `true` activates the optional inspector.                                                      |
| `ABIDE_INSPECT`               | Enable DevTools inspection in a desktop bundle's webview.                                     |

---

This map mirrors `package.json` `exports`. After adding or renaming an export,
run `bun run packages/abide/scripts/readmeSurfaces.ts` and update the matching
bullet here.
