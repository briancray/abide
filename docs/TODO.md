# abide — remaining work & shortcuts to fix

Consolidated from: inline `TODO`/`Deferred` comments in `packages/abide/src`, the `## Deferred /
parked` sections in `docs/spec/*.md`, and the adversarial-review outcomes. The framework is
functional and test-covered (packages/abide `bun test` + packages/docs Playwright), but these are
the known shortcuts and gaps. Ordered by impact.

## Tier 1 — the big implementation shortcuts

1. **`.abide` is interpreted at runtime, not AOT-compiled to source.** `renderServer.ts` /
   `renderClient.ts` / `assembleCore.ts` compile each expression to `new Function(...)` and run the
   ~~`<script>` inside `with($s)`.~~ **DONE (Stage 1)** — AOT source-emit shipped. One shared emitter
   (`templatePlan`/`emitServer`/`emitClient`/`emit` + `runtime`/`serverRuntime`/`analyzeScope`/
   `emitSetup`) replaced the `renderServer.ts`/`renderClient.ts` interpreters (both DELETED, along
   with `assembleCore`/`mountPrepared`/`transformScript`/`assemble`). SSR is emitted-only; the client
   bundle boots from emitted per-page `mount`s (32 KB, no `typescript`/`parse`/interpreter — CSP/
   no-eval win). Cell refs are lexically rewritten (`n++`→`n.write(n.read()+1)`), no `with`, no
   runtime eval. Verified: 696 pass, tsc clean, real-browser lane green, emitted-vs-interpreter parity
   proven then frozen as a snapshot oracle. Design: `docs/spec/attach-hydration-design.md`;
   implementation: `docs/spec/attach-hydration-stage1-plan.md`.
2. ~~**No true hydration — fresh-mount over SSR** (C2).~~ **DONE (Stage 2)** — true attach-hydration.
   The client CLAIMS the server DOM (no clear, no flash): emitted `hydrate()` walks a stateful cursor
   over server DOM, claims text (with `prefixLen` split for parser-merged nodes)/elements/blocks/async,
   **suppresses the initial reactive write** (trusts server output), and recovers locally on mismatch
   (whole-page fresh-mount as last resort). Soft-nav unified onto the same hydrate path. State
   initializers are recorded/replayed via the seed (instance-level deterministic; module-level under a
   warm server is a tracked follow-up). Proven end-to-end in the real-bundle browser lane: the
   server-rendered node is the SAME object after hydrate (`===`), never re-created, and stays reactive.
   Shipped as 7 verified PRs — see `docs/spec/attach-hydration-stage2-plan.md` (design:
   `attach-hydration-design.md`). Refs: `ui/internal/emitClient.ts`, `runtime.ts`, `bootstrap.ts`,
   `ui/navigate.ts`, `server/internal/pages.ts`.
   **NOW VALIDATED AGAINST THE REAL APP:** the `packages/docs` Playwright e2e (browser hydration +
   interactivity) is **72 passed / 0 failed**. Getting there exposed real bugs the unit fixtures
   missed — the unit suite was green while the app didn't hydrate. Fixed: (a) `<script module>`
   imports not reaching the template (`emitSetup.ts`); (b) **hydration cursor whitespace desync** —
   the plan's `childIndex` counted zero-DOM nodes (`<script>`/`{#snippet}`) as boundaries while the
   HTML parser coalesces adjacent text (`templatePlan.ts`); (c) server-side accessor-bind
   serialization rendered `{get,set}` objects unwrapped (`serverRuntime.ts`); (d) primed-suppression
   swallowed a client-only `bind:element` update; (e) `{#await}`/`{#try}` branch-swap teardown +
   nested-block cursor desync; (f) module-import proxies frozen across soft-nav (`emitSetup.ts`). All
   with new unit regression guards (803 abide tests). **Lesson (memory):** abide `bun test` green ≠
   framework works — the docs e2e is the real gate.
3. ~~**Hydration seed payload is empty `{}`.**~~ **DONE** — SSR reads are recorded into the page
   (`#__abide-seed`) and the soft-nav envelope as `{ reads: [{name,args,value}] }`, and the client
   replays them into the RPC cells before mount, so no re-fetch on hydration (rpc-core §5). Values
   are output-shaped (see #5). Cell gained `snapshot()`/`seed()`. Verified end-to-end in the browser
   lane (no-refetch assertion). Refs: `pages.ts` (`collectSeed`), `router.ts`, `bootstrap.ts`
   (`replayReads`), `navigate.ts`, `shared/cell.ts`.

## Tier 2 — feature gaps

4. ~~**Server SHARED cross-request cache + §8 broadcast**~~ **DONE** (5 PRs, plan:
   `docs/spec/shared-cache-plan.md`). `cache:{shared:true}` stores slots in a process-global
   `sharedStore()` with LRU (`ABIDE_MAX_SHARED_CACHE_SIZE`) and runs the handler **fail-closed**
   (scope-exited so `identity()` throws → never caches per-user data; ambient reads without a scope
   error). Invalidate/refresh/amend on a shared slot **broadcast** a `CacheFrame` over the socket mux
   on `@rpc:<name>:<key>` channels (`cacheChannels.ts`); `cache:{tags}` + global
   `invalidate/refresh({tags})` fan out across tagged cells (`cacheTags.ts`, `shared/{invalidate,
   refresh,pending,refreshing}.ts`). **Channel-join auth (the security crux, DECIDED):** `wsSubscribe`
   re-runs the target RPC's OWN middleware chain per subscribe with the connection's upgrade-resolved
   identity (`channelAuth.ts`) — plus an **args-spoof defense** (`cacheChannelName(rpc,presentedArgs)
   === channelName`, verified before middleware). Client cells reading a `shared` RPC auto-subscribe
   (`@rpc:` only) and apply frames via their local verbs (`cacheMux.ts`). 782 tests green; adversarial
   auth matrix (`channelAuth.test.ts`) + auth code reviewed by hand. Deferred (parked): horizontal
   backplane (single-process only), client `@tag:` subscription, `canSubscribe`. Refs: `shared/cell.ts`,
   `shared/internal/sharedCache.ts`, `server/internal/{cacheChannels,cacheTags,channelAuth}.ts`,
   `ui/internal/{cacheMux,applyCacheFrame}.ts`.
5. ~~**Output-shaping** — RPC/hydration output isn't trimmed to the declared schema fields.~~
   **DONE** — `shared/internal/shapeToSchema.ts` key-picks values against the declared JSON output
   schema (recursing objects/arrays; permissive/absent/Standard schema passes through unchanged);
   applied to both the RPC wire result (`router.ts`, all environments) and the hydration seed
   (`collectSeed`). Undeclared fields (e.g. `passwordHash`) no longer leak.
6. **Client bundle: single bundle, no code-splitting.** ~~non-minified~~ **MINIFY DONE** — production
   builds minify. An explicit `config.dev` flag gates it: `abide build`/`abide start` set `dev = false`
   → `Bun.build({ minify: true })`; `abide dev` sets `dev = true` and tests/`createTestApp` leave it
   unset → unminified (fast rebuilds, readable output, stable in-bundle assertions). Verified by a new
   browser-execution test that a minified prod bundle is materially smaller AND still attach-hydrates +
   stays interactive in happy-dom (`server/browserBundle.test.ts`). Refs: `server/internal/router.ts`
   (`AppConfig.dev`), `cli/serve.ts`, `cli/main.ts build()`, `server/internal/clientBundle.ts`.
   **Still deferred — per-route SPLITTING + per-chunk hashing (perf, not a bug, XL):** requires N
   per-pattern entries (`Bun.build({ splitting, naming: "[name]-[hash]" })`), a hashed-URL serving
   substrate (today `dist/_app/<hash>/` is written but never read at serve time; the router always serves
   the fixed `/__abide/client.js`), and an ASYNC lazy page registry so a soft-nav to an unvisited route
   `await import()`s its chunk before hydrate (today soft-nav needs ZERO JS round-trips). Cross-cutting
   build→serve→hydrate change; ship as staged PRs gated on the docs Playwright e2e. Ref:
   `server/internal/clientBundle.ts`.
7. ~~**`layout.abide` not wired**~~ **DONE** — `loadApp` now discovers `layout.abide` alongside
   `page.abide` (keyed by directory route prefix); a page's applicable layouts wrap it outer→inner,
   each rendering the next level where it calls `{children()}`. Composition reuses the existing
   component/`{children()}` path: `{children()}` compiles to a `children` component slot
   (`templatePlan.ts`), and the composer injects `children` as an isomorphic component wrapping the
   next level — server (`pages.ts renderLevel`) and client (`ui/internal/compose.ts`) both drive it
   through `genComponent`/`$rt.component` (paired anchors + claimBlock hydration). Seed reads +
   `state` ordinals span layers (rendered/mounted outer→inner). Refs: `server/internal/layouts.ts`,
   `server/internal/loadApp.ts`, `server/internal/pages.ts`, `server/internal/clientBundle.ts`,
   `ui/internal/compose.ts`, `ui/internal/templatePlan.ts`. Follow-ups **RESOLVED/CLASSIFIED:**
   (a) **per-layout `<script module>` parity** — NOT a gap: a layout is structurally just another
   emitted level, so its `<script module>` is `$ensureModule`-memoized once/module exactly like a
   page's (server `SERVER_MODULE_CACHE`, client `$MODULES` dedupe). Frozen with a regression test
   (two pages sharing a layout render the same module stamp — `server/layout.test.ts`).
   (b) **layout-level error boundaries** — a layout CAN contain a throwing inner page by wrapping
   `{children()}` in `{#try}{:catch}` (server `try/catch` chunk + client try plan); tested. Plus a
   safe hardening: an uncaught page/layout render error now returns a controlled **500** (`error(500)`
   + loud log) instead of leaking Bun's default handler (`server/internal/router.ts` nav-render
   try/catch). An **implicit** boundary (auto-wrap / a `{:error}` slot) remains a parked design
   decision (needs a fallback-UI + status + hydrate-reconcile spec). (c) `props()` shared across
   layers — accepted (no supported way to pass distinct props to a layout).
