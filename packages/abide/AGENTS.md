# AGENTS.md — abide complete surface map

> The exhaustive index of abide's public surface: every `exports` key appears once,
> grouped by namespace, with its import specifier and a one-line spec — so an agent
> grasps the whole API in one read and knows which file to open for depth. The README
> is the curated three-primitive intro (RPCs, sockets, components); `CONTEXT.md` is the
> glossary and `docs/adr/` the rationale. No barrels: every public name has its own
> module path, and the namespace marks the side it runs on — `abide/server/*` is
> server-only, `abide/ui/*` client-only, `abide/shared/*` isomorphic (same callable,
> same behaviour on both sides). Package `@abide/abide`, single Bun runtime (≥ 1.3.0),
> one direct dependency (`typescript`). Bullets show the import specifier; the file
> path it resolves to lives in `package.json` `exports`.

## The premise

One typed verb declaration fans out to five surfaces:
```text
              getMessages = GET(fn, { inputSchema })
                              │
   ┌───────────┬─────────────┼────────────┬──────────────┐
 SSR call   browser fetch   MCP tool    CLI command    OpenAPI op
cache(fn)() typed proxy()  (read-only)  abide ... cli  /openapi.json
```

A schema unlocks the CLI everywhere and MCP for read-only verbs; a mutating verb
never auto-exposes to MCP — it needs explicit `clients: { mcp: true }`.

## File-based conventions

The bundler reads these paths by convention:

| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | One HTTP verb per file; the path is the route, the schema projects MCP/CLI/OpenAPI |
| `src/server/sockets/<name>.ts` | One broadcast socket per file; file name is the topic |
| `src/server/prompts/<name>.md` | One MCP prompt per file; `{{name}}` placeholders, optional frontmatter |
| `src/server/config.ts` | Optional `env(schema)` validation, run at boot |
| `src/app.ts` | Optional `AppModule` lifecycle hooks (`init`/`handle`/`handleError`/`health`/`forwardHeaders`) |
| `src/bundle/window.ts` | Optional desktop `BundleWindow` config (title, size, menus, setup form) |
| `src/ui/pages/<path>/page.abide` | A route; folder path is the URL, `[id]` segments are params |
| `src/ui/pages/<path>/layout.abide` | A layout wrapping pages at or below its folder |
| `src/ui/public/` | Static assets served from `/`, embedded in the standalone binary |
| `src/.abide/*.d.ts` | Generated route/rpc/health types — do not hand-edit |
| `dist/_app/` | Generated client bundle (code-split, hashed chunks) |

Aliases: `$server` → `src/server/`, `$ui` → `src/ui/`, `$shared` → `src/shared/`,
`$mcp` → `src/mcp/`, `$cli` → `src/cli/`.

## CLI

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | Copy the template, install, start dev (`--no-install`, `--no-dev`) |
| `abide dev` | Build + run with hot reload; watches `src/`, rebuilds client, restarts server |
| `abide build` | One-shot client build into `dist/_app/` |
| `abide check` | Type-check `.abide` templates + props via the shadow language service |
| `abide start` | Run the production server against a pre-built `dist/` |
| `abide run <file> [args]` | Run a script under the abide preload (jobs, tests) |
| `abide compile` | Build a standalone server executable with embedded assets |
| `abide cli` | Build a thin CLI binary that ships the server (`--platforms` cross-compiles) |
| `abide bundle` | Build a movable, self-contained desktop app bundle for this platform (unsigned `.app` on macOS, flat dir elsewhere) |
| `abide lsp` | Run the `.abide` language server over stdio (JSON-RPC editor diagnostics) |
| `abide init-agent` | Write/refresh a `CLAUDE.md` pointer to this surface map |

Tests preload the framework: `preload = ["@abide/abide/preload"]` in `bunfig.toml`
registers `.abide` compilation so `bun test` runs the same runtime as the server.

## Authoring contracts

What you write into each convention path, and the contract the framework holds
you to. The per-export specs below are exhaustive; this is the shape of the code
that produces them.

### RPC verb — `src/server/rpc/<name>.ts`

