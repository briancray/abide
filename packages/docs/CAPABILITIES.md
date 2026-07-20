# abide — Capability Manifest

A complete checklist of every unique public capability that should have a docs page + a test.
Source of truth: `/CLAUDE.md` (public API reference) + `packages/abide/src/lib` exports.

Legend:
- **PW** = Playwright-testable (browser-facing: SSR, hydration, DOM, client reactivity, soft-nav, fetch from browser).
- **RT** = runtime-only (`bun test` / `createTestApp` / CLI): no browser surface, or best asserted server-side.
- **PW+RT** = has both a browser surface and a server/machine surface worth covering in each harness.

Status of each item: `[ ]` = no dedicated docs page + test yet, `[x]` = covered.
Current smoke coverage lives in `e2e/smoke.spec.ts` (home, reactivity counter, soft-nav, machines).

---

## Coverage summary (verify phase)

- **Total capabilities in this manifest: 130** (~86 browser-facing PW/PW+RT, ~44 runtime-only RT).
- **Playwright suite: 12 spec files, 95 tests — ALL PASSING.** They drive the real docs app (a real
  abide app served in dev mode) in Chromium: SSR HTML, hydration, live reactivity, two-way binds,
  soft-nav, sockets, and machine surfaces fetched from the browser.
  - `rpc` (18), `bindings` (14), `cache` (11), `control` (10), `reactivity` (10), `platform` (9),
    `routing` (6), `sockets` (6), `smoke` (5), `streaming` (3), `uploads` (2), `styling` (1).
- **Docs example structure:** every live demo is a standalone `src/ui/demos/<section>/<Name>.abide`
  component, rendered inside the reusable `components/Demo.abide` card. The card shows the demo, then
  two source tabs in a fixed order — **server** (the full `.ts` RPC/socket) then **client** (the full
  `.abide` component) — read live from disk via the `snippet` RPC; `tab=` opens the side the capability
  is about (server for RPC/socket capabilities, client for UI/template ones), and a one-shot demo (a
  single read/mutation) gets a "Run again" button (`replayable`). Coupled capabilities that share one
  reactive signal (e.g. the reactivity chain, the verb mutations, the socket) live in one cohesive
  component so the shared behaviour — which the e2e asserts — is preserved.
- **Runtime (`bun test`) suite in `packages/abide`: 567 tests — ALL PASSING.** Covers the RT-only
  capabilities (agent, CLI/build, `createTestApp`, RPC `opts` internals, template compiler units) and
  the browser-facing runtime primitives at the unit level.
- Every capability marked `[x]` below with a Playwright note has a browser test; RT-only items are
  asserted by `bun test` / `createTestApp`. `[~]` = partially covered. `[ ]` = not yet covered here.

**Run both suites:**
- Playwright (browser e2e): `cd packages/docs && bunx playwright test`
- Runtime (framework unit/integration): `cd packages/abide && bun test`

**Static gates — one command (repo root): `bun run check`.** Runs, in order: `biome check` (format +
lint), `bun run --filter '*' typecheck` (TypeScript `tsc --noEmit` for every workspace, docs included),
and `bun run --filter docs abide-check` (`abide check .` — type-checks the `.abide` `<script>` bodies).
Each step must exit 0. Individual pieces: `bun run lint` / `bun run typecheck` (root), `bun run
abide-check` (from `packages/docs`).

### Framework bugs surfaced by the e2e dogfood

The verify phase exercised the pages in a real browser and exposed three genuine framework issues in
the `.abide` compiler (`packages/abide/src/lib/ui/internal/`). None were fixed (framework code is
out of scope); the docs pages use supported workarounds so the capability still demonstrates live,
and each workaround is commented in-page:

1. **Bare two-way binds over a state var don't wire write-back.** `bind:value={x}` /
   `bind:checked={x}` / `bind:group={x}` / `bind:element={x}` where `x` is a `let x = state()` var
   never write back to the state (the var evaluates to its *value*, not the signal cell). This is a
   documented known-limit (`transformScript.ts:28-29`). Workaround: the supported `{ get, set }`
   accessor form (e.g. `const xBind = { get: () => x, set: (v) => { x = v } }`).
