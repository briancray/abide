# AGENTS.md — abide complete surface map

> This file is the exhaustive public-surface map of `@abide/abide`: every
> `exports` key, grouped by namespace, with its import specifier and a one-line
> spec. The README is the curated three-primitive intro; `CONTEXT.md` is the
> domain glossary; `docs/adr/` holds the rationale behind decisions. Ground
> rules: there are **no barrels** — every public name has its own module path,
> and the namespace marks the side it runs on (`abide/server/*` server-only,
> `abide/ui/*` client-only, `abide/shared/*` isomorphic — same callable, same
> behavior on both sides). Package `@abide/abide`, runtime Bun ≥ 1.3, one
> direct dependency (TypeScript). Import specifiers below are `exports`-map
> keys (`@abide/abide/server/GET`), not source file paths.

## The premise

One typed declaration fans out to every surface:

```text
src/server/rpc/getMessages.ts
      │
      ├─ SSR / server   await getMessages({ room })  in-process, no HTTP
      ├─ browser        await getMessages({ room })  typed fetch proxy
      ├─ HTTP           GET /rpc/getMessages?room=…
      ├─ CLI            my-app get-messages --room …
      ├─ MCP            tool: get-messages
      └─ OpenAPI        operation in /openapi.json
```

A `schemas.input` (any Standard Schema library — zod, valibot, arktype,
unadapted) is the gate: it unlocks the CLI, and for read-only methods
(GET/HEAD) the MCP tool. A mutating method (POST/PUT/PATCH/DELETE) never
auto-exposes to MCP — it requires explicit `clients: { mcp: true }`.

## File-based conventions

| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | One RPC per file; the export name must match the file stem; the file path becomes the URL `/rpc/<name>` (subdirectories nest into the path) |
| `src/server/sockets/<name>.ts` | One broadcast socket per file; export name = file stem = topic name |
| `src/mcp/prompts/<name>.md` | An MCP prompt template; `{{arg}}` placeholders become the prompt's arguments |
| `src/mcp/resources/**` | Files served as MCP resources (gzip-embedded into builds) |
| `src/server/config.ts` | Boot-time `env()` validation; eager-imported so a bad environment fails the boot |
| `src/app.ts` | Optional `AppModule` hooks: `init`, `handle`, `handleError`, `health`, `forwardHeaders` |
| `src/bundle/window.ts` | Optional `BundleWindow` default export configuring the desktop bundle's window and menus |
| `src/ui/pages/**/page.abide` | A routed page; the directory path is the route — a `[id]` folder is a path param, `[[id]]` an optional param, `[...rest]` a catch-all |
| `src/ui/pages/**/layout.abide` | A layout wrapping the pages below it; its `{children()}` is the router outlet |
| `src/ui/public/` | Static assets served as-is |
| `src/.abide/*.d.ts` | Generated typing (rpc args for `url()`, page routes, health fields, test rpc/socket clients, public asset paths) |
| `dist/` | Build output — `dist/_app` client bundle, `dist/cli-thin/<platform>/` CLI tarballs |

Project import aliases resolve to the five top-level source dirs: `$server`,
`$ui`, `$shared`, `$mcp`, `$cli` (e.g. `$server/rpc/getMessages`,
`$ui/pages/...`). `$server/rpc/*` and `$server/sockets/*` are proxied into
client bundles; any other `$server/*` import from client code is a
side-crossing error.

## CLI

| Command | Does |
| --- | --- |
| `bunx abide scaffold <name>` | Scaffolds the bundled template, installs it, and (interactive TTY only) starts the dev server; `--no-install` / `--no-dev` opt out |
| `abide dev` | Dev orchestrator: builds the client, runs the server as a child, watches `src/`, rebuilds + restarts on change, live-reloads the browser |
| `abide build` | One-shot client build into `dist/_app` (CI / static deploys) |
| `abide start` | Runs the production server against an already-built `dist/` |
| `abide run <file> [args...]` | Runs any script under the abide preload — same runtime as the server (`.abide` compilation, `abide/*` + `$` alias resolution) |
| `abide compile [--target=…] [--out=…]` | Compiles a standalone server executable (client assets embedded) |
| `abide cli [--target=…] [--out=…] [--platforms=a,b,c]` | Builds the thin CLI binary (rpc manifest baked in) that talks to a remote server or starts a local one; `--platforms` cross-compiles into `dist/cli-thin/<platform>/` |
| `abide bundle` | Assembles a movable, self-contained desktop app bundle (server binary + launcher + webview) for the host platform; unsigned |
| `abide check` | Type-checks every `.abide` component's template + props through its shadow; non-zero exit on errors |
| `abide lsp` | Runs the `.abide` language server over stdio (JSON-RPC) for editor diagnostics |
| `abide init-agent` | Writes/refreshes the CLAUDE.md pointer to this surface map for non-scaffolded projects |

For tests, add `preload = ["@abide/abide/preload"]` under `[test]` in
`bunfig.toml` and use `bun test`.

## Authoring contracts

**RPC** — the handler receives the schema-validated args
(`InferOutput<schemas.input>`); typed generics on the helper are a compile error
— type the parameter, let the body infer. Inside it, `request()` / `cookies()`
/ `server()` read the request scope. Return `json(data)` (or `jsonl` / `sse`
for streams, `error` / `redirect`, or a raw `Response`). Options are namespaced
(ADR-0020): `schemas: { input, output, files }` (`files` validates uploaded
`File` parts, kept out of the JSON-Schema projection); `clients: { browser, mcp,
cli }`; `crossOrigin` (exempts a mutating rpc from the same-origin CSRF gate);
`timeout` (handler deadline in ms → 504 on every surface, composed into
`request().signal`); `maxBodySize` (per-rpc 413 cap); on read helpers (GET/HEAD)
`cache: { ttl, tags, throttle, debounce, shared }` (the endpoint's
retention/refetch policy) and `stream: { n }` (replay depth). Kind-scoped by type:
`cache`/`stream` on a write is a compile error. Query args on GET/HEAD/DELETE travel as
strings — coerce in the schema (`z.coerce.number()`). Beyond scalars, a
type-directed wire codec (ADR-0028/0029) revives a top-level arg field into the
runtime value its declared type names — a numeric string → `number`/`bigint`, a
`Date` from an ISO string, a `Set` from a JSON array, a `Map` from an entries
array/object — resolved through the warm server program; reviving is fail-open
(an unrevivable value passes through as its JSON form). A body rpc also accepts
a `FormData` in place of typed args (the upload escape hatch): text fields
validate as args, `File` parts validate against `schemas.files`.