- One `export const <name> = METHOD(handler, opts?)` per file (`METHOD` ∈ `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`); the file path is the route.
- The handler receives the **validated** input — `InferOutput<inputSchema>`, or `{}` when schemaless — and may read request scope via `request()` / `cookies()`. It returns `json()`, `jsonl()`, `sse()`, `error()`, `redirect()`, or a raw `Response`; the union of those branches is the verb's typed result.
- `opts`: `{ inputSchema?, outputSchema?, filesSchema?, clients?: { browser, mcp, cli }, crossOrigin?, maxBodySize?, timeout? }`. A Standard Schema flips MCP + CLI on automatically; a **mutating** verb still needs explicit `clients: { mcp: true }`. `crossOrigin: true` exempts a mutating verb from the same-origin CSRF check. `timeout` (ms) bounds the handler on every surface (504 past it). `filesSchema` validates multipart `File` parts (the caller sends `FormData`).
- Query args arrive as **strings** — validate with `z.coerce.*`.
- Consume four ways: `cache(verb)(args)` in-process (SSR, warm hydration), the same call over a swapped `fetch` in the browser, `verb.raw(args)` for the undecoded `Response`, `verb.stream(args)` for an iterable body view.

### Socket — `src/server/sockets/<name>.ts`

- One `export const <name> = socket({ schema, tail?, ttl?, clientPublish?, clients? })`; the file name is the topic.
- `.publish(msg)` validates then broadcasts; `.tail(n?)` replays the retained window then streams live; bare `for await` is live-only. `tail` = frames retained, `ttl` = frame expiry (ms), `clientPublish` = allow a browser `POST` (default off, so route writes through a verb that validates first).
- HTTP face `/__abide/sockets/<name>`: `GET` returns the tail, `POST` publishes (gated by `clientPublish`).
- Consume in a component with `tail(socket)` (latest-wins) or `tail(socket, { last: n })` (window).

### Page & layout — `src/ui/pages/**`

- `page.abide` is a route; the folder path is the URL. `[id]` segments become params read off the `page` proxy (`page.params.id`), typed via generated `src/.abide/routes.d.ts`, reactive across navigation.
- `layout.abide` wraps every page at or below its folder; its `<slot/>` (compiled to an outlet) holds the nested page or child layout.
- Build links with `url('/pages/product/[id]', { id })` and move with `navigate(href)`.

### App module & config — `src/app.ts`, `src/server/config.ts` (both optional)

- `src/app.ts` exports the `AppModule` hooks: `forwardHeaders`, `init`, `handle`, `handleError`, `health`.
- `src/server/config.ts` exports `env(schema)`, validated against `Bun.env` at boot; the typed result is your config and seeds the bundle launcher's setup form.

### The isomorphism move

Import a server verb (or socket) straight into a `.abide` and call it: during SSR
the bundler keeps the real handler (it runs in-process), in the browser it swaps
to a `fetch` proxy of the same signature, same name. Wrap reads in `cache()` so the
SSR pass serializes the value into the snapshot and the client hydrates warm
instead of refetching.

## .abide template grammar

A `.abide` file is one component: an optional `<script>` (module scope), HTML
markup with reactive interpolation and `<template>` control flow, and optional
component-scoped `<style>`. Ambient in `<script>` — no import — are `scope`,
`props`, `effect`, `html`, and `snippet`; everything else (`cache`, `page`,
`navigate`, `tail`, verbs, sockets, child components) is imported normally.

```html
<script>
import { cache } from '@abide/abide/shared/cache'
import { getThing } from '$server/rpc/getThing.ts'
import Child from '$ui/Child.abide'

const { title = 'untitled' } = props<{ title?: string }>()   // reactive props
let count = scope().state(0)                                 // writable cell
const doubled = scope().computed(() => count * 2)            // read-only derived
effect(() => console.log(count))                             // re-runs on change
</script>

<h1>{title}: {doubled}</h1>                                  <!-- {expr} interpolation -->
<button onclick={() => (count = count + 1)}>inc</button>     <!-- on<event>={fn} -->
<Child label={title}><p>slot body</p></Child>                <!-- caps tag = component -->

<style>h1 { font-weight: 600 }</style>                        <!-- component-scoped -->
```