2. **Template literals in a `<script>` corrupt the transform.** A top-level `${...}` interpolation
   (e.g. `` `platform_pref=${encodeURIComponent(v)}; path=/` ``) makes the statement-boundary brace
   tracker miscount — the interpolation's closing `}` is treated as a block close and scope-assignment
   code is injected *inside* the string. Workaround: string concatenation instead of template literals.
3. **Top-level generator declarations aren't hoisted onto the template scope.** An
   `async function* gen()` (or `function*`) declared at script top level is not registered on `$s`
   (`transformScript.ts:266` scans for the name but hits the `*` token), so `{#for await x of gen()}`
   throws `gen is not defined`. Workaround: assign a generator *expression* to a const
   (`const gen = async function* () { … }`).

Also noticed: pre-encoded HTML entities in static template text (e.g. `&amp;`) are passed through raw
on SSR but treated as literal text on the client, so they double-escape after hydration — author with
literal characters (`&`) instead.

### Framework bugs surfaced by the code-block (`abide check`) pass — FIXED

Type-checking every page under `abide check` (the code-block work made all pages import their
runtime — no ambient identifiers) exposed three real framework defects. These were fixed in
`packages/abide` (they made the mandated import style un-type-checkable and misrepresented documented
verbs); the runtime was already correct, so the fixes are type-only:

