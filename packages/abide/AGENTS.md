# AGENTS.md — abide complete surface map

> Generated from the source as the single index of abide's public featureset, so an
> agent can grasp the whole API in one read and know which file to open for depth.
> The README is the curated human intro (3 primitives); this is the exhaustive map.
> CONTEXT.md is the domain glossary; docs/adr/ holds design rationale.
>
> **Ground rule:** every public name has its own module path — no barrels. The
> namespace marks the side: `abide/server/*` server-only, `abide/ui/*` client-only,
> `abide/shared/*` isomorphic (same callable, same behaviour on both sides; the
> bundler swaps the runtime). Package: `@abide/abide`. Runtime: Bun ≥ 1.3, web
> standards only, zero runtime deps.
>
> **Two kinds of path below.** Import specifiers (`abide/server/GET`) are the stable
> identity — that's what you import. File paths like `src/lib/...` are *inside the
> abide package* (relative to this file: `packages/abide/` in this repo,
> `node_modules/@abide/abide/` when abide is a dependency); the published package
> ships `src`, so those files are readable in both. Paths like `src/server/rpc/...`
> and `src/.abide/...` in the conventions table refer to **your own app**, not the
> package.

---

## The premise

One declared verb fans out to every surface, with no extra work:

```
       export const getMessages = GET(fn, { inputSchema })
                                 │
   ┌───────────────┬────────────┼──────────────┬────────────────┐
 SSR call      browser fetch    MCP tool      CLI subcommand   OpenAPI op
cache(fn)()   fetch /rpc/...   (read-only +    app get-messages  /openapi.json
(in-process)  (typed proxy)     schema → tool)  (schema → flags)  (described)
```

A Standard Schema (zod / valibot / arktype, unadapted) is the contract: it
validates args and projects the CLI flags, the MCP tool, and the OpenAPI operation.
The schema gates the machine surfaces — it unlocks CLI and (for read-only/GET verbs)
MCP; a mutating verb never auto-exposes to MCP, it needs explicit `clients: { mcp: true }`.

## File-based conventions (the bundler reads these paths)

| Path | Meaning |
|---|---|
| `src/server/rpc/<name>.ts` | one RPC verb per file; file path = URL (`/rpc/<name>`), one export named after the file |
| `src/server/sockets/<name>.ts` | one broadcast socket per file; multiplexes onto `/__abide/sockets` |
| `src/mcp/prompts/<name>.md` | MCP prompt template (`{{arg}}` placeholders) → `definePrompt` |
| `src/server/config.ts` | `export const config = env(schema)` — boot-validated env, also drives the bundle setup form |
| `src/app.ts` | optional app module: `handleError`, `health()` hook, lifecycle (see `AppModule`) |
| `src/bundle/window.ts` | optional desktop bundle window config (`BundleWindow`, default export) |
| `**/page.abide` | a page; directory path → route in bracket form (`/post/[id]`, `/docs/[...rest]`) |
| `**/layout.abide` | nearest-only layout wrapping a page via `<slot/>` (layouts never stack) |
| `src/.abide/*.d.ts` | generated: route/param/rpc/health types (do not hand-edit) |
| `public/<file>` | static asset, served at `/<file>` |
| `dist/_app/` | `abide build` output; `dist/` is what `abide start` serves |

## CLI (`bunx abide <cmd>` / `abide <cmd>`)

| Command | Does |
|---|---|
| `scaffold <name>` | scaffold a project, install, start dev (`--no-install` / `--no-dev`) |
| `dev` | build + run with hot reload |
| `build` | build the client into `dist/_app/` |
| `check` | type-check `.abide` templates + props |
| `start` | run the production server against `dist/` |
| `run <file> [args]` | run a script under the abide preload (same runtime as the server) |
| `compile [--target] [--out]` | build a standalone server executable |
| `cli [--target] [--out] [--platforms]` | build the cli client binary (ships the server beside it; cross-compiles) |
| `bundle` | build a movable self-contained desktop app bundle (unsigned) |
| `lsp` | language server for `.abide` files |

