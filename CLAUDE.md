# abide - isomorphic type-safe framework for async interfaces for humans and machines built on bun and web standards

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic with no ceremony
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all builds and environments
* isomorphism by default — same callable, same name, same *intent* on both sides
* uses typescript 7 for compiler
* small and low level client bundle built from compiled .abide
* value performance when all other conditions are met

# coding guidelines

* src/lib is split three ways: `lib/server/`, `lib/ui/`, and `lib/shared/`
* use bun apis - not node apis unless necessary
* only one export per file named after the export
* favor imperative/procedural over heavy functional abstractions
* write pure functions and use functional style programming
* use simple loops (for, for of) and straightforward control flow instead of deep iterator chains or high generic combinators in tight loops
* keep objects and arrays monomorphic so the JIT can optimize them agressively
* minimize dynamic features and complex closures in performance critical sections
* use descriptive variable and function names instead of abbrevations
* write terse comments only when why is unclear. do not write comments where code is self explanatory
* use monomorphic types and narrowing/widening instead of ad-hoc or one use types
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* constants should be UPPERCASE_SNAKE_CASE always, including their files
* do not worry about backwards compatibility if there is a better way to do something at any level unless it changes a public api - then discuss

> The authoritative design lives in `docs/spec/*.md`. This file is the generated public-API
> reference. Core model: the primitive is **`cell`** — a generic isomorphic memoizer for async
> functions (cache + coalesce + reactive read surface); RPC is `cell` + transport. RPC inputs/outputs
> are **JSON-serializable only**; the rich value codec applies only to hydrated non-RPC values.

# abide — Public API & Template Feature Reference

## Server — `abide/server/*`

### RPC helpers
| Import | Signature | Notes |
| --- | --- | --- |
| `abide/server/GET` | `GET(fn, opts?)` | Read-only. |
| `abide/server/HEAD` | `HEAD(fn, opts?)` | Read-only, identical to `GET` |
| `abide/server/POST` | `POST(fn, opts?)` | Mutating. |
| `abide/server/PUT` | `PUT(fn, opts?)` | Mutating |
| `abide/server/PATCH` | `PATCH(fn, opts?)` | Mutating |
| `abide/server/DELETE` | `DELETE(fn, opts?)` | Mutating |

Handler takes **one positional argument** — a single object `{...}` (or absent for zero-arg). Its
properties are the input schema / MCP tool props / CLI flags / cache-key args. Any handler may
return a stream (`jsonl`/`sse`). Reads put args in the URL, mutations in the body.

**RPC `opts`**: `{ schemas?: { input?, output?, files? }, clients?: { browser?, mcp?, cli? },
middleware?, crossOrigin?, maxBodySize?, timeout?, cache?: false | { ttl?, shared?, tags? } }`.
- **No schema** → input/output JSON Schema is **type-derived** (TS7), runtime-enforced, loud on
  unrepresentable types.
- **`clients`** = *reachability only* (which surfaces reach it; `true`/`false`/`{…}`). **Not
  authorization** — auth is `middleware`. `{ browser: { validate: false | true } }`; `true` ships
  the real validator client-side for parity.