8. ~~**File uploads (multipart / `files` schema)** deferred.~~ **DONE** — RPCs accept `FormData`
   (multipart) as an input shape: a `File` rides in the FormData body, never in the JSON args object.
   The mutation dispatch detects `multipart/form-data`, parses `request.formData()`, and passes the
   raw `FormData` to the handler as its single positional argument (handler pulls `File`s via
   `form.get(name)`). The JSON `input` schema stays JSON-only (skipped for multipart); a new
   `schemas.files` (`{ required?, properties?: { maxSize?, accept? } }`) validates uploaded file
   fields → the same 422 `ValidationErrorData` path. CSRF unchanged/uncompromised: `multipart/form-data`
   is a CORS-simple type, so a multipart mutation is admitted ONLY via the `x-abide` header (a
   cross-site `<form>` can't set it). Client proxy + `createTestApp.rpc` send a `FormData` arg as the
   raw body (no content-type; browser sets the boundary) + `x-abide`. `maxBodySize` enforced up front
   via Content-Length (413). Refs: `server/internal/router.ts`, `server/internal/makeRpc.ts`
   (`FilesSchema`, `Mutation` accepts `FormData`), `server/internal/validateFiles.ts` (new),
   `ui/internal/clientProxy.ts`, `test/createTestApp.ts`, `server/multipart.test.ts` (new). ~~Follow-up:
   validating multipart *text* fields against a schema.~~ **DONE** — the multipart branch now also
   validates the TEXT fields against the JSON `input` schema: `projectFormText.ts` (new) extracts the
   non-`File` FormData entries into a plain object (excluding Files → the "a File never rides in JSON
   args" invariant holds) and coerces each string to its declared type (number/integer/boolean/
   object/array via `env.ts`'s rules; opaque Standard Schemas + undeclared/untyped fields pass through
   raw), which the router validates via the same `validateStandard`→`validationError` (422) path as the
   JSON args. The handler still receives the raw `FormData` (validation is a gate only). Refs:
   `server/internal/{projectFormText,router,validateFiles,makeRpc}.ts`,
   `server/internal/projectFormText.test.ts` (new), `server/multipart.test.ts`.
9. ~~**`env<T>()` build-time type-derivation** not wired (falls back to pass-through).~~ **RESOLVED
   (decision + implementation).** Investigated: abide loads `src/server/**/*.ts` **directly** via Bun
   import — there is NO server-source transform stage (only `.abide` files are transformed), `src/.abide/`
   is written by nothing, and `deriveSchema.ts` still has ZERO production callers. So both build-delivery
   options fail on their merits, not just effort: **(A)** a general server-source transform / shared TS7
   §11 build-extraction pass is XL, multi-PR, and explicitly parked ("adjacent, not core-slice-1");
   **(B)** a boot-loaded `src/.abide/config.schema.json` artifact **violates the project goal "consistent
   runtime between all builds and environments"** — `env<{PORT:number}>()` would enforce coercion under
   `abide build`/`dev` (artifact present) but silently pass through under `abide run`/`bun test`/
   `createTestApp` (no artifact). The only runtime-CONSISTENT way to get typed+validated config is to have
   the schema present at runtime. **Shipped (C-plus):** `env(schema)` now **infers its result type from the
   schema argument** (schema-first) — a field-spec map `env({ PORT: { type: "number", required: true } })`
   → `{ PORT: number }`, a Standard Schema → its output type, an `enum` → the literal union, non-required/
   no-default fields → optional — so you write the schema ONCE and get coercion + validation + the static
   type, identically in every environment. `env<T>()` no-arg stays best-effort pass-through with the header/
   CLAUDE.md/spec corrected to say `T` is a compile-time annotation only (not runtime-derived), pointing at
   the deferred §11 build pass for the erased-`T` path. New TS overloads + `InferEnv`/`EnvFieldType`/
   `EnvFieldPresent` mapped types (`server/env.ts`); tests: schema-first runtime + compile-time
   `assertType` cases (`config.test.ts`, proven to error on wrong types via a scratch negcheck). 875 tests
   + tsc + lint green. Refs: `server/env.ts`, `server/config.test.ts`, `CLAUDE.md`,
   `docs/spec/config-observability.md` (CO1.3). Erased-`T` runtime derivation remains **deferred** to the
   RPC-first §11 build-extraction pass (rpc-core §11 / build-pipeline BP1.4).
10. **Claude Code engine + approval transport** — split into two parts:
    - **Part A — approval-decision transport: ✅ DONE.** `AgentOptions.approval` is now a real
      `ApprovalPolicy` (`required?` boolean/predicate + an injectable `decide` transport); the agent
      loop gates each tool call — emits `approval-request`, awaits the decision (abort-safe),
      approve→run / deny→skip+record refusal the model sees / edit→run with edited args (faithful
      transcript). The production transport is a **message** over the socket mux on `@agent:<runId>:
      <toolCallId>` channels (`muxApprovalDecider`/`publishApprovalDecision`, `agentApproval.ts`). No
      `approval` option = auto-approve (back-compat). 790 tests green. Refs: `server/agent.ts`,
      `server/internal/{agentTypes,agentApproval}.ts`, `server/agentApproval.test.ts`.
    - ~~**Part B — Claude Code engine (`claudeCodeEngine.ts` still throws) — NEEDS A DECISION.**~~
      **DONE (decision + implementation).** Decided in favor of **`Bun.spawn` of the local `claude`
      CLI** (bun-native, **zero npm dep**; the Agent SDK route was rejected as an npm dependency). The
      binary is an OPTIONAL runtime dep — if absent, `stream()` yields a clear `error` frame naming the
      fix, never a crash (the old stub threw on construction). The architectural mismatch — abide's loop
      expects one engine turn + `tool-call` frames it executes in-proc, while Claude Code runs its OWN
      loop and executes its OWN tools — is resolved by modeling it as a **self-contained engine**:
      `stream()` spawns `claude --print --output-format stream-json --verbose`, translates the NDJSON
      into `AgentFrame`s (assistant text/thinking → deltas, result → `usage`/`error`), and emits NO
      `tool-call` frames (Claude Code's own tool activity surfaces as informational `tool-result`
      frames), so the loop settles to `done` after one turn with no double-execution. Engine built-in
      tools OFF by default (AG2.5); `spawn` is injectable for hermetic tests. **Verified:** 10 hermetic
      unit tests (canned stream-json → frames, argv wiring, missing-binary error, abort-kills-child) +
      a REAL end-to-end smoke against the installed `claude` v2.1.197 (prompt→"pong", real usage parsed,
      loop `done`). 885 tests + tsc + lint green. **Deferred (documented, not faked):** exposing the
      app's RPCs as tools to the spawned Claude Code via abide's MCP face (`--mcp-config` at the app URL
      + auth) and reconciling Claude Code's permission model with abide's `ApprovalPolicy`. Refs:
      `server/claudeCodeEngine.ts`, `server/claudeCodeEngine.test.ts`, `CLAUDE.md`, `docs/spec/agent.md`.
      The approval transport (Part A) already works for any engine.
      **DOGFOODED IN THE DOCS:** the `agent()` surface (previously undogfooded — the real engines can't run
      in a deterministic browser e2e) now has a `/machines` sample driven by a scripted `AgentEngine`
      (`src/server/rpc/agentDemo.ts`) — turn 0 emits text + a `clock` tool-call, the loop runs the tool
      in-proc, turn 1 answers, then `done`; the `AgentFrame` stream is jsonl'd and consumed live with
      `{#for await}`. The Claude/Claude Code engines plug into this exact seam. e2e asserts the streamed
      text/tool-call/tool-result/done land in the DOM (`e2e/smoke.spec.ts`).
11. **`abide check` (`.abide` type-checking)** — script + import checking via TS7 is **done, wired
    (`cli/main.ts` `check` dispatch, ~L200), and tested**. ~~`abide lsp` (C10.7, no file yet)~~ **DONE
    (minimal stub)** — `cli/lsp.ts` ships a diagnostics-only `.abide` language server over stdio
    (JSON-RPC + `Content-Length` framing) that reuses the SAME `check(dir)` core (C10.7's "check and lsp
    share one core"): on `textDocument/didOpen`/`didSave` it re-runs `check`, maps each 1-based
    `CheckDiagnostic` to a 0-based LSP `Diagnostic` (`source: "abide"`, severity Error), publishes per
    file, and clears stale squiggles when a file passes. Advertises `textDocumentSync: {openClose, save}`;
    answers `initialize`/`shutdown`; stops on `exit`. Wired as `abide lsp` (`cli/main.ts` + USAGE).
    Verified: 2 in-memory-transport integration tests (`cli/lsp.test.ts`, driving the real loop over
    check()) + a real-process stdio smoke (spawned `abide lsp` answers initialize + publishes a mapped
    TS2339 then exits 0). **Deliberate limits (documented in the file header):** diagnostics only (no
    hover/completion), whole-project re-check per open/save (no in-memory buffer / persistent language
    service → no live per-keystroke), and the same SCRIPT-only surface as `check`. Refs: `cli/lsp.ts`,
    `cli/main.ts`, `cli/lsp.test.ts`. **Remaining gap: template-expression type-flow (C10.2–6).**
    **Foundation laid by #1**: emitted client/server modules are real lexical TS (no `with`/eval), so
    C10 becomes "point `abide check` at the emitted TS + source-map back" — BUT the source-map machinery
    does NOT exist yet (verified: zero `sourceMap`/`mappings` hits across the emitters; `check.ts` keeps
    its own independent script-only offset map), so template type-flow is unbuilt emitter+source-map work,
    not a wired foundation. (Status: check core + lsp stub shipping; template type-flow deferred.)
    **FULL COMPLETION DESIGNED — see `docs/spec/abide-check-lsp-plan.md`** (decision record from the
    design grill). Resolved: a dedicated `emitCheck.ts` typed-lowering (single source of truth for
    check + lsp) with a bidirectional verbatim-copy `Segment[]` map; FULL template type-flow incl.
    cross-file component-prop typing (graduated: explicit `props<T>()` closed/exact, bare `props()`
    open/best-effort) and type annotations in template expressions (checked free via verbatim copy);
    a real `abide lsp` = {diagnostics, hover, completion, definition, references, signature-help} over
    a persistent node sidecar (tsgo `unstable/sync` `API` behind a `TypeEngine` seam + `fs` in-memory
    overlay + incremental snapshots) with a dumb Bun forwarder and a `bunCanHostTsgo()` auto-upgrade
    probe. 6-PR phasing (PR1 intra-file lowering + map + rewire check → PR6 references), each gated on
    `abide check packages/docs` clean + docs e2e + 853 unit tests. Deferred: rename, semantic tokens,
    formatting, per-route param typing, snippet-param inference. **Adjacent tracked cleanup (found
    during the grill, NOT in #11 scope):** the RUNTIME emitter rewrote TYPE-POSITION identifiers to
    `$scope.X` (`{(x as Foo).bar}` → `(x.read() as $scope.Foo).bar`) — intermediate `.ts` that is not
    type-valid but HARMLESS (Bun strips types syntactically; `emitCheck` is a separate verbatim-copy
    path). #18 excluded the operators `as`/`satisfies` but not the type OPERAND after them.
    **DONE (`as`/`satisfies` operand):** `analyzeScope.markTypeSkips` now walks each `as`/`satisfies`
    type operand (qualified names, generics `<…>`, array/indexed suffixes, `|`/`&` unions, leading
    `keyof`/`readonly`/`infer`/…, object/function/tuple types) and marks those token indices so both
    free-identifier passes (`rewriteFreeIdentifiers` + `collectFreeIdentifiers`) leave them alone.
    **SAFETY INVARIANT:** the scanner only ADDS an index it can prove is type-position and STOPS at the
    first token it cannot classify — so it can only UNDER-mark (harmless residue), never mask a real
    VALUE identifier (`a`/`b` in `x as Foo ? a : b` stay rewritten). Verified: 14 new unit cases
    (`analyzeScope.test.ts` — incl. over-skip controls) + 904 unit + tsc + lint + `abide check
    packages/docs` + docs e2e (92) green. **Still cosmetic (deliberately out of scope):** param/return
    type ANNOTATIONS (`(i: Item)` → `(i: $scope.Item)`) — the `:` is ambiguous with object literals /
    ternaries, so marking it risks over-skipping a value; left as harmless residue. Ref:
    `ui/internal/analyzeScope.ts`.
    **PR1 LANDED (template type-flow for `abide check`):** `ui/internal/emitCheck.ts` (new) is the typed
    lowering — interpolation/html/await/if/for/await/try/switch/snippet + element/component attrs +
    control-flow bindings, each `{expr}` copied VERBATIM inside synthetic scaffolding, with a
    bidirectional verbatim-copy `Segment[]` map (`mapGenToOrig`/`mapOrigToGen`). `cli/check.ts` rewired
    onto it (script-only generation deleted as a subset). Type annotations in template expressions check
    for free (verbatim). Tests: `emitCheck.test.ts` (verbatim-invariant + orig↔gen round-trip property —
    which caught a real substring-collision bug in `{#for item, i}`) + `checkTemplate.test.ts` (RPC-arg
    checking, loop-var/await-then typing, `{#if}` narrowing). 864 unit tests + tsc + lint green.
    **Rpc zero-arg type fix:** `Rpc<Args,T>` now uses `RpcCallArgs<Args> = unknown extends Args ?
    [args?:Args] : [args:Args]` so a `GET(()=>…)` zero-arg read type-checks as `fn()` (was TS2554);
    `.load()` shares it. **Docs-clean gate GREEN** (`abide check packages/docs` = 0) after interim honest
    guards for the `T|undefined` peek model (`{#await fn.load()}` for display reads, `{fn()?.foo}` +
    `?.` for interactive/peek reads, route-param casts, explicit `props<T>()` on `Sample.abide`). **Docs
    e2e passes** (88 passed; 2 sockets FLAKY-not-regression, confirmed passing on retry).
    **Read-model decision (grill) → `docs/spec/promise-read-model.md`: ✅ IMPLEMENTED.** The bare cell/
    RPC call now returns `Promise<T>` (coalesced load), `rpc.peek(args): T|undefined` is the reactive
    snapshot, and `.load` is kept only as a `@deprecated` non-subscribing alias (migration; the spec's
    "REMOVED" softened to deprecate-alias to avoid churning 8 test files + the machine-surface callers).
    **The open crux is SOLVED:** the bare call does a tracked `slot.signal()` read before returning the
    coalesced load, so the interpolation/await effect re-runs and re-awaits on invalidate (no more stale
    blocking read after a mutation). Seed-primed synchronous hydration-claim preserved via a runtime-only
    settled-value hint on the promise (`shared/internal/settledRead.ts`) — public type stays a clean
    `Promise<T>`; `claimAwait` reads the hint. Note: the runtime auto-awaits a thenable interpolation, so
    a bare `{rpc()}` renders the awaited value (better than the projected `[object Promise]`); the checker
    still errors on `{rpc().field}`. Migration: cell `readReactive` behavior moved to `.peek` (now auto-
    loads); docs dogfooded — bare-as-value peeks → `.peek()` (cache/async-reads), `{#await fn.load()}` →
    `{#await fn()}`, CLAUDE.md call-surface + async-reads tables flipped. Verified: 885 framework tests +
    tsc + `abide check packages/docs` + docs Playwright e2e green. Refs: `shared/cell.ts`,
    `server/internal/makeRpc.ts`, `ui/internal/clientProxy.ts`, `server/internal/pages.ts`,
    `ui/internal/runtime.ts`, `shared/internal/settledRead.ts`.
    **PR2 LANDED (cross-file component-prop typing):** `emitCheck.componentDts(source, root)` derives a
    typed default export per `.abide` — explicit `props<T>()` → the exact CLOSED `T` (unknown + wrong-
    typed props error); bare `props()` / none → OPEN `Record<string,unknown>` (accepts anything, zero
    false positives; destructuring-synthesis of widened defaults deferred). `check.ts` writes a
    `<file>.abide.d.ts` companion next to EVERY `.abide` (cleaned up with the temp modules), so a
    verbatim `import X from "./X.abide"` resolves to the typed default instead of the ambient
    `declare module "*.abide"` (any) — verified a concrete `.abide.d.ts` overrides the wildcard. Errors
    inside a companion are never collected, so a `props<T>()` referencing an unimported type degrades
    that prop to `any` (no check, no false positive) — v1 omits component imports deliberately.
    `emitCheck` lowers `<Name a={x} b="lit" {...r}>…</Name>` → a typed call `Name({ "a": (x), "b": "lit",
    ...(r) }, async () => { <children> })` — the `async` slot keeps `{#await}` inside a component in an
    async context (a regression the docs gate caught). Tests: 3 cross-file cases (wrong-typed prop,
    unknown prop, valid + bare-open). 867 unit + tsc + lint green; **docs-clean gate STILL green** with
    cross-file typing active over `Sample.abide`'s ~27 usages (its `props<T>()` now dogfooded). Refs:
    `ui/internal/emitCheck.ts` (`componentDts`/`deriveProps`/`emitComponentCall`), `cli/check.ts`.
    **PR3 IN PROGRESS — the `TypeEngine` seam + in-memory `fs` overlay landed:** `check.ts`'s diagnose
    bridge now serves ALL generated modules + `.abide.d.ts` companions as VIRTUAL files through the tsgo
    `API`'s `fs` callbacks (`overlayFs`: `readFile`/`fileExists`/`realpath` + `getAccessibleEntries`
    merging virtual files into their dir listing so the tsconfig `include` loads them into the CONFIGURED
    project with its ambient `*.css`/`*.abide` — a subtlety the docs gate caught: a virtual file's
    side-effect `import "./x.css"` else fell into a bare inferred project). The virtual-file manifest
    rides in on the subprocess STDIN (bytes, not a string — a Bun `spawnSync` gotcha), diagnostics ride
    out on STDOUT. **`check` now touches ZERO disk** (no temp `.ts`/`.d.ts` writes or cleanup) — verified
    0 stray files + the full check/cross-file suite + docs gate green over the real ~40-file project.
    This is the exact overlay the lsp server reuses to serve unsaved editor buffers.
    **PR3 LANDED — persistent, buffer-aware lsp server (no longer a stub):** `cli/lsp.ts` was rewritten
    from the `check(dir)`-per-save stub into a PERSISTENT node server. `LspEngine` keeps ONE warm tsgo
    `API` alive across requests (live `fs` overlay via `overlayFs(() => this.files)`, no per-keystroke
    cold start); `lowerProject(dir, overrides)` lowers every `.abide` in-memory (`emitCheck` +
    `componentDts`), substituting UNSAVED buffer content for the disk file — so `didChange` yields LIVE
    diagnostics before save (advertised sync now `{openClose, change:1, save}`; `didOpen/didChange/
    didSave/didClose` tracked; parse errors surfaced; open-doc diagnostics published, empty to clear).
    Diagnostics map back to the `.abide` via the same `Segment`/`mapGenToOrig` path. Runs UNDER NODE (the
    `API` pipe); `abide lsp` (Bun, `main.ts`) is a dumb bidirectional byte-pump `forwardLsp` to
    `node lsp.ts`, gated by `bunCanHostTsgo()` (`ABIDE_LSP_INPROCESS=1` flips to in-process the day Bun
    can host tsgo — revert = drop the forwarder). Verified: 2 real-process integration tests
    (`cli/lsp.test.ts` — spawn `node lsp.ts`: template TS2339 on `didOpen` mapped to the `.abide`, CLEARED
    on `didChange` to an unsaved fix; initialize advertises `change:1`) + a full-forwarder smoke (`bun
    bin.ts lsp` → node → mapped `publishDiagnostics`). 867 unit + 2 integration + tsc + lint + docs gate
    green. Refs: `cli/lsp.ts` (`LspEngine`/`lowerProject`/`lspServer`), `cli/main.ts` (`forwardLsp`/
    `bunCanHostTsgo`), `cli/check.ts` (`overlayFs` live-getter + `CHECK_SUPPRESSED_CODES`).
    **LSP DOGFOOD wired into the gate** (parallel of `abide-check`): `packages/docs/scripts/lsp-dogfood.ts`
    drives `abide lsp` against the REAL docs app — asserts real cross-file pages (`<Sample>` + RPC
    imports) report ZERO diagnostics AND a `didChange` to an unsaved bad buffer surfaces TS2339 (live
    in-memory checking at real scale, not just 2-file fixtures). Wired as docs `abide-lsp` + into the root
    `check` script — the LSP equivalent of the docs-clean checker gate.
    **PR4 LANDED — hover + go-to-definition:** the LSP now answers `textDocument/hover` (the TS type +
    doc comment at a position, via `checker.getTypeAtPosition`/`typeToString`) and `textDocument/
    definition` (`checker.getSymbolAtPosition` → `symbol.declarations` → `NodeHandle.resolve().getStart/
    getEnd`), advertised via `hoverProvider`/`definitionProvider`. `.abide` (line,character) → generated
    offset via `lineColumnToOffset` + the `mapOrigToGen` FORWARD map (built in PR1); results map BACK: a
    virtual generated module → its `.abide` (via `mapGenToOrig`), a `.abide.d.ts` companion → the top of
    the `.abide`, a real `.ts` → as-is. Proven end-to-end: hover on a TEMPLATE `count` → `number`;
    definition on the template `count` → its SCRIPT declaration (line 1), all in `.abide` coords. Two
    subtle bugs found + fixed en route: (a) a reused virtual path stays cached even under `invalidateAll`/
    `clearSourceFileCache` — the engine now mints a FRESH `revision` per lowering (so tsgo re-reads) and
    `closeFiles` the prior revision (so opens don't accumulate); (b) tsgo canonicalizes `NodeHandle.path`
    to LOWERCASE on a case-insensitive FS — the tsPath→module maps are keyed lowercase. Verified: a 3rd
    integration test (`cli/lsp.test.ts` — hover type + definition template→script). 868 unit + 3
    integration + tsc + lint + docs check + LSP dogfood green.
    **PR5 LANDED — completion + signature-help:** `textDocument/completion` (`checker.
    getCompletionsAtPosition` → LSP `CompletionItem`s; tsgo's `CompletionItemKind` IS the LSP enum, so
    `kind` passes through) and `textDocument/signatureHelp` (`getTokenAtPosition` → walk `.parent` to the
    enclosing `CallExpression` → `getResolvedSignature` → `getParameters`/`getReturnTypeOfSignature` +
    active-param from args ended before the cursor). Advertised via `completionProvider.triggerCharacters
    ["."]` + `signatureHelpProvider.triggerCharacters ["(", ","]`. `resolvePosition` gained a
    segment-boundary fallback (cursor right after `.` maps the preceding char + 1) so dot-completion
    resolves. Proven: completion after `count.` → number members (`toFixed`, …); signature-help inside
    `toFixed(` → `(fractionDigits: number | undefined): string`. Note: `getTokenAtPosition` is re-exported
    from `typescript/unstable/ast` (its `ast/astnav` subpath isn't in the package `exports`). Verified:
    a 4th integration test. 869 unit + 4 integration + tsc + lint + docs check + LSP dogfood green.
    **PR6 LANDED — find-references (LSP FEATURE-COMPLETE):** `textDocument/references` via `getToken
    AtPosition` → `checker.getReferencedSymbolsForNode(node, pos)` → each `ReferencedSymbolEntry.
    references` NodeHandle → resolve → mapped back through the same `declToLocation` path (case-insensitive
    tsPath keys). Proven: references on the template `count` return BOTH its `<script>` declaration (line
    1) AND its `{count…}` template usage (line 3), all in `.abide` coords — cross-position script↔template
    reference tracking. `referencesProvider: true`. v1 limit: searches loaded (open) modules + real files;
    refs in CLOSED `.abide` aren't loaded. Verified: a 5th integration test. 870 unit + 5 integration +
    tsc + lint + docs check + LSP dogfood green.
    **`abide lsp` IS NOW A FULL LANGUAGE SERVER:** live diagnostics + hover + go-to-definition +
    completion + signature-help + find-references, all over one warm persistent tsgo engine + the
    bidirectional `.abide`↔generated-TS map, dogfooded against the real docs app. Deferred perf: debounce
    `didChange`, true-incremental snapshots, publish diagnostics for closed cross-file dependents, load
    all modules for whole-project references. Deferred typing: bare-props destructuring-synthesis (Q4).
12. **Streaming SSR (out-of-order flush)** — client-side `{#for await}` over live streams **works**
    (as a documented create-fallback: it re-iterates a FRESH async iterator client-side,
    `runtime.ts:1124`); only the out-of-order SSR flush + fine-grained streaming hydration (rpc-core
    §5.4/§6) is unbuilt. **DEFER (XL, not session-completable).** No platform blocker — Bun
    `Response(ReadableStream)` is exactly the mechanism (already used by `jsonl`/`sse`) — but it is a
    rewrite of the server render model from "single awaited string" (`emitServer` emits `async render()`
    returning one buffered `$out`; `pageCallable` awaits even the peek form) to "shell + out-of-order
    patch stream," plus a NEW server-side reactive flush (§7.4 — watch/effects are client-only today),
    plus progressive client hydration + an incremental seed contract (today one bottom-of-page
    `#__abide-seed` blob). Touches the two most bug-prone areas (emit byte-parity oracle + Stage-2
    hydration cursor). Ship as a staged plan (`docs/spec/streaming-ssr-plan.md`) across ~6 PRs, each
    gated on the docs Playwright e2e. Perf/UX, not correctness.
    **IN PROGRESS — plan authored + decisions locked (`docs/spec/streaming-ssr-plan.md`):** (1) streaming
    is the DEFAULT and ONLY path — the real-500 guarantee is preserved structurally (drain eagerly; only
    commit to a streamed 200 when a read blocks past the deadline, so all-resolved pages still 500 before
    first flush); (2) deadline-based auto-boundaries, no new author syntax (only *pending* reads emit a
    placeholder); (3) `<template id="ab-p:N">` + move-script + adjacent JSON seed piece, on ONE extracted
    `{target?, html, reads}` envelope + `applyEnvelope` applicator that soft-nav (which already IS this)
    and HMR (drop `location.reload()` for markup/data changes, keep a JS-graph-changed gate) reuse; (4)
    suspense streaming first (PR1–4), continuous `{#for await}` handoff second (PR5–6); (5) server flush
    = promise-join, not a server signal graph. **PR1 LANDED — streaming transport + shell/tail seam
    (buffered-equivalent):** the router serves the SSR document via `new Response(ReadableStream)` instead
    of `Response(string)`. `renderDocument` was refactored into a `documentFrame(opts) → {head, tail}`
    seam (`head` = through `<div id="__abide-app">`; `tail` = seed script + client script + closers) and
    stays **byte-identical** (`head + inner + tail`); `streamDocument(inner, opts)` enqueues head/inner/
    tail as chunks. `renderPage` + `collectSeed` are still fully awaited before the Response is built, so
    the bytes are identical AND the render-error → controlled 500 guarantee (TODO #7) is unchanged. This
    proves `Response(ReadableStream)` end-to-end under `Bun.serve` and gives PR2 its flush seam. Verified:
    a byte-identity unit test (`streamDocument` ≡ `renderDocument` across seed/styles/devReload/title) +
    905 unit + tsc + lint + `abide check packages/docs` + docs e2e (92) green. Refs:
    `server/internal/pages.ts` (`documentFrame`/`streamDocument`), `server/internal/router.ts`,
    `server/pages.test.ts`.
    **PR2 LANDED — suspense placeholders + out-of-order flush:** the full `{#await}{:then}` block is the
    STREAMING form (an `inline` flag threaded parse→plan→emit tells it from the blocking inline shorthand
    `{#await p then v}`). `emitServer` lowers it to `$rt.awaitStream(...)` (`ui/internal/streamScope.ts`,
    new): race the read against ONE per-render deadline — settle-in-time → render the resolved branch
    INLINE (byte-identical to blocking for warm/fast reads); still pending → emit an `<abide-slot
    id="ab-p:N">`+fallback + register a deferred subtree. `streamPageDocument` flushes head→shell→
    out-of-order `<template data-ab-patch=N>`+move-script patches (`drainPatches`, promise-join, §7.4)→
    seed+tail; the seed is collected AFTER the drain so streamed reads are included (one tail seed for
    now). Direct `render()` (tests) has no stream scope → awaits fully inline → oracle + buffered tests
    byte-identical. **Deadline is time-based (default 4ms, `ABIDE_SSR_DEADLINE`), NOT a macrotask —
    empirical finding:** an SSR read is always cold-cache and crosses ≥1 macrotask, and the deadline
    timer is scheduled before the read kicks, so `setTimeout(0)` fired first and streamed EVERY read; 4ms
    cleanly separates a cold-but-fast in-proc read (~0.1ms → inline) from genuine I/O (ms+ → stream) with
    wide margin (machine-stable). Soft-nav stays BUFFERED (its `{html,seed}` envelope needs the complete
    inner HTML). **Deferred to PR3:** the shared `{target?,html,reads}` envelope + `applyEnvelope`
    applicator + soft-nav migration + the client reactively CLAIMING a streamed subtree (PR2's move-script
    fills it pre-hydration only). Verified: 2 integration tests (fast→inline no-slot; slow→out-of-order
    patch+move-script+ordering) + 907 unit + tsc + lint + `abide check packages/docs` + docs e2e (92)
    green. Refs: `ui/internal/streamScope.ts`, `ui/internal/{emitServer,ast,parse,templatePlan}.ts`,
    `shared/internal/context.ts`, `server/internal/{pages,router}.ts`, `server/pages.test.ts`.
    **PR3 LANDED — first-load progressive hydration (client CLAIMS streamed subtrees):** decision (a)
    UNWRAP — `runtime.awaitBlock`'s hydrate path runs `unwrapStreamSlot(parent, open)` first: a streamed
    `<abide-slot>` (filled by its patch — module-deferred hydration runs after every patch + the tail
    seed, so it always has on first load) has its resolved branch lifted to sit DIRECTLY between the
    block anchors and the wrapper dropped, so the existing `claimAwait` claims it byte-for-byte as a
    non-streamed block (tail seed primed the read → peeks settled → claims, no re-create/refetch). After
    hydration a streamed block is indistinguishable from an inline one → reactive-swap/teardown stays
    single-codepath. The `<abide-slot>` carries inline `style="display:contents"` (no head-byte change)
    so it's layout-transparent during streaming. Client bundle is a deferred module script → no
    hydration-vs-patch race. **Deferred to PR4 (needs the soft-nav client stream-consumer):** the shared
    `{target?,html,reads}` envelope + `applyEnvelope` extraction. Verified: a real-browser hydration e2e
    (`/streaming` + `streamSlow` 40ms RPC) asserting raw HTML streamed (placeholder + out-of-order
    patch), value present after load, `<abide-slot>` UNWRAPPED (0 in live DOM), claimed block stays
    reactive (refresh advances counter), zero hydration-mismatch warnings — + 907 unit + tsc + lint +
    `abide check packages/docs` + docs e2e (93). Refs: `ui/internal/runtime.ts` (`unwrapStreamSlot`),
    `ui/internal/streamScope.ts`; docs `ui/pages/streaming/page.abide`, `server/rpc/streamSlow.ts`,
    `e2e/streaming.spec.ts`.
    **PR4 LANDED — streaming soft-nav (true incremental):** an in-app navigation streams too. Soft-nav's
    response is now a JSONL frame stream (`{kind:"shell",html,url}` → `{kind:"patch",id,html}`* →
    `{kind:"seed",seed}`, `content-type application/jsonl`) instead of the buffered `{html,seed}` JSON
    envelope (`streamSoftNav`). `navigate.ts softLoad` reads frames PROGRESSIVELY (`readFrames`): swaps
    the shell immediately (slow read shows its `<abide-slot>` fallback), fills each slot as its patch
    frame arrives (`fillSlot` — a `<template>` parse + `replaceChildren`, in JS since a fetched body's
    inline scripts don't run), then hydrates the assembled DOM via the SAME `mountPathname` path (PR3
    unwraps slots). Disposes the previous mount BEFORE the shell swap. A middleware redirect still comes
    as a JSON `{redirect}` envelope (matched BEFORE the stream — "application/jsonl" contains
    "application/json" as a substring, a bug caught in testing). One tail seed for now (per-patch seed =
    later refinement). Verified: a progressive soft-nav e2e (nav → `pending` then streamed value, marker
    survives = no reload, slot unwrapped, reactive) + server soft-nav tests migrated to a `parseSoftNav`
    JSONL helper + 907 unit (4 deterministic runs) + tsc + lint + `abide check` + docs e2e (94).
    **Contamination fix:** the migrated tests threw on `response.json()` of a JSONL body before
    `app.stop()`, leaking apps/timers that intermittently broke happy-dom (`document is not defined`) in
    other files — `parseSoftNav` restored determinism. Refs: `server/internal/{pages,router}.ts`,
    `ui/navigate.ts`, `ui/internal/streamScope.ts` (`Patch`/`documentPatch`), `test/parseSoftNav.ts`,
    `ui/nav.test.ts`; docs `e2e/streaming.spec.ts`.
    **PR5 LANDED — error/status semantics:** (1) a streaming `{#await}` that rejects WITHIN the deadline
    with no `{:catch}` rethrows before the shell flushes → controlled 500 (TODO #7 holds for streaming
    forms). (2) a slow read that rejects WITH `{:catch}` streams the catch branch as its patch (client
    hydrates it) — server-side the catch sees the raw error, but on the wire an uncaught throw is a 500
    with no raw message + an errored read carries no seed, so the client re-fetches and its `{:catch}`
    renders the `HttpError` ("Internal Server Error") — correct + secure divergence. (3) a slow read that
    rejects with NO `{:catch}` emits an EMPTY patch clearing the slot (can't 500 post-flush) + a loud
    server log — NOT a stream abort (that would kill sibling patches + the page). Verified: 3 integration
    tests + a browser e2e + 910 unit (2 deterministic runs) + tsc + lint + `abide check` + docs e2e (95).
    Refs: `ui/internal/streamScope.ts`, `server/pages.test.ts`; docs `server/rpc/streamBoom.ts`,
    `ui/pages/streaming/page.abide`, `e2e/streaming.spec.ts`.
    **PR6 LANDED — continuous `{#for await}` SSR streaming (server):** the emitter lowers `{#for await}`
    to `$rt.forAwaitStream(...)` — drain to the deadline INLINE (fast/sync streams byte-identical, per the
    oracle), then stream each subsequent item into an `<abide-list id="ab-l:N">` as an `append` patch, and
    a `complete` patch (flags `data-ab-done`) iff the source ENDS within the budget (`ABIDE_SSR_STREAM_
    BUDGET`, default 30s) — exceeds → cut off without the flag (client re-iterates), so an SSR `{#for
    await}` NEVER hangs. The scheduler generalized to interleave single-resolve subtrees + multi-yield
    streamers (`DeferredStreamer`, `Patch` union fill/append/complete). Works for any source (HTML is
    streamed, no value serialization). Verified: a server integration test + the existing `{#for await}`
    e2e green (client still re-iterates — safe state) + 911 unit + tsc + lint + `abide check` + docs e2e
    (95). Refs: `ui/internal/{streamScope,emitServer}.ts`, `shared/internal/context.ts`,
    `server/internal/pages.ts`, `server/pages.test.ts`.
    **PR7 SUPERSEDED → `docs/spec/replayable-streams.md` (design of record).** Stress-testing the naive
    client-claim surfaced that it's unsound (a "static claim" leaves item-body `onclick`/state dead) and
    that the real concern is COST: a `{#for await tok of complete(prompt)}` runs the model on SSR AND the
    client re-iterate re-runs it (double-billed); two refreshes = two runs; the shared cache can't replay
    a stream (single-consumption, no tee/buffer). The sound primitive is a **ReplayableStream**
    (consume-once + buffer decoded chunks + replay-then-live fan-out) keyed by `(fn,args)` in the shared
    store — which converges with the socket tail. Folded into that design: **all verbs route through the
    cell** (mutations coalesce by default, `cache:{ttl:0}`; `cache:false` opts out); **ttl clock starts
    at stream CLOSE** (`ttl:0` = coalesce-only, `ttl:n` = n-ms late-join replay window); **client
    ATTACHES to the slot** (replay + subscribe, reactive item mount) instead of re-running; **budget =
    the source's own RPC timeout** (global cap only for non-abide sources). Limits: single-process
    (backplane parked), buffer bound for infinite streams. PR6 is the shipped SSR substrate underneath.
    Spec supersedes rpc-core §14.1 (mutations never coalesced) + §12.2–3 (no HTTP-stream replay); CLAUDE.md
    cache opt updated. **Build order in the spec; not yet implemented.**

## Tier 3 — polish / smaller shortcuts

13. ~~**Scoped `<style>` not actually scoped**~~ **DONE (with #1 Stage 1)** — root-scope selector
    rewrite (`.a` → `.a[data-ab-<hash>]`) + per-element scope attribute now emitted at build time
    (`templatePlan.scopeStyles`). Nested/branch `<style>` (C9.2) uses the same hook, shipped as a
    fast-follow. Ref: `ui/internal/templatePlan.ts`.
14. ~~**Script-cell edge cases — NEEDS RE-EVALUATION post-rewrite.**~~ **RE-AUDITED.**
    - ~~`bind:value={x}` on a bare state var silently no-op'd~~ **FIXED (#14)** — `rewriteExpr` collapsed
      a bare cell ref to a READ (`x.read()`), so the two-way bind received the value, not a writable
      accessor. The plan (`templatePlan.ts` `planAttribute` BindDirective) now wraps a bare cell in the
      same `{ get: () => x.read(), set: ($v) => x.write($v) }` accessor the manual `{get,set}` workaround
      used — for value/checked/group, on BOTH emitters (server SSR reads `.get()`, client `boundAccessor`
      gets `{get,set}`). `bind:element` unaffected (node-ref cell / attach fn, not a value accessor).
      Verified: unit (`emitCapabilities.test.ts` — emitted accessor client+server) + docs e2e
      (`bindings.spec.ts` bare-var round-trip) + a new `bindings/page.abide` "bare state var" sample.
      **Dogfooded across the docs:** the 5 pages that carried the `{get,set}` workaround for a bare state
      cell (`sockets`, `sockets/mux`, `platform/identity`, `platform/scope`, `rpc-guide/verbs`) were
      migrated to the bare `bind:value={x}` sugar (identity accessors deleted, stale "known-limit"
      comments removed) — full docs e2e 87/87 confirms no regression.
    - **Destructured `state` cells become plain values** — CONFIRMED still true and **accepted as correct
      behavior, not a bug:** `cellKind` only classifies a cell when the declarator is a simple identifier
      (`analyzeScope.ts`), so `const { a } = state({a:1})` binds `a` as a plain value — you cannot
      destructure a signal and keep reactivity. Documented limit; no fix intended.
15. ~~**`abide scaffold`** writes files only — no `bun install` / auto-`dev`.~~ **DONE** —
    `scaffold()` stays pure; `main()` now runs `git init` + `bun install` + `abide dev` after
    scaffolding, each skippable via `--no-git`/`--no-install`/`--no-dev`. Ref: `cli/main.ts`.
16. ~~**Dev live-reload** doesn't pick up *newly added* socket files without a restart.~~ **DONE** —
    `startWatch`'s rebuild now reconciles `config.sockets` **in place** (`syncSockets`), preserving
    the mux-captured object identity + the dev-reload channel. Ref: `cli/serve.ts`.
17. ~~**`StandardSchema.ts` TODO** — raw JSON Schema handling note.~~ **DONE (stale comment)** — raw
    JSON Schema is handled in `shared/internal/jsonSchema.ts` (`asStandardSchema`), consumed by
    `router.ts:318,330`; comment rewritten to point there. Ref: `shared/StandardSchema.ts`.
19. **Hydration (Stage 2) tracked follow-ups** — accepted limitations, not blockers:
    - **Module-level non-deterministic `state()` desyncs under a warm server** — `<script module>`
      setup memoizes once/process, so warm renders don't re-record its initials → ordinal misalign.
      Instance state is deterministic. Fix = decision-10 render-lifecycle hook (cache cold-render
      module recordings, prepend to every seed with a phase boundary; client consumes module vs
      instance ordinals). Ref: `server/internal/pages.ts`, `ui/internal/seededState.ts`.
    - **Cheap-check blind spots** (decision 5, by design): same-tag wrong-content and wrong-tag on a
      purely-static container aren't detected → silent until first update.
    - `{#for await}` hydration is create-fallback (re-iterates a fresh async iterator), not same-node
      claim. `{#switch}` `leading` region and purely-static block bodies are created, not claimed.
      Component `{children()}` claimed only for emitted/pass-through components.
18. ~~**Emitter: contextual-keyword template identifiers not rewritten**~~ **FIXED (#18).** A bare
    template identifier whose name is a TS *contextual keyword* tokenizes as a keyword, so the
    free-identifier passes skipped it → `$scope.<name>` never emitted → `ReferenceError` at mount.
    `analyzeScope.ts` now carries a curated `SAFE_VALUE_KEYWORDS` allowlist + `isIdentifierLike(kind)`
    used by the binding collectors AND `collectFreeIdentifiers`/`rewriteFreeIdentifiers`, so
    allowlisted safe contextual keywords (`accessor`, `type`, `object`, `module`, `number`, … — value
    identifiers with no operator role) rewrite to `$scope.<name>` and keyword-named local bindings are
    shadowed correctly. **Deliberately an allowlist, not a range check:** the DANGEROUS contextual
    keywords that carry expression/operator/declaration meaning — `await`, `async`, `as`, `satisfies`,
    `of`, `get`/`set`, `using`, `keyof`, `infer`, `is`, `asserts` — are EXCLUDED so `{await fn()}`,
    `x as T`, `for (a of b)`, `{ get x(){} }` are never misread. Missing a safe one only leaves the rare
    bug; wrongly including a dangerous one would break real syntax. Verified: unit
    (`emitCapabilities.test.ts` — safe keywords resolve, keyword-named binding stays lexical, `{await}`
    not rewritten) + full docs e2e (87/87, the emitter touches every page). Ref: `ui/internal/analyzeScope.ts`.
    Out of scope (noted): a *cell* named with a keyword (`let type = state(...)` then a bare `{type}`
    write) — cell-ref matching still keys on `K.Identifier`; extremely rare.
20. **CSS bundling + Tailwind in the build; `import "./x.css"` from pages.** DECIDED (direction):
    tailwind is part of abide's bundling process, and a page/component can `import "./styles.css"`.
    `Bun.build` emits imported CSS as an `asset` output and `bun-plugin-tailwind` processes
    `@import "tailwindcss"` (both verified). Wiring: the emitter must PRESERVE `.css` (side-effect)
    imports in the emitted CLIENT module (today all imports are stripped → Bun.build never sees the
    CSS); `clientBundle.ts` adds the tailwind plugin (optional/dynamic) + collects the CSS asset;
    serve `/__abide/client.css` (router) + `<link rel="stylesheet">` in `renderDocument`'s head;
    tailwind content scanning of `.abide` files via `@source` globs in the app CSS. **Done + wired
    into the docs app** (root `layout.abide` imports `app.css`; `/__abide/client.css` served + linked).
    ~~Follow-up: abide should SHIP an ambient `declare module "*.css";` in its app type surface~~
    **DONE (#20/#21 follow-up)** — see #21 below (one shipped ambient file covers `*.css` + `*.abide`).
    ~~Also #13's scoped `<style>` stamps the `data-ab` attr inconsistently (nav element unstamped →
    styles don't match).~~ **FIXED (#20/#13 emitter parity)** — root cause was a server/client
    ASYMMETRY, not the CSS pipeline: the CLIENT emitter baked the `data-ab-<hash>` scope attribute onto
    every element (`templatePlan.staticAttrString`) but the SERVER emitter stamped NONE, so the
    rewritten selector `.a[data-ab-<hash>]` matched nothing during SSR / no-JS / after hydration (only a
    fresh client mount applied the styles). `emitServer.genElement` now stamps the same attr
    (`$rt.applyStatic($a, "data-ab-<hash>", null)` → bare attr, byte-matching the client skeleton),
    threaded via a new `scopeAttr` field on the `element` `ServerChunk`. Component/block roots are
    anchor pairs (not elements) so neither side stamps them — scoped styles correctly don't cross a
    component boundary. Guards: a new `style scoped element` emit-oracle fixture (server + client
    snapshots now BOTH carry the attr) + an `emitHydrate.test.ts` SSR→hydrate guard. Refs:
    `ui/internal/{templatePlan,emitServer,emitFixtures}.ts`, `ui/internal/emitHydrate.test.ts`.
21. **Components as `.abide` files** — **DONE.** `import Card from "./Card.abide"` + `<Card>` now
    works like an inline `{#snippet}`, in a shared reusable file. Design: `docs/spec/component-files-
    plan.md`. Each `.abide` module emits a `default` component adapter reusing its own `mount`/`render`;
    `.abide` imports stay real ES imports with rewritten specifiers, so `Bun.build` (client) +
    dynamic-import (server) resolve the graph (nested components, CSS-in-component, RPC-in-component,
    `<script module>` — all free). Hydration + seed ordinals work byte-for-byte (no new machinery);
    fully backward-compatible. 815 tests green; docs migrated 27 pages to one shared `Sample.abide`.
    Refs: `ui/internal/{analyzeScope,emitClient,emitServer,emitSetup,runtime,emit}.ts`,
    `server/internal/{clientBundle,pages}.ts`. ~~**Follow-up:** abide should SHIP ambient
    `declare module "*.abide";` + `declare module "*.css";` in its app type surface~~ **DONE** — abide now
    ships a single canonical `packages/abide/ambient.d.ts` (declares both `*.css` and `*.abide`), exposed
    via the package `types` field + `exports["."].types`. Apps pull it in with a one-line
    `src/abide-env.d.ts` containing `/// <reference types="abide" />` — `abide scaffold` writes it for new
    apps, and the docs app dropped its hand-written `globals.d.ts` for it (verified: `bun run --filter docs
    typecheck` green; a probe `.ts` importing `./x.css` + `./Foo.abide` errors WITHOUT the reference and
    passes WITH it). Refs: `packages/abide/ambient.d.ts`, `packages/abide/package.json`, `cli/main.ts`
    (`scaffold`), `packages/docs/src/abide-env.d.ts`.

22. **Docs sample-coverage audit — findings.** A capability→sample audit (docs dogfooding, every
    CLAUDE.md API item) drove real conformance fixes and surfaced framework gaps:
    - **NEW dogfood samples (this session, closing two undogfooded capabilities):** (1) **scoped
      `<style>`** (#13/#20) — `pages/styling/page.abide` + `e2e/styling.spec.ts` assert the scoped rule's
      computed style actually applies after SSR+hydration and the element carries `data-ab-*` (would
      have failed before the #20 server-emitter fix; docs had ZERO `<style>` blocks before). (2)
      **multipart file uploads** (#8 + text-field follow-up) — `server/rpc/rpcUpload.ts` +
      `pages/uploads/page.abide` + `e2e/uploads.spec.ts` drive a real browser FormData upload: a valid
      file+caption succeeds, and a valid file with an EMPTY caption is rejected by the `input` schema
      (proving multipart TEXT-field validation). Both wired into the sidebar (`layout.abide`).
      ~~Note: `bind:element={cell}` (node-ref form) did NOT surface a file `<input>`'s live `.files`;
      the documented attach-fn form (`bind:element={fn}`) did — possible latent bind:element-cell gap.~~
      **FIXED.** Root cause: `templatePlan.ts` explicitly EXCLUDED `element` from the bare-cell
      `{get,set}` accessor wrap (the same wrap #14 added for `bind:value`), so `bind:element={node}`
      over a `let node = state(null)` collapsed to `node.read()` — a VALUE (null), never a settable
      accessor — and `bindElement` no-op'd (abide cells are `.read()/.write()`, not the callable+`.set`
      signal shape its cell branch expected). Fix: (a) `templatePlan.ts` now wraps a bare cell for
      `element` too; (b) `runtime.ts bindElement` accepts the `{get,set}` accessor shape (via
      `boundAccessor`) — writes the node in, clears it (`read()===element` guard) on teardown; the
      attach-fn and legacy callable-signal branches are unchanged. Verified: unit regression
      (`emitCapabilities.test.ts` "assigns the node to a bare state() cell") + docs dogfood (the
      bindings "node ref cell" sample now uses the true bare-cell form, `refNode` attach-fn workaround
      deleted) + real-browser e2e (`bindings.spec.ts` node-ref, SSR+hydration, 14/14). Refs:
      `ui/internal/{templatePlan,runtime}.ts`.
    - **DONE (implemented during the audit):** `fn.raw` / `fn.isError` / `fn.refreshing` / `fn.watch`
      were documented but unwired — now on the server `Rpc` + client proxy (`makeRpc.ts`,
      `clientProxy.ts`), tested (`rpc.test.ts`). `pageCallable` (`server/internal/pages.ts`) now
      forwards the FULL read surface (it silently dropped `watch/refreshing/amend/raw/isError/snapshot/
      seed` on the SSR side → `undefined` in templates). Distinct samples added across the docs for the
      whole RPC call surface + `cache:{tags,shared,ttl}` + global `invalidate/refresh/pending({tags})`
      + PUT/PATCH/DELETE split + component-prop spread + `middleware` onion + `log.channel`.
    - ~~**FRAMEWORK GAPS (documented in CLAUDE.md, NOT implemented):** `state.share`/`state.shared`;
      `done(iterable)`; `online()`/`bundled()` in a template.~~ **ALL DONE.**
      - **M3b module-swap resolution** shipped: non-scope-provided `abide/shared|ui/*` imports in a
        page `<script>` are now emitted as REAL ES imports (classified by specifier in `analyzeScope.ts`,
        re-emitted by `emitServer`/`emitClient`, resolved to absolute paths for `Bun.build` in
        `clientBundle.ts`); scope primitives (`state`/`props`/`route`/…) still route through `$scope`.
        This unblocks `online()` / `bundled()` (and any shared/ui util) called directly in a template.
        Sample: `platform/observability` (online()/bundled() incl. offline-toggle reactivity e2e).
      - **`done(iterable)`** implemented (`shared/done.ts` + `shared/internal/iterableDone.ts`): a
        reactive completion probe a `{#for await}` flips when its stream drains (client + server marks).
        Sample + e2e: `control/async` (`done-status` streaming→complete + restart).
      - **`state.shared(key, initial)`** implemented (`ui/state.ts`): a writable cell shared by key
        across component instances (one backing signal) and synced across tabs via `BroadcastChannel`;
        server-isolated per-render (no cross-request leak). Plumbed through `recordingState`/
        `seededState`/`analyzeScope.cellKind`. Sample + e2e: `reactivity/demo` (`SharedTally.abide`,
        cross-instance + cross-tab). `state.share` was never designed — dropped from CLAUDE.md.
      - Doc-accuracy fixes from the audit: `abide/server/cell` → `abide/shared/cell` (wrong path);
        `abide/server/appDataDir` + `abide/shared/withJsonSchema` implemented (were documented-only).
        **Follow-up:** a public `abide/server/render(path, params?, query?)` → HTML string is still
        unimplemented (needs ambient app-config + route matching, not just a doc entry) — removed from
        CLAUDE.md pending that; internal SSR is `server/internal/pages.ts renderPage`.
    - ~~**PRE-EXISTING (not audit-caused):** the `/sockets` HTTP-face **SSE subscription drops**.~~
      **FIXED.** Root cause: Bun's default 10s `idleTimeout` killed the byte-idle SSE stream (reproduced:
      `[Bun.serve]: request timed out after 10 seconds`). Fix: `idleTimeout: 255` on `Bun.serve` +
      a 15s heartbeat/comment-ping and a `cancel()` handler (also fixes a subscriber leak) in
      `server/sse.ts`. The 3 quarantined `sockets.spec.ts` tests are un-`fixme`d and green.
    - **Attribute-value interpolation (found while reviewing the docs headers):** `{expr}` inside a
      QUOTED attribute value (`title="Count: {n}"`, and the Sample `title="…{'{'}…"` headers) rendered
      literally — abide only interpolated element content and `name={expr}` whole-value form. **FIXED**
      by implementing it: `templatePlan.ts` (`splitAttrValue`/`planAttribute`) splits a quoted value into
      literal + `{expr}` parts and compiles to a reactive `expr` attribute (exact `{x}` ≡ `name={x}`;
      mixed → forced-string concat), reusing the existing attr path so it works on element attrs AND
      component props with SSR+hydration; `parse.ts` `readQuotedValue` is now brace-aware (a delimiter
      quote may appear inside `{…}`). Unit tests (`emitCapabilities.test.ts`) + e2e (`rpc.spec.ts` header
      assertion). Docs headers now render `{await fn()}` via the natural `{'{'}` escape.

## Design-level parked (see each spec's `## Deferred / parked`)
`docs/spec/*.md` carry the design-level parked items, e.g.: socket **backplane** (horizontal
scaling, sockets.md S3.3), **lazy-mount islands** (abide-compiler C2), **`canSubscribe`** predicate
(sockets S4), **per-user token rotation/revocation** (auth AU9), **MCP streaming tail** vs snapshot
(machine-surfaces MS2.2), **scroll restoration / `keepScroll`** (abide-compiler), **inspector
contents** + client-log shipping + metrics (config-observability CO2), **desktop native webview**
(bundle.md — currently a best-effort launcher), primitive/`AsyncCell` naming polish.

## Consciously-accepted tradeoffs (documented, not "bugs")
From the adversarial review — recorded so they're deliberate:
- **Shared cache unbounded by default** (env `ABIDE_MAX_SHARED_CACHE_SIZE` is the opt-in bound).
- **Single-process sockets** — cross-instance cache-coherence/chat needs a backplane.
- **Sealed-token revocation** = expiry + `ABIDE_IDENTITY_SECRET` rotation only (no denylist); roles
  frozen in the token until `exp`.
- **Every nav hits the server** (no fully-client nav opt-out).
- **Client per-session cache never evicts.**

## Test-coverage gaps
- Runtime-only capabilities (agent, CLI/build, `createTestApp`, raw HTTP) are covered by
  `packages/abide` `bun test`; browser-facing ones by `packages/docs` Playwright. The **browser
  bundle-execution** lane is guarded by `browserBundle.test.ts` (subprocess happy-dom) — a good
  start on the "browser e2e for abide itself" the docs review flagged.
- ~~**Docs e2e is flaky under `fullyParallel`** — pages compile `.abide` on first hit, so the first
  parallel wave of workers races the on-demand compile and intermittently times out.~~ **FIXED** —
  `serve()` now pre-compiles every page + layout (and their `.abide` component trees) before accepting
  traffic via `warmPages(config)` (`server/internal/pages.ts`), priming `SERVER_MODULE_CACHE` so the
  first request to each route hits a warm cache instead of racing the ~13ms/page on-demand AOT compile
  (measured: cold 12.7ms → warm 0.01ms, whole docs app warms in ~68ms at boot). Compile-only (no request
  scope) and resilient (a broken page is logged + skipped, never blocks boot); also re-warms on the dev
  rebuild and removes first-hit latency for `abide dev`/`start`. Regression tests: `pages.test.ts`
  (`Bun.peek` settled-proof that warm primed the cache + the broken-page resilience path). 872 tests +
  tsc green; real docs SSR smoke served 5/5 routes with the 43 KB page rendering in 5ms on first hit.
  Refs: `cli/serve.ts`, `server/internal/pages.ts`.
- ~~**3 `/sockets` SSE tests fail** (see #22)~~ **FIXED** — Bun default `idleTimeout` killed the
  byte-idle SSE stream; resolved with `idleTimeout: 255` + a heartbeat in `server/sse.ts`. Tests green.
- **`abide` on PATH may resolve to a different sibling repo** (`~/Code/abide`) in some shells; use the
  workspace bin (`packages/docs` `bun run abide-check`, or `bun run ../abide/src/lib/cli/bin.ts`).