**Consuming an rpc** — the bare call `fn(args)` IS the smart read: cached,
coalesced, reactive, stale-while-revalidate for replayable (GET/HEAD) reads.
There are no call-site options (ADR-0020) — all retention/refetch policy is
declared once on the endpoint's `cache`/`stream`. `ttl` defaults to `Infinity`:
an entry is retained for its store's lifetime — the request on the server (a
non-shared read dies with the request), the tab on the client (until
invalidate/refresh); a write coalesces only (ttl 0, the mutation idiom).
`shared` selects the process-level store instead of the request-scoped default
(server); with the default `Infinity` ttl it memoises across requests (an
explicit `ttl` bounds it) — for an external endpoint, never per-user data; on
the client it is a no-op (one tab store). A read with no request in flight (e.g.
a background job) resolves against the process-level store and coalesces only
(so it can't leak forever). During SSR the same call — any method — resolves
in-process and its value is baked into the HTML so hydration starts warm without
a re-fetch (an inline write seeds too, ADR-0036; only unprompted refetch stays
GET/HEAD) — there is no `cache()` wrapper; the bare call carries the caching. Around it:
`fn.raw(args, init?)` returns the raw `Response` (per-call transport options —
`signal`, `headers`, `keepalive`, … — live here); `fn.refresh(args?)`
refetches keeping the stale value visible; `fn.patch(args?, updater)` mutates
the retained value locally (absent on streaming rpcs); `fn.peek(args?)` reads
it synchronously; `fn.pending(args?)` / `fn.refreshing(args?)` are reactive
probes; `fn.error(args?)` is the rpc's last typed error; `fn.watch(args?,
handler)` pipes each resolved value to a handler (client-only; SSR-inert);
`fn.isError(e, kind?)` type-guards a caught error against the rpc's declared
error kinds. A
handler that returns `jsonl()`/`sse()` makes the bare call return a
`NamedAsyncIterable` (`for await` it) — detected at build, nothing to declare;
awaiting a streaming call is a compile error.

**Typed errors** — declare a constructor with
`error.typed(name, status, schema?)` and `return` it from the handler; the
client's `HttpError` then carries `kind` (the name) and `data` (the schema's
payload), narrowed via `rpc.isError`. The framework reserves
`kind: 'validation'` (422, `data: ValidationErrorData`).

**Socket** — `socket<T>(opts)` or `socket({ schema, … })` (with a schema, `T`
infers and publishes validate). Options: `tail` (retained frames, default 1 —
`tail: 0` opts out), `ttl` (retained frames expire lazily after N ms),
`clientPublish` (accept browser/HTTP publishes, off by default), `clients`
(mcp/cli exposure; a schema flips both on by default). The socket IS the
`AsyncIterable` — iterating is the live stream, no replay. Members:
`publish(msg)` (isomorphic — mirrors Bun's `server.publish()`; server fans out
in-process + to remote subscribers, client sends a validated `pub` frame),
`tail(count?)` (a
subscription seeded with retained frames), `peek()` (latest retained frame),
`refresh()` (drop local frames and re-pull the server tail; server-side
no-op), `watch(handler)` ≡ `watch(socket, handler)` (client-only, SSR-inert),
`pending()` / `refreshing()` / `done()` / `error()` (reactive stream probes),
plus `name` and `clients`.

**Pages and layouts** — `src/ui/pages/blog/[id]/page.abide` serves
`/blog/<id>`; the param arrives as a prop (`const { id } = props()`) and on the
reactive `page.params`. A `[[name]]` folder is an optional segment (the route
matches with or without it; the param is absent when unmatched), `[...rest]`
a catch-all capturing the remaining path (last segment only). One matcher
resolves routes on both sides — at the first position where two matching
patterns differ, literal beats `[name]` beats `[[name]]` beats `[...rest]`. A `layout.abide` wraps every page below its directory
and renders the page at its `{children()}` outlet. Links are plain `<a href>`
(the router intercepts in-app hrefs); build paths with `url()` and navigate
programmatically with `navigate()`.

**app.ts / config.ts** — `src/app.ts` optionally exports the `AppModule`
hooks: `init({ server })` (boot; may return a cleanup run on SIGINT/SIGTERM),
`handle(request, next)` (single middleware), `handleError(error, request)`,
`health(request)` (fields merged into the `/__abide/health` payload — public
and unauthenticated, keep it cheap), and `forwardHeaders` (extra inbound
header names forwarded onto in-process rpc requests beyond the built-in
auth/identity set). `src/server/config.ts` holds the `env(schema)` call so a
bad environment fails at boot.

## `.abide` template grammar

A component file is: an optional leading `<script>` (imports + author scope),
markup, optional `<style>` blocks. The compiler emits a client build and an
SSR render from the same parse; `abide check` / the LSP type-check the
template through a generated shadow. HTML comments are dropped; a bare
`<template>` is an inert element.

Reactive state is reached through **imported primitives**, resolved by import
binding (alias-safe) and lowered by the compiler — inside a component you read
and write the declared names as plain variables (`{count}`,
`onclick={() => (count += 1)}`); there is no `.value` in `.abide` authoring
and no `$state` sigils. In plain `.ts` modules the same imports are runtime
cells read/written through `.value`.

| Primitive | Import | Spec |
| --- | --- | --- |
| `state(initial, transform?)` | `@abide/abide/ui/state` | Writable cell. Plain `state(v)` lowers to a serializable doc slot (SSR-resumable); with `transform` the gate runs on every write (`(next, previous) => stored`) |
| `state.computed(fn)` | member of `state` | Read-only derived value, lazy, never serialized |
| `state.linked(fn, transform?)` | member of `state` | Writable cell re-seeded whenever the thunk's dependencies change |
| `state.share(key, value)` / `state.shared(key)` | members of `state` | Put a named value on the ambient scope / read the closest ancestor's |
| `watch(source, handler)` | `@abide/abide/ui/watch` | The single reaction primitive (client-only, stripped from SSR). Sources: a bare thunk `watch(() => …)` (auto-tracked effect), a state cell, a cell array, a socket/stream (`handler(frame)` per frame with reconnect replay), an rpc (`watch(fn, args?, handler)` — runs the smart read, `handler(value)` on each change). Returns a scope-tied disposer |
| `html(str)` / `` html`…` `` | `@abide/abide/ui/html` | Brands trusted raw HTML so `{expr}` inserts nodes instead of escaped text; plain `{value}` always escapes |
| `props()` | `@abide/abide/ui/props` | The prop reader, resolved by import binding (alias-safe) like `state`: `const { name = fallback, ...rest } = props()`; a page/layout's declared props are additive with its route-param shape. `children` is an ordinary declared prop (`const { children } = props<{ children: Snippet }>()`), not ambient |

Bindings and directives (the attribute kinds `readAttributes` parses):

| Form | Spec |
| --- | --- |
| `{expr}` | Text interpolation, escaped; a snippet or `html`-branded value mounts as nodes. Type-directed (ADR-0032): a `Promise`/`AsyncIterable`-typed `{expr}` (or an async sub-expression) lifts to a peek-cell — `undefined` while pending (composes with `??`/`?.`), then the resolved value / latest frame; a plain value binds directly |
| `{await expr}` | Explicit **blocking** await — renders the awaited value inline during SSR. Valid in every position (ADR-0032): content, an attribute, an `{#if}`/`{#switch}` subject, a `{#for}` source |
| `name={expr}` | Attribute/prop bound to an expression |
| `name="a {expr} b"` | Interpolated attribute — a literal `{` in a quoted value always interpolates (write `&lbrace;` for a literal brace) |
| `{...expr}` | Spread — props onto a component, attributes onto a native element (rejected on `<template>`) |
| `on<event>={fn}` | Event listener (`onclick`, `onsubmit`, …); on a component it is a checked callback prop |
| `bind:value={cell}` | Two-way input/select/textarea binding. `<input type="number"/"range">` writes back a number; `<select>` re-applies against late-mounting options and `<select multiple>` binds an array of selected values |
| `bind:value={{ get, set }}` | Writable-computed binding: read via `get()`, write via `set(next)` |
| `bind:checked={cell}` / `bind:group={cell}` | Checkbox boolean / radio-group value (SSR emits boolean attributes bare — `checked`, `open`, `selected` on the matching option) |
| `bind:prop={target}` (on a component) | Two-way prop binding — the same `target` forms as an element bind (an lvalue or `{ get, set }`). The child reads `prop` normally; if it writes `prop` or forwards it to another `bind:`, those writes flow back to `target`. Bindability is usage-inferred (no child-side marker): a prop only read stays read-only, and a `bind:prop` whose child never writes is simply one-way |
| `class:name={cond}` | Toggles a class; merges with a reactive `class` base in one effect |
| `style:property={value}` | Sets one style property; merges with a reactive `style` base |
| `attach={fn}` | Runs `fn(element)` at build time; an optional returned teardown runs on dispose |

Control flow is mustache blocks (`{#…}` open, `{:…}` branch, `{/…}` close —
the close must name its block, and a branch outside its block is a parse
error):

| Block | Spec |
| --- | --- |
| `{#if cond}…{:else if cond}…{:else}…{/if}` | Conditional chain (the branch keyword is `{:else if}`, with a space) |
| `{#for item, i of list by key}…{:catch e}…{/for}` | Keyed list; `, i` index and `by` key optional; `{#for await item of asyncIterable}` renders rows as they arrive (its `{:catch}` shows the stream error) |
| `{#await p}…{:then v}…{:catch e}…{:finally}…{/await}` | Async block. The branch form streams: SSR flushes the shell and streams the fragment out of order. The head form `{#await p then v}` is blocking — rendered inline (depth-first, serial) during the SSR pass |
| `{#switch subject}{:case match}…{:default}…{/switch}` | Multi-branch on a subject; only branches render — stray content is a compile error |
| `{#try}…{:catch e}…{:finally}…{/try}` | Synchronous error boundary around a build/reactive throw |
| `{#snippet name(args)}…{/snippet}` | Declares a reusable builder, called as an interpolation: `{name(args)}`; a snippet value passes through props like any other value |

A `Promise`/`AsyncIterable` (or an async sub-expression) lifts to a peek-cell in
**every** position (ADR-0032) — content, an attribute, an `{#if}`/`{#switch}`
subject, a plain `{#for}` source — reading `undefined` while pending, so
`{getFoo() ?? 'Loading…'}` shows the fallback, `{#if getFoo()}` takes the else
branch, and a pending `{#for}` renders empty. A leading `await` makes it
SSR-blocking (resolved inline); no `await` streams (pending shell, resolves on the
client). The one rejection is a raw `AsyncIterable` driving a plain `{#for}` —
iterate its frames with `{#for await}`.

Components are capitalised tags (`<Panel prop={x}>…</Panel>`); nested content
becomes the component's `children` prop — an ordinary declared prop of type
`Snippet`, read with `const { children } = props<{ children: Snippet }>()`
and called as `{children()}` — the single fill point (`{#if children}
{children()}{:else}…{/if}` for a fallback; there are no named slots and no
`<slot>` element). Slotted content (`<Panel>…</Panel>`) and an explicit
`children={aSnippet}` attribute set the same prop — slotted content rides in
as the trailing prop layer, so it wins over an explicit `children` attribute
on the same tag (`mergeProps`, last layer wins per key). A layout's
`{children()}` is the route outlet.

`<script>` and `<style>` are **not component-root-only**: either may sit
inside a control-flow branch, scoped to that branch. A nested `<script>`
declares branch-local `state` / `state.computed` / `state.linked` the same
imported way (re-seeded per mount; static `import` statements are illegal
there — imports live in the leading `<script>`). A **root** `<style>` is
component-scoped; a nested `<style>` scopes to its sibling subtree only.

Removed forms throw migration errors at parse time: the `<slot>` element (use
a declared `children: Snippet` prop, called `{children()}`), `<template
name>` snippets (use `{#snippet}`), and all `<template
if/each/await/switch/…>` control flow (use `{#…}` blocks).

## Server surface — `abide/server/*`

### RPC — `@documentation rpc`

- `@abide/abide/server/GET` — GET rpc helper: `export const x = GET(handler, opts?)` inside `src/server/rpc/`; the bundler rewrites it to the server dispatcher or the browser proxy — calling it outside an rpc module throws.
- `@abide/abide/server/POST` — POST rpc helper (mutating: JSON/FormData body).
- `@abide/abide/server/PUT` — PUT rpc helper (mutating).
- `@abide/abide/server/PATCH` — PATCH rpc helper (mutating).
- `@abide/abide/server/DELETE` — DELETE rpc helper (mutating; args travel in the query string).
- `@abide/abide/server/HEAD` — HEAD rpc helper (read-only).

### Responses — `@documentation response`

- `@abide/abide/server/json` — `json(data, init?)`: JSON response with `Cache-Control: no-store` default; `json(undefined)` emits 204 and round-trips back to `undefined`; carries the value type so the rpc's `Return` infers.
- `@abide/abide/server/jsonl` — `jsonl(asyncIterable, init?)`: JSON Lines streaming response; consumer cancel flows into the generator's `return`; a generator throw becomes a final `{"$error": message}` line.
- `@abide/abide/server/sse` — `sse(asyncIterable, init?)`: Server-Sent Events response with a 15s keepalive comment; errors emit an `event: error` frame carrying only the message.
- `@abide/abide/server/error` — `error(status, message?, init?)`: plain-text error response (message defaults to the reason phrase); the caller's await throws `HttpError`. Member `error.typed(name, status, schema?)` declares a reusable typed-error constructor the handler returns (see Authoring contracts).
- `@abide/abide/server/redirect` — `redirect(url, status = 302, init?)`: redirect response accepting relative URLs; 301/302/303/307/308.

### Request scope — `@documentation request-scope`

- `@abide/abide/server/request` — `request()`: the inbound `Request` for the in-flight SSR/rpc pass (AsyncLocalStorage); throws outside a request scope.
- `@abide/abide/server/cookies` — `cookies()`: the request's cookie jar (Bun `CookieMap`) — reads parse the inbound header; `set`/`delete` flush as `Set-Cookie` when the handler returns.
- `@abide/abide/server/server` — `server()`: the active `Bun.serve` instance; a no-op stand-in during in-process dispatch (CLI/MCP/tests); throws before boot.

### Configuration — `@documentation configuration`

- `@abide/abide/server/env` — `env(schema)`: validates `Bun.env` against a Standard Schema at module top level (synchronous; every issue reported at once) and returns the typed config; the schema also projects the bundle's first-run setup form.

### Sockets — `@documentation sockets`

- `@abide/abide/server/socket` — `socket<T>(opts?)` / `socket({ schema, tail, ttl, clientPublish, clients })`: declares the broadcast topic inside `src/server/sockets/<name>.ts`; see Authoring contracts for the full `Socket<T>` member surface.

### Agent — `@documentation agent`

- `@abide/abide/server/agent` — `agent(engine, messages)`: runs a provider engine (an `@abide/<provider>` package) against the app's own MCP surface inside an rpc's request scope and returns its `AgentFrame` stream; the handler picks the transport (`jsonl(agent(…))` / `sse(agent(…))`). The module also exports the neutral contract types: `NeutralMessage` (user/assistant/tool turns), `AgentFrame` (`text` deltas, `tool_use`, `tool_result`, `done` with a stop reason), `AgentSurface` (the gated tool/prompt/resource surface), and `AgentEngine` (surface + messages + origin in, frames out).

### Server plumbing — `@documentation plumbing`

- `@abide/abide/server/AppModule` — the type of `src/app.ts`'s optional hooks (`init`, `handle`, `handleError`, `health`, `forwardHeaders`).
- `@abide/abide/server/InspectorContext` — the capability object core injects into `@abide/inspector` (`loadSurface`, `cacheSnapshot`, `inFlightSnapshot`, `onRecord`, app identity); keeps the inspector a pure consumer.
- `@abide/abide/server/rpc/defineRpc` — `defineRpc(method, url, handler, opts?)`: the server-side construction the bundler rewrites rpc helper calls into — validation, timeout composition, client-flag resolution, registry entry.
- `@abide/abide/server/sockets/defineSocket` — `defineSocket(name, opts?)`: server-side socket construction (retained-tail buffer with lazy TTL eviction, per-subscriber queues, `server.publish` fan-out).
- `@abide/abide/server/prompts/definePrompt` — `definePrompt(name, opts)`: registers an MCP prompt; the resolver plugin generates one call per `src/mcp/prompts/<name>.md`.
- `@abide/abide/server/prompts/renderPromptTemplate` — `renderPromptTemplate(template, args)`: substitutes `{{name}}` placeholders in a prompt body (missing args collapse to empty).

## Isomorphic surface — `abide/shared/*`

### Cache mutators — `@documentation cache`

- `@abide/abide/shared/refresh` — `refresh(selector?, args?)`: refetch every cached read matching the selector, keeping the stale value visible until the fresh one swaps in. Selector grammar: `(fn, args)` exact call, `(fn)` every args-variant, `({ tags })` a tagged group, `()` everything. `fn.refresh(args?)` is the pre-bound sugar.
- `@abide/abide/shared/patch` — `patch(fn, args?, updater)` / `patch({ tags }, updater)`: mutate the retained value(s) in place — reactive, no network; the optimistic-update / socket-frame primitive. `fn.patch(…)` is the sugar.

### Probes — `@documentation probes`

Probes report, never act — reading one opens no fetch and no stream.

- `@abide/abide/shared/pending` — `pending(selector?, args?)`: reactive "no value yet" probe over calls and streams (global, per-rpc, per-call, tagged, per-subscribable).
- `@abide/abide/shared/refreshing` — `refreshing(selector?, args?)`: "holding a value while a fresher one is in flight" — the SWR reload / stream-reconnect badge.
- `@abide/abide/shared/peek` — `peek(fn, args?)` / `peek(socket)`: the retained value (or latest frame), synchronously, `T | undefined`; reactive inside a tracking scope.
- `@abide/abide/shared/done` — `done(subscribable)`: true once a stream closed (stream-only; a cache read's "done" is `!pending && !refreshing`).
- `@abide/abide/shared/online` — `online()`: reactive connectivity probe — browser `online`/`offline` events; server-side it reflects the *calling client's* reported connectivity (always true during SSR and outside a scope).

### Errors — `@documentation response`

- `@abide/abide/shared/HttpError` — thrown by rpc calls on non-2xx; carries `status`, `statusText`, the raw `response`, and — for typed/validation errors — `kind` + `data`.
- `@abide/abide/shared/ValidationErrorData` — the `data` shape of a `kind: 'validation'` failure: the raw Standard Schema `issues` plus a `fields` (field → first message) map.

### Schema projection — `@documentation rpc`

- `@abide/abide/shared/withJsonSchema` — `withJsonSchema(schema, toJsonSchema)`: attaches the `toJSONSchema()` projection to a Standard Schema whose library lacks one, feeding OpenAPI, MCP, CLI help, and the bundle setup form.

### Observability — `@documentation observability`

- `@abide/abide/shared/health` — `health()`: reactive backend health — `{ reachable, abide, name, version, …app health-hook fields }`, polled from `/__abide/health` only while a tracking scope reads it; SSR-seeded so hydration starts warm; constant `{ reachable: true }` on the server. The `AppHealth`/`AppHealthMap` types augment from the generated `health.d.ts`.
- `@abide/abide/shared/reachable` — `await reachable(host?)`: outbound reachability, same callable both sides. The first call probes (HEAD) and starts a TTL background poll; later calls answer instantly off the warm value. Any completed HTTP response counts as reachable. No host asks about the app's own backend: constant true on the server and on a loopback origin (dev, desktop bundle — works offline); a deployed origin probes like any host. The browser probes no-cors and composes `navigator.onLine` in at read time (loopback exempt). Tuned by `ABIDE_REACHABLE_TTL` / `ABIDE_REACHABLE_TIMEOUT` (server env; the browser runs the defaults).
- `@abide/abide/shared/log` — the unified logger: `log(...)` / `.warn` / `.error` / `.trace` on the app's always-on channel, every record carrying request-scope context (short trace id, +elapsed, method+path); member `log.channel(name)` returns the same shape on a DEBUG-gated diagnostic channel. Renders tsv (default) or JSON per `ABIDE_LOG_FORMAT`.
- `@abide/abide/shared/trace` — `trace()`: the current request's W3C `traceparent` (client-side: the trace of the request that rendered the page), or undefined outside any scope.

### Page — `@documentation page`

- `@abide/abide/shared/page` — the reactive page proxy: `page.route`, `page.params`, `page.url` (browser-space on both sides, mount base included), `page.navigating`; isomorphic, re-runs readers across navigations.

### URL — `@documentation url`

- `@abide/abide/shared/url` — `url(path, params?/args?)`: resolves any in-app URL to its base-correct form — a page route literal interpolates its `[name]` / `[[name]]` / `[...rest]` params (typed via `PathParams`; an absent optional drops its segment), a GET rpc path serializes typed args to the query, anything else is base-prefixed. Also exports the augmentable `RpcRoutes` / `PageRoutes` / `PublicAssets` maps and the `PathParams<P>` type.

### Templating — `@documentation templating`

- `@abide/abide/shared/snippet` — `snippet(payload)`: brands a snippet payload so a `{expr}` interpolation mounts it (client: a DOM builder; server: the rendered string); the compiler wraps `{#snippet}` bodies in this. Also exports the `Snippet<Args>` type — a callable `(...args: Args) => SnippetValue`, generic over its call arguments (`children` is `Snippet`, invoked `children()`; a row snippet is `Snippet<[Item]>`, invoked `row(item)`) — plus `SnippetValue` (the internal payload brand) and `snippetPayload(value)` (a branded value's payload, or undefined for plain values).

### Shared plumbing — `@documentation plumbing`

- `@abide/abide/shared/createSubscriber` — `createSubscriber(start)`: open-on-first-tracked-read / close-on-last-reader resource lifecycle grounded in the signal core; the substrate under `health()`, `online()`, and the tail probes.

## UI surface — `abide/ui/*` (client-only)

### Reactive state — `@documentation reactive-state`

- `@abide/abide/ui/state` — the `state` primitive: `state(initial, transform?)` writable cell, `state.computed(fn)` read-only derived, `state.linked(fn, transform?)` writable-reseeded, `state.share(key, value)` / `state.shared(key)` ambient context. In `.abide` files the compiler lowers reads/writes to plain variable syntax; in `.ts` the cell is read/written through `.value`.
- `@abide/abide/ui/watch` — `watch(source, handler)`: the single reaction primitive over a thunk, cell, cell array, socket/stream, or rpc (see the grammar table). Client-only; the compiler strips author calls from SSR, and the `socket.watch` / `fn.watch` instance sugar is SSR-inert.
- `@abide/abide/ui/props` — `props<T>()`: the prop reader, resolved by import binding (alias-safe) like `state`; a required import — there is no ambient `props()`. Destructure declared props off it (`const { name, ...rest } = props<T>()`); a page/layout's declared `T` is additive with its auto-typed route-param shape. `children` is an ordinary declared prop, not ambient: `const { children } = props<{ children: Snippet }>()` (`Snippet` from `@abide/abide/shared/snippet`).

### Templating — `@documentation templating`

- `@abide/abide/ui/html` — `html(string)` / `` html`…` ``: brands trusted raw HTML for unescaped interpolation; the tag does not escape its interpolations — only feed it values you trust.

### Navigate — `@documentation navigate`

- `@abide/abide/ui/navigate` — `navigate(path, params?, options?)`: typed programmatic navigation off the route map; params interpolate through `url()` (base-correct). Options `{ replace, keepScroll }`. The module also exports `navigatePath(path, options?)` (already-resolved paths — the router's own entry, no re-basing) and the `NavigateOptions` type.

### UI plumbing — `@documentation plumbing`

Compiler/runtime machinery — published so generated code, the type shadow, and
tests can import it, not for app code.

- `@abide/abide/ui/effect` — `effect(fn)`: the raw auto-tracked effect the compiler emits for bindings; authors use `watch`. Returns a disposer; SSR strips author calls.
- `@abide/abide/ui/currentScope` — `scope()`: the ambient lexical scope — the internal lowering host for `state`/`effect` (`derive`/`linked`/`effect`/`share` land here).
- `@abide/abide/ui/enterRenderScope` — `enterScope()`: opens an isolated scope for an SSR render; returns the previous scope to restore.
- `@abide/abide/ui/exitRenderScope` — `exitScope(previous)`: restores the scope `enterScope` saved.
- `@abide/abide/ui/router` — `router(...)`: the client router — fills layout/page chains into comment-marker outlet boundaries, intercepts in-app links, buckets/restores scroll per history entry.
- `@abide/abide/ui/startClient` — `startClient(...)`: the client entry — reads every `__SSR__` field into its shared slot (cache seed, health seed, client timeout, resume manifest), hydrates the chain, starts the router.
- `@abide/abide/ui/renderToStream` — `renderToStream(render)`: out-of-order SSR streaming — shell first, then one `<abide-resolve>` fragment per streaming await block in completion order; blocking (`then`-head) awaits render inline.
- `@abide/abide/ui/remoteProxy` — `remoteProxy(method, url, opts?)`: the browser-side rpc stub the bundler emits (fetch, decode, HttpError, streaming); the `RemoteProxyOptions` type rides along.
- `@abide/abide/ui/socketProxy` — `socketProxy(name)`: the browser-side socket stub — the identical `Socket<T>` shape over the page's lazily-opened multiplexed ws channel.
- `@abide/abide/ui/runtime/escapeKey` — JSON-Pointer-escapes one reactive-doc path key (`~`→`~0`, `/`→`~1`).
- `@abide/abide/ui/runtime/withPath` — pushes one `escapeKey`-escaped render-path segment for the duration of a synchronous `build`, relative to the ambient path (the render-path identity a layout layer / child mount composes); restores after. A reactively-rebuilt block uses `withPathFrom` with a captured base instead.
- `@abide/abide/ui/runtime/renderPath` — the render-path a `<Child/>` mounts under: composes a child's ordinal onto the ambient path (`withPath(ordinal, …)`) to produce the `abide:await:CHILDPATH` boundary id, computed identically on both sides so the streamed-child adopter never drifts. Server-emit-only.
- `@abide/abide/ui/runtime/blockId` — allocates an await/try block id namespaced by the ambient render-path (`${path}:${n}`, per-path document-order counter), so sibling child renders can run concurrently during SSR without their block ids interleaving; the bare (`path === ''`) case keeps the plain `0,1,2…` form.
- `@abide/abide/ui/runtime/nextBlockId` — the next await/try block id in the current render pass (document order, shared across inlined children).
- `@abide/abide/ui/runtime/enterRenderPass` — marks entry into a render/mount; the outermost resets the block-id counter.
- `@abide/abide/ui/runtime/exitRenderPass` — unwinds `enterRenderPass`'s depth.
- `@abide/abide/ui/dom/mount` — mounts a top-level page/layout into a host under an ownership scope; returns the unmount.
- `@abide/abide/ui/dom/mountChild` — mounts a nested child component as a comment-marker range (dev builds also register it with the hot bridge).
- `@abide/abide/ui/dom/mountStreamedChild` — the client mount for a HOISTABLE child (ADR-0039): a dual-mode adopter that probes the hydration cursor to tell whether the server inlined the child (settled) or streamed it (`abide:await:CHILDPATH` boundary, already swapped in), then adopts the range in place — falling back to a create-mount on a client navigation or an unfilled boundary. Registers with the hot bridge like `mountChild`.
- `@abide/abide/ui/dom/mountSlot` — mounts a component's passed-children content as a marker-bounded range.
- `@abide/abide/ui/dom/outlet` — a layout's outlet: an empty `<!--abide:outlet-->…<!--/abide:outlet-->` boundary the router fills.
- `@abide/abide/ui/dom/hydrate` — adopts server-rendered DOM instead of rebuilding: runs the build with a claim cursor over the existing nodes.
- `@abide/abide/ui/dom/skeleton` — the parsed-once static-structure clone path every bound element builds through; element holes by path, blocks by anchor comments.
- `@abide/abide/ui/dom/anchorCursor` — positions a skeleton-anchored block/slot at its `<!--a-->` anchor, in clone and hydrate modes alike.
- `@abide/abide/ui/dom/cloneStatic` — appends a fully-static subtree (no bindings, control flow, or listeners) by cloning.
- `@abide/abide/ui/dom/appendStatic` — a static text node: created (create mode) or claimed from server-rendered text (hydrate mode).
- `@abide/abide/ui/dom/appendText` — a reactive `{expr}` text node under a parent.
- `@abide/abide/ui/dom/appendTextAt` — a reactive text node mounted at a skeleton anchor (text interleaved with element siblings).
- `@abide/abide/ui/dom/appendSnippet` — mounts a `{snippet(args)}` interpolation's builder into a marker-bounded range.
- `@abide/abide/ui/dom/attr` — binds an element attribute to a read (boolean true → bare attribute, false/nullish → removed).
- `@abide/abide/ui/dom/on` — attaches an event listener whose removal is registered with the ownership scope.
- `@abide/abide/ui/dom/attach` — runs an `attach={fn}` attachment and registers its optional teardown.
- `@abide/abide/ui/dom/bindSelectValue` — two-way `<select>` binding that re-applies the selection when the option set changes (late-mounting `{#for}`/async options; `multiple` binds an array).
- `@abide/abide/ui/dom/each` — keyed `{#for}` runtime: marker-bounded rows reconciled by key.
- `@abide/abide/ui/dom/eachAsync` — `{#for await}` runtime: rows append/reconcile as the AsyncIterable yields.
- `@abide/abide/ui/dom/when` — `{#if}` runtime (single-branch swap in a marker-bounded range).
- `@abide/abide/ui/dom/switchBlock` — `{#switch}` runtime (also `{#if}` chains with `{:else if}` branches).
- `@abide/abide/ui/dom/awaitBlock` — `{#await}` runtime: pending → resolved/error branch swap, teardown-generation guarded.
- `@abide/abide/ui/dom/tryBlock` — `{#try}` runtime: synchronous error boundary around a subtree build.
- `@abide/abide/ui/dom/mergeProps` — composes a child's props from explicit thunk runs, spread layers, and the trailing children layer.
- `@abide/abide/ui/dom/spreadProps` — wraps a `{...source}` spread layer so every key resolves to a live value thunk.
- `@abide/abide/ui/dom/restProps` — the live unconsumed-props object behind `const { …, ...rest } = props()`.
- `@abide/abide/ui/dom/bindProp` — the parent half of a component `bind:prop`: annotates a prop's value thunk with a `set` write-back channel.
- `@abide/abide/ui/dom/bindableProp` — the child half: the writable cell a component gets for a prop it writes or forwards (pass-through to the parent when bound, a local reseeding cell when not).
- `@abide/abide/ui/dom/spreadAttrs` — spreads an object's keys onto a native element (`<div {...rest}>`), keys enumerated once.
- `@abide/abide/ui/dom/mutateDocContainer` — the lowering for an in-place mutating container method on a reactive doc (`model.items.splice(…)`, `.sort()`, a Set `.add()`, a Map `.set()`, …): clones the array/Map/Set, applies the mutation to the copy, and writes it back through `replace` so a real patch fires (readers wake, the render tree re-derives); returns the native method's result unchanged.
- `@abide/abide/ui/dom/readCall` — guarded method call on a reactive-doc read (the `model.draft.trim()` lowering).
- `@abide/abide/ui/dom/readCell` — unified read for a `linked`/async-`computed` reference (the `$$readCell(NAME)` lowering): peeks an async cell, reads `.value` off a sync one.
- `@abide/abide/ui/dom/cellPending` — whether a control-flow subject (`{#if}`/`{#switch}`) is a still-loading async cell (no value, no error) so the block renders no branch while pending instead of flashing its `{:else}`; a plain/settled value is never pending.
- `@abide/abide/ui/settleAsyncCells` — the SSR Tier-2 await-barrier (the `await $$settleAsyncCells()` lowering emitted between a component's cell declarations and its template): drains + awaits the request-scoped in-flight async-cell promises so their resolved values bake into the first-pass HTML.
- `@abide/abide/ui/flight` — the SSR flight-starter (`$$flight(() => expr)`): hoists a hoistable await's promise into the synchronous render prefix so independent flights overlap instead of serializing; normalises a synchronous loader throw to a rejected promise and carries a synchronous `.settled` snapshot for `finalizeStreamedChildren`. Server-emit-only.
- `@abide/abide/ui/isolateCellBarrier` — runs a hoisted child render (`$$isolateCellBarrier`) under its own async-cell barrier list (ALS-backed on the server) so its cell registrations and `$$settleAsyncCells` drain stay isolated from concurrent siblings and the page; an inert passthrough on the client. Server-emit-only.
- `@abide/abide/ui/finalizeStreamedChildren` — the ADR-0039 when-to-stream decision run once after a component's body walk (`await $$finalizeStreamedChildren(...)`): fills each hoistable child's reserved output slot — inlining a settled flight byte-identically to the pre-ADR path, rethrowing a rejected one, or emitting an `abide:await:CHILDPATH` boundary + streaming `SsrAwait` for a still-pending one. Server-emit-only.

## Build / tooling

### Building — `@documentation building`

- `@abide/abide/build` — `build({ cwd, … })`: builds the client bundle into `dist/_app` (`.abide` loader, virtual-module resolver, optional Tailwind); production builds also emit `.gz` siblings; staged and atomically swapped so a live dev server never sees a half-built dist.
- `@abide/abide/compile` — `compile({ cwd, target?, outfile? })`: produces a standalone server executable (runs the client build first and embeds the compressed assets); returns the binary path.

### Tooling plumbing — `@documentation plumbing`

- `@abide/abide/preload` — the Bun preload installing the `.abide` loader, the virtual-module resolver, and a `.css` no-op loader — the same runtime for the server, scripts (`abide run`), and `bun test`.
- `@abide/abide/resolver-plugin` — the resolver plugin itself: `$`-alias + virtual-module (`abide:*`) resolution, rpc/socket module rewriting, side-crossing guards.
- `@abide/abide/ui-plugin` — the Bun plugin that compiles `.abide` single-file components to ES modules (layouts flagged by filename; scoped styles bundled into the entry stylesheet).
- `@abide/abide/tsconfig` — the base tsconfig apps extend (`bundler` resolution, strict, `types: ["bun"]`, erasable syntax only).

## Desktop bundle — `@documentation bundle`

- `@abide/abide/bundle/BundleWindow` — the type of `src/bundle/window.ts`'s default export: window title/size plus custom `menu` entries inserted between the standard Edit and Window menus.
- `@abide/abide/bundle/BundleMenu` — one top-level custom menu (`label` + `items`).
- `@abide/abide/bundle/BundleMenuItem` — one menu entry: a divider, an `emit` item dispatching an `abide:menu` CustomEvent into the page (optional Cmd `shortcut`), or a `navigate` item repointing the window itself.
- `@abide/abide/bundle/onMenu` — `onMenu(handler)` / `onMenu(name, handler)`: subscribes to bundle menu clicks; returns an unsubscribe; inert during SSR and in plain browser tabs.
- `@abide/abide/bundle/bundled` — `bundled()`: true inside the desktop bundle (client: webview init flag; server: launcher-spawned process), false in a plain browser tab or on a remote server.
- `@abide/abide/server/appDataDir` — `appDataDir()`: the running bundle's per-user data dir, keyed by the bundler-injected program name; pure path computation, cwd-independent (`ABIDE_DATA_DIR` overrides).

## MCP — `@documentation mcp`

- `@abide/abide/mcp/createMcpServer` — `createMcpServer(opts?)`: the MCP server behind `/__abide/mcp` — tools derived from every `clients.mcp` rpc and socket (a `<name>-tail` read tool, plus `<name>-publish` under `clientPublish`), prompts from `src/mcp/prompts/`, auth inherited from the inbound request, optional `authorize` hook. Framework-constructed; there is no user-authored server module.

## Testing

- `@abide/abide/test/createTestApp` — `@documentation testing` — boots the app in-process for `bun test`: typed `app.rpc.<name>` / `app.sockets.<name>` clients (typed via the generated `testRpc.d.ts` / `testSockets.d.ts`), request scope included, no network.
- `@abide/abide/test/createScriptedSurface` — `@documentation plumbing` — a scripted `AgentSurface` for engine tests: declarative tool stubs in, an MCP surface out, every dispatched call recorded for assertions.
- `@abide/abide/test/assertAgentFrameConformance` — `@documentation plumbing` — collects an engine's frame stream and asserts the neutral `AgentFrame` contract (exactly one terminal `done`, paired `tool_use`/`tool_result`, string deltas); returns the frames for provider-specific assertions.

## Generated machine surfaces

| Route | Serves |
| --- | --- |
| `/openapi.json` | The OpenAPI document projected from every rpc's method, URL, and schemas. The 200 response body comes from `schemas.output` or, absent one, the handler's return type projected to JSON Schema (ADR-0030 D2); each `error.typed(...)` branch the handler can return surfaces as its own status response (ADR-0030) |
| `/__abide/mcp` | The MCP endpoint (tools from rpcs/sockets, prompts, resources); auth flows from the inbound request |
| `/__abide/health` | Liveness + identity JSON: framework version, app name/version, plus the app `health(request)` hook's fields; answered ahead of `app.handle` |
| `/__abide/identity` | Compatibility alias for the same payload with the legacy `abide: true` marker |
| `/__abide/sockets` | The single multiplexed WebSocket every client socket rides |
| `/__abide/sockets/<name>` | A socket's HTTP face: `GET` = retained tail as JSON (SSE stream under `Accept: text/event-stream`; `?tail=N` caps/seeds), `POST` = publish gated by `clientPublish`; 404 unless the socket is exposed to mcp/cli |
| `/__abide/cli` | `GET` = shell install script; `/__abide/cli/<platform>` streams the thin-CLI tarball (cli + server binaries, `.env` baked with `ABIDE_APP_URL`/`ABIDE_APP_TOKEN`) |
| `/__abide/inspector` | The `@abide/inspector` UI, mounted only under `ABIDE_ENABLE_INSPECTOR=true` |
| `/__abide/hot/<moduleId>` | Dev-only component hot-module endpoint backing `.abide` HMR |

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | Binds that exact port (a collision fails loudly); unset, the server finds an open port from the default |
| `APP_URL` | The app's public origin and optional mount base path (a bare `/v2` is tolerated); drives `url()` base-prefixing |
| `ABIDE_APP_URL` | The remote server a thin CLI binary talks to (baked into its downloaded `.env`) |
| `ABIDE_APP_TOKEN` | Bearer token the thin CLI sends; baked into the downloaded `.env` when the download request was authenticated |
| `ABIDE_CLIENT_TIMEOUT` | Default browser-side rpc timeout in ms — read at server boot, shipped to the client via the SSR payload |
| `ABIDE_DATA_DIR` | Overrides the per-user data directory on every platform |
| `ABIDE_ENABLE_INSPECTOR` | `true` mounts `@abide/inspector` at `/__abide/inspector` (the package must be installed) |
| `ABIDE_IDLE_TIMEOUT` | Bun per-connection idle timeout in seconds (default 10) |
| `ABIDE_INSPECT` | Enables right-click → Inspect in the desktop bundle's webview |
| `ABIDE_LOG_FORMAT` | `json` renders one JSON object per log line (default: tab-separated tsv) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | Server-wide max request body bytes (a per-rpc `maxBodySize` refines it) |
| `ABIDE_REACHABLE_TTL` | `reachable()` poll cadence / freshness in ms (default 30000) |
| `ABIDE_REACHABLE_TIMEOUT` | `reachable()` per-probe bound in ms (default 3000) |
| `DEBUG` | Channel-gated diagnostics (`DEBUG=abide:rpc`, `abide:sockets`, `abide:build`, …); `DEBUG=-abide` silences the framework's own channel |

---

This file mirrors `package.json`'s `exports`; after adding or renaming an
export, run `bun run packages/abide/scripts/readmeSurfaces.ts` and regenerate.
