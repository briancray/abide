# AGENTS.md — abide complete surface map

> The exhaustive public-surface map: every `exports` key in
> `packages/abide/package.json`, grouped by namespace, each with its import
> specifier and a one-line spec, plus the file conventions, CLI, generated
> routes, environment variables, and the `.abide` template grammar. Where the
> `README.md` is the curated three-primitive intro (RPC + socket + component),
> this is the complete reference. `CONTEXT.md` is the domain glossary and
> `docs/adr/` the rationale.
>
> Package `@abide/abide`, runtime Bun `>=1.3.0`, one direct dependency
> (TypeScript; `tailwindcss` / `bun-plugin-tailwind` are optional styling
> peers). No barrels: every public name has its own module path, and the
> namespace marks the side it runs on — `abide/server/*` server-only,
> `abide/ui/*` client-only, `abide/shared/*` isomorphic (same callable, same
> behaviour on both sides). Import specifiers below are the `@abide/abide/…`
> keys; the file path each maps to is an implementation detail.

## The premise

One typed RPC declaration fans out to five faces:

```text
                    ┌─ SSR call       cache(getMessages, { room })
                    ├─ browser fetch  getMessages({ room }) (typed proxy)
  getMessages (GET) ┼─ MCP tool       read-only + schema (auto-exposed)
                    ├─ CLI subcommand the generated CLI binary
                    └─ OpenAPI op     /openapi.json
```

An `inputSchema` (Standard Schema — zod / valibot / arktype, unadapted) unlocks
the CLI for any rpc and, for a read-only method (`GET`/`HEAD`), the MCP tool. A
mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) never auto-exposes to MCP; it
needs an explicit `clients: { mcp: true }`. Explicit `clients` always wins.

## File-based conventions

The bundler reads these paths and generates the wiring:

| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | An RPC per file; path → URL `/rpc/<name>`, export name → HTTP method. |
| `src/server/sockets/<name>.ts` | A socket per file; path → the socket's identity. |
| `src/server/config.ts` | `env(schema)` config, eager-imported so a bad env fails boot. |
| `src/app.ts` | Optional `AppModule` hooks (`init`/`handle`/`handleError`/`health`/`forwardHeaders`). |
| `src/ui/pages/**/page.abide` | A routed page; a `[id]` segment → `page.params.id`. |
| `src/ui/pages/**/layout.abide` | A layout wrapping nested routes; its `{children()}` is the outlet. |
| `src/ui/**/*.abide` | A component, imported via `$ui/…`. |
| `src/ui/public/` | Static assets served at the site root. |
| `src/mcp/prompts/<name>.md` | An MCP prompt (front-matter + template body). |
| `src/mcp/resources/` | Static MCP resources. |
| `src/bundle/window.ts` | Default-exported `BundleWindow` config for the desktop bundle. |
| `src/.abide/*.d.ts` | Generated ambient types (typed `url()`, `health()`, routes). |
| `dist/_app/` | Client build output; `dist/` holds the production server. |

## CLI

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | Scaffold the template, install, and (in a TTY) start dev. `--no-install` / `--no-dev` opt out. |
| `abide dev` | Build the client + run the server child with hot reload. |
| `abide build` | Build the client bundle into `dist/_app/` (no server). |
| `abide start` | Run the production server against an already-built `dist/`. |
| `abide run <file> [args]` | Run a script under the abide preload (same runtime as the server). |
| `abide compile` | Produce a standalone Bun server executable (`--target` / `--out`). |
| `abide cli` | Build the thin CLI client binary (`--platforms a,b,c` cross-compiles). |
| `abide bundle` | Assemble a self-contained desktop app bundle for the host platform. |
| `abide check` | Type-check every `.abide` template + props; non-zero on any error. |
| `abide lsp` | Run the `.abide` language server over stdio (editor diagnostics). |
| `abide init-agent` | Write/refresh the agent-guide pointer in the project's root `CLAUDE.md`. |