Reactive state — `scope()` is the only reactive surface:

| Form | Meaning |
| --- | --- |
| `scope().state(v)` | writable cell — read by name, assign with `=` |
| `scope().computed(fn)` | read-only derived; re-runs when its read cells change |
| `scope().linked(fn)` | local draft reseeded from upstream on source change |
| `effect(fn)` | side effect; re-runs on change; return a teardown |
| `props()` / `props<T>()` | destructure reactive props, defaults allowed |

Interpolation & bindings:

| Syntax | Effect |
| --- | --- |
| `{expr}` | reactive text, HTML-escaped; `{html(s)}` inserts trusted raw HTML |
| `name={expr}` | reactive attribute (omitted when nullish) |
| `on<event>={fn}` | event listener — `onclick`, `onsubmit`, … |
| `bind:value={cell}` | two-way bind to input / textarea / select |
| `bind:checked={cell}` | checkbox boolean bind |
| `bind:group={cell}` | radio (single value) / checkbox group (array) |
| `bind:value={{ get, set }}` | writable computed — a lens over derived state |

Control flow — native `<template>`:

| Directive | Shape |
| --- | --- |
| `<template if={c}>` … `<template elseif={c2}>` … `<template else>` | conditional chain (`else` must be last) |
| `<template each={list} as="x" key="x.id" index="i">` | keyed list (`index` binds the row's reactive position) |
| `<template await={p}>` `<template then="v">` `<template catch="e">` `<template finally>` | promise (streams; branch value bound by `then`/`catch`) |
| `<template switch={s}>` `<template case={v}>` … `<template default>` | first strict-`===` match |
| `<template try>` `<template catch="e">` `<template finally>` | synchronous error boundary |
| `<template name="row" args={p}>` … `{row(p)}` | snippet — a named builder that closes over scope, rendered like a function and passable as a prop |

Components & slots — a capitalized tag is an imported component; its attributes
are props; child markup fills the default `<slot/>`, and `<el slot="footer">` fills
`<slot name="footer">`. A `then`/`catch` branch (and any nested `<script>` / `<style>`)
is its own lexical scope.

## Server surface — abide/server/*

### RPC verbs — @documentation rpc

- `@abide/abide/server/GET` — HTTP verb helper; the bundler rewrites `export const x = GET(fn, opts)` in `src/server/rpc/<file>.ts` to `defineVerb` server-side and `remoteProxy` client-side.
- `@abide/abide/server/POST` — as `GET`, for `POST`.
- `@abide/abide/server/PUT` — as `GET`, for `PUT`.
- `@abide/abide/server/PATCH` — as `GET`, for `PATCH`.
- `@abide/abide/server/DELETE` — as `GET`, for `DELETE`.
- `@abide/abide/server/HEAD` — as `GET`, for `HEAD`.
- `@abide/abide/server/rpc/defineVerb` — the verb factory (plumbing): handler + options (`inputSchema`, `outputSchema`, `filesSchema`, `clients`, `timeout`, `maxBodySize`, `crossOrigin`); returns a `RemoteFunction` — plain call decodes by Content-Type and throws `HttpError` on non-2xx, `.raw(args)` returns the `Response`, `.stream(args)` an iterable body view; auto-exposes to CLI/MCP per schema + method.

### Response helpers — @documentation response

- `@abide/abide/server/json` — JSON `Response`, `Cache-Control: no-store`; `undefined` → 204; phantom `TypedResponse` brand carries the return type.
- `@abide/abide/server/jsonl` — wraps `AsyncIterable<Frame>` as JSON Lines; frame errors emit a `{"$error":...}` line; cancellation flows to `iter.return()`.
- `@abide/abide/server/sse` — wraps `AsyncIterable<Frame>` as Server-Sent Events; 15s keepalive comments, error frames as `event: error`.
- `@abide/abide/server/error` — plain-text error `Response(status, message?, init?)`; defaults to the standard status text; `TypedResponse<never>` so error branches union cleanly.
- `@abide/abide/server/redirect` — redirect `Response(url, status=302, init?)`; relative URLs allowed, 301/302/303/307/308, `TypedResponse<never>`.

### Request scope — @documentation request-scope

- `@abide/abide/server/request` — the inbound `Request` for the current SSR/RPC pass (AsyncLocalStorage); throws outside request scope.
- `@abide/abide/server/cookies` — `Bun.CookieMap` for the in-flight request; `.set()`/`.delete()` flush to `Set-Cookie`; throws outside scope.
- `@abide/abide/server/server` — the active `Bun.serve` instance (getter, shows in stack traces); in-process server inside scope when none is bound.

### Configuration — @documentation configuration

- `@abide/abide/server/env` — validate `Bun.env` against a Standard Schema, returns typed config; fails fast listing all issues; registers the schema for the bundle launcher's setup form.

### Reachability — @documentation observability

- `@abide/abide/server/reachable` — server-only probe of an external host: awaits a `HEAD` (`ABIDE_REACHABLE_TIMEOUT`), then background-polls at `ABIDE_REACHABLE_TTL`; returns a boolean, status-agnostic (any completed HTTP counts).

### Sockets — @documentation sockets

- `@abide/abide/server/socket` — `Socket<T>` declaration; the bundler placeholder throws if called outside `export const <file> = ...` in `src/server/sockets/`.
- `@abide/abide/server/sockets/defineSocket` — server socket factory (plumbing): `name` + `{ tail, ttl, schema, clientPublish, clients }`; `.publish(msg)` validates then broadcasts via `server.publish`, `.tail(count?, hooks?)` replays history then streams live, bare iteration is live-only; auto-MCP/CLI when a schema is present.

### Agent — @documentation agent

- `@abide/abide/server/agent` — run the AgentEngine (surface + messages → `AsyncIterable<AgentFrame>`) against the request's MCP surface; wrap the stream with `jsonl()`/`sse()`, auth forwarded per tool.

### Prompts — @documentation plumbing

- `@abide/abide/server/prompts/definePrompt` — prompt factory: `name` + `{ description, jsonSchema, render }`; registered for MCP enumeration (the resolver generates these from `src/server/prompts/*.md`).
- `@abide/abide/server/prompts/renderPromptTemplate` — substitute `{{name}}` placeholders in a markdown template from a `Record<string,string>`; missing args render empty.

### App + inspector hooks — @documentation plumbing

- `@abide/abide/server/AppModule` — the `src/app.ts` hook contract: `forwardHeaders`, `init(ctx)`, `handle(req, next)`, `handleError(err, req)`, `health(req)`.
- `@abide/abide/server/InspectorContext` — capabilities handed to `@abide/inspector` when enabled: identity, `loadSurface()`, `cacheSnapshot()`, `inFlightSnapshot()`, `onRecord(listener)`.

## Isomorphic surface — abide/shared/*

### RPC contract — @documentation rpc

- `@abide/abide/shared/withJsonSchema` — attach a `toJSONSchema()` to a Standard Schema, enabling projection to OpenAPI, MCP tools, CLI help, and bundle forms.

### Errors — @documentation response

- `@abide/abide/shared/HttpError` — `Error` subclass thrown by remote calls on non-2xx; carries `status`, `statusText`, and the raw `Response`.

### Cache — @documentation cache

- `@abide/abide/shared/cache` — wrap a sync/async callable (remote or producer) with deduped, optional-TTL storage; SSR-aware streaming hydration, stale-while-revalidate, and optimistic mutation.

### Templating — @documentation templating

- `@abide/abide/shared/html` — mark a string as trusted raw HTML inserted verbatim in interpolations; plain-call and tagged-template forms.
- `@abide/abide/shared/snippet` — brand a snippet payload (DOM builder on the client, HTML string on the server) so interpolations mount it instead of escaping.

### Page — @documentation page

- `@abide/abide/shared/page` — reactive page snapshot: matched route, decoded params, browser-space URL, and a `navigating` flag; isomorphic.

### Probes — @documentation probes

- `@abide/abide/shared/pending` — reactive: any cache call in-flight, any stream awaiting its first frame, or a tagged group pending.
- `@abide/abide/shared/refreshing` — reactive: a cache call holds a value while revalidating, or a stream reconnects with its window retained.
- `@abide/abide/shared/online` — reactive connectivity: `navigator.onLine` on the client, the request's `OFFLINE_HEADER` on the server.
- `@abide/abide/shared/health` — reactive backend health: a `reachable` flag polled from `/__abide/health` every 10s while visible, plus app `health()` fields; `navigator.onLine` composes at read.

### URL — @documentation url

- `@abide/abide/shared/url` — resolve in-app URLs to base-correct typed form: verb args serialize to query, page routes interpolate params, assets pass through; external URLs untouched.

### Observability — @documentation observability

- `@abide/abide/shared/log` — unified logger with request-scope context (trace id, elapsed, verb+path); `log`/`warn`/`error`/`trace` on the always-on channel, `log.channel(name)` is `DEBUG`-gated.
- `@abide/abide/shared/trace` — the request's W3C `traceparent` string for propagation; `undefined` outside request scope.

### Subscribers — @documentation plumbing

- `@abide/abide/shared/createSubscriber` — lazy resource lifecycle: `start()` opens on first tracked read, close deferred to a microtask on last disposal, subscribers shared by reference.

## UI surface — abide/ui/* (client-only)

### Reactive state — @documentation reactive-state

- `@abide/abide/ui/scope` — the sole reactive surface: `scope()` resolves the current lexical scope (`scope('/')` the root); returned scope has `.state()` (writable cell), `.computed()` (read-only derived), `.linked()` (draft reseeded from upstream). A writable computed is expressed at the binding, `bind:value={{ get, set }}`.

### Effects — @documentation effect

- `@abide/abide/ui/effect` — run `fn` now and re-run when its read cells change; `fn` may return a teardown; captures lexical scope. Client-only.

### Tail — @documentation tail

- `@abide/abide/ui/tail` — reactive stream consumer: latest-wins `T | undefined`, or a window `T[]` with `{ last: n }`; reconnect retains the window and flags `refreshing`; seeds from `Subscribable.tail(count)`.

### Navigation — @documentation navigate

- `@abide/abide/ui/navigate` — client navigation: push/replace a history entry, update the reactive route (re-mounts), bucket scroll per entry; `keepScroll` carries the live offset across.

### Outbox — @documentation ui

- `@abide/abide/ui/outbox` — durable FIFO mutation queue for local-first writes: enqueue appends and drains head-first while online, drops permanently-failed entries via `onDrop`, resumes on reconnect.

### Client glue — @documentation plumbing

- `@abide/abide/ui/router` — client router on the History API: matches patterns, imports page/layout chunks on demand, diffs and rebuilds divergent layers, restores scroll per entry, probes the server gate on SPA nav.
- `@abide/abide/ui/startClient` — the official client entry: seed cache from the SSR snapshot, install the base, start the router (adopts SSR DOM), returns a disposer.
- `@abide/abide/ui/renderToStream` — out-of-order SSR streaming: shell first, then resolved `{#await}` fragments in completion order with a resume seed; blocking awaits render inline.
- `@abide/abide/ui/remoteProxy` — client remote function: build the `Request` (base, mount, offline header, traceparent), decode by Content-Type, throw `HttpError` on non-2xx.
- `@abide/abide/ui/socketProxy` — client `Socket`: bare iteration is the live stream, `.tail(n)` seeds from the retained tail, `.publish` sends a server-validated frame; over the multiplexed ws.
- `@abide/abide/ui/enterScope` / `@abide/abide/ui/exitScope` — open and restore an isolated lexical scope around an SSR render so `scope()` and model state don't bleed.

### DOM runtime — @documentation plumbing

Compiler emit targets, not written by hand — the runtime the compiled `.abide`
output calls into to build, hydrate, and reconcile the DOM.

- `@abide/abide/ui/dom/mount` — mount a top-level page/layout into a host element under an ownership scope; returns a disposer.
- `@abide/abide/ui/dom/mountChild` — mount a child component as a marker-bounded range, with optional hot-reload support.
- `@abide/abide/ui/dom/mountSlot` — mount a slot's content as a marker-bounded range that renders once without re-render.
- `@abide/abide/ui/dom/outlet` — a layout's empty outlet boundary for the router to fill with the next chain layer.
- `@abide/abide/ui/dom/hydrate` — adopt existing server-rendered DOM instead of rebuilding, attaching listeners and effects to preserve focus/scroll.
- `@abide/abide/ui/dom/skeleton` — realize a compiled skeleton under a parent, returning the element and anchor holes for binding.
- `@abide/abide/ui/dom/cloneStatic` — append a fully-static subtree by cloning a cached template (create) or claiming server nodes (hydrate).
- `@abide/abide/ui/dom/appendStatic` — a static text node, claimed on hydrate or appended on create.
- `@abide/abide/ui/dom/anchorCursor` — position a control-flow block or slot by its skeleton anchor, returning the insertion reference.
- `@abide/abide/ui/dom/text` — a text node whose content tracks a reactive read, updating fine-grained on cell changes.
- `@abide/abide/ui/dom/appendText` — a reactive interpolation branching on value kind: escaped text, snippet builder, or raw HTML.
- `@abide/abide/ui/dom/appendTextAt` — as `appendText`, positioned at a skeleton anchor with live re-parsing.
- `@abide/abide/ui/dom/appendSnippet` — a snippet call that mounts/remounts its builder in a marker-bounded range on argument change.
- `@abide/abide/ui/dom/attr` — bind an element attribute to a reactive read with present/absent semantics.
- `@abide/abide/ui/dom/on` — attach an event listener registered with the ownership scope for cleanup on dispose.
- `@abide/abide/ui/dom/attach` — run an attachment at build time and register its optional teardown with the ownership scope.
- `@abide/abide/ui/dom/each` — keyed list binding with reconciliation by key, minimal DOM moves, optional hydration.
- `@abide/abide/ui/dom/eachAsync` — async keyed list appending rows as an iterator yields, reconciling by key with error handling.
- `@abide/abide/ui/dom/when` — conditional binding that swaps range content on condition flip; an unchanged condition is a no-op.
- `@abide/abide/ui/dom/awaitBlock` — async binding with pending/resolved/error branches, reactive re-run, and hydration by precedence.
- `@abide/abide/ui/dom/tryBlock` — synchronous error boundary building guarded content or the error branch on throw.
- `@abide/abide/ui/dom/switchBlock` — multi-branch binding picking the first case matching the subject (strict `===`).
- `@abide/abide/ui/dom/applyResolved` — bundle-side consumer of streamed resolution chunks, swapping pending DOM and seeding cache.
- `@abide/abide/ui/dom/mergeProps` — compose a child's props from layered sources (explicit, spreads, slot), last-writer-wins.
- `@abide/abide/ui/dom/spreadProps` — wrap a reactive spread layer so every key resolves to a live value thunk.
- `@abide/abide/ui/dom/restProps` — return unconsumed prop values as a live object, unwrapping thunks, excluding consumed/slot keys.
- `@abide/abide/ui/dom/spreadAttrs` — spread an object's keys onto a native element, binding event listeners and reactive attributes.
- `@abide/abide/ui/dom/readCall` — guard a method call on a reactive-document read, with friendly errors for nullish/non-callable members.

### Render-pass runtime — @documentation plumbing

- `@abide/abide/ui/runtime/escapeKey` — JSON-Pointer-escape reactive-doc path keys (`~`→`~0`, `/`→`~1`) so composite keys survive path joining.
- `@abide/abide/ui/runtime/nextBlockId` — next block id in the render pass (per await/try block).
- `@abide/abide/ui/runtime/enterRenderPass` — mark entry into a render/mount, resetting the block-id counter at depth 0.
- `@abide/abide/ui/runtime/exitRenderPass` — mark exit from a render/mount, unwinding the depth counter.

## Build / tooling — @documentation building

- `@abide/abide/build` — build the client bundle with optional gzip, via atomic directory swaps.
- `@abide/abide/compile` — produce a standalone Bun server executable with embedded assets.
- `@abide/abide/preload` — Bun preload that registers the `.abide` loader and resolver before builds.
- `@abide/abide/resolver-plugin` — Bun plugin resolving bare/extensionless paths, generating manifests, and handling virtual modules.
- `@abide/abide/ui-plugin` — Bun plugin that loads `.abide` single-file components, compiling them to ES modules with scoped styles.
- `@abide/abide/tsconfig` — the strict ESNext + bundler-resolution + Bun-types TypeScript config consumers extend.

## Desktop bundle — @documentation bundle

- `@abide/abide/server/appDataDir` — per-user app data directory keyed by the bundler-injected program name; cwd-independent, pure.
- `@abide/abide/bundle/BundleWindow` — type for the bundle window config: title, size, custom menus, setup form schema.
- `@abide/abide/bundle/BundleMenu` — type for a top-level menu inserted between the standard Edit and Window menus.
- `@abide/abide/bundle/BundleMenuItem` — type for one menu entry: separator, clickable emit, or navigate.
- `@abide/abide/bundle/onMenu` — subscribe to bundle menu clicks (optional filter); returns an unsubscribe.
- `@abide/abide/bundle/bundled` — true inside the desktop webview, false as a standalone web app.

## MCP — @documentation mcp

- `@abide/abide/mcp/createMcpServer` — build an MCP server bound to the project's RPC registry, deriving tools and sockets with auth.

## Testing — @documentation testing

- `@abide/abide/test/createTestApp` — build a test app with augmentable verb/socket maps and bundled virtual modules.
- `@abide/abide/test/createScriptedSurface` — a scripted `AgentSurface` with declarative tool stubs and recorded calls.
- `@abide/abide/test/assertAgentFrameConformance` — collect an engine's frame stream and validate it against the neutral `AgentFrame` contract.

## Generated machine surfaces

| Route | Serves |
| --- | --- |
| `/openapi.json` | OpenAPI 3.1 spec of every RPC verb (methods, params, schemas, operationIds) |
| `/__abide/health`, `/__abide/identity` | Health JSON: app `health()` fields merged with `{ abide: version, name }` |
| `/__abide/mcp` | MCP endpoint; delegates to `mcp.handle(request)`, publishing the surface on first access |
| `/__abide/sockets` | The single ws multiplex for every defined socket; per-name HTTP face for tail/publish |
| `/__abide/cli` | Platform-detecting shell installer that downloads and runs the CLI binary |
| `/__abide/inspector` | Inspector UI + data when `ABIDE_ENABLE_INSPECTOR=true` (operator-only) |
| `/__abide/hot/<moduleId>` | Dev-only HMR: compiles an edited `.abide` to importable JS; 404 falls back to reload |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | Listener port (0–65535); honored exactly if set, else scans up from 3000 |
| `APP_URL` | Mount base path from the URL's pathname (`https://x/v2` → `/v2`); mounts server URLs + shell |
| `ABIDE_APP_URL` | App origin sent to the CLI download tarball's `.env` |
| `ABIDE_APP_TOKEN` | Bearer token forwarded into the CLI tarball `.env` when the request carries `Authorization` |
| `ABIDE_CLIENT_TIMEOUT` | Client RPC fetch timeout (ms, 1–600000); shipped to the browser via SSR |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide request body ceiling (bytes); default ~Bun default |
| `ABIDE_IDLE_TIMEOUT` | Per-connection idle timeout (s, 0–255); default 10 |
| `ABIDE_DATA_DIR` | Override the platform app-data dir (used as-is, no program name appended) |
| `ABIDE_REACHABLE_TIMEOUT` | Per-HEAD reachability probe timeout (ms, 100–60000); default 3000 |
| `ABIDE_REACHABLE_TTL` | Reachability poll cadence (ms, 1000–600000); default 30000 |
| `ABIDE_LOG_FORMAT` | `json` emits JSON log records to stdout instead of TSV |
| `DEBUG` | npm-debug channel selection (`abide`, `abide:*`, `-abide` to negate request-close logs) |
| `ABIDE_ENABLE_INSPECTOR` | `true` mounts `@abide/inspector` on `/__abide/inspector` |
| `ABIDE_INSPECT` | Enable the native webview inspector (right-click Inspect) in bundle windows |

---

Mirrors `package.json` `exports`. After adding or renaming an export, run
`bun run packages/abide/scripts/readmeSurfaces.ts` and update this map.
