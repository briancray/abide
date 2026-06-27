# AGENTS.md — abide complete surface map

> The exhaustive index of abide's public surface: every `exports` key appears once, grouped by namespace, with its import specifier and a one-line spec. This is the whole-API read; the README is the curated 3-primitive intro. CONTEXT.md is the glossary, `docs/adr/` the rationale.

**No barrels.** Every public name has its own module path (`abide/server/GET`, `abide/shared/cache`, `abide/ui/scope`) — there is no umbrella `index.ts`, so importing one name never drags side-effecting siblings into the bundle. The namespace marks the side a name runs on: `abide/server/*` is server-only, `abide/ui/*` is client-only, `abide/shared/*` is isomorphic (same callable, same behaviour on both sides; the bundler swaps the runtime). The bullets below name each export by its import specifier in the `abide/…` shorthand (the published package is `@abide/abide`, so `abide/server/GET` imports from `@abide/abide/server/GET`) — these are import specifiers, not source file paths.

Package `@abide/abide`. Runtime: Bun ≥ 1.3.0. One direct dependency (TypeScript); `tailwindcss` + `bun-plugin-tailwind` are optional peers for styling.

## The premise

One typed RPC declaration fans out to every surface:

```text
      export const getMessages = GET(fn, { inputSchema })
                            │
  ┌────────────┬────────────┬────────────┬────────────┐
  ▼            ▼            ▼            ▼            ▼
  SSR call     browser      MCP tool     CLI cmd      OpenAPI
  cache(fn)()  fetch proxy  (read-only)  abide cli    /openapi.json
```

The Standard Schema is the gate: an `inputSchema` unlocks the CLI subcommand and, for read-only methods (GET/HEAD), the MCP tool automatically. A mutating method (POST/PUT/PATCH/DELETE) never auto-exposes to MCP — it opts in with `clients: { mcp: true }`.

## File-based conventions

The bundler reads these paths; the path is the identity.

| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | one RPC export; URL is `/rpc/<name>` |
| `src/server/sockets/<name>.ts` | one socket export; socket identity is `<name>` |
| `src/mcp/prompts/<name>.md` | one MCP prompt; identity is `<name>` (front-matter + `{{arg}}` body) |
| `src/server/config.ts` | the `env(schema)` config, read at boot |
| `src/app.ts` | optional `AppModule` hooks (`init`, `handle`, `handleError`) |
| `src/bundle/window.ts` | optional `BundleWindow` default export (desktop bundle) |
| `src/ui/pages/**/page.abide` | a page; the directory is the route, `[id]` a dynamic segment, `[...rest]` a catch-all |
| `src/ui/pages/**/layout.abide` | a layout wrapping every page below it via its `{children()}` outlet |
| `src/.abide/*.d.ts` | generated type surfaces (RPC routes, health fields, test client) |
| `public/` | static assets served as-is |
| `dist/_app/` | the built client bundle (`abide build`) |

## CLI

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | scaffold a project, install it, start dev (`--no-install` / `--no-dev` to skip) |
| `abide dev` | build + run with hot reload |
| `abide build` | build the client into `dist/_app/` |
| `abide check` | type-check `.abide` templates + props |
| `abide start` | run the production server against `dist/` |
| `abide run <file> [args…]` | run a script under the abide preload (same runtime as the server) |
| `abide compile [--target] [--out]` | build a standalone server executable |
| `abide cli [--target] [--out] [--platforms]` | build the CLI binary (a thin remote client that ships the server beside it) |
| `abide bundle` | build a movable, self-contained desktop app bundle for this platform |
| `abide lsp` | the `.abide` language server (editor integration) |
| `abide init-agent` | write/refresh a CLAUDE.md pointer to this surface map (non-scaffolded projects) |

For tests, add `preload = ["@abide/abide/preload"]` under `[test]` in `bunfig.toml` and use `bun test`.

## Authoring contracts