For tests, add the preload so the `.abide` loader + virtual resolver are active:
`preload = ["@abide/abide/preload"]` under `[test]` in `bunfig.toml`.

## Authoring contracts

- **RPC** (`GET`/`POST`/… in `src/server/rpc/<name>.ts`): the handler receives
  `InferOutput<inputSchema>` (or raw args), reads `request()` / `cookies()`, and
  returns `json` / `jsonl` / `sse` / `error` / `redirect` / an `error.typed`
  constructor / a raw `Response`. Options: `inputSchema`, `outputSchema`,
  `filesSchema` (File parts → `files()`, validated), `clients:{ browser, mcp,
  cli }`, `crossOrigin` (exempt a mutating rpc from the same-origin CSRF gate),
  `timeout` (a 504 on every surface), `maxBodySize` (413 past it), `outbox: true`
  (durable delivery on a mutating rpc). GET/DELETE/HEAD args travel as query
  strings — use `z.coerce.*`. Consume forms: `cache(fn, args?, options?)` (SSR /
  in-process read-through), `fn(args)` (browser fetch, throws `HttpError`),
  `fn.raw(args)` (raw `Response`), and the bound selectors
  `fn.cache/pending/refreshing/invalidate/error`. A streaming handler
  (`jsonl`/`sse`) makes the bare call return a `Subscribable` — `for await` or
  `state(fn(args))`; `await fn(args)` is a compile error.
- **Socket** (`socket(opts)` in `src/server/sockets/<name>.ts`): options
  `schema`, `tail` (retained-frame count), `ttl` (lazy eviction of retained
  frames), `clients`, `clientPublish`. `Socket<T>` is an isomorphic
  `AsyncIterable<T>`; `.publish(m)` fans out, `.tail(n)` replays. Consume live
  frames with `tail(chat)` / `tail(chat, { last })` in the UI.
- **Page / layout**: a `page.abide` under `src/ui/pages/`; `[id]` dynamic
  segments surface on `page.params`; `layout.abide` wraps nested routes with
  `{children()}` as its outlet. Read the active route reactively via `page`;
  navigate with `navigate()` and build hrefs with `url()`.
- **`src/app.ts`** exports the optional `AppModule` hooks; **`src/server/config.ts`**
  exports `env(schema)`.
- **Isomorphism move**: read data through `cache()` so an SSR-blocking `await`
  bakes the value into the initial HTML and the client hydrates warm from the
  streamed cache snapshot.

## .abide template grammar

A `.abide` file is a component: a leading `<script>` (module scope: imports +
setup), template markup, and a root `<style>` (component-scoped). Derived from
the parser (`src/lib/ui/compile/parseTemplate.ts`), never from `examples/`.

**Ambient authoring names**: `props()` (prop reader, no import) and `children()`
(the single slot fill point). Reactive primitives are ordinary imports —
`state` (`abide/ui/state`), `effect` (`abide/ui/effect`), `html` (`abide/ui/html`),
`snippet` (`abide/shared/snippet`) — recognised by import binding (alias-safe).

Reactive state:

| Form | Meaning |
| --- | --- |
| `let x = state(v, transform?)` | Writable cell; read/write `x.value`. `transform` gates writes. |
| `state<T>()` | Writable cell of `T \| undefined` (typed no-arg). |
| `const d = state.computed(() => …)` | Read-only derived cell; lazy, never serialized. |
| `const l = state.linked(() => src, transform?)` | Writable cell reseeded when the thunk's deps change. |
| `state.share(key, value)` / `state.shared(key)` | Put / read a named value on the ambient scope. |
| `effect(() => teardown?)` | Run + re-run on dep change; client-only (stripped from SSR). |
| `const { a = fallback, ...rest } = props()` | Ambient prop reader. |

Bindings and directives (on an element and on a component alike):