For `bun test`, add `preload = ["@abide/abide/preload"]` under `[test]` in `bunfig.toml`.

---

## Server surface — `abide/server/*` (and authored helpers)

### RPC verbs — `@readme rpc`
Each is `Verb(fn, opts?)` with three overloads (see `src/lib/server/rpc/types/VerbHelper.ts`):
`Verb(fn, { inputSchema, outputSchema?, filesSchema?, clients?, timeout?, maxBodySize?, crossOrigin? })`,
`Verb(fn, { clients })`, and bare `Verb(fn)`. Return type usually infers from the
`TypedResponse<T>` brand on `json`/`error`/`redirect`/`jsonl`/`sse`.

- `abide/server/GET` · `abide/server/POST` · `abide/server/PUT` · `abide/server/PATCH` · `abide/server/DELETE` · `abide/server/HEAD`
- **Query args travel as strings** — use `z.coerce.*` in the schema for numbers/booleans.
- `timeout` (ms) bounds the handler on *every* surface → 504; on the network path it also aborts `request().signal`.
- `crossOrigin: true` exempts a mutating verb from the same-origin CSRF gate (non-GET/HEAD cross-origin browser requests are 403 by default).
- `filesSchema` enables multipart upload: handler gets text fields ∩ validated `File` parts; call with a `FormData`.
- `abide/shared/withJsonSchema(schema, toJsonSchema)` — attach `toJSONSchema()` to a schema whose library lacks one (feeds OpenAPI / MCP / CLI help).

The reference each verb returns is a `RemoteFunction<Args, Return>` (see `src/lib/shared/types/RemoteFunction.ts`):
plain call decodes the body + throws `HttpError` on non-2xx; `.raw` resolves to the
`Response` undecoded; `.stream(args)` returns a `Subscribable` (SSE/JSONL frames, or
the decoded body once) for `tail()`; `.fetch(req)` is framework-internal dispatch.