- **`middleware`**: `Array<(next) => Response>` run for this RPC (composed inside the global chain).
- **`cache`** (unified across verbs; `docs/spec/replayable-streams.md`): `ttl` (ms; **reads** default ∞,
  **mutations** default `0` = coalesce identical concurrent in-flight calls, retain nothing), `shared`
  (opt-in cross-request server cache; ambient-scope reads fail-closed; pure-over-args), `tags`.
  `cache: false` opts a call OUT of the cell entirely (every call runs; a mutation's at-least-once). A
  `FormData` mutation body always bypasses (can't be keyed). A streaming handler that yields an
  `AsyncIterable` (or `jsonl(gen())`, which sees through to it) is stored as a **ReplayableStream**
  (replay-then-live; ttl clock from stream CLOSE; open streams pinned; per-stream cap
  `ABIDE_MAX_STREAM_BUFFER_SIZE`, default unbounded) so concurrent/late viewers share one run. Resume a
  retained transcript over `GET /rpc/<name>?args=…&from=<count>` (re-encoded in the handler's ORIGINAL
  encoding — jsonl resumes as jsonl, sse as sse). **Built:** primitive + cell + verb routing + shared
  streaming + json/jsonl/**sse** see-through (all lazy) + resumable endpoint + the **SSR→client hydration
  handoff** — a `{#for await}` over a known-RPC source seeds its decoded transcript (a `StreamHandle`) so
  hydrate ADOPTS the completed transcript (mode A) or RESUMES an open one over `?from=<count>` (mode B)
  instead of re-invoking the source; a non-RPC source still re-iterates. **Client-side consumption:** the
  browser RPC proxy decodes a streaming response by content-type into an `AsyncIterable` (routed through
  the same cell), so `{#for await x of rpc()}` works in the browser identically to SSR; `sse` is also
  consumable via the native `EventSource`.
- **`timeout`**: bilateral (client abort + server deadline); defaults to `ABIDE_RPC_TIMEOUT`.
  **`crossOrigin`**: default closed.

### Response
| Import | Signature |
| --- | --- |
| `abide/server/json` | `json(data, init?)` → `TypedResponse<T>` (sees through to `data` in a cell-backed read/mutation) |
| `abide/server/jsonl` | `jsonl(iterable, init?)` → `StreamResponse<C>`, `application/jsonl` (lazy; sees through to the iterable → ReplayableStream) |
| `abide/server/sse` | `sse(iterable, init?)` → `StreamResponse<C>`, `text/event-stream` (lazy; sees through to the iterable → ReplayableStream, on par with jsonl; also consumable via `EventSource`) |
| `abide/server/error` | `error(status, message?, init?)`; `error.typed(name, status, schema?)` |
| `abide/server/redirect` | `redirect(url, status=302, init?)` |

### Sockets
| Import | Signature |
| --- | --- |
| `abide/server/socket` | `socket<T>(opts?)`; opts: `{ tail?, ttl?, clientPublish?, schema?, clients?, handler?, crossOrigin? }` |

`Socket<T>` is an isomorphic `AsyncIterable<T>`. Subscribe by iterating; **publish via
`socket.publish(msg)`** (server always; client when `clientPublish`). `handler` mediates client
publishes (transform/reject/drop). HTTP face `/__abide/sockets/<name>` (SSE subscribe / POST
publish). Server-side cache broadcasts ride authorized `(rpc,args)` channels on the mux.

### Request scope (imported ambient accessors)
| Import | Signature |
| --- | --- |
| `abide/server/request` | `request()` → `Request` |
| `abide/server/cookies` | `cookies()` → `Bun.CookieMap` |
| `abide/server/server` | `server()` → `Bun.serve` instance |
| `abide/server/identity` | `identity()` → principal (never null; `.set(p)` / `.clear()`) |
| `abide/server/context` | `context()` → per-request mutable carrier bag |
| `abide/shared/route` | `route()` → `{ kind, name, params, url, navigating }` (isomorphic) |

### Config
| Import | Signature |
| --- | --- |
| `abide/server/env` | `env(schema)` → typed, boot-validated config; result type is **inferred from the schema** (schema-first, no `<T>` to repeat; field-spec map + Standard Schema). `env<T>()` (no schema) = best-effort pass-through — `T` is a compile-time annotation, not runtime-enforced |

### Beyond the browser
| Import | Signature |
| --- | --- |
| `abide/server/agent` | `agent(engine, messages, options?)` → `AgentFrame` stream. `options`: `{ model?, system?, tools?, approval?, … }`. `tools` default = all `clients.mcp` RPCs; `[]` = none. Types: `NeutralMessage`, `AgentFrame`, `AgentSurface`, `AgentEngine`. Ships a Claude engine (Anthropic Messages API over `fetch`) + a Claude Code engine (spawns the local `claude` CLI via `Bun.spawn`; **self-contained** — runs its own loop, engine tools OFF by default). |
| `abide/server/appDataDir` | `appDataDir()` → per-user data dir |
| `abide/shared/cell` | `cell(asyncFn, opts?)` → smart-read wrapper for any async fn (the memoizer primitive; isomorphic) |

## Isomorphic — `abide/shared/*`

### Cache verbs (method form canonical; globals only for tags)
| Method (per callable) | Global (tags only) |
| --- | --- |
| `fn.invalidate(args?)` — partial-object match; `()` = whole callable | `invalidate({ tags })` |
| `fn.refresh(args?)` | `refresh({ tags })` |
| `fn.amend(args, value \| updater)` | — |

`amend`: value-form broadcasts server→clients (via the `(fn,args)` channel); updater-form is local
(client) or runs on a durable **shared** slot (server) — server updater on a per-request slot errors.
Partial args match every superset slot.

### Probes
| Method | Global (tags) |
| --- | --- |
| `fn.pending` / `fn.refreshing` / `fn.peek` / `fn.error` | `pending({tags})` / `refreshing({tags})` |
| `done(iterable)` → boolean · `online()` → reactive boolean · `reachable(host)` → `await` boolean | |

### Schema / errors / misc
| Import | Notes |
| --- | --- |
| `abide/shared/withJsonSchema` | `withJsonSchema(schema)` → Standard Schema that also exposes `toJSONSchema()` |
| `abide/shared/done` | `done(iterable)` → reactive boolean: has a `{#for await}`-consumed stream finished? |
| `abide/shared/online` | `online()` → reactive connectivity boolean (true on server; tracks `navigator.onLine`) |
| `abide/shared/HttpError` | type: `status`, `statusText`, `kind?`, `data?` |
| `abide/shared/ValidationErrorData` | `{ issues, fields }` |
| `abide/shared/route` | `route()` (see above) |
| `abide/shared/url` | `url(path \| URL, params?, query?)` — in-app href resolver; `params` fill `[name]` segments (typed from the path literal), `query` appends a query string. No-`[name]` path (or a `URL`) collapses to `url(target, query?)` |
| `abide/shared/health` | `health()` → `{ reachable, ... }` |
| `abide/shared/log` | `log(...)`, `.info/.warn/.error/.trace`, `.channel(name)` |
| `abide/shared/trace` | `trace()` → W3C traceparent \| undefined |

## UI — `abide/ui/*` (client-only)
| Import | Signature |
| --- | --- |
| `abide/ui/state` | `state(initial, transform?)`; `.computed(fn)`, `.linked(src, transform?)`, `.shared(key, initial)` (cell shared by key across instances + tabs via `BroadcastChannel`) |
| `abide/ui/watch` | `watch(source, handler)` / `watch(thunk)` |
| `abide/ui/props` | `props<T>()` |
| `abide/ui/html` | `html(str)` / `html\`…\`` |
| `abide/ui/navigate` | `navigate(path \| URL, { replace?, keepScroll? })` — target is an already-resolved href; compose params/query with `url()` (`navigate(url('/users/[id]', { id }, { tab }))`) |
| `abide/ui/bundled` | `bundled()` → boolean |

## Desktop bundle — `abide/bundle/*`
`BundleWindow` (`title`, `width`, `height`, `menu`, `config`), `BundleMenu`, `BundleMenuItem`
(separator / `emit` / `navigate`, optional `shortcut`), `onMenu(name?, handler)`.

## MCP / testing
| Import | Signature |
| --- | --- |
| `abide/test/createTestApp` | `createTestApp()` → `TestApp` (`origin`, `fetch`, `rpc`, `sockets`, `health`, `stop`, `as(identity)`) — real in-process app, not mocks |

## isometric RPC consumption (call surface)
| Form | Meaning |
| --- | --- |
| `fn(args)` | **the read** — awaitable `Promise<T>` (coalesced + cached; SSR in-proc → browser fetch). Also subscribes the caller, so `{await fn()}` re-awaits on invalidate |
| `fn.peek(args)` | reactive `T \| undefined` snapshot — subscribes + kicks a coalesced load; the non-blocking display read |
| `fn.raw(args, init?)` | raw `Response`, full bypass |
| `fn.refresh(args?)` / `fn.invalidate(args?)` / `fn.amend(args, v)` | cache verbs (partial match) |
| `fn.peek` / `fn.pending` / `fn.refreshing` / `fn.error` / `fn.watch` | reactive probes |
| `fn.isError(e, name)` | narrow a typed error |
| bare call on a streaming handler | resolves to a fresh replay-then-live `AsyncIterable<C>` cursor (per caller, over one shared run) |
| **streaming read** `StreamRead<Args, C>` | `GET`/`HEAD` whose handler yields an `AsyncIterable<C>`; replaces the value verbs with reactive chunk probes: `fn.peek(args): C\|undefined` (the **latest chunk** — the "current value"), `fn.chunks(args): C[]\|undefined` (transcript snapshot), `fn.done(args)`, `fn.error(args)` |

## `.abide` template grammar

### Reactive state (script)
| Form | Meaning |
| --- | --- |
| `let x = state(v, transform?)` | writable cell |
| `state.computed(…)` | read-only derived (lazy, never serialized) |
| `state.linked(src, transform?)` | writable cell reseeded on dep change |
| `state.shared(key, initial)` | writable cell shared by key across instances + browser tabs |
| `watch(source, handler)` / `watch(thunk)` | reaction / auto-tracked effect |
| `const { name = fallback, ...rest } = props()` | reactive prop reader |

### Bindings / directives
| Form | Meaning |
| --- | --- |
| `{expr}` | reactive text (escaped) · `{html(...)}` raw |
| `name={expr}` | reactive attribute (whole-value expression) · `on<event>={fn}` native listener (`oninput`/`onclick`/…) |
| `name="…{expr}…"` | quoted values interpolate too (reactive) — mixed literal + `{expr}`, also on component props; a literal brace is `{'{'}` |
| `bind:value` / `bind:checked` / `bind:group` / `bind:value={{get,set}}` | two-way binds (also on component props) |
| `class:name={cond}` / `style:prop={value}` | toggle class / set one property |
| `bind:element={cell \| fn}` | node ref (cell) or per-instance attachment+teardown (fn) |
| `{...expr}` | spread props (component) / attributes (element) |

### Control flow
| Block | Branches |
| --- | --- |
| `{#if}` | `{:else if}`, `{:else}` |
| `{#for item, i of list by key}` | keyless → positional (dev-warns if body is stateful); `{#for await}` + `{:catch}` |
| `{#await p}` | `{:then}`, `{:catch}`, `{:finally}`; inline shorthand `{#await p then v}` / `{#await p catch e}` (body = that branch, no pending — the compact blocking form) |
| `{#switch}` | `{:case}`, `{:default}` |
| `{#try}` | `{:catch}`, `{:finally}` (JS-semantics error boundary) |
| `{#snippet name(args)}` | reusable builder, called `{name(args)}`, passable as a prop |

### Async reads
| Form | Meaning |
| --- | --- |
| `{fn.peek(args)}` | non-blocking `T \| undefined` snapshot; `undefined` while pending, reactive |
| `{await fn(args)}` | the read — blocks SSR (value in initial HTML) / suspends on client; re-awaits on invalidate |
| `{#await fn(args)}` | reactive await block: `{:then v}` (`v: T`) / `{:catch}` / `{:finally}` |
| `{#await fn(args) then v}` | inline blocking form: `v: T` bound in the opener, body renders once settled (no pending branch) |
| `{fn(args)}` (bare) | renders the awaited value (the runtime auto-awaits the read promise); `{fn(args).field}` is a type error — bind via `{#await}` or use `.peek()` |
| `fn.pending()` / `fn.error()` | probes |

### Components / pages
| Feature | Notes |
| --- | --- |
| Capitalised tags | component invocation · `{children()}` single slot · snippets = named-slot/render-prop |
| `<script>` per-instance · `<script module>` once-per-module · nested `<script>` branch-local |
| `<style>` component-scoped · nested `<style>` subtree-scoped · tailwind optional |
| `src/ui/pages/**/page.abide` / `layout.abide` | routes; `[name]` → `route().params.name` |
| `route()` | `route().url`, `.params`, `.name`, `.kind`, `.navigating` |
| `navigate` / `url` | `url(path, params?, query?)` builds an href; `navigate(target, options?)` moves to one — compose as `navigate(url(...), options)`. Nav always hits the server (middleware); same-route param nav = seeds-only (no DOM swap), cross-route = HTML outlet swap |

## App module — `src/app.ts`
`export const middleware = [(next) => Response, …]` (onion; `next()` needs no args; return a
`Response` to short-circuit — **auth is middleware**). Plus lifecycle `onStart` / `onStop` /
`health()`.

## CLI
| Command | Does |
| --- | --- |
| `abide scaffold <name>` | scaffold + install + dev (`--no-install`/`--no-dev`/`--no-git`) |
| `abide dev` | same pipeline as build + watch + full live-reload (over the socket mux) |
| `abide build` | code-split client → content-hashed chunks + `manifest.json` into `dist/_app/<hash>/` |
| `abide start` | serve the app against the built `dist/` client assets (no bundler at boot; builds first if absent) |
| `abide run <file> [args...]` | run script under the abide runtime (no HTTP; `onStart`/`onStop` run) |
| `abide compile [--target] [--out]` | standalone server executable (embeds assets) |
| `abide cli [--target] [--out] [--platforms]` | dual-mode binary: embeds app, self-hosts or targets `ABIDE_APP_URL`; interactive with no subcommand |
| `abide bundle` | desktop app (host platform; embeds assets; first-run setup screen) |
| `abide check` | type-check `.abide` (generate-TS → TS7 → map back); template + cross-file component-prop type-flow |
| `abide lsp` | `.abide` language server over stdio: diagnostics · hover · go-to-definition · completion · signature-help · find-references (runs under node; `abide lsp` forwards from Bun) |
| `abide init-agent` | write/refresh this `CLAUDE.md` pointer |

## File-based conventions
| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | one RPC per file; URL `/rpc/<name>` |
| `src/server/sockets/<name>.ts` | one `socket(...)` per file |
| `src/mcp/prompts/<name>.md` / `src/mcp/resources/<name>` | MCP prompt (`{{arg}}`) / resource |
| `src/server/config.ts` | boot-time `env(...)` schema |
| `src/app.ts` | `middleware` + lifecycle hooks |
| `src/ui/pages/**/page.abide` · `layout.abide` · `src/ui/public/` | routes / layouts / static |
| `src/bundle/window.ts` | `BundleWindow` config |
| `src/.abide/*` | generated types + JSON Schema (+ `--dump` proxies) |
| `dist/_app/<hash>/` | content-addressed code-split client build (hashed chunks + `index.json`; a stable `dist/manifest.json` points `abide start` at it) |

## Generated routes
`/openapi.json` (OpenAPI 3.1) · `/__abide/mcp` (MCP; socket → tail/publish tools) · `/__abide/sockets`
(multiplexed WS + per-socket HTTP face) · `/__abide/health` · `/__abide/cli` (per-user install) ·
`/__abide/inspector` (gated) · `/__abide/chunk/<name>-<hash>.(js|css)` (content-hashed, code-split client
assets — the loader entry + per-route chunks + shared chunks + CSS; served immutable/long-cache).

## Environment variables
| Var | Effect |
| --- | --- |
| `PORT` / `APP_URL` | listen port / public URL (mount base) |
| `ABIDE_APP_DIR` / `ABIDE_DATA_DIR` | override built app dir / per-user data dir |
| `ABIDE_IDENTITY_SECRET` | seals the `abide-identity` cookie + tokens (required in prod for authenticated `identity.set()`) |
| `ABIDE_IDENTITY_TTL` | identity cookie/token TTL ms (default 30d, rolling) |
| `ABIDE_APP_TOKEN` / `ABIDE_APP_URL` | bearer token / app URL for remote CLI & bundle |
| `ABIDE_MAX_SHARED_CACHE_SIZE` | byte ceiling (LRU) for shared + default-context cache (default: no limit) |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | per-stream ReplayableStream transcript cap in bytes (default: no limit; exceed → overflow, no replay) |
| `ABIDE_RPC_TIMEOUT` | default for the RPC `timeout` prop (bilateral); per-RPC `timeout` overrides |
| `ABIDE_SOCKET_TIMEOUT` | socket idle/connection timeout (WS) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | default max request body |
| `ABIDE_LOG_FORMAT` (`json`) / `DEBUG` / `ABIDE_DEV_SURFACE` | log format / channel gating / dev request log |
| `ABIDE_ENABLE_INSPECTOR` / `ABIDE_INSPECT` | inspector route (off by default) / debug instrumentation |