1. **`abide/ui/html` and `abide/ui/props` had no backing module.** Both are documented public API
   (and `abide/ui/props` is used by the framework's own `assemble.test.ts`), but `src/lib/ui/` shipped
   only `state.ts` / `watch.ts`. The runtime works anyway (`html(...)` is intercepted by the template
   parser; `props` is injected into the scope by local name), so any importing page ran fine but failed
   `tsc` / `abide check` with `TS2307`. Fix: added `src/lib/ui/html.ts` (`html`, `RawHtml`) and
   `src/lib/ui/props.ts` (`props<T>()`) as the type/identity surface.
2. **`Rpc.invalidate` / `Rpc.refresh` rejected partial selectors.** `Cell<Args,T>` types these as
   `args?: Partial<Args> | Args` (the documented partial-object match), but the RPC wrapper narrowed
   them to `args?: Args`, so the canonical `cacheMetric.invalidate({ team: "red" })` partial-invalidate
   demo failed to type-check. Fix: `makeRpc.ts` now mirrors `Cell` (`Partial<Args> | Args`).

Not fixed (documented framework wart, worked around in-docs): a **zero-input RPC handler**
(`GET(async () => …)`) infers `Args = unknown`, so the callable requires an argument and a bare
`fn()` in a `<script>` is a `TS2554`. The verb helpers lack a zero-arg overload. Workaround: the two
call sites pass `{}` (`cacheReachable({})`, `platformLogout({})`) — harmless, since the handler
ignores it and the cache key is stable.

---

## 1. RPC helpers — verbs
Import `abide/server/{VERB}`; handler takes one positional object arg. Reads → URL args, mutations → body.

| Capability | Kind | Status |
| --- | --- | --- |
| `GET(fn, opts?)` — read | PW+RT | [x] (rpc-guide/verbs + async-reads) |
| `HEAD(fn, opts?)` — read, identical to GET | RT | [x] (rpc-guide/verbs raw HEAD fetch) |
| `POST(fn, opts?)` — mutating | PW+RT | [x] (rpc-guide/verbs) |
| `PUT(fn, opts?)` — mutating | PW+RT | [x] (rpc-guide/verbs) |
| `PATCH(fn, opts?)` — mutating | PW+RT | [x] (rpc-guide/verbs) |
| `DELETE(fn, opts?)` — mutating | PW+RT | [x] (rpc-guide/verbs) |
| RPC `opts.schemas` (input/output/files; type-derived when absent) | RT | [ ] |
| RPC `opts.clients` (browser/mcp/cli reachability; `validate`) | RT | [ ] |
| RPC `opts.middleware` (per-RPC onion) | RT | [ ] |
| RPC `opts.cache` (ttl/shared/tags) | PW+RT | [ ] |
| RPC `opts.timeout` (bilateral) | RT | [ ] |
| RPC `opts.crossOrigin` | RT | [ ] |
| RPC `opts.maxBodySize` | RT | [ ] |

## 2. Responses
Import `abide/server/{json,jsonl,sse,error,redirect}`.

| Capability | Kind | Status |
| --- | --- | --- |
| `json(data, init?)` → `TypedResponse<T>` | PW+RT | [x] (rpc-guide/responses) |
| `jsonl(iterable, init?)` — `application/jsonl` stream (lazy, see-through) | PW+RT | [x] (rpc-guide/responses; `{#for await x of rpc()}` + Start/restart via `.refresh()`) |
| `sse(iterable, init?)` — `text/event-stream` stream (lazy, see-through, isomorphic) | PW+RT | [x] (rpc-guide/responses; consumed via the RPC callable `{#for await}` **and** via native `EventSource`) |
| `error(status, message?, init?)` | RT | [x] (rpc-guide/responses, caught in browser) |
| `error.typed(name, status, schema?)` + `fn.isError(e, name)` narrowing | PW+RT | [x] (rpc-guide/responses; narrowed by `.kind`) |
| `redirect(url, status=302, init?)` | PW+RT | [x] (rpc-guide/responses) |

## 3. Call surface (isomorphic RPC consumption)
| Capability | Kind | Status |
| --- | --- | --- |
| `fn(args)` — smart read (cache + coalesce + reactive; SSR in-proc → browser fetch) | PW+RT | [x] (rpc-guide/async-reads) |
| `fn.raw(args, init?)` — raw `Response`, full bypass | PW+RT | [x] (rpc-guide/async-reads; raw-fetch bypass — `.raw` method not yet in framework) |
| bare call on a streaming handler → replay-then-live `AsyncIterable<C>` (client proxy decodes jsonl/sse by content-type → same cell → stream slot) | PW+RT | [x] (rpc-guide/responses; browser `{#for await x of rpc()}` for jsonl + sse, verified streaming + re-run) |
| `fn.peek` — reactive probe | PW | [x] (rpc-guide/async-reads) |

## 4. Cache verbs + probes (isomorphic — `abide/shared/*`)
| Capability | Kind | Status |
| --- | --- | --- |
| `fn.invalidate(args?)` — partial-object match; `()` = whole callable | PW+RT | [x] (cache page: counter + partial-match) |
| `fn.refresh(args?)` | PW+RT | [x] (cache page: counter + slow) |
| `fn.amend(args, value)` — broadcasts server→clients | PW+RT | [ ] (not reachable from a `.abide` page — RPC proxy/pageCallable expose no `amend`; `cell` is not injectable into template scope) |
| `fn.amend(args, updater)` — local / shared-slot | PW+RT | [ ] (same: no `amend` on the injectable RPC surface) |
| Partial-args match (superset slots) | RT | [x] (cache page: invalidate `{team:"red"}`) |
| Global `invalidate({ tags })` | RT | [ ] (tags unimplemented in framework — `cell.ts` TODO) |
| Global `refresh({ tags })` | RT | [ ] (tags unimplemented in framework) |
| Probe `fn.pending` | PW | [x] (cache page: slow read) |
| Probe `fn.refreshing` | PW | [ ] (not on the injectable RPC proxy; `refresh` keeping stale IS shown) |
| Probe `fn.peek` | PW | [x] (cache page: counter peek) |
| Probe `fn.error` | PW | [x] (cache page: flaky 400) |
| Probe `fn.watch` | PW | [x] (cache page: `watch(() => fn.peek(...), …)` tally) |
| Global `pending({tags})` / `refreshing({tags})` | PW | [ ] (tags unimplemented in framework) |
| `done(iterable)` → boolean | PW+RT | [x] (control/async: `done-status` streaming→complete + restart) |
| `online()` → reactive boolean | PW | [x] (platform/observability: online-flag + offline-toggle reactivity) |
| `reachable(host)` → await boolean | PW+RT | [x] (cache page: `cacheReachable` RPC, self vs dead port) |
| `abide/shared/cell` — the memoizer primitive | RT | [x] (RPCs are cell-backed; usable in a template via M3b import) |

## 5. Reactivity (UI — `abide/ui/*`, client-only)
| Capability | Kind | Status |
| --- | --- | --- |
| `state(initial, transform?)` — writable cell | PW | [x] (reactivity/demo) |
| `state.computed(...)` — read-only derived | PW | [x] (reactivity/demo) |
| `state.linked(src, transform?)` — reseeded writable | PW | [x] (reactivity/demo) |
| `state.shared(key, initial)` — cell shared by key (instances + tabs) | PW | [x] (reactivity/demo: `SharedTally.abide` ×2, cross-instance + cross-tab) |
| `watch(source, handler)` / `watch(thunk)` | PW | [x] (reactivity/demo) |
| `props<T>()` — reactive prop reader | PW | [x] (reactivity/demo) |
| `html(str)` / `` html`…` `` — raw HTML | PW | [x] (reactivity/demo) |
| `navigate(target, { replace?, keepScroll? })` — target is a resolved href; compose with `url()` | PW | [x] (routing navigate() + navigate(url(...)) e2e) |
| `bundled()` → boolean | PW | [x] (platform/observability: bundled-flag) |

## 6. Template bindings / directives (`.abide`)
| Capability | Kind | Status |
| --- | --- | --- |
| `{expr}` — reactive text (escaped) | PW | [x] (bindings page) |
| `{html(...)}` — raw | PW | [x] (bindings page) |
| `name={expr}` — reactive attribute | PW | [x] (bindings page) |
| `on<event>={fn}` — native listener (onclick/oninput/…) | PW | [x] (bindings page) |
| `bind:value` | PW | [x] (bindings page) |
| `bind:checked` | PW | [x] (bindings page) |
| `bind:group` | PW | [x] (bindings page) |
| `bind:value={{get,set}}` | PW | [x] (bindings page) |
| `bind:element={cell \| fn}` — node ref / attach-teardown | PW | [x] (bindings page) |
| `class:name={cond}` | PW | [x] (bindings page) |
| `style:prop={value}` | PW | [x] (bindings page) |
| `{...expr}` — spread props / attributes | PW | [x] (bindings page) |

## 7. Control flow (`.abide`)
| Capability | Kind | Status |
| --- | --- | --- |
| `{#if}` / `{:else if}` / `{:else}` | PW | [x] (control/conditionals) |
| `{#for item, i of list by key}` — keyed | PW | [x] (control/lists) |
| `{#for}` keyless positional | PW | [x] (control/lists) |
| `{#for await}` + `{:catch}` | PW | [x] (control/async) |
| `{#await p}` / `{:then}` / `{:catch}` / `{:finally}` | PW | [x] (control/async) |
| `{#switch}` / `{:case}` / `{:default}` | PW | [x] (control/conditionals) |
| `{#try}` / `{:catch}` / `{:finally}` — error boundary | PW | [x] (control/errors) |
| `{#snippet name(args)}` + call `{name(args)}` + pass as prop | PW | [x] (control/components) |
| Components: capitalised tags + `{children()}` single slot | PW | [x] (control/components) |
| `<script>` / `<script module>` / nested branch-local scripts | PW | [~] |
| `<style>` component-scoped / nested subtree-scoped | PW | [ ] |

## 8. Async reads in templates
| Capability | Kind | Status |
| --- | --- | --- |
| `{fn(args)}` — non-blocking peek (undefined while pending, auto-streams SSR) | PW | [x] (rpc-guide/async-reads) |
| `{await fn()}` — blocks SSR (value in initial HTML) / suspends client | PW | [x] (rpc-guide/async-reads) |
| `{#await}` — explicit pending/then/catch | PW | [x] (rpc-guide/async-reads + verbs + responses) |
| `fn.pending()` / `fn.error()` template probes | PW | [ ] |

## 9. Routing / navigation
| Capability | Kind | Status |
| --- | --- | --- |
| File-based pages (`pages/**/page.abide`) | PW | [x] (routing-demo pages + e2e/routing.spec) |
| `layout.abide` layouts | PW | [ ] |
| `[name]` dynamic param routes → `route().params.name` | PW | [x] (routing-demo/[slug] + e2e/routing.spec) |
| `route()` → `{ kind, name, params, url, navigating }` (isomorphic) | PW+RT | [x] (routing-demo pages assert kind/name/params/url) |
| `navigate(target, opts)` — soft nav (same-route seeds-only vs cross-route outlet swap) | PW | [x] (routing-demo navigate() + soft-nav/back-forward e2e) |
| `url(path, params?, query?)` — in-app href resolver (typed params + query string) | PW+RT | [x] (routing-demo hub builds [slug] hrefs + query strings; e2e asserts href + query round-trip via route().url) |
| Static assets `src/ui/public/` | PW | [ ] |

## 10. Sockets
Import `abide/server/socket`; HTTP face `/__abide/sockets/<name>`.

| Capability | Kind | Status |
| --- | --- | --- |
| `socket<T>(opts?)` — isomorphic AsyncIterable subscribe-by-iterate | PW+RT | [x] (sockets page) |
| `socket.publish(msg)` — server publish | PW+RT | [x] (sockets page) |
| `clientPublish` — client publish | PW | [x] (sockets page) |
| `handler` — mediate client publishes | RT | [x] (sockets page — stamps via:client, drops empty) |
| `tail` / `ttl` options | RT | [x] (sockets page — tail replay on reload) |
| `schema` / `clients` / `crossOrigin` options | RT | [ ] |
| HTTP face: SSE subscribe / POST publish | RT | [x] (sockets page) |
| Multiplexed WS mux `/__abide/sockets` | PW+RT | [x] (sockets/mux page) |

## 11. Auth / request scope (server ambient accessors)
| Capability | Kind | Status |
| --- | --- | --- |
| `identity()` → principal; `.set(p)` / `.clear()` | PW+RT | [x] (platform/identity login/logout + e2e/platform.spec) |
| `cookies()` → `Bun.CookieMap` | PW+RT | [x] (platform/scope reads browser cookie via platformScope RPC) |
| `request()` → `Request` | RT | [ ] |
| `server()` → Bun.serve instance | RT | [ ] |
| `context()` → per-request mutable carrier bag | RT | [x] (platform/scope: per-RPC middleware stamps context(), handler reads it) |
| `middleware` = auth (short-circuit `Response`) | PW+RT | [~] (platformScope per-RPC middleware demo; not a short-circuit) |

## 12. Config / observability
| Capability | Kind | Status |
| --- | --- | --- |
| `env(schema)` / `env<T>()` — typed boot-validated config | RT | [x] (platform/config via platformConfig RPC; coercion asserted) |
| `log(...)` + `.info/.warn/.error/.trace` + `.channel(name)` | RT | [~] (platformObserve calls log.info server-side) |
| `trace()` → W3C traceparent | PW+RT | [x] (platform/observability renders trace() traceparent) |
| `health()` → `{ reachable, ... }` | PW+RT | [x] (platform/observability renders health() + browser fetch of /__abide/health) |
| `online()` → reactive boolean (browser connectivity) | PW | [x] (platform/observability, offline-toggle) |
| `reachable(host)` → await boolean | PW+RT | [x] (cache page: `cacheReachable`) |
| `withJsonSchema(schema)` → `toJSONSchema()` | RT | [x] (`shared/withJsonSchema.test.ts`) |
| `HttpError` / `ValidationErrorData` types | PW+RT | [ ] |
| `render(path, params?, query?)` → HTML string | RT | [ ] (not implemented — needs ambient app-config + route matching; removed from CLAUDE.md) |
| `appDataDir()` → per-user data dir | RT | [x] (`server/appDataDir.test.ts`) |

## 13. Machine surfaces (generated routes)
| Capability | Kind | Status |
| --- | --- | --- |
| `/openapi.json` — OpenAPI 3.1 document | PW+RT | [x] (platform/machines fetches + renders paths in-browser; e2e asserts) |
| `/__abide/mcp` — MCP endpoint (tools/list, tools/call) | RT | [x] (platform/machines POSTs tools/list from browser; e2e asserts tool list) |
| MCP prompts (`src/mcp/prompts/<name>.md`) / resources | RT | [ ] |
| Socket → MCP tail/publish tools | RT | [ ] |
| `/__abide/health` | PW+RT | [x] (platform/observability fetches /__abide/health in-browser) |
| `/__abide/inspector` (gated) | RT | [ ] |
| `/__abide/cli` (per-user install) | RT | [ ] |

## 14. Agent (`abide/server/agent`)
| Capability | Kind | Status |
| --- | --- | --- |
| `agent(engine, messages, options?)` → `AgentFrame` stream | RT | [ ] |
| `options` (model/system/tools/approval) | RT | [ ] |
| Tools default = all `clients.mcp` RPCs; `[]` = none | RT | [ ] |
| Claude engine | RT | [ ] |
| Claude Code engine (engine tools OFF by default) | RT | [ ] |
| Types: `NeutralMessage` / `AgentFrame` / `AgentSurface` / `AgentEngine` | RT | [ ] |

## 15. CLI / build (RUNTIME-only — `bun test`, not Playwright)
| Capability | Kind | Status |
| --- | --- | --- |
| `abide scaffold <name>` | RT | [ ] |
| `abide dev` (watch + live-reload over mux) | RT | [ ] |
| `abide build` (content-addressed client bundle) | RT | [ ] |
| `abide start` | RT | [ ] |
| `abide run <file>` | RT | [ ] |
| `abide compile` / `abide cli` / `abide bundle` | RT | [ ] |
| `abide check` / `abide lsp` | RT | [ ] |
| `abide init-agent` | RT | [ ] |
| Desktop bundle (`BundleWindow`/`BundleMenu`/`onMenu`) | RT | [ ] |

## 16. Testing harness
| Capability | Kind | Status |
| --- | --- | --- |
| `createTestApp()` → `TestApp` (real in-process app: origin/fetch/rpc/sockets/health/stop/as) | RT | [ ] |

---

## Bucket summary & counts

| # | Bucket | Items | Playwright-relevant (PW / PW+RT) | Runtime-only (RT) |
| --- | --- | --- | --- | --- |
| 1 | RPC helpers — verbs | 13 | 6 | 7 |
| 2 | Responses | 6 | 5 | 1 |
| 3 | Call surface | 4 | 4 | 0 |
| 4 | Cache verbs + probes | 17 | 12 | 5 |
| 5 | Reactivity (UI) | 9 | 9 | 0 |
| 6 | Template bindings / directives | 12 | 12 | 0 |
| 7 | Control flow | 11 | 11 | 0 |
| 8 | Async reads in templates | 4 | 4 | 0 |
| 9 | Routing / navigation | 7 | 7 | 0 |
| 10 | Sockets | 8 | 4 | 4 |
| 11 | Auth / request scope | 6 | 3 | 3 |
| 12 | Config / observability | 10 | 6 | 4 |
| 13 | Machine surfaces | 7 | 3 | 4 |
| 14 | Agent | 6 | 0 | 6 |
| 15 | CLI / build | 9 | 0 | 9 |
| 16 | Testing harness | 1 | 0 | 1 |
| | **Total** | **130** | **~86 browser-facing** | **~44 runtime-only** |

Notes:
- Buckets 5–9 (reactivity, template bindings, control flow, async reads, routing) are the richest
  Playwright targets — they are the `.abide` template + client runtime, only observable in a real browser.
- Buckets 14–16 + 15 (agent, CLI/build, test harness) are strictly runtime-only: cover with `bun test`
  and `createTestApp`, never Playwright.
- Several capabilities (RPC verbs, responses, cache verbs, sockets, machine surfaces) are **PW+RT**:
  worth one browser test (the fetch/DOM path) *and* one runtime test (the raw HTTP / machine-surface path).
- `abide/ui/html` and `abide/ui/props` are documented public UI imports but are provided through the
  `.abide` template compiler rather than standalone files under `src/lib/ui/` — test them via template pages.