| Form | Meaning |
| --- | --- |
| `{expr}` | Reactive text (escaped). |
| `{html`…`}` / `{html(str)}` | Trusted raw-HTML insertion (opt-in; no auto-escape). |
| `name={expr}` | Attribute / prop bound to an expression. |
| `name="… {expr} …"` | Interpolated string attribute / prop. |
| `on<event>={fn}` | Event listener (e.g. `onclick`, `onsubmit`). |
| `bind:value={x}` / `bind:checked={x}` / `bind:group={x}` | Two-way form binds. |
| `bind:value={{ get, set }}` | Derived two-way binding (a writable computed at the site). |
| `class:name={cond}` | Toggle a class. |
| `style:property={value}` | Set one style property. |
| `attach={fn}` | Run `fn(node)` at build; optional teardown return. |
| `{...expr}` | Spread an object's keys as props (component) / attributes (element). |

Control flow — mustache `{#…}` blocks (the `<template if>` / `<slot>` forms were
removed; a bare `<template>` is now an inert element and a removed form throws a
migration error):

| Block | Branches |
| --- | --- |
| `{#if cond}` … `{/if}` | `{:else if cond}`, `{:else}` |
| `{#for item, i of list by key}` … `{/for}` | (keyed list; `, i` and `by key` optional) |
| `{#for await item of source}` … `{/for}` | `{:catch e}` (over an `AsyncIterable`) |
| `{#await promise}` … `{/await}` | `{:then v}`, `{:catch e}`, `{:finally}` |
| `{#switch subject}` … `{/switch}` | `{:case value}`, `{:default}` |
| `{#try}` … `{/try}` | `{:catch e}`, `{:finally}` |
| `{#snippet name(args)}` … `{/snippet}` | reusable builder, invoked `{name(args)}` |

Components are capitalised tags; nested content renders where the child calls
`{children()}` (fallback: `{#if children}{children()}{:else}…{/if}` — no named
slots). A `<script>` or `<style>` may sit inside a control-flow branch, scoped to
that branch: a nested `<script>` declares branch-local `state`/`state.computed`/
`effect` (inherited by canonical name — it carries no imports, which must live in
the leading `<script>`), and a nested `<style>` scopes to its sibling subtree.

## Server surface — abide/server/*

### RPC helpers — @documentation rpc

- `@abide/abide/server/GET` — declare a `GET` rpc (read; schema → CLI + MCP auto-exposed).
- `@abide/abide/server/POST` — declare a `POST` rpc (mutating; body args or `FormData`).
- `@abide/abide/server/PUT` — declare a `PUT` rpc (mutating).
- `@abide/abide/server/PATCH` — declare a `PATCH` rpc (mutating).
- `@abide/abide/server/DELETE` — declare a `DELETE` rpc (mutating; query args).
- `@abide/abide/server/HEAD` — declare a `HEAD` rpc (read; headers only).

### Response helpers — @documentation response

- `@abide/abide/server/json` — JSON `Response` from a value (typed body for the caller).
- `@abide/abide/server/jsonl` — wrap an `AsyncIterable` as a JSON-Lines streaming `Response`.
- `@abide/abide/server/sse` — wrap an `AsyncIterable` as a Server-Sent-Events streaming `Response` (15s keepalive).
- `@abide/abide/server/error` — plain-text error `Response`; `error(status, message?, init?)`, message defaults to the reason phrase. `error.typed(name, status, schema?)` builds a reusable typed-error constructor branded onto `fn.isError`/`fn.error()`.
- `@abide/abide/server/redirect` — redirect `Response` accepting relative URLs, default 302.

### Request scope — @documentation request-scope

- `@abide/abide/server/request` — the inbound `Request` for the current SSR/RPC pass (throws outside a scope).
- `@abide/abide/server/cookies` — the request's `Bun.CookieMap`; reads parse the inbound header, writes flush as `Set-Cookie`.
- `@abide/abide/server/server` — the live `Bun.Server` inside a request scope.

### Sockets — @documentation sockets