### Responses — `@readme response`
- `abide/server/json(data, init?)` — JSON with `Cache-Control: no-store`; `json(undefined)` → 204 that round-trips to `undefined`.
- `abide/server/error(status, message?, init?)` — text/plain error; message defaults to the status reason phrase.
- `abide/server/redirect(url, status=302, init?)` — accepts relative URLs (platform `Response.redirect` doesn't); 301/302/303/307/308.
- `abide/server/jsonl(iterable, init?)` — wrap an `AsyncIterable` as JSON Lines stream; errors → final `{"$error":…}` line.
- `abide/server/sse(iterable, init?)` — wrap an `AsyncIterable` as Server-Sent Events; 15s keepalive; errors → `event: error`.
- `abide/shared/HttpError` — thrown by remote calls on non-2xx; carries `status`, `statusText`, raw `response`.

### Sockets — `@readme sockets`
- `abide/server/socket(opts?)` — declare a `Socket<T>` (an isomorphic `AsyncIterable<T>`) inside `src/server/sockets/<name>.ts`. Opts: `{ schema?, tail?, ttl?, clientPublish?, clients? }`. `tail: n` retains last n frames; `ttl` evicts older. HTTP face at `/__abide/sockets/<name>`: GET = retained tail, POST = publish (gated by `clientPublish`).

### Agents — `@readme agent`
- `abide/server/agent(engine, messages)` — run a model engine against the app's own (already-gated) MCP surface; returns the engine's `AgentFrame` stream. Wrap in `jsonl()`/`sse()` to pick the transport. Types exported: `NeutralMessage`, `AgentFrame` (`text`/`tool_use`/`tool_result`/`done`), `AgentSurface`, `AgentEngine`. Engines live in `@abide/<provider>` packages, never in core.

### Request scope — `@readme request-scope`
Resolve only during an in-flight SSR render or RPC handler (throw outside one):
- `abide/server/request()` → the inbound `Request`.
- `abide/server/cookies()` → Bun `CookieMap`; writes flush as `Set-Cookie` on return.
- `abide/server/server()` → active `Bun.serve` (or a no-op in-process server under CLI/MCP/test).

### Config / data — `@readme configuration` / `reference`
- `abide/server/env(schema, opts?)` — validate `Bun.env` against a Standard Schema at module top level; fails boot loudly. Registered so the bundle launcher derives its setup form.
- `abide/server/appDataDir()` → the running bundle's per-user data dir (cwd-independent, pure).

### Observability — `@readme observability`
- `abide/server/reachable(host)` — server-only outbound reachability; first call probes (HEAD), then warm-polls every TTL. Tuned by `ABIDE_REACHABLE_TTL` / `ABIDE_REACHABLE_TIMEOUT`.
- `abide/shared/health()` → `HealthState` (framework + app `health()` hook payload, typed via generated `health.d.ts`); also at `/__abide/health`.
- `abide/shared/log` — unified logger carrying request-scope context; `log()/warn/error/trace` on the app channel, `log.channel(name)` on a `DEBUG`-gated channel. `ABIDE_LOG_FORMAT=json` for JSON lines.
- `abide/shared/trace()` → current W3C `traceparent` (isomorphic; client reads the SSR-stamped trace).

### App / inspector types — `@readme plumbing`
- `abide/server/AppModule` — shape of `src/app.ts` (error handler, health hook, lifecycle).
- `abide/server/InspectorContext` — inspector wiring type.
- `abide/server/rpc/defineVerb`, `abide/server/sockets/defineSocket`, `abide/server/prompts/definePrompt`, `abide/server/prompts/renderPromptTemplate` — bundler-emitted runtime bindings; you don't call these by hand (the `GET`/`socket`/`.md` files compile down to them).

---

## Isomorphic surface — `abide/shared/*`

### Cache — `@readme cache`
- `abide/shared/cache(fnOrProducer)` → a memoised callable. Key auto-derives (method+url+args for a remote fn; producer-reference+args for a producer). Options `{ ttl?, tags?, global?, swr? }`: `ttl` ms-past-resolve (omit = forever, `0` = dedupe-only / the **mutation idiom**); `tags` for group invalidation; `global` = process-level store (server); `swr` = stale-while-revalidate — on invalidate, keep the stale value (reader sees `refreshing()`, not `pending()`) and refetch in the background. `swr: true` refetches immediately; `swr: { throttle | debounce }` adds a coalescing window. GET-only, throws on a write.
- `cache.invalidate(selector?, args?)` — end retention early (by fn, fn+args, `{ tags }`, or all).
- `cache.patch(selector, updater, args?)` — optimistic local fold over matching entries.
- `cache.on(subscribable, (frame, ctx) => …)` — event-driven cache maintenance: run a handler per socket/stream frame; `ctx.invalidate` / `ctx.patch` are coverage-tracked and resync on reconnect. Client-only (no-op on server).

### Probes — `@readme probes` (read-only; reading never triggers work)
- `abide/shared/pending(selector?, args?)` — "no value yet" (in-flight call, or stream awaiting first frame).
- `abide/shared/refreshing(selector?, args?)` — "holding a value while a fresher source is in flight".
- `abide/shared/online()` — reactive connectivity probe (server: the calling client's reported state via offline header).

Same selector grammar as `cache.invalidate`; also accept a `Subscribable`. See CONTEXT.md → Probe.

### Routing / page — `@readme page` / `url`
- `abide/shared/page` — reactive proxy: `route`, `params`, `url` (browser-space), `navigating`. Isomorphic; re-runs reactive readers on navigation.
- `abide/shared/url(path, query?)` — type-safe URL builder; augmented by generated `RpcRoutes`/`PageRoutes`/`PublicAssets` for autocomplete. Applies mount base.

### Templating values — `@readme plumbing`
- `abide/shared/html` — `html\`...\`` tagged template → `RawHtml` (trusted markup); `rawHtmlString(v)`.
- `abide/shared/snippet(payload)` → `Snippet` — a reusable template builder (the `<template name=…>` form).
- `abide/shared/createSubscriber(start)` — the subscription primitive behind sockets/streams/probes.

---

## UI surface — `abide/ui/*` (client-only)

### Reactive primitives — `@readme plumbing` (declared through `scope()` in a `.abide` `<script>`; the runtime forms are NOT public exports)
Reactive state is owned by a scope and declared explicitly through it: `const count = scope().state(0)` (or a captured handle: `const s = scope(); const count = s.state(0)`). A **bare** `state(...)` / `linked(...)` / `computed(...)` call is a compile error — the surface always shows the scope interaction. The declared binding is then read/written by its bare name (`{count}`, `count = count + 1`); the compiler lowers that to the doc API.
- `scope().state(initial, transform?)` — local truth. Plain `state(x)` lowers to a serializable `model` (= `scope()`) doc slot. `state(x, transform)` is a write-coercion gate (`.value` cell).
- `scope().linked(seed, transform?)` — a `.value` cell seeded reactively from upstream (Angular's `linkedSignal`): owns a local value, reseeds when the `seed` thunk's deps change, edits stay local. Non-serializing — reseeds on resume.
- `scope().computed(compute)` → a read-only computed **doc slot** (`scope().derive("name", compute)`), referenced as `name()` (string-free reader): re-computed on resume, never serialized/journalled. Always read-only (no `set` overload) — a writable computed is expressed at the binding site (`bind:value={{ get, set }}`), where the write actually originates.
- `prop('name')` → a read-only computed doc slot over the parent thunk (`scope().derive`), referenced as `name()`.
- `abide/ui/effect(fn)` → run now, re-run on dependency change; `fn` may return teardown / be async; returns dispose. (`effect` IS still a public export.)
- `abide/ui/scope(address?)` → `Scope` — **the data + capability seam; the only public way to reach reactive state.** The reactive document (immutable path-addressed tree, every change a patch — JSON Pointer keys via `escapeKey`, so a key may contain `/`) is now *internal* (`doc`/`createDoc`): a scope wraps one and mirrors its interface — `read`/`replace`/`add`/`remove`/`cell`/`derive`/`snapshot` (data; `derive(path, compute)` is a computed slot, never stored/serialized/journalled), `child`/`root`/`parent` (tree), `dispose`. Every applied patch is announced on an internal process-global patch bus (`PATCH_BUS`) carrying `{ doc, patch, inverse }` — the single tap undo / persistence / sync consume; computed recomputes never reach it. Capabilities route where the scope's changes go — `record({ limit? })` to an undo journal (then `undo`/`redo`/`canUndo`/`canRedo`), `persist(key?)` to durable storage (key defaults to the scope `id`), `broadcast(transport)` to peers. A passable value (`<Child parentScope={scope}/>`). `scope()` = the ambient current scope — `mount`/`hydrate` (client) and `enterScope`/`exitScope` (SSR, per render) establish one per component; the lowering emits `const model = scope()`, so `scope()`'s data IS the component's `state`; `scope('/')` = the root. Resolves correctly inside event handlers, effects, and attach teardowns (they pin the scope they were registered under).
- `abide/ui/outbox({ key, send, store?, online?, onDrop? })` → `Outbox<T>` — local-first mutation queue: `enqueue(payload)` records a serializable mutation (persisted via `persist`, so it survives a reload) and drains FIFO while `online()`; success dequeues, offline-mid-send keeps the head and retries on reconnect (auto-drains on the online edge), an online rejection drops the entry and reports via `onDrop` (roll back the optimistic change there). At-least-once → `send` should be idempotent. `pending()` is a reactive read for a sync indicator. Built on `doc` + `persist` + `online` (the queue is itself a persisted doc).

### Streams
- `abide/ui/tail(subscribable)` → latest frame (`T | undefined`); `tail(x, { last: n })` → window `T[]`. Reactive latest-wins read of a socket/stream. `tail.status` / `tail.error` expose richer stream state. See CONTEXT.md → Tail.

### Navigation / lifecycle — `@readme plumbing`
- `abide/ui/navigate(path, replace?)` — client navigation.
- `abide/ui/router(...)`, `abide/ui/startClient(...)`, `abide/ui/renderToStream(render)` — bootstrap/render runtime (compiler/launcher uses these).

### DOM + render runtime — `@readme plumbing` (compiler-emitted; you don't hand-write these)
`abide/ui/dom/{mount,mountChild,hydrate,text,appendText,appendTextAt,appendSnippet,appendStatic,cloneStatic,skeleton,anchorCursor,mountSlot,attr,on,attach,each,eachAsync,when,awaitBlock,tryBlock,switchBlock,applyResolved}` and `abide/ui/runtime/{nextBlockId,enterRenderPass,exitRenderPass}`. These are what `analyzeComponent → generateBuild/generateSSR` lower a `.abide` file into — every bound element builds through the parser-backed `skeleton` (one clone + located holes / `<!--a-->` anchors); there is no imperative element builder. Read them only to understand compiler output.
- `abide/ui/remoteProxy`, `abide/ui/socketProxy` — the browser-side implementations the bundler swaps in for `GET(...)` / `socket(...)`.

### `.abide` component format (see `src/lib/ui/README.md`)
Valid HTML with `<script>` + native `<template>` control flow + scoped `<style>`.
- **Bindings:** `{expr}` text, `name={expr}` attr, `onclick={fn}`, `bind:value={…}` / `bind:checked` / `bind:group`, `attach={fn}` (node-lifetime attachment — the dual of `on`; the `use:`-action / `{@attach}` equivalent, lowered to `ui/dom/attach`). A two-way `bind:` target is an **lvalue** (`count`, `model.lines[i]`) or an **accessor object** `bind:value={{ get, set }}` (reads via `get()`, writes via `set(v)`) — the only way to two-way-bind derived state; binding a read-only `computed` is a compile error.
- **Control flow (native `<template>`):** `if` with a nested `else` (the `<template else>` is a CHILD of its `<template if>`, not a sibling), `each={list} as="x" key="x.id"`, `await={p}`/`then`/`catch`, `switch`/`case`/`default`.
- **A branch is a lexical scope:** any control-flow branch may host its own nested `<script>` and `<style>`. The nested `<script>` declares branch-local **plain** signals (`state`/`computed`/`linked`/`prop`) — owned by the branch's render scope, re-seeded each mount (not the serializable top-level `doc`) — with the branch's binding in scope (`then`/`catch`'s `as` value, the `each` `as`/`key` row), so it can derive from the awaited/iterated value; its bindings cover the branch subtree and later siblings auto-deref them. The nested `<style>` is scoped to that branch alone (its own `data-a-<hash>`), not the whole component.
- **Components:** capitalised tags (`<Layout title=…>`); children fill `<slot/>`; props are reactive (passed as thunks). A component has no directives — every attribute is a prop under its written name (so `onclick=`/`bind:open=`/`attach=` pass through as props, e.g. callbacks, not the DOM-element directives those are on a lowercase tag) and is type-checked against the child's declared props. `prop('name')` reads a typed component prop (the parent-supplied thunk, reactive + read-only); route params come from the `page` proxy (`page.params.name`), not `prop()`.
- **Snippets / named slots:** `<template name="x" args={…}>` declares a reusable named builder (the `snippet()` form), rendered like a function — covers named slots / `{@render}`.
- **Reactivity:** write plain assignment (`count += 1`, `items.push(x)`); the compiler lowers it to patches. Deep-field edits wake only that field.
- **SSR:** byte-identical HTML string; `renderToStream` ships the shell then streams `<template await>` fragments out of order; `hydrate` adopts the server DOM in place — static structure, `if`/`else`, keyed `each`, `switch`, `try`, and child components/slots all claim existing nodes (no re-render; focus/scroll/input preserved). The one cold-rebuild case left is a genuinely-pending `await` that is neither resumable (`RESUME[id]`) nor cache-warm — it discards the boundary and builds the pending branch fresh; an `await` over a `cache`d read is warm on resume and adopts without a flash.

---

## Build / tooling — `@readme plumbing`
- `abide/ui-plugin` — Bun loader plugin for `.abide` files.
- `abide/resolver-plugin` — resolves the `$server`/`$ui`/virtual modules and swaps server↔client runtime per target.
- `abide/preload` — Bun preload registering both plugins (use in `bunfig.toml` `[test]`).
- `abide/build`, `abide/compile` — programmatic build / standalone-executable compile.
- `abide/tsconfig` — base tsconfig for consumer apps.

## Desktop bundle — `@readme bundle`
- `abide/bundle/BundleWindow` — `src/bundle/window.ts` default-export shape (`title`, `width`, `height`, `menu`, `config` schema for the first-run setup form).
- `abide/bundle/BundleMenu`, `abide/bundle/BundleMenuItem` — custom menu types.
- `abide/bundle/onMenu(handler)` / `onMenu(name, handler)` — subscribe to native menu clicks (returns unsubscribe; drop into an `effect`). Inert outside the bundle.
- `abide/bundle/bundled()` — true inside the desktop webview (isomorphic detection).

## MCP — `@readme plumbing`
- `abide/mcp/createMcpServer(opts)` — framework-internal; the `abide:mcp` virtual constructs it. Tools derive from verbs/sockets flagged `clients.mcp: true`; auth inherits from the inbound request; optional `authorize` hook. Served at `/__abide/mcp`.

## Testing — `@readme testing`
- `abide/test/createTestApp()` → `TestApp` with typed `RpcClient` / `SocketClient` — in-process dispatch, no network.
- `abide/test/createScriptedSurface(...)` — records tool dispatches for engine tests.
- `abide/test/assertAgentFrameConformance(...)` — the frame contract every engine must satisfy (exactly one `done`, last; every `tool_use` answered by a same-id/name `tool_result`).

---

## Generated machine surfaces (runtime, from the user's app)
- `/openapi.json` — full OpenAPI for every exposed verb.
- `/__abide/mcp` — MCP endpoint (tools/sockets/prompts).
- `/__abide/health` — health payload. `/__abide/identity` — app identity.
- `/__abide/sockets` — ws multiplex (per-socket HTTP face at `/__abide/sockets/<name>`).
- `/__abide/cli` — CLI dispatch endpoint. `/__abide/hot` — dev hot-reload. `/__abide/inspector` — inspector stream (gated by `ABIDE_ENABLE_INSPECTOR=true`).

## Environment variables (consumer-facing)

| Var | Effect |
|---|---|
| `PORT` | TCP port the server binds |
| `APP_URL` | public URL; its pathname becomes the mount base (e.g. `…/v2` → `/v2`) |
| `ABIDE_APP_URL` / `ABIDE_APP_TOKEN` | remote server URL + bearer token for the CLI client / bundle |
| `ABIDE_DATA_DIR` | override the per-user data dir |
| `ABIDE_CLIENT_TIMEOUT` | client-side RPC timeout (ms); distinct from per-verb `timeout` |
| `ABIDE_IDLE_TIMEOUT` | Bun per-connection idle timeout (s) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | server-wide request body ceiling |
| `ABIDE_REACHABLE_TTL` / `ABIDE_REACHABLE_TIMEOUT` | `reachable()` poll cadence / per-HEAD bound (ms) |
| `ABIDE_LOG_FORMAT` | `json` for one JSON object per log line (default: tsv) |
| `ABIDE_ENABLE_INSPECTOR` | `true` to enable the inspector endpoint |
| `ABIDE_INSPECT` | enable Bun inspector on the build |
| `DEBUG` | enable diagnostic log channels (e.g. `abide:cache`, `abide:build`); browser uses the `abide-debug` localStorage key |

---

*Maintenance (abide repo only): this file mirrors `package.json` `exports`. After
adding/renaming an export, run `bun run scripts/readmeSurfaces.ts` from
`packages/abide/` (it lists every export by `@readme` slug and fails on any untagged
one) and reflect the change here.*
