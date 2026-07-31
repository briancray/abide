# abide — Capability Manifest

A complete checklist of every unique public capability that should have a docs page + a test.
Source of truth: `/CLAUDE.md` (public API reference) + `packages/abide/src` exports.

Legend:
- **PW** = Playwright-testable (browser-facing: SSR, hydration, DOM, client reactivity, soft-nav, fetch from browser).
- **RT** = runtime-only (`bun test` / `createTestApp` / CLI): no browser surface, or best asserted server-side.
- **PW+RT** = has both a browser surface and a server/machine surface worth covering in each harness.

Status of each item: `[ ]` = no dedicated docs page + test yet, `[~]` = partially covered (the
parenthetical says what is and isn't), `[x]` = covered.
Current smoke coverage lives in `e2e/smoke.spec.ts` (home, soft-nav, machines, agent).

---

## Coverage summary (verify phase)

- **Total capabilities in this manifest: 201** (133 browser-facing PW/PW+RT, 62 runtime-only RT, 6 `unit`).
  By status: **149 `[x]`, 9 `[~]`, 43 `[ ]`** — i.e. ~74% covered, and the manifest deliberately lists
  capabilities it does *not* yet cover, so a `[ ]` is a known gap rather than an oversight.
- **Re-derive these with ONE parser, not by hand.** Three rows carry an escaped `\|` inside the
  capability cell and a fourth spells its kind `unit (checkTemplate.test.ts)`, so a naive
  column-split silently drops four rows — which is how the previous figures (168 / 119 / 47) came to
  disagree with the tables above them *and* with each other. Strip `\|`, take the last two columns,
  and match the kind with a prefix:
  ```sh
  sed 's/\\|/~ESC~/g' CAPABILITIES.md | awk -F'|' '
    /^## [0-9]+\./ { sec=$0; sub(/^## /,"",sec); sub(/ .*/,"",sec); order[++n]=sec }
    /^\| / && NF>=5 { k=$3; s=$4; gsub(/^ +| +$/,"",k)
      if (s ~ /\[[x~ ]\]/ && k ~ /^(PW\+RT|PW|RT|unit)/) { if (k ~ /^unit/) k="unit"
        total++; kind[k]++; st[substr(s,index(s,"[")+1,1)]++
        items[sec]++; if (k ~ /^PW/) pw[sec]++; else if (k=="RT") rt[sec]++ } }
    END { print total, kind["PW"]+kind["PW+RT"], kind["RT"], kind["unit"], st["x"], st["~"], st[" "]
      for (i=1;i<=n;i++) printf "%s %d %d %d\n", order[i], items[order[i]], pw[order[i]]+0, rt[order[i]]+0 }'
  ```
  The three totals must reconcile three ways — kinds, statuses, and the bucket table's own column
  sums all equal the total — which is the check that catches a dropped row.
- **Playwright suite: 26 spec files, 192 tests — ALL PASSING** (`bunx playwright test --list | tail -1`).
  They drive the real docs app
  (a real abide app served in dev mode) in Chromium: SSR HTML, hydration, live reactivity, two-way
  binds, soft-nav (incl. layout keep-alive + streamed-patch adoption), sockets, raw SSR-emitter bytes,
  and machine surfaces fetched from the browser.
  - `rpc` (24), `routing` (24), `platform` (17), `bindings` (16), `memo` (14), `control` (11),
    `ssr-emit` (10), `sockets` (8), `memo-verbs` (7), `state` (5), `memo-global` (5), `channel` (5),
    `build-deploy` (5), `branch-scope` (5), `bench-client` (5), `watch` (4), `streaming` (4),
    `smoke` (4), `rpc-probes` (4), `bench` (4), `hydration` (3), `uploads` (2),
    `sidebar` (2), `bench-server` (2), `styling` (1), `nav-perf` (1).
  - Note: `bench.spec.ts`'s two re-run tests were flaky under CPU contention (they failed in a
    full-suite run while passing 3/3 in isolation). Both asserted that two *live* microbenchmark
    measurements DIFFER — but an identical iteration count is a legitimate outcome of measuring twice,
    so the assertion, not the framework, was wrong. Both now go through `expectRerunRepaints`, which
    tags the current row nodes and requires every one to vanish before the corpus streams back in —
    proving the `{#for await}` clear-and-restream structurally. Strictly stronger than the old check:
    it also catches a regression to in-place patching, which value inequality could not distinguish
    from a genuine re-run.
  - Note: `sidebar.spec.ts` pins a soft-nav bug the suite could not have caught before: the sidebar's
    per-page card index was built from a `bind:element` attachment assumed to re-fire per navigation. It
    does not — the root layout SURVIVES a cross-route soft-nav (only the diverging suffix is swapped) —
    so after navigating, the sidebar kept showing the previous page's cards under the previous link. A
    hard reload hid it. The rebuild now hangs off `route()`; both the stale-index and the no-cards-page
    cases are asserted.
  - Note: `hydration.spec.ts` "soft-nav … keeps every demo tab correctly seeded" was flaky under CPU
    contention — diagnosed as a TEST race (it counted `.sample` after `toHaveURL`, which resolves on the
    history push BEFORE the soft-nav content swap, so it read the outgoing page's samples). Framework
    hydration/seed-ordinal replay was correct throughout; the test now waits for the destination `h1`
    before counting (verified 12/12 under the load that previously failed 11/12).
- **Docs example structure:** every live demo is a standalone `src/ui/demos/<section>/<sub>/<Name>.abide`
  component, rendered inside the reusable `components/Demo.abide` card. The card shows the demo, then
  two source tabs in a fixed order — **server** (the full `.ts` RPC/socket) then **client** (the full
  `.abide` component) — read live from disk via the `snippet` RPC; `tab=` opens the side the capability
  is about (server for RPC/socket capabilities, client for UI/template ones), and a one-shot demo (a
  single read/mutation) gets a "Run again" button (`replayable`). Coupled capabilities that share one
  reactive signal (e.g. the reactivity chain, the verb mutations, the socket) live in one cohesive
  component so the shared behaviour — which the e2e asserts — is preserved.
- **Runtime (`bun test`) suite in `packages/abide`: 1274 tests across 91 files — ALL PASSING.** Covers the RT-only
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
the `.abide` compiler (`packages/abide/src/ui/internal/`). None were fixed (framework code is
out of scope); the docs pages use supported workarounds so the capability still demonstrates live,
and each workaround is commented in-page.

(A fourth — dependency position not surviving into `abide check` — was resolved by **ADR 0025**
rather than patched: the source is now always a thunk, so the un-type-checkable form no longer
exists and `abide check` is clean. A separate pre-existing defect found alongside it, destructured
parameters not binding their names, WAS fixed — it emitted invalid JS.)

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
   (and `abide/ui/props` is used by the framework's own `assemble.test.ts`), but `src/ui/` shipped
   only `state.ts` / `watch.ts`. The runtime works anyway (`html(...)` is intercepted by the template
   parser; `props` is injected into the scope by local name), so any importing page ran fine but failed
   `tsc` / `abide check` with `TS2307`. Fix: added `src/ui/html.ts` (`html`, `RawHtml`) and
   `src/ui/props.ts` (`props<T>()`) as the type/identity surface.
2. **`Rpc.invalidate` / `Rpc.refresh` rejected partial selectors.** `Memo<Args,T>` types these as
   `args?: Partial<Args> | Args` (the documented partial-object match), but the RPC wrapper narrowed
   them to `args?: Args`, so the canonical `cacheMetric.invalidate({ team: "red" })` partial-invalidate
   demo failed to type-check. Fix: `makeRpc.ts` now mirrors `Memo` (`Partial<Args> | Args`).

Resolved: a **zero-input RPC handler** (`GET(async () => …)`) infers `Args = unknown`, and
`RpcCallArgs<unknown>` makes the call argument **optional** — so a bare `fn()` / `fn.peek()` /
`fn.pending()` type-checks with no argument. The former `{}` workarounds at `cacheReachable.peek()`
and `platformLogout()` have been dropped. (Related: a handler with a declared arg — annotation,
generic, or a destructuring default — keeps `Args` concrete, so the argument stays required.)

---

## 1. RPC helpers — verbs
Import `abide/server/{VERB}`; handler takes one positional object arg. Reads → URL args, mutations → body.

| Capability | Kind | Status |
| --- | --- | --- |
| `GET(fn, opts?)` — read | PW+RT | [x] (/rpc/reads) |
| `HEAD` — router-DERIVED from `GET`, no helper (ADR 0027 D6) | RT | [x] (/rpc/reads raw HEAD fetch) |
| `POST(fn, opts?)` — mutating | PW+RT | [x] (/rpc/mutations) |
| `PUT(fn, opts?)` — mutating | PW+RT | [~] (verb supported; browser demo consolidated to POST + DELETE on /rpc/mutations) |
| `PATCH(fn, opts?)` — mutating | PW+RT | [~] (verb supported; browser demo consolidated to POST + DELETE on /rpc/mutations) |
| `DELETE(fn, opts?)` — mutating | PW+RT | [x] (/rpc/mutations) |
| Mutations expose the FULL read surface (peek/pending/refreshing/refresh/invalidate/publish/watch/snapshot/seed/raw/isError + streaming chunk probes) — read/mutation symmetry | PW+RT | [x] (/rpc/mutations cached-mutation demo drives `.peek`/`.refresh`/`.refreshing` on a POST) |
| Cached mutation — `cache: { ttl }` on a mutation retains (repeat call hits cache, `.refresh()` re-runs) | PW+RT | [x] (/rpc/mutations cached-mutation; `rpcBumpCounter`) |
| Streaming mutation — a POST yielding `jsonl` consumed via `{#for await x of mutation()}` | PW+RT | [x] (/rpc/streaming streaming-mutation; `rpcStreamJob`) |
| RPC `opts.schemas` (input/output/files; type-derived when absent) | RT | [ ] |
| RPC `opts.clients` (browser/mcp/cli reachability; `validate`) | RT | [ ] |
| RPC `opts.middleware` (per-RPC onion) — runs **per READ, from every door** | PW+RT | [x] (platform/scope: `platformContext` declares `middleware: [stamp]` and `ContextDemo` reads it at page render, so `platform.spec.ts` asserts the stamp in the **raw SSR bytes** as well as after a browser fetch; `rpcChain.test.ts` covers the rungs, once-per-read, and short-circuit → `HttpError`) |
| RPC `opts.cache` (ttl/shared/tags) | PW+RT | [ ] |
| RPC `opts.memo` normalization — ONE `rpcMemoPolicy` feeds the server memo, the wire spec and the browser proxy, so a read's two memos cannot disagree | RT | [x] (abide `ui/internal/clientProxy.test.ts` counts handler RUNS on both sides of one rpc) |
| `memo: false` is verb-dependent — a MUTATION bypasses the bare call, a READ stays memo-backed at `ttl: 0` (retains nothing, still coalesces, probes stay live) | RT | [x] (abide `clientProxy.test.ts` "a memo:false read has the same peek policy on the server and in the browser") |
| The SWR refetch clock (`memo: { throttle }` / `{ debounce }`) — rate-limits explicit revalidation of a slot that already holds a value; `invalidate` CANCELS a scheduled one on both the pulled and derivation paths | PW+RT | [x] (/memo/verbs refetch-clock demo + e2e/memo-verbs.spec counts RUNS — throttle 2, debounce 1 — since both edges serve the same value; abide `shared/memo.test.ts` for the derivation-path cancel, which counts the ARMED TIMER) |
| RPC `opts.timeout` (bilateral) | RT | [ ] |
| RPC `opts.crossOrigin` | RT | [ ] |
| RPC `opts.maxBodySize` | RT | [ ] |
| RPC `opts.doc` — the human description carried onto OpenAPI, the MCP tool description and CLI `help` | RT | [ ] |

## 2. Responses
Import `abide/server/{json,jsonl,sse,error,redirect}`.

| Capability | Kind | Status |
| --- | --- | --- |
| `json(data, init?)` → `TypedResponse<T>` | PW+RT | [x] (/rpc/responses) |
| `jsonl(iterable, init?)` — `application/jsonl` stream (lazy, see-through) | PW+RT | [x] (/rpc/streaming; `{#for await x of rpc()}` + Start/restart via `.refresh()`) |
| `sse(iterable, init?)` — `text/event-stream` stream (lazy, see-through, isomorphic) | PW+RT | [x] (/rpc/streaming; consumed via the RPC callable `{#for await}` **and** via native `EventSource`) |
| `error(status, message?, init?)` → **`never`** — THROWS an `HttpError` rather than returning a `Response`, so the failure lands in the memo slot's ERROR channel (a returned one was retained as the slot's VALUE at `ttl: ∞`) and reaches an in-process caller as a `catch` | RT | [x] (/rpc/responses `rpcBoom`, caught in the browser; abide `server/rpcOutcome.test.ts` asserts the failure lands in the memo's error channel, not its value channel, and `server/response.test.ts` the rendering) |
| `error.typed(name, status, schema?)` → a factory that THROWS; `fn.isError(e, name)` narrows the same on both sides (the browser proxy decodes the non-2xx back into the same `abide/shared/HttpError`) | PW+RT | [x] (/rpc/responses; narrowed by `.kind`) |
| `redirect(url, status=302, init?)` → **`never`** — THROWS a `Redirect`; the router renders the 3xx + `Location` | PW+RT | [x] (/rpc/responses) |
| A thrown outcome (`HttpError`/`Redirect`) is rendered at its OWN status BEFORE `onError` and never becomes the generic 500 — a declared 404 is not a bug in the app; `onError` may itself throw `error()`/`redirect()` to shape the reply | PW+RT | [x] (platform/lifecycle: this app's `onError` calls `error(500, …)` and the shaped body is asserted by e2e/platform.spec + e2e/streaming.spec; abide `server/internal/onError.test.ts` + `server/internal/router.test.ts`) |
| `abide/shared/HttpError` / `abide/shared/Redirect` — the two classes the helpers throw and the router/browser proxy both decode; ONE class each side, which is what makes `catch` isomorphic | PW+RT | [~] (exercised end-to-end at /rpc/responses + platform/scope, but the docs app never imports either class by name — the type-level row is §12's `HttpError`/`ValidationErrorData`, still `[ ]`) |
| The `OutcomeResponse` brand and `Payload<R>`'s outcome branch are RETIRED — a `throw` is `never` and a union absorbs it, so `GET(({ fail }) => fail ? error(503) : { greeting })` still infers `{ greeting }` with no brand | unit | [x] (abide `server/rpcOutcome.test.ts` "never reaches a caller as a value" + `server/response.test.ts`; `rpcBoom.ts` is the live instance — its success branch types as `{ ok: boolean }`) |
| Baseline response headers stamped at one choke point (`nosniff`, `Referrer-Policy`; `Cache-Control: private, no-cache` + `Vary: Cookie` by default), each only when the response didn't set it | PW | [x] (/rpc/responses RawResponseDemo reads them off the untouched `Response` per helper) |
| `raw`'s `init` reaches the underlying fetch (`{ redirect: "manual" }` → opaque response) | PW | [x] (/rpc/responses RawResponseDemo) |

## 3. Call surface (isomorphic RPC consumption)
| Capability | Kind | Status |
| --- | --- | --- |
| `fn(args)` — smart read (cache + coalesce + reactive; SSR in-proc → browser fetch) | PW+RT | [x] (/rpc/reads) |
| `fn.raw(args, init?)` — raw `Response`, full bypass (reads AND mutations) | PW+RT | [x] (/rpc/reads `rpcGreet.raw`; /rpc/responses RawResponseDemo across all four helpers; platform/lifecycle `lifecycleThrow.raw({})` on a POST) |
| bare call on a streaming handler → replay-then-live `AsyncIterable<C>` (client proxy decodes jsonl/sse by content-type → same memo → stream slot) | PW+RT | [x] (/rpc/streaming; browser `{#for await x of rpc()}` for jsonl + sse, verified streaming + re-run) |
| `fn.peek` — reactive probe | PW | [x] (/rpc/reads) |
| `StreamRead`/`StreamMutation` carry the WHOLE probe vocabulary, re-typed over the chunk — including `refreshing`, which `StreamRead` used to omit from its declaration while `makeRpc` assigned it all along. The six names are ONE declaration (`ReactiveValueProbes` + `ReactiveStreamProbes`) that `memo`, `channel`, `socket`, `Rpc` and `StreamRead` all derive from | RT | [x] (abide `shared/internal/reactiveReadSurface.test.ts` — a NAME LIST asserted against all six surfaces, at runtime, because each is assembled by assigning onto a callable and casting, so a type-level unification cannot guard itself) |
| Read URL args — two forms: canonical `?__abide_args=<json>` blob (browser proxy / test app / MCP) OR flat per-field query params (`?key=beta&n=5`, curl-friendly; coerced to each input-schema field type, raw passthrough when undeclared) | RT | [ ] (abide `decodeQueryArgs`/router unit tests; no docs-app demo) |

## 4. Cache verbs + probes (isomorphic — `abide/shared/*`)
| Capability | Kind | Status |
| --- | --- | --- |
| `fn.invalidate(args?)` — partial-object match; `()` = whole callable | PW+RT | [x] (/memo/verbs: counter + partial-match) |
| `fn.refresh(args?)` | PW+RT | [x] (/memo/verbs: counter + refreshing) |
| `fn.publish(args, value)` — broadcasts server→clients | PW+RT | [x] (/memo/verbs PublishDemo: value-form rewrites the slot, no re-fetch) |
| `fn.publish(args, updater)` — local / shared-slot | PW+RT | [x] (/memo/verbs PublishDemo: updater-form derives next value locally) |
| Partial-args match (superset slots) | RT | [x] (/memo/verbs: invalidate `{team:"red"}`) |
| Global `invalidate({ tags })` | PW+RT | [x] (/memo/verbs TagsInvalidateDemo: `invalidate({tags:["docs"]})` drops both tagged shared reads) |
| Global `refresh({ tags })` | PW+RT | [x] (/memo/verbs TagsRefreshDemo: `refresh({tags:["docs"]})` revalidates both in place) |
| Probe `fn.pending` | PW | [x] (/rpc/probes ProbesDemo: slow read) |
| Probe `fn.refreshing` | PW | [x] (/rpc/probes RefreshingDemo: refreshing flips yes over a retained value while pending stays no) |
| Probe `fn.peek` | PW | [x] (/rpc/probes ProbesDemo: counter peek) |
| Probe `fn.error` | PW | [x] (/rpc/probes FlakyDemo: flaky 400) |
| Probe `fn.watch` | PW | [x] (/rpc/probes WatchMethodDemo: `watch(() => fn.peek(...), …)` tally) |
| Global `pending({tags})` / `refreshing({tags})` | PW | [x] (/memo/global TagProbesDemo: the aggregate tag probe over slow tagged reads) |
| `done(iterable)` → boolean | PW+RT | [x] (/templating/async: `done-status` streaming→complete + restart) |
| `online()` → reactive boolean | PW | [x] (/memo/global OnlineDemo + platform/observability: online-flag + offline-toggle reactivity) |
| `reachable(host)` → await boolean | PW+RT | [x] (/memo/global ReachableDemo: `cacheReachable` RPC, self vs dead port) |
| `abide/shared/memo` — the memoizer primitive | PW+RT | [x] (/memo MemoAsyncDemo: argless + async is one reused slot, untracked until refresh; MemoArgsDemo: the argument is the key — a slot per key, invalidated independently; ServerStateDemo: an isomorphic server-owned `state`+`watch` graph driven by RPCs) |
| `memo.*` probes on a bare `memo()` (`peek`/`pending`/`refreshing`/`error`/`watch`) | PW | [x] (/memo/probes Memo{Peek,Pending,Refreshing,Error,Watch}ProbeDemo) |
| `cache: false` — opt a read/mutation OUT of the memo (every call runs) | PW+RT | [x] (/memo/verbs CacheFalseDemo: `cacheOff` climbs every call, `cacheOn` holds) |

## 5. Reactivity (isomorphic — `abide/shared/*` state/watch; UI — `abide/ui/*`)
| Capability | Kind | Status |
| --- | --- | --- |
| `state(initial, transform?)` — writable cell (isomorphic: `abide/shared/state`, server-usable) | PW+RT | [x] (/state; server-side in `src/shared/serverReactive.ts` → /memo ServerStateDemo) |
| `memo(fn)` — auto-tracked derived value (ADR 0024) | PW | [x] (/memo; also server-side in ServerStateDemo) |
| `memo(src, transform?).state()` — writable projection, provisional until re-fill | PW | [x] (/memo) |
| `state.shared(key, initial)` — cell shared by key (instances + tabs) | PW | [x] (/state: `SharedTally.abide` ×2, cross-instance + cross-tab) |
| `memo(source, transform)` — tracks the source thunk only, transform untracked | PW | [x] (/memo MemoSourceDemo: the transform reads a second cell; bumping it recomputes nothing, the next source change picks it up) |
| The source is always an argless THUNK (ADR 0025) — no dependency-position exception | PW | [x] (/watch WatchSourceDemo `watch(() => count, h)`; /memo MemoSourceDemo `memo(() => count, t)`; unit: analyzeScope "source position (ADR 0025 — thunk only)") |
| Several declared inputs are what the thunk RETURNS — no API of their own | PW | [x] (/memo MemoSourcesDemo + /watch WatchSourcesDemo: `() => ({ a, b })`, one object into the transform/handler) |
| A KEYED body may be SYNCHRONOUS — args are the whole dependency set (body untracked), and the read is the VALUE, not a promise | PW+RT | [x] (/memo MemoKeyedSyncDemo: one slot per key, value present in the SSR HTML; RT: keyed-sync + untracked + seeded-async cases in memo.test.ts) |
| A destructured PARAMETER binds its names (shadows a same-named cell; the pattern is not expanded) | unit | [x] (analyzeScope "destructured parameter bindings" — object/array/nested/renamed/default; previously emitted invalid JS) |
| `watch(source, handler)` / `watch(thunk)` — isomorphic (`abide/shared/watch`; fires server-side too) | PW+RT | [x] (/watch; server-side in ServerStateDemo's `serverReactive.ts`) |
| A watch may RETURN a teardown — it runs before every re-run and once when the component goes away (the lifecycle hook, in place of `onMount`/`onDestroy`) | PW+RT | [x] (/watch WatchTeardownDemo + WatchTeardownTicker: the interval is cleared before the re-subscribe and again when the component unmounts; RT: watch.test.ts "the returned teardown" + ui/internal/watchTeardown.test.ts for the component-unmount half) |
| A component OWNS its `<script>` effects — same ownership server-side, where a render is the component's whole life, so a finished request disposes them (no `onMount`/`onDestroy`, no is-this-the-browser branch) | RT | [x] (ui/internal/serverEffectScope.test.ts: a finished request runs its render's teardowns and detaches them from a module-level `state`; and two renders interleaved across an `await` in setup keep their own effects — the owner scope is per request, not per process) |
| `channel<T>(opts?)` — the pub/sub primitive; `publish(msg)` + iterate to subscribe | PW | [x] (/channel ChannelPublishDemo: a browser-owned channel, no transport) |
| `channel` `Args` names the ROOM — per-room hubs, lazily created (ADR 0023) | PW | [x] (/channel ChannelRoomsDemo: a publish to `{room:"blue"}` is invisible to a `{room:"red"}` subscriber) |
| The publish KEY is a positional that vanishes when there is none — argless `memo`/void `channel` publish `fn.publish(value)`, keyed ones `fn.publish({ id }, value)` | PW+RT | [x] (/channel ChannelKeyLadderDemo: rung 1 publishes the message alone, rung 2 keys first and hits one slot; RT: channel.test.ts "void channel: direct iteration…" + "…the explicit (undefined, message) form", memo.test.ts "an argless memo publishes bare") |
| `watch` carries the same vanishing key — `fn.watch(handler)` / `fn.watch({ id }, handler)` | RT | [x] (channel.test.ts "watch on a void channel takes the handler alone"; memo.test.ts "an argless memo watches with the handler alone") |
| `channel` implements the shared read surface (`peek`/`chunks`/`invalidate`; status probes degenerate in-process) | PW | [x] (/channel ChannelProbesDemo) |
| `channel` `tail` replay for a late joiner | PW | [x] (/channel: `tail: 5` / `tail: 3`, replayed on re-subscribe) |
| `props<T>()` — reactive prop reader | PW | [~] (/templating/components — props read reactively by a child component; the degenerate page-level reader demo was removed) |
| `html(str)` / `` html`…` `` — raw HTML | PW | [x] (/templating/bindings RawHtmlDemo) |
| `navigate(target, { replace?, keepScroll? })` — target is a resolved href; compose with `url()` | PW | [x] (/pages/routing navigate() + navigate(url(...)) e2e) |
| `bundled()` → boolean | PW | [x] (platform/observability: bundled-flag) |

## 6. Template bindings / directives (`.abide`)
| Capability | Kind | Status |
| --- | --- | --- |
| `{expr}` — reactive text (escaped) | PW | [x] (/templating/bindings) |
| `{html(...)}` — raw | PW | [x] (/templating/bindings) |
| `name={expr}` — reactive attribute | PW | [x] (/templating/bindings) |
| `on<event>={fn}` — native listener (onclick/oninput/…) on an ELEMENT | PW | [x] (/templating/bindings) |
| `on<event>={fn}` on a COMPONENT is an ordinary PROP named `onclick` — there is no element to attach to, so the component places it; BOTH emitters pass it (the server used to drop it, so SSR and hydrate disagreed about the props a component received) | RT | [~] (abide `ui/internal/componentAttrLanes.test.ts` asserts the server and client lanes agree on the props object; the docs app has NO demo — no component here takes a handler prop, so nothing dogfoods it) |
| `class:name={cond}` / `style:prop={value}` on a COMPONENT is a compile error in BOTH lanes (the directive targets one element; a component renders a subtree). It used to be typed as a real prop by `abide check` and silently DROPPED by both emitters | unit | [x] (abide `ui/internal/componentAttrLanes.test.ts` "…compile error in the check lane AND the build lane" + "the message names the fix"; one gate — `validateTemplate` runs `buildPlan` — so check and build reject the same thing by construction. Not hostable in the docs app: it does not compile) |
| `bind:value` | PW | [x] (/templating/bindings) |
| `bind:checked` | PW | [x] (/templating/bindings) |
| `bind:selected` — the other BOOLEAN target. A bind target resolves to one of four kinds (`element`/`group`/`boolean`/`value`) through one taxonomy both lanes read; `checked` and `selected` are a named SET rather than a `checked`-only test, because that test let `selected` fall through to the VALUE bind on the client while the server wrote a boolean attribute — so `<option bind:selected>` painted correctly and then had `option.value = "true"` written over it on hydrate. Two-way in both directions, which needs one further distinction: a bind READS the property off the element it is attached to but LISTENS on whichever element emits `change`, and for an `<option>` those are different nodes (selectedness changes because the user acted on the `<select>`, and events bubble up) | PW+unit | [x] (/templating/bindings + e2e/bindings.spec — TWO tests, because the two directions have different failure modes: the mirror half asserts the option's own `value` survives hydration (the only observable — the visible output was right either way), and the write-back half asserts the CELL moves when the user picks through the select (attaching the listener to the option is silently one-way: the mirror works, nothing throws, the cell never moves). Each reds only for its own regression. abide `ui/internal/bindTarget.test.ts` pins the shared classification. The parity harness provably cannot catch this family: both bind fixtures are `client: false` by construction, since a bind writes a PROPERTY on the client and an ATTRIBUTE on the server) |
| `bind:group` | PW | [x] (/templating/bindings — radios + checkbox array) |
| `bind:value={{get,set}}` | PW | [x] (/templating/bindings) |
| `bind:element={cell \| fn}` — node ref / attach-teardown | PW | [x] (/templating/bindings) |
| `class:name={cond}` | PW | [x] (/templating/bindings) |
| `style:prop={value}` | PW | [x] (/templating/bindings) |
| `{...expr}` — spread props / attributes | PW | [x] (/templating/bindings) |

## 7. Control flow (`.abide`)
| Capability | Kind | Status |
| --- | --- | --- |
| `{#if}` / `{:else if}` / `{:else}` | PW | [x] (/templating/conditionals) |
| `{#for item, i of list by key}` — keyed | PW | [x] (/templating/lists) |
| `{#for}` keyless positional | PW | [x] (/templating/lists) |
| `{#for await}` + `{:catch}` | PW | [x] (/templating/async) |
| `{#await p}` / `{:then}` / `{:catch}` / `{:finally}` | PW | [x] (/templating/async) |
| a streaming `{#await}` inside an `{#if}` BRANCH still streams (the emitter's inlining invariant — a collapsed branch frame silently buffers, same bytes, no throw) | PW | [x] (/pages/ssr `branch-block` + e2e/streaming.spec) |
| `{#switch}` / `{:case}` / `{:default}` | PW | [x] (/templating/conditionals) |
| `{#try}` / `{:catch}` / `{:finally}` — error boundary | PW | [x] (/templating/errors) |
| Inline component `{#component Name()}` (TitleCase) invoked `<Name/>` + `<slot/>` + pass as prop | PW | [x] (/templating/components) |
| Nested `{#component}` inside `<Foo>` → Foo's same-named prop (named slot) | PW | [x] (/templating/components) |
| `<slot/>` is the ONLY spelling of the children outlet — `{children()}` is retired and `children` is a RESERVED template name, in every EXPRESSION position (interpolation, attribute value, block head) and every BINDING position (`{#for}` item/index, `{:then}`/`{:catch}` param, inline-component params), all of which publish onto the scope chain the outlet reads. Only a LEXICAL `children` (a `<script>` binding) is exempt. The retracted `{#if children}<slot/>{:else}…{/if}` fallback never worked: a childless caller passes the shared `emptyChildren` FUNCTION, which is always truthy | unit | [x] (abide `ui/internal/childrenOutlet.test.ts` — the expression cases, the binding cases, and the still-legal shapes; plus "the check lane declares no children intrinsic". Not hostable in the docs app: it does not compile. The BINDING half was the last to arrive and is the one the reservation exists for — the expression check reached `{#for children of …}` only when the body happened to spell the name, and a body using `<slot/>` never does, so that form compiled and threw at RENDER) |
| A childless `<slot/>` renders nothing on BOTH lanes — the client used to pass `null` where the server passed `emptyChildren`, throwing `<children> is not a component in scope` on hydrate for every childless outlet while the server's HTML was correct | unit | [x] (abide `ui/internal/childrenOutlet.test.ts` renders AND hydrates the same markup and treats a throw as an observable — an output-comparing harness provably cannot see this family, since only one lane throws and the other lane's HTML is right) |
| Reactive component — cell/memo-named tag `<C/>` (`const C = memo(…)`) re-mounts on change | PW | [x] (/templating/components) |
| Member tag `<item.Icon/>` — the head is any binding, TitleCase applies to the LAST segment (`<item.icon/>` is a parse error; a hyphen keeps a dotted tag an element) | PW | [x] (/templating/components MemberTagDemo + e2e/control.spec) |
| A member tag is REACTIVE — an expression over bindings, not an import, so it re-mounts on identity change (`templatePlan` marks every dotted tag reactive, and the emitter mounts it via `dynamicComponent`) | PW | [x] (MemberTagDemo's swap button hands row 0 a different component; e2e/control.spec pins the row's `<li>` first, so it asserts the TAG re-mounted rather than the list rebuilding the row — the `by` key is unchanged) |
| `<item.icon/>` (lowercase last segment) is a PARSE ERROR; `<my-el.foo>` (hyphen) stays an element | unit | [x] (abide `ui/internal/parse.test.ts` "member tag with a lowercase last segment is a parse error" + "a hyphenated dotted tag stays an element"; the docs app cannot host either — one throws and the other is an ordinary element) |
| Component-valued prop typing `Component<Props>` | unit (checkTemplate.test.ts) | [x] |
| `<script>` / `<script module>` / nested branch-local scripts | PW | [~] |
| An `export` in ANY of the three `<script>` kinds is a compile error in both lanes — none is an ES module boundary, each body is inlined into the emitted component's setup, so an `export` there lands inside a function. It used to be skipped by the scanner, and the only symptom was a parse failure over GENERATED source | unit | [x] (abide `ui/internal/nestedScopes.test.ts` "&lt;script&gt; — the export gate" covers module/instance/branch-local + `export default` + `export type`, and the negative cases — `{ export: 1 }`, the word inside a string literal, a local named `exported`; `ui/internal/laneAgreement.test.ts` asserts check and build agree. Not hostable in the docs app: it does not compile) |
| A cell assignment whose RHS spans a LINE BREAK is one expression (ternary, operator, member chain, `instanceof`, `in`, template middles) — severing it sets the cell to the head and orphans the tail, silently | PW | [x] (/templating/scripts multiline demo + e2e/branch-scope.spec; `as` is unit-only — the operator forbids a preceding line break in TS itself) |
| `<style>` component-scoped / nested subtree-scoped | PW | [x] (/templating/styling ScopedStyleDemo + e2e/styling.spec) |

## 8. Async reads in templates
| Capability | Kind | Status |
| --- | --- | --- |
| `{fn(args)}` — bare call = the awaitable coalesced load (`Promise<T>`); the runtime auto-awaits it, so it blocks SSR exactly like `{await fn()}` and differs only in TYPE (`.field` on it is a checker error) | PW | [ ] (prose at /rpc/reads; NO demo exercises the bare form — the page demos `.peek()`, `{await}`, `{#await}`, inline-then) |
| `{fn.peek(args)}` — the non-blocking `T \| undefined` snapshot (undefined while pending; subscribes + kicks the load) | PW | [x] (/rpc/reads PeekReadDemo; call-surface row in §3) |
| `{await fn()}` — blocks SSR (value in initial HTML) / fills on settle client-side | PW | [x] (/rpc/reads; /templating/async AwaitRpcDemo — re-awaits in place on `refresh`) |
| a `refresh` that lands a DIFFERENT value re-awaits; an identity-equal re-fill wakes nobody | PW | [x] (/templating/async: `controlGreet` carries a run counter precisely so the refresh is observable) |
| `{#await}` — explicit pending/then/catch | PW | [x] (/rpc/reads + /rpc/responses) |
| `fn.pending()` / `fn.error()` template probes | PW | [x] (/rpc/reads ProbesDemo: `probe-pending-flag` / `probe-error-flag`) |

## 9. Routing / navigation
| Capability | Kind | Status |
| --- | --- | --- |
| File-based pages (`pages/**/page.abide`) | PW | [x] (/pages/routing pages + e2e/routing.spec) |
| `layout.abide` layouts | PW | [x] (/pages/layouts + e2e/routing.spec: wrap-over-soft-nav, cross-route keep-alive, layout state survives nav; SSR-origin proof badge) |
| Hydration correctness across scenarios (claim vs create-fallback; `{#for await}` re-renders by design) | PW | [x] (/pages/hydration — a seeded-state HydrationProbe per scenario; e2e/hydration.spec asserts zero mismatches on hard load + soft-nav) |
| Rich-typed `state()` seed initials (`Date`/`BigInt`/`Map`/`Set`/`TypedArray`/refs) round-trip through the hydration value codec — preserved with their type, not JSON-flattened to `null`; a codec-unsupported initial (class instance/fn/symbol) → `null` (lossy) rather than crashing | PW+RT | [x] (/pages/hydration RichSeedProbe row + e2e/hydration.spec `data-{date,big,map}-ok` on hard load + soft-nav; RT: abide stateSeed.test + codec.test lossy-mode) |
| `[name]` dynamic param routes → `route().params.name` | PW | [x] (/pages/routing/[slug] + e2e/routing.spec) |
| Optional `[[name]]` (absent → param omitted) + rest `[...name]` (`/`-joined) segments; precedence literal > required > optional > rest | PW | [x] (/pages/routing/blog/[[page]] bare+paged, /pages/routing/files/[...path], /pages/routing/files/latest exact-over-catch-all + e2e/routing.spec) |
| `route()` → `{ kind, name, params, url, navigating }` (isomorphic) | PW+RT | [x] (/pages/routing pages assert kind/name/params/url) |
| `navigate(target, opts)` — soft nav (same-route param/query = whole chain kept alive, no re-hydrate; cross-route sharing a layout prefix keeps shared layouts + grafts only the diverging suffix; disjoint = outlet swap) | PW | [x] (/pages/routing navigate() + soft-nav/back-forward e2e; /pages/layouts keep-alive + e2e/routing.spec persistence asserts) |
| The CLIENT declares the kept layout depth (`Abide-Nav-Keep: <n>`) and where sent it **decides** the render (`levels.slice(keep)`, clamped to the route's own depth; malformed → fall back). The server's `sharedLayoutDepth(from, to)` answers what the route TABLE permits and is only the fallback for a caller that sends nothing — a live page's real keep depends on whether a chain is mounted/claimed/graftable, which the server cannot see. The two used to be derived independently and reconciled at runtime, with the client hard-loading on a mismatch; one derivation makes that unrepresentable. A same-URL nav sends `0`, so the whole tree renders and the seed carries the kept layouts' reads | PW | [x] (e2e/routing.spec: the Back-that-re-enters-a-layout-section test pins exactly the case where the two numbers disagree — it was a full document load before) |
| `url(path, params?, query?)` — in-app href resolver (typed params + query string; drops absent optional `[[name]]`, expands rest `[...name]`, all-optional path → optional params arg) | PW+RT | [x] (/pages/routing hub builds [slug] hrefs + query strings + optional/rest hrefs; e2e asserts href + query round-trip via route().url) |
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
| `schema` / `clients` options | RT | [ ] |
| `{#for await}` over a socket — subscribe-by-iterate in a template | PW | [x] (/sockets ForAwaitDemo) |
| Socket probe `.peek()` — latest (`ttl`-windowed) | PW | [x] (/sockets/probes PeekDemo) |
| Socket probe `.chunks()` — session transcript (`tail`-capped) | PW | [x] (/sockets/probes ChunksDemo) |
| HTTP face: SSE subscribe / POST publish | RT | [x] (sockets page) |
| Multiplexed WS mux `/__abide/sockets` | PW+RT | [x] (/sockets — folded in) |

## 11. Auth / request scope (server ambient accessors)
| Capability | Kind | Status |
| --- | --- | --- |
| `identity()` → principal; `.set(p)` / `.clear()` / `.refresh()`; ISOMORPHIC (same import in a handler and a component) | PW+RT | [x] (platform/identity: `#identity-client-auth` is `identity()` called straight from the component — no rpc — and follows a login through `identity.refresh()`; e2e/platform.spec asserts both lines) |
| `/__abide/identity` — the caller's own resolved principal | PW+RT | [x] (abide `shared/identity.test.ts`; the CLI's `identity` subcommand reads it) |
| `cookies()` → `Bun.CookieMap` | PW+RT | [x] (platform/scope reads browser cookie via platformScope RPC) |
| `request()` → `Request` | RT | [ ] |
| `server()` → Bun.serve instance | RT | [ ] |
| `context()` → per-request mutable carrier bag | PW+RT | [x] (platform/scope: per-RPC middleware stamps context(), handler reads it — twice per visit now, once at SSR and once on the click, since the rpc's middleware runs per read) |
| `middleware` = auth (short-circuit) | PW+RT | [x] (platform/scope GuardDemo: layer1 returns `error(403)` without `next()`, blocking the handler). Over HTTP the short-circuit is that `Response`; reaching an **in-process** caller it is a thrown `HttpError` (`rpcChain.test.ts`), which is why `fn.isError` narrows the same on both sides |
| `app.ts` `onStart(start)` / `onStop(stop)` — boot/teardown wrappers | PW+RT | [x] (platform/lifecycle: docs app.ts wraps boot, seeds bootId surfaced via onHealth; serveLifecycle.test) |
| `app.ts` `onHealth()` — merged over `/__abide/health` stub (`reachable`/`version`/`uptime`/`startedAt`) | PW+RT | [x] (platform/lifecycle: /__abide/health shows app + bootId fields) |
| `app.ts` `onError(error)` — shape an uncaught request throw | PW+RT | [x] (platform/lifecycle: throwing RPC → onError-shaped 500) |

## 12. Config / observability
| Capability | Kind | Status |
| --- | --- | --- |
| `env(schema)` / `env<T>()` — typed boot-validated config | RT | [x] (platform/config via platformConfig RPC; coercion asserted) |
| `log(...)` + `.info/.warn/.error/.trace` + `.channel(name)` | RT | [~] (platformObserve calls log.info server-side) |
| `trace()` → W3C traceparent | PW+RT | [x] (platform/observability renders trace() traceparent) |
| `health()` → `Promise<HealthDocument & <onHealth fields>>` — isomorphic AND symmetric (server composes in-proc; client `await`s a fetch of `/__abide/health`); return type generated into `src/.abide/health.d.ts` | PW+RT | [x] (platform/observability + platform/lifecycle call `await health()`) |
| The GENERATED `src/.abide/health.d.ts` really types the read — `(await health()).bootId` checks in this app and would be a compile error with no such hook (needs the tsconfig to name `"src/.abide/*.d.ts"`; an `include` wildcard never descends into a dot-directory) | PW+RT | [x] (`src/server/rpc/platformHealth.ts` reads `doc.bootId`/`doc.app` off the composed document in a `.ts`, where the checker is real, and e2e/platform.spec asserts the value reaches the browser. The two `.abide` demos CANNOT guard it — both hold the document in a `state(null)` cell that `emitCheck`'s widen resolves to `any`, so the companion is never consulted there) |
| `online()` → reactive boolean (browser connectivity) | PW | [x] (platform/observability, offline-toggle) |
| `reachable(host)` → await boolean | PW+RT | [x] (/memo/verbs: `cacheReachable`) |
| `withJsonSchema(schema)` → `toJSONSchema()` | RT | [x] (`shared/withJsonSchema.test.ts`) |
| `HttpError` / `ValidationErrorData` types | PW+RT | [ ] |
| `render(path, params?, query?)` → HTML string | RT | [ ] (not implemented — needs ambient app-config + route matching; removed from CLAUDE.md) |
| `appDataDir()` → per-user data dir | RT | [x] (`server/appDataDir.test.ts`) |

## 13. Machine surfaces (generated routes)
| Capability | Kind | Status |
| --- | --- | --- |
| `/openapi.json` — OpenAPI 3.1 document (reads project one query param per input field when field-enumerable, else the `__abide_args` blob) | PW+RT | [x] (platform/machines fetches + renders paths in-browser; e2e asserts) |
| `/__abide/mcp` — MCP endpoint (tools/list, tools/call) | RT | [x] (platform/machines POSTs tools/list from browser; e2e asserts tool list) |
| MCP prompts (`src/mcp/prompts/<name>.md`) / resources | RT | [ ] |
| Socket → MCP tail/publish tools | RT | [ ] |
| `/__abide/health` | PW+RT | [x] (platform/observability fetches /__abide/health in-browser) |
| `/__abide/identity` — the caller's OWN resolved principal | RT | [ ] |
| `/__abide/logs` — SSE log feed, opt-in via `ABIDE_LOGS` (404 otherwise); backlog-then-live, filtered server-side by tail/level/debug/trace, `follow=0` for history-then-EOF | RT | [ ] |
| Log feed is inside the middleware chain and NOT on the WS mux (a browser-joinable log channel makes any XSS a log exfil) | RT | [ ] |
| Log fan-out happens BEFORE the `DEBUG` gate — `logs --debug abide:rpc` lights a channel on a live deployment booted without it | RT | [ ] |
| Declared RPC verb is ENFORCED — a mismatched method is a 405 carrying a derived `Allow` (`GET, HEAD` for a read); HEAD rides with GET | RT | [ ] |
| Every GENERATED route gates its method through the same `enforceMethod` — a read-only framework route answers anything but `GET`/`HEAD` with 405 + `Allow: GET, HEAD`, and `/__abide/mcp` with `Allow: POST`. It had been written out per route class five times and omitted from three, so a `POST /openapi.json` carrying the abide client's shape cleared the CSRF gate and returned **200 with the spec document** (same for `/__abide/identity` and `/__abide/health`) | RT | [x] (abide `server/responseHeaders.test.ts` "405 Allow" — a `test.each` ENUMERATION over `/openapi.json`, `/__abide/identity`, `/__abide/health`, `/__abide/logs`, kept as a list precisely because the failure mode is a route class nobody remembered; `internal/logsRoute.test.ts` for the log feed. No docs-app demo) |
| OpenAPI declares the 422 typed-error ENVELOPE once under `components/schemas` and references it from every operation's `422` response — the envelope, not the payload alone, so a described error is the shape a caller actually receives | RT | [x] (abide `server/openapi.test.ts` asserts the `422` response on both a read and a mutation operation; `server/loadApp.test.ts` + `server/multipart.test.ts` assert the router really answers 422 with it. The docs app renders only the operation PATHS, so the browser surface does not reach the envelope) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` / per-RPC `maxBodySize` — declared oversize is a 413 before buffering, chunked re-checked after | RT | [ ] |
| Both representations at one URL carry `Vary: Abide-Nav, Abide-Nav-Keep` — the first-load HTML document and the soft-nav JSONL frame stream (`NAV_VARY`); `from` picks document-vs-frame-stream, `keep` picks how much of the tree the stream carries, so a cache keyed on only one could serve a page fragment to a first load | PW | [ ] |
| `<head>` `modulepreload`s the whole static boot graph + the matched route's chunk graph, each chunk named individually | PW | [ ] |
| `/__abide/inspector` (gated) — **specced, NOT built** (config-observability CO2.7; no route, no env var) | RT | [ ] |
| `/__abide/cli` (per-user install) — **specced, NOT built** (machine-surfaces MS3.5 parks it) | RT | [ ] |

## 14. Agent (`abide/server/agent`)
| Capability | Kind | Status |
| --- | --- | --- |
| `agent(engine, messages, options?)` → `AgentFrame` stream | PW+RT | [~] (/platform/machines AgentDemo: browser consumes an `AgentFrame` stream from a scripted engine via `{#for await}`) |
| `options` (model/system/tools/approval) | RT | [ ] |
| Tools default = all `clients.mcp` RPCs; `[]` = none (`clients.mcp` is the one gate — naming `tools` is the override, not the way in) | RT | [x] (abide `server/agent.test.ts` "agent default tool surface" — drives the loop to a real handler, since the gap was that nothing wired the mapper) |
| Claude engine | RT | [ ] |
| Claude Code engine (engine tools OFF by default) | RT | [ ] |
| Types: `NeutralMessage` / `AgentFrame` / `AgentSurface` / `AgentEngine` | RT | [ ] |

## 15. CLI / build (mostly RUNTIME — `bun test`; 3 rows are browser-facing, see bucket note)
| Capability | Kind | Status |
| --- | --- | --- |
| `abide scaffold <name>` | RT | [ ] |
| `abide dev` (watch + live-reload over mux) | RT | [ ] |
| `abide build` (content-addressed client bundle + baked `dist/schemas.json` type-derived schema map) | PW+RT | [~] (/platform/deploy page + e2e/build-deploy.spec; also /platform/cli, /platform/bench, /platform/bench/server pages) |
| Boot-time type-derived schemas (batched `node`/tsgo pass; `ABIDE_DERIVE_SCHEMAS=0` opts out; `abide build` bakes, `abide start` prefers the bake) | RT | [ ] (abide `bakeSchemas.test.ts` / `deriveSchema.test.ts`) |
| Server-dispatch microbench (`route`/`cache-key`/`memo` hot paths) | PW+RT | [x] (/platform/bench/server + e2e/bench-server.spec) |
| SSR render microbench vs a hand-written string builder | PW | [x] (/platform/bench + e2e/bench.spec) |
| Frontend mount/update/hydrate microbench, and the HYDRATE BASELINE. The unit is a PATH, not an op: `build vs adopt` compares mount against parse+hydrate (`hydrate ÷ mount` is abide against itself, `÷ vanilla build` is ship-SSR-and-walk-it against ship-nothing-and-build-by-hand), and `first load` is render + parse + hydrate, drained from the same streaming `benchFrontend` rpc the SSR bench page uses and joined by scenario name. Adopting server markup is a thing only a framework does, so there is no vanilla column for the hydrate op itself — the ratio only exists once the unit is a path. Parse is timed per side (abide's markup carries anchor comments the hand-written string does not) and BATCHED on one clock pair, since timed per-op a 40-byte interpolation reads slower than ten nested elements and every ratio inherits the clock's resolution | PW | [x] (/platform/bench/client + e2e/bench-client.spec — the ratio assertions are the point: a join that silently missed leaves an em-dash, not an error) |
| Raw SSR-emitter byte fixture (static attrs, class/style merge, spread override, escaping, null-attr omission, block anchors) | PW | [x] (/__e2e/ssr-emit + e2e/ssr-emit.spec) |
| `abide start` | RT | [ ] |
| `abide run <file> [args…]` — boots the lifecycle, serves no HTTP; everything after `<file>` is the script's; a throw propagates with its stack | RT | [x] (abide `cli/run.test.ts`) |
| `abide` exit codes — help is stdout + 0, an unknown subcommand is stderr + 2 (usage); `check` errors are 1 (failed) | RT | [x] (abide `cli/main.test.ts`) |
| `abide compile` / `abide bundle` | RT | [ ] |
| `abide check` / `abide lsp` | RT | [ ] |
| Compiled binary — `logs` subcommand (`--tail`/`--level`/`--debug`/`--trace`/`--no-follow`), rendered by the READER through the server's own formatter | RT | [ ] |
| Compiled binary — `completion <bash\|zsh\|fish>`; the generated script bakes no names in, calling `completion --line` on every TAB (same call the REPL makes) | RT | [ ] |
| REPL line editing, 200-entry history, TAB completion and inline ghost text (suppressed under `NO_COLOR`); piped it still reads plain lines | RT | [ ] |
| Reserved command table — 9 names on both surfaces, `exit`/`quit` at the prompt ONLY (an rpc named `exit` is still callable as `app exit`); a shadowed rpc warns on `abide:cli` | RT | [x] (abide `cli/main.test.ts` — dispatcher, REPL, generated help and the shadow warning all read the one list) |
| A handler's DESTRUCTURING default reaches the derived input schema as `default` (literals only) → OpenAPI, MCP, `help` (`default <value>`), the REPL prompt | RT | [ ] |
| Desktop bundle (`BundleWindow`/`BundleMenu`/`onMenu`) | RT | [ ] |

## 16. Testing harness
| Capability | Kind | Status |
| --- | --- | --- |
| `await createTestApp(config?)` → `Promise<TestApp>` (async; explicit vs discovery mode; origin/fetch/rpc/socket/health/stop/as) | RT | [x] (/platform/testing page + abide `createTestApp.test.ts`: explicit + discovery + lifecycle) |

---

## Bucket summary & counts

| # | Bucket | Items | Playwright-relevant (PW / PW+RT) | Runtime-only (RT) |
| --- | --- | --- | --- | --- |
| 1 | RPC helpers — verbs | 20 | 10 | 10 |
| 2 | Responses | 11 | 9 | 1 |
| 3 | Call surface | 6 | 4 | 2 |
| 4 | Cache verbs + probes | 19 | 18 | 1 |
| 5 | Reactivity (shared state/watch + UI) | 22 | 19 | 2 |
| 6 | Template bindings / directives | 14 | 12 | 1 |
| 7 | Control flow | 19 | 16 | 0 |
| 8 | Async reads in templates | 6 | 6 | 0 |
| 9 | Routing / navigation | 11 | 11 | 0 |
| 10 | Sockets | 11 | 7 | 4 |
| 11 | Auth / request scope | 10 | 7 | 3 |
| 12 | Config / observability | 11 | 6 | 5 |
| 13 | Machine surfaces | 17 | 4 | 13 |
| 14 | Agent | 6 | 1 | 5 |
| 15 | CLI / build | 17 | 3 | 14 |
| 16 | Testing harness | 1 | 0 | 1 |
| | **Total** | **201** | **133 browser-facing** | **62 runtime-only** |

> Counts are mechanical — **run the parser in the coverage summary above**, don't split columns by
> hand. PW + RT = 195; the other six are the `unit` rows in buckets 2, 5, 6 and 7, a kind outside the
> PW/RT taxonomy. **Re-derive after editing any table** — this summary silently drifted by 18 rows
> once, and then by 31 more, because "re-derive" had no command attached to it. It does now, and the
> three-way reconciliation (kinds = statuses = bucket column sums = total) is what makes a dropped
> row visible instead of plausible.

Notes:
- Buckets 5–9 (reactivity, template bindings, control flow, async reads, routing) are the richest
  Playwright targets — they are the `.abide` template + client runtime, only observable in a real browser.
- Buckets 14–16 (agent, CLI/build, test harness) are *predominantly* runtime-only — cover with
  `bun test` / `createTestApp` by default. Not exclusively, though: bucket 14 has one PW+RT row (the
  browser consuming an `AgentFrame` stream) and bucket 15 has three (`abide build` via
  `e2e/build-deploy.spec`, the server microbench, the raw SSR-emitter byte fixture). An artefact of a
  build or an agent stream that a browser observes is legitimately browser-facing.
- Some capabilities are `unit` because the docs app **cannot host them**: `class:`/`style:` on a
  component, an `export` in a `<script>`, and `<item.icon/>` are all COMPILE ERRORS, so a page that
  demonstrated one would not build. Those rows cite the abide unit test that owns the gate instead —
  a `[x]` there means the gate is guarded, not that this app exercises it.
- Several capabilities (RPC verbs, responses, cache verbs, sockets, machine surfaces) are **PW+RT**:
  worth one browser test (the fetch/DOM path) *and* one runtime test (the raw HTTP / machine-surface path).
- `abide/ui/html` and `abide/ui/props` are documented public UI imports but are provided through the
  `.abide` template compiler rather than standalone files under `src/ui/` — test them via template pages.