- `@abide/abide/server/socket` — declare a broadcast `Socket<T>` (`{ schema, tail, ttl, clients, clientPublish }`).

### Configuration — @documentation configuration

- `@abide/abide/server/env` — validate `Bun.env` against a Standard Schema at boot; returns typed config, registers it for the setup form.

### Observability — @documentation observability

- `@abide/abide/server/reachable` — server-only cached outbound host reachability; `await reachable(host)` HEADs the origin, background-polls per TTL.

### Agent — @documentation agent

- `@abide/abide/server/agent` — run a model engine against the app's own MCP surface; `agent(engine, messages)` returns the engine's neutral `AgentFrame` stream (wrap in `jsonl`/`sse`).

### Desktop bundle — @documentation bundle

- `@abide/abide/server/appDataDir` — the running bundle's per-user data dir, keyed by the program name (cwd-independent, pure).

### Plumbing — @documentation plumbing

- `@abide/abide/server/rpc/defineRpc` — the runtime the bundler rewrites each rpc export into (method + URL + handler + opts). Not hand-authored.
- `@abide/abide/server/sockets/defineSocket` — the runtime the bundler rewrites each `socket(opts)` export into (name + opts). Not hand-authored.
- `@abide/abide/server/prompts/definePrompt` — the runtime a generated `src/mcp/prompts/<file>.md` module calls to register a prompt.
- `@abide/abide/server/prompts/renderPromptTemplate` — interpolate `{{arg}}` placeholders in a prompt template body with string args.
- `@abide/abide/server/AppModule` — the type of the optional `src/app.ts` hooks (`init`/`handle`/`handleError`/`health`/`forwardHeaders`).
- `@abide/abide/server/InspectorContext` — the context type the inspector surface receives.

## Isomorphic surface — abide/shared/*

### Cache — @documentation cache

- `@abide/abide/shared/cache` — read-through cache: `cache(fn, args?, options?)` returns a shared promise, coalescing identical in-flight calls. Options: `ttl` (undefined = forever, 0 = dedupe-only, N ms = expiry), `global` (process store), `tags`, `swr`, `throttle`/`debounce` (refetch rate-limit). `cache.invalidate(selector?, args?)` drops matching entries; `cache.refresh(selector?, args?)` refetches matching entries keeping the stale value visible (the smart-call refetch; see `./shared/refresh`); `cache.patch(selector, args, updater)` mutates matching retained values locally with no network (see `./shared/patch`); `cache.on(source, handler)` invalidates off a stream. `cache.read(fn, args?, options?)` is the smart bare-call read-through (internal wiring for `getFoo(args)`): a replayable read is coalesced + retained (SWR unconditional, `ttl` drives background revalidation not eviction), a write is coalesce-only. Streaming rpcs are not cacheable (compile error).

### Probes — @documentation probes

- `@abide/abide/shared/pending` — reactive "no value yet" probe over cache calls + tail streams; `pending()` / `pending(fn)` / `pending(fn, args)` / `pending({ tags })` / `pending(subscribable)`.
- `@abide/abide/shared/refreshing` — reactive "holding a value while a fresher one is in flight" probe; same selector grammar as `pending`.
- `@abide/abide/shared/done` — reactive stream-terminal probe; true once a subscribable has closed (`tail` status `done`). Stream-only.
- `@abide/abide/shared/online` — reactive connectivity probe; the browser's `navigator.onLine` (client) or the calling client's reported offline header (server).

### Page — @documentation page

- `@abide/abide/shared/page` — the reactive page proxy: `page.route`, `page.params`, `page.url`, `page.navigating` — isomorphic across SSR and hydration.

### URL — @documentation url

- `@abide/abide/shared/url` — resolve any in-app URL to its base-correct, typed form (rpc query args, page params, or bare path); external URLs pass through.

### Templating — @documentation templating