- **RPC** — `export const <name> = METHOD(handler, opts?)` in `src/server/rpc/<name>.ts`. The handler receives the parsed args (`InferOutput<inputSchema>`, or the raw `Args` when schemaless), reads request state via `request()` / `cookies()`, and returns `json` / `jsonl` / `sse` / `error` / `redirect` / a raw `Response`. `opts`: `inputSchema`, `outputSchema`, `filesSchema` (multipart upload), `errors`, `clients: { browser, mcp, cli }`, `crossOrigin` (CSRF exemption), `maxBodySize` (413 past it), `timeout` (504, every surface), `outbox` (durable mutating delivery). Query args (GET/DELETE/HEAD) arrive as strings — use `z.coerce.*`. Consume four ways: `cache(fn)()` in-process, the swapped `fetch` proxy in the browser, `fn.raw(args)` (untouched `Response`), `fn.stream(args)` (frame stream). A non-2xx throws `HttpError`; `fn.isError(err, name)` type-guards it against the rpc's own `errors` (plus `'validation'` / `'queued'`), narrowing `.kind` and the matching `.data`.
- **Socket** — `export const <name> = socket(opts)` in `src/server/sockets/<name>.ts`. A `Socket<T>` is an `AsyncIterable<T>`: bare iteration is the live stream; `<name>.tail(count?)` seeds from the retained tail; `<name>.publish(m)` is isomorphic. `opts`: `schema` (validates publishes, infers `T`, flips MCP/CLI faces on), `tail` (retained frame count), `ttl` (lazy age eviction), `clientPublish` (allow browser publishes), `clients`.
- **Page / layout** — `.abide` files under `src/ui/pages/`. A `[id]` segment lands on `page.params.id` (or read it as a prop: `const { id } = props()`, typed from the route); a layout's `{children()}` is the outlet the child fills; read the route via `page`, navigate via `url` / `navigate`.
- **app.ts / config.ts** — `app.ts` exports optional `AppModule` hooks (`init` → cleanup, `handle` middleware, `handleError`); `config.ts` exports `env(schema)`, validated synchronously at boot.
- **Isomorphism move** — read through `cache()` during SSR so the value bakes into the HTML and the matching `{#await}` adopts the server DOM warm on hydration (no refetch).

## .abide template grammar

A component is one `.abide` file: valid HTML with an optional `<script lang="ts">`, `{expr}` bindings, `{#…}` control-flow blocks (including `{#snippet}` declarations), `{children()}` slots, capitalised component tags, and a component-scoped `<style>`. The browser's parser is the tree-builder, so SVG/MathML and foreign content work. Ambient in every component (no import): `scope` and `props`; `html` and `snippet` are the templating brands. `effect` is not ambient — it is a scope primitive, authored as `scope().effect(fn)` (a bare `effect(...)` is a compile error).

**Reactive state** — reached through `scope()` (destructure `const { state, computed, linked } = scope()` once, or call `scope().state(…)` directly). A bare `state` / `computed` / `linked` with no `scope()` in view is a compile error.