- `@abide/abide/shared/snippet` — brand a payload as a `Snippet` so a `{expr}` interpolation mounts it (a DOM builder on the client, a pre-rendered string on the server).

### Responses — @documentation response

- `@abide/abide/shared/HttpError` — the error a non-2xx remote call throws; carries `status`, `statusText`, the raw `response`, and `kind`/`data` for a typed error.
- `@abide/abide/shared/ValidationErrorData` — the shape of a 422 validation error's `.data` (the Standard Schema issue list).

### RPC schema — @documentation rpc

- `@abide/abide/shared/withJsonSchema` — attach a hand-written JSON Schema to a Standard Schema so the OpenAPI/MCP/CLI projection uses it verbatim.

### Observability — @documentation observability

- `@abide/abide/shared/health` — `AppHealth` / `HealthState` types for the `health()` payload, augmented by the generated `health.d.ts`.
- `@abide/abide/shared/log` — the unified request-context logger: `log`/`warn`/`error`/`trace` on the app channel, `log.channel(name)` for a DEBUG-gated channel; tsv or `ABIDE_LOG_FORMAT=json`.
- `@abide/abide/shared/trace` — the current request's short trace id (undefined outside a scope).

### Plumbing — @documentation plumbing

- `@abide/abide/shared/createSubscriber` — the open-on-first-read / close-on-last-reader subscriber primitive backing `tail`/`online` (grounded in abide's signal core).

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `@abide/abide/ui/state` — the `state` callable + `.computed` / `.linked` / `.share` / `.shared` members (see the grammar tables). Imported and called bare in a `.abide` `<script>`.

### Effect — @documentation effect

- `@abide/abide/ui/effect` — the `effect(fn)` primitive: run + re-run on dep change, optional teardown; client-only (SSR strips it).

### Tail — @documentation tail

- `@abide/abide/ui/tail` — reactive consumer of a `Subscribable` (socket or streaming rpc): `tail(src)` latest-wins (`T | undefined`), `tail(src, { last })` a live window (`T[]`); `tail.error(src)` / `tail.status(src)` address the same entry. No-op on the server.

### UI — @documentation ui

- `@abide/abide/ui/outbox` — the global durable-write outbox: `outbox()` lists every parked entry across rpcs, `outbox.retry()` drains every queue.

### Templating — @documentation templating

- `@abide/abide/ui/html` — mark a string as trusted raw HTML for `{expr}` insertion; `html(str)` plain or `` html`…` `` tagged. No `{@html}` mustache.

### Navigate — @documentation navigate

- `@abide/abide/ui/navigate` — client navigation to a typed in-app path; `navigate('/p/[id]', { id }, options?)`, built through `url()`. `replace` / `keepScroll` options.

### Plumbing — @documentation plumbing

- `@abide/abide/ui/currentScope` — resolve the current lexical scope (`scope()`); the internal lowering host generated code + the type shadow import, not authored.
- `@abide/abide/ui/enterRenderScope` — open a fresh SSR render scope, returning the previous one.
- `@abide/abide/ui/exitRenderScope` — restore the scope `enterRenderScope` saved.
- `@abide/abide/ui/router` — the client router: mounts pages/layouts into a host, restores scroll, optionally probes navigations through the server's `app.handle`.
- `@abide/abide/ui/startClient` — boot the client runtime: seed the cache/health/page from `__SSR__`, hydrate, start the router.
- `@abide/abide/ui/renderToStream` — out-of-order SSR streaming: yield the shell, then one resolved fragment per streaming `await` block as it settles.
- `@abide/abide/ui/remoteProxy` — the browser-side rpc runtime the bundler swaps in (fetch over the network; durable `outbox` park-on-unreachable).
- `@abide/abide/ui/socketProxy` — the browser-side socket runtime the bundler swaps in (subscribe over the multiplexed ws channel).
- `@abide/abide/ui/dom/mount` — mount a top-level page/layout into a host element.
- `@abide/abide/ui/dom/mountChild` — mount a nested child component as a comment-anchored range.
- `@abide/abide/ui/dom/mergeProps` — compose a child's props from ordered explicit + spread layers.
- `@abide/abide/ui/dom/spreadProps` — wrap a `{...source}` prop-spread layer as live value thunks.
- `@abide/abide/ui/dom/restProps` — the live `...rest` of a component's props.
- `@abide/abide/ui/dom/spreadAttrs` — spread an object's keys onto a native element's attributes.
- `@abide/abide/ui/dom/readCall` — guarded method call on a reactive-document read.
- `@abide/abide/ui/dom/hydrate` — adopt server-rendered DOM instead of rebuilding it.
- `@abide/abide/ui/dom/text` — a text node tracking a reactive `read()`.
- `@abide/abide/ui/dom/appendText` — a reactive `{expr}` interpolation appended under a parent.
- `@abide/abide/ui/dom/appendTextAt` — a reactive `{expr}` interpolation mounted at a skeleton anchor comment.
- `@abide/abide/ui/dom/appendSnippet` — mount a branded snippet builder's nodes in a range.
- `@abide/abide/ui/dom/appendStatic` — append a static (non-reactive) text node.
- `@abide/abide/ui/dom/cloneStatic` — append a fully-static cloned subtree.
- `@abide/abide/ui/dom/skeleton` — clone a static template and expose its binding holes by path/anchor.
- `@abide/abide/ui/dom/anchorCursor` — position a skeleton-anchored control-flow block or slot at its `<!--a-->` anchor.
- `@abide/abide/ui/dom/mountSlot` — mount a component's slot content as a marker-bounded range.
- `@abide/abide/ui/dom/outlet` — a layout's `<!--abide:outlet-->` range where nested route content mounts.
- `@abide/abide/ui/dom/attr` — bind an element attribute to a reactive `read()`.
- `@abide/abide/ui/dom/on` — attach an event listener and register its removal with the owning scope.
- `@abide/abide/ui/dom/attach` — run an `attach={fn}` against an element and register its teardown.
- `@abide/abide/ui/dom/each` — the keyed-list runtime for `{#for … by key}`.
- `@abide/abide/ui/dom/eachAsync` — the async keyed-list runtime for `{#for await … of …}`.
- `@abide/abide/ui/dom/when` — the conditional runtime for `{#if}` (with optional else).
- `@abide/abide/ui/dom/awaitBlock` — the async runtime for `{#await}` (pending / then / catch / finally).
- `@abide/abide/ui/dom/tryBlock` — the synchronous error-boundary runtime for `{#try}`.
- `@abide/abide/ui/dom/switchBlock` — the multi-branch runtime for `{#switch}` and `{#if}` chains.
- `@abide/abide/ui/dom/applyResolved` — the bundle-side consumer that swaps an SSR stream fragment into its `await` boundary.
- `@abide/abide/ui/runtime/escapeKey` — JSON-Pointer-escape one object key (`~`/`/`) for a reactive-doc path segment.
- `@abide/abide/ui/runtime/nextBlockId` — the next block id in the current render pass (await/try boundaries).
- `@abide/abide/ui/runtime/enterRenderPass` — mark entry into a render/mount; the outermost resets the block-id counter.
- `@abide/abide/ui/runtime/exitRenderPass` — mark exit from a render/mount, unwinding the pass depth.

## Build / tooling

### Building — @documentation building

- `@abide/abide/build` — build the client bundle into `dist/_app/` (Bun.build with the `.abide` loader + virtual resolver + optional Tailwind + optional gzip).
- `@abide/abide/compile` — produce a standalone Bun server executable (runs the client build first).

### Testing — @documentation testing

- `@abide/abide/test/createTestApp` — spin up an in-memory abide app (rpc/socket/MCP surfaces) for tests.

### Plumbing — @documentation plumbing

- `@abide/abide/preload` — the Bun preload that installs the `.abide` loader + virtual resolver (`[test]` preload, `abide run`).
- `@abide/abide/resolver-plugin` — the Bun plugin wiring every `abide:*` virtual module and rewriting rpc/socket modules per target.
- `@abide/abide/ui-plugin` — the Bun plugin that loads `.abide` single-file components (compiles each to an ES module).
- `@abide/abide/tsconfig` — the shared `tsconfig.app.json` a project extends.
- `@abide/abide/test/createScriptedSurface` — a scripted MCP/tool surface for agent-engine tests.
- `@abide/abide/test/assertAgentFrameConformance` — assert an engine's frame stream satisfies the neutral `AgentFrame` contract.

## MCP

### MCP — @documentation mcp

- `@abide/abide/mcp/createMcpServer` — construct the MCP server bound to the project's rpc registry; its `handle(request)` backs `/__abide/mcp`. Framework-internal (the `abide:mcp` virtual default-constructs it).

## Desktop bundle — @documentation bundle

- `@abide/abide/bundle/BundleWindow` — the type of the default export from `src/bundle/window.ts` (title, size, menus).
- `@abide/abide/bundle/BundleMenu` — a top-level bundle menu (`label` + `items`).
- `@abide/abide/bundle/BundleMenuItem` — one menu entry (a divider or a clickable item dispatching an `abide:menu` event).
- `@abide/abide/bundle/onMenu` — subscribe to bundle menu clicks; returns an unsubscribe (drops into an `effect`).
- `@abide/abide/bundle/bundled` — `true` when running inside the abide desktop bundle rather than a plain browser tab.

## Generated machine surfaces

Routes the runtime serves (the internal `/__abide/{config,dev,disconnect,reload}`
routes are deliberately undocumented plumbing):

| Route | Serves |
| --- | --- |
| `/openapi.json` | The OpenAPI 3 spec projected from every schema'd rpc. |
| `/__abide/mcp` | The MCP endpoint (tools + prompts from schema'd rpcs and prompt files). |
| `/__abide/health` | The health payload the client `health()` polls (identity + app `health()` fields). |
| `/__abide/sockets` | The multiplexed WebSocket hub; `/__abide/sockets/<name>` GET tail / POST publish. |
| `/__abide/cli` | The CLI binary download endpoint (per-platform thin client + server). |
| `/__abide/hot` | The dev hot-reload channel. |
| `/__abide/identity` | The app identity (name/version) probe. |
| `/__abide/inspector` | The inspector surface (gated by `ABIDE_ENABLE_INSPECTOR`). |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | The port the server binds. |
| `APP_URL` / `ABIDE_APP_URL` | The app's public base URL (mount subpath, absolute link/asset resolution). |
| `ABIDE_APP_TOKEN` | Shared token authenticating a CLI/remote client to the server. |
| `ABIDE_CLIENT_TIMEOUT` | Client-wide default timeout (ms) for browser rpc fetches. |
| `ABIDE_DATA_DIR` | Override the per-user data dir (`appDataDir()`). |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide default max request body bytes. |
| `ABIDE_IDLE_TIMEOUT` | Idle timeout (s) for connections. |
| `ABIDE_REACHABLE_TIMEOUT` | Per-probe timeout (ms) for `reachable()`. |
| `ABIDE_REACHABLE_TTL` | Freshness window (ms) for a cached `reachable()` result. |
| `ABIDE_LOG_FORMAT` | `json` for one JSON object per log line (default: tsv). |
| `ABIDE_ENABLE_INSPECTOR` | Enable the `/__abide/inspector` surface. |
| `ABIDE_INSPECT` | Attach the inspector to a run. |
| `DEBUG` | Enable DEBUG-gated diagnostic channels (e.g. `abide:cache`, `abide:rpc`). |

## Maintenance

This map mirrors the `exports` in `packages/abide/package.json`. After adding or
renaming an export, run `bun run packages/abide/scripts/readmeSurfaces.ts` and
re-sync this file.