| Form | Is |
| --- | --- |
| `scope().state(value, transform?)` | a writable cell — read/reassigned as a plain variable; optional `transform(next, prev)` coerces every write |
| `scope().linked(fn, transform?)` | a writable local draft seeded from upstream — reseeds when the source changes, edits stay local |
| `scope().computed(fn)` | a read-only derived value — re-runs when a cell it reads changes |
| `scope().effect(fn)` | a client-only side effect (stripped from SSR); return a function to clean up |
| `props()` | destructure component props (`const { name = fallback, ...rest } = props()`), each a reactive read; a page/layout reads its route params here too (typed from the route's `[id]` segments) |

A two-way binding over derived state is an accessor at the bind site (`bind:value={{ get, set }}`), not a writable primitive.

**Bindings**

| Syntax | Binds |
| --- | --- |
| `{expr}` | reactive text / snippet / `html` interpolation (escaped unless `html`-branded) |
| `name={expr}` | reactive attribute (`false`/`null`/`undefined` removes it) |
| `on<event>={fn}` | event listener (`onclick`, `onsubmit`, …) |
| `bind:value={x}` / `bind:checked={x}` / `bind:group={x}` | two-way form binding |
| `bind:value={{ get, set }}` | two-way binding over derived state |
| `{...expr}` | spread props (component) or attributes (element) |

**Control flow** — mustache blocks (`{#…}` open, `{:…}` branch, `{/…}` close):

| Block | Form |
| --- | --- |
| if | `{#if cond}` … `{:elseif cond}` … `{:else}` … `{/if}` |
| for | `{#for item of list by key}` … `{/for}` (`item, i of list`; `{#for await x of source …}` over an AsyncIterable) |
| await | `{#await promise}` pending `{:then value}` … `{:catch error}` … `{/await}` (inline `{#await p then v}`) |
| switch | `{#switch subject}` `{:case value}` … `{:default}` … `{/switch}` |
| try | `{#try}` … `{:catch error}` … `{:finally}` … `{/try}` |
| snippet | `{#snippet row({ msg })}…{/snippet}`, called as `{row({ msg })}` |

**Components & slots** — a capitalised tag (`<Avatar name={…} />`) mounts a child `.abide` component as a marker-bounded range (no wrapper element); its children render where the child calls `{children()}` (guard/fallback with `{#if children}…{:else}…{/if}`). `<style>` is component-scoped.

## Server surface — abide/server/*

### RPC helpers — @documentation rpc

- `abide/server/GET` — declare a read RPC; the bundler rewrites it to a server `defineRpc` or a client `remoteProxy`. Calling it directly throws.
- `abide/server/POST` — declare a creating mutating RPC (carries the durable `outbox` overloads).
- `abide/server/PUT` — declare a replacing mutating RPC.
- `abide/server/PATCH` — declare a partial-update mutating RPC.
- `abide/server/DELETE` — declare a deleting mutating RPC.
- `abide/server/HEAD` — declare a metadata-only read RPC.

### Sockets — @documentation sockets

- `abide/server/socket` — declare a broadcast `Socket<T>` in `src/server/sockets/<name>.ts`; opts (`schema`, `tail`, `ttl`, `clientPublish`, `clients`) live on the server, the client proxy discards them.

### Responses — @documentation response

- `abide/server/json` — JSON `Response` with `Cache-Control: no-store` default; `json(undefined)` emits a 204 that round-trips back to `undefined`. Brands `T` so the RPC infers `Return`.
- `abide/server/jsonl` — wrap an `AsyncIterable<Frame>` as a JSON Lines (`application/jsonl`) streaming response; cancellation flows into the generator's `return()`, errors become a final `{"$error":…}` line.
- `abide/server/sse` — wrap an `AsyncIterable<Frame>` as Server-Sent Events (`text/event-stream`) with a 15s keepalive; errors become an `event: error` frame.
- `abide/server/error` — return a non-2xx wire error (`TypedResponse<never>`); the caller's `await fn(args)` throws `HttpError`, so it never pollutes the inferred success `Return`.
- `abide/server/redirect` — return a 3xx redirect (`TypedResponse<never>`), same inference-neutral shape as `error`.

### Request scope — @documentation request-scope

- `abide/server/request` — the inbound `Request` for the current SSR/RPC pass (AsyncLocalStorage); throws outside a request scope.
- `abide/server/cookies` — the request's `Bun.CookieMap`; reads parse the inbound header, writes flush as `Set-Cookie` on return. Lazy; throws outside a scope.
- `abide/server/server` — the active `Bun.serve` instance; returns a no-op in-process server under a scope without a booted server (CLI/MCP/test), throws before init outside any scope.

### Configuration — @documentation configuration

- `abide/server/env` — validate `Bun.env` against a Standard Schema at boot and return the typed config; reports every issue at once on failure, registers the schema for the bundle setup form.

### Observability — @documentation observability

- `abide/server/reachable` — server-only outbound reachability: `await reachable(host)` HEADs the origin, caches the verdict, and background-polls every TTL so later calls resolve instantly.

### Bundle data — @documentation bundle

- `abide/server/appDataDir` — the running desktop bundle's per-user data dir, keyed by the program name; cwd-independent, pure.

### Agent — @documentation agent

- `abide/server/agent` — run a provider engine against the app's own MCP surface (`agent(engine, messages)`) and yield a neutral `AgentFrame` stream; the handler frames it with `jsonl()`/`sse()`. Exports `NeutralMessage` / `AgentFrame` / `AgentEngine`.

### Plumbing — @documentation plumbing

- `abide/server/AppModule` — the optional `src/app.ts` hook shape (`init` → cleanup, single-middleware `handle`, `handleError`).
- `abide/server/InspectorContext` — the capability bundle core injects into `@abide/inspector` when `ABIDE_ENABLE_INSPECTOR=true`, so the inspector stays a pure consumer.
- `abide/server/rpc/defineRpc` — server-side RPC construction from method + URL + handler; the bundler's server-target rewrite emits it. Records the synthesized Request for `cache()`.
- `abide/server/sockets/defineSocket` — server-side socket construction; the bundler's server-target rewrite binds the file-path name into real fan-out over `server.publish`.
- `abide/server/prompts/definePrompt` — register an MCP prompt from a name + options; the resolver plugin emits it per `src/mcp/prompts/<name>.md`.
- `abide/server/prompts/renderPromptTemplate` — substitute `{{name}}` placeholders in a prompt body (missing args collapse to empty).

## Isomorphic surface — abide/shared/*

### Responses — @documentation response

- `abide/shared/HttpError` — thrown by remote-function calls on a non-2xx response; carries the raw `Response` (status/`statusText`/headers/body) plus the typed-error layer parsed off a `{ $abideError, data }` body: `.kind` (the declared error name, `'validation'`, or the framework-reserved `'queued'`) and `.data` (`unknown` — narrow yourself; `ValidationErrorData` for `'validation'`). Both undefined for a plain `error(status, text)`.
- `abide/shared/ValidationErrorData` — the `data` a `kind: 'validation'` HttpError (422) carries: `{ issues, fields }` — the raw Standard Schema issue list plus the form-friendly field → first-message map.

### Schema projection — @documentation rpc

- `abide/shared/withJsonSchema` — attach a `toJSONSchema()` projection to a Standard Schema whose library lacks one, feeding OpenAPI / MCP / CLI / the setup form.

### Templating — @documentation templating

- `abide/shared/html` — a `` html`…` `` tag marking trusted raw markup that a `{expr}` inserts verbatim (registered-Symbol brand, survives bundle copies).
- `abide/shared/snippet` — the `Snippet<Payload>` brand a `{#snippet}` carries: a DOM builder on the client, pre-rendered HTML on the server.

### Cache — @documentation cache

- `abide/shared/cache` — curry a call against a store: `cache(fn, options?)` returns an invoker that coalesces in-flight calls and retains by `ttl` (undefined = forever, 0 = dedupe-only). Reactive (subscribes the reading scope), isomorphic, `options.global` for the process store. `cache.invalidate` / `cache.on` address entries by selector.

### Page — @documentation page

- `abide/shared/page` — the reactive page proxy (matched route, decoded `params`, browser-space `url`, `navigating`); isomorphic, re-runs readers on navigation.

### Probes — @documentation probes

- `abide/shared/pending` — reactive "no value yet" probe over the cache + tail registries; selector grammar `pending(fn)` / `pending(fn, args)` / `pending({ tags })` / `pending(subscribable)`. Counts undelivered durable-outbox entries.
- `abide/shared/refreshing` — reactive "holding a value while a fresher source is in flight" probe; same selector grammar.
- `abide/shared/online` — the client/server-reported connectivity boolean (the inbound counterpart to `reachable`).

### URL — @documentation url

- `abide/shared/url` — typed URL builder: `url('/rpc/search', { q })` types args against the generated `RpcRoutes`, falling through to page/asset paths; base-correct.

### Observability — @documentation observability

- `abide/shared/health` — reactive backend health (`reachable` + the app `health()` hook's fields), polled from `/__abide/health` only while a tracking scope reads it; constant `{ reachable: true }` on the server.
- `abide/shared/log` — the unified logger: `log`/`warn`/`error`/`trace` on the app's always-on channel, `log.channel(name)` on a DEBUG-gated channel; tsv default or JSON per line (`ABIDE_LOG_FORMAT=json`). Carries request-scope context.
- `abide/shared/trace` — the current request's W3C `traceparent`, isomorphic (ALS on the server, `__SSR__` stamp in the browser); undefined outside a scope.

### Plumbing — @documentation plumbing

- `abide/shared/createSubscriber` — abide-ui-native open-on-first-read / close-on-last-reader subscriber over abide's own signal core (the lifecycle `cache`/`tail`/`health` reuse).

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `abide/ui/scope` — resolve a lexical scope: `scope()` is the current one (compiler-established per level), `scope('/')` the tree root; the returned value is passable to children/helpers.

### Streaming — @documentation tail

- `abide/ui/tail` — reactive consumer for a `Subscribable<T>` (a `Socket<T>` or `fn.stream(args)`): bare form is latest-wins (`T | undefined`), `{ last: n }` is a live window (`T[]`); reconnect keeps the value and flags `refreshing`. No-op on the server. `tail.error` / `tail.status` address the same entry.

### Navigation — @documentation navigate

- `abide/ui/navigate` — programmatic SPA navigation typed off the page routes; `NavigateOptions` carries `replace` / `keepScroll`. Delegates path-building to `url`.

### Outbox — @documentation ui

- `abide/ui/outbox` — the global reactive view of every durable-RPC outbox: a flat list of undelivered entries tagged with their `rpc`, `outbox.retry()` to drain all queues. A single RPC's slice is `rpc.outbox`. Empty on the server. Exports `GlobalOutboxEntry`.

### Plumbing — @documentation plumbing

- `abide/ui/effect` — abide's reaction primitive: run `fn` now, re-run on dep change, optional (async) teardown; returns a dispose. The runtime target the compiler emits for `scope().effect`.
- `abide/ui/enterScope` — open a fresh lexical scope for an SSR render, returning the previous to restore.
- `abide/ui/exitScope` — restore the scope `enterScope` saved.
- `abide/ui/remoteProxy` — the client-side RPC substitute the bundler emits per export: fetches, decodes by Content-Type, throws `HttpError`; a durable (`outbox`) RPC parks an unreachable request for replay as a side-effect. Exports `DurableOptions`.
- `abide/ui/socketProxy` — the client-side socket substitute: subscribe/publish over the multiplexed ws channel, same `Socket` shape as the server.
- `abide/ui/startClient` — the official client entry: read `__SSR__`, seed the warm cache store, install the mount base, start the router.
- `abide/ui/router` — the History-API client router: match the path, import the page chunk + its layout chain, mount the chain into nested `{children()}` outlets.
- `abide/ui/renderToStream` — out-of-order SSR streaming: shell first, then one `<abide-resolve>` fragment per streaming `{#await}` as it settles.
- `abide/ui/runtime/escapeKey` — escape one object key into a JSON-Pointer token (`~0`/`~1`) so a key with `/` or `~` survives a `/`-joined path.
- `abide/ui/runtime/nextBlockId` — the next block id in the current render pass (document order), so page and child ids don't collide.
- `abide/ui/runtime/enterRenderPass` — mark entry into a render/mount; the outermost resets the block-id counter.
- `abide/ui/runtime/exitRenderPass` — mark exit from a render/mount, unwinding the depth.
- `abide/ui/dom/mount` — mount a top-level page/layout into a host element under an ownership scope; returns a disposer.
- `abide/ui/dom/mountChild` — mount a child component as a marker-bounded range (no wrapper); hot path keeps the range for in-place HMR re-fill.
- `abide/ui/dom/mountSlot` — mount a component's `{children()}` content as a marker range (the parent's `$children`); renders once.
- `abide/ui/dom/outlet` — a layout's `{children()}` outlet as an empty comment boundary the router fills with the next chain layer.
- `abide/ui/dom/mergeProps` — compose a child's props from ordered layers (explicit thunks, spreads, the `$children` slot), last layer wins per key.
- `abide/ui/dom/spreadProps` — wrap a `{...source}` props layer so each key resolves to a live value thunk; the source thunk re-reads reactively.
- `abide/ui/dom/restProps` — the unconsumed props of a `const { a, ...rest } = props()` as a live object (each thunk unwrapped on read; page/layout route params arrive as thunks too).
- `abide/ui/dom/spreadAttrs` — spread an object's keys onto a native element (`<div {...rest}>`): keys enumerated once, each value live; `on*` keys attach as listeners.
- `abide/ui/dom/attr` — bind one element attribute to `read()` (boolean present/absent, else stringified); one effect per attribute.
- `abide/ui/dom/on` — attach an event listener scoped to the owning component (the `onclick={…}` runtime target), pinned to its `scope()`.
- `abide/ui/dom/attach` — run a node-lifetime attachment at build time with optional teardown (the dual of `on`); may be async.
- `abide/ui/dom/text` — a text node tracking `read()` via one effect (plain text, `String()`-coerced).
- `abide/ui/dom/appendText` — a reactive `{expr}` interpolation (escaped text, snippet, or `html`); claims and splits merged SSR text on hydrate.
- `abide/ui/dom/appendTextAt` — a reactive `{expr}` mounted at a skeleton anchor, for text interleaved with element siblings.
- `abide/ui/dom/appendStatic` — a static (non-reactive) text node, claimed/split from SSR text on hydrate.
- `abide/ui/dom/appendSnippet` — a `{snippet(args)}` interpolation mounted in a marker-bounded range; reactive in its args.
- `abide/ui/dom/cloneStatic` — append a fully-static subtree from a compiler skeleton string (byte-identical to SSR markup).
- `abide/ui/dom/skeleton` — realize a compiled skeleton under a parent and return its element holes (pre-order) + anchor holes (document order); the parser is the tree-builder, so foreign content lands namespaced.
- `abide/ui/dom/anchorCursor` — position a skeleton-anchored control-flow block or slot relative to its `<!--a-->` marker.
- `abide/ui/dom/readCall` — a guarded method call on a reactive-doc read, so a nullish throw names the authored scope path instead of the desugared call.
- `abide/ui/dom/hydrate` — adopt server-rendered DOM: run `build` with a claim cursor so dom helpers take existing nodes; returns a disposer.
- `abide/ui/dom/each` — the keyed `{#for … by key}` runtime: each row a marker-bounded range reconciled by key.
- `abide/ui/dom/eachAsync` — the async `{#for await … by key}` runtime over an `AsyncIterable`; SSR renders no rows.
- `abide/ui/dom/when` — the `{#if}` (+ `{:else}`) runtime: a branch range swapped on a truthy↔falsy flip.
- `abide/ui/dom/awaitBlock` — the `{#await}` runtime: pending → resolved/error branch on settle, each a range.
- `abide/ui/dom/tryBlock` — the `{#try}` runtime: a synchronous error boundary; build throw → `{:catch}` branch, no catch re-throws.
- `abide/ui/dom/switchBlock` — the `{#switch}` runtime: first `===`-matching case (or default), each a range.
- `abide/ui/dom/applyResolved` — bundle-side consumer of an SSR stream chunk (streaming SPA nav, socket-delivered SSR): seed cache partitions and swap await boundaries.

## Build / tooling

### Building — @documentation building

- `abide/build` — build the client bundle into `dist/_app` (Bun.build + the `.abide` loader, virtual-module resolver, optional Tailwind; `compress` writes `.gz` siblings).
- `abide/compile` — produce a standalone Bun server executable (runs `build` first to embed assets); returns the binary path.

### Plumbing — @documentation plumbing

- `abide/preload` — the Bun preload entry that installs the `.abide` loader + resolver for `abide run` and `bun test`.
- `abide/resolver-plugin` — the Bun plugin wiring every build-time virtual import (`abide:rpc` / `abide:sockets` / `abide:pages` / `abide:prompts` / `abide:app` …).
- `abide/ui-plugin` — the Bun plugin that compiles each `.abide` single-file component (and `layout.abide`) to its ES module.
- `abide/tsconfig` — the shareable base `tsconfig` (`tsconfig.app.json`) projects extend.

## Desktop bundle — abide/bundle/*

### Bundle — @documentation bundle

- `abide/bundle/BundleWindow` — the optional `src/bundle/window.ts` default-export shape (title, size, menus); baked into the launcher.
- `abide/bundle/BundleMenu` — a top-level menu inserted into the macOS menu bar (`label` + `items`).
- `abide/bundle/BundleMenuItem` — one menu entry: a divider or a clickable item that dispatches an `abide:menu` CustomEvent into the page.
- `abide/bundle/onMenu` — subscribe to bundle menu clicks (catch-all or per-name), returning an unsubscribe.
- `abide/bundle/bundled` — `true` when the code runs inside the abide desktop bundle; isomorphic, detected per side.

## MCP — abide/mcp/*

### MCP — @documentation mcp

- `abide/mcp/createMcpServer` — construct the MCP server bound to the project's RPC registry; its `handle(request)` backs `/__abide/mcp`. Framework-internal (the `abide:mcp` virtual default-constructs it).

## Testing — abide/test/*

### Testing — @documentation testing

- `abide/test/createTestApp` — an in-process test app exposing `app.rpc.<rpc>` / `app.sockets.<name>` typed against the project's generated surface (no network, no imports).

### Plumbing — @documentation plumbing

- `abide/test/createScriptedSurface` — a scripted `AgentSurface` for engine tests: declarative tool stubs in, an MCP surface out, every `call` recorded.
- `abide/test/assertAgentFrameConformance` — collect an engine's frame stream and assert the neutral `AgentFrame` contract (one terminal `done`, every `tool_use` answered, …).

## Generated machine surfaces

Runtime routes the framework serves:

| Route | Serves |
| --- | --- |
| `/openapi.json` | the OpenAPI document projected from every RPC schema |
| `/__abide/mcp` | the MCP endpoint (tools/prompts from the RPC + prompt registries) |
| `/__abide/health` | the health payload (`reachable` + the app `health()` hook's fields) |
| `/__abide/sockets` | the multiplexed WebSocket hub (and `/__abide/sockets/<name>` HTTP face) |
| `/__abide/cli` | the CLI manifest the `abide cli` binary reads |
| `/__abide/identity` | the server identity the bundle/CLI client probes |
| `/__abide/inspector` | the inspector surface (when `ABIDE_ENABLE_INSPECTOR=true`) |
| `/__abide/hot` | the dev hot-reload channel |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | server listen port (unset → abide scans from a default) |
| `APP_URL` | public origin; its pathname becomes the app's mount base (sub-path hosting) |
| `ABIDE_APP_URL` | runtime URL of the server the bundle/CLI client connects to |
| `ABIDE_APP_TOKEN` | bearer token the bundle/CLI client sends to an authenticated remote server |
| `ABIDE_CLIENT_TIMEOUT` | client-side per-call fetch timeout (ms); a breach surfaces as a 504 `HttpError` |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | default inbound request-body byte cap (a per-RPC `maxBodySize` overrides) |
| `ABIDE_IDLE_TIMEOUT` | Bun per-connection idle timeout (seconds) |
| `ABIDE_DATA_DIR` | override the per-user app data dir on every platform (used as-is) |
| `ABIDE_REACHABLE_TTL` | `reachable()` poll cadence / freshness window (ms) |
| `ABIDE_REACHABLE_TIMEOUT` | `reachable()` per-HEAD probe bound (ms) |
| `ABIDE_LOG_FORMAT` | `json` switches the logger from tsv to one JSON object per line |
| `DEBUG` | enable DEBUG-gated diagnostic log channels (npm-debug conventions, e.g. `abide`, `abide:*`) |
| `ABIDE_ENABLE_INSPECTOR` | inject the `InspectorContext` into `@abide/inspector` (exposes all traffic; trusted use only) |
| `ABIDE_INSPECT` | enable the desktop bundle's right-click → Inspect web-inspector (off in release bundles) |

---

This map mirrors the `exports` map in `package.json`. After adding or renaming an export, run `bun run packages/abide/scripts/readmeSurfaces.ts` and update the matching section here.
