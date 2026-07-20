# Stage 1 implementation plan — the shared AOT `.abide` emitter

Concrete plan for Stage 1 of the compiler rewrite (TODO #1 + #13 folded in). Stage 2 (#2
hydration) builds on this. Companion to `docs/spec/attach-hydration-design.md`. Every `file:line`
below is an anchor in the current code.

## 0. Orienting facts (current code)

- Two interpreters walk the same `Root` AST (`ui/internal/ast.ts:265`) and return closures:
  `compileServer` (`renderServer.ts:604`) builds an HTML string; `compileClient`
  (`renderClient.ts:1067`) builds DOM + wires `effect()` (`shared/internal/reactive.ts:273`).
- Both resolve template expressions via `new Function("$s","with($s){ return (${expr}) }")`
  (`renderServer.ts:59`, `renderClient.ts:66`) — the eval/`with` to eliminate on the client.
- `<script>` execution is a THIRD `new Function`+`with`: `compileRunner` (`assembleCore.ts:102`), fed
  by the TS7-scanner transform `transformScript` (`transformScript.ts:167`). `$def` installs get/set
  accessors so a bare `count` proxies a signal (`assembleCore.ts:57`) — this is why `with` is
  currently unavoidable.
- SSR: `renderPage` (`server/internal/pages.ts:73`) → `assemble(source)` (`assemble.ts:26`) cached in
  `PAGE_CACHE`. Seed: `collectSeed` (`pages.ts:96`) reads `rpc.snapshot()` after render.
- Client: `clientBundle.ts:74` inlines `{source, prepared}` JSON, `Bun.build`s it; the browser
  RE-PARSES source at runtime via `mountPrepared` → `parse` + `compileClient`. So `parse.ts`,
  `renderClient.ts`, `assembleCore.ts` all ship to the browser today.
- Seed replay: `bootstrap.ts` `readSeed`/`replayReads` push recorded reads into RPC cells
  (`clientProxy.ts:85` `.seed`) BEFORE mount.
- Gates: `bundleSize.test.ts` asserts no `SyntaxKind`/`typescript` in the bundle, `< 150 KB`, and
  `toContain("bootstrapPage")`; `clientBundle.test.ts` asserts `toContain("Home")`;
  `browserBundle.test.ts` executes the real bundle in happy-dom.

**Key consequence:** script-cell semantics can't be lexical without reference rewriting. `let n =
state(0)` where `n++` hits a signal has no eval-free, `with`-free form unless every `n` read →
`n.read()` and write → `n.write(...)`. This reference rewrite is the core new work of Stage 1
(`transformScript.ts:28` explicitly avoids it today).

## 1. New module layout

Build/SSR-time modules use the TS7 scanner and NEVER ship to the browser. Only `runtime.ts` and the
emitted module strings reach the client.

- **`ui/internal/runtime.ts`** (NEW, ships to browser, TS7-free, tiny) — DOM + reactivity helpers the
  emitted client code calls, **lifted verbatim** from `renderClient.ts` (keyed reconciler, await/if/
  for/switch/try, binds, thenable/Mountable interpolation). Cursor helpers `firstChild`/`nextSibling`
  authored **dual-mode-ready**: Stage 1 walks a cloned template, Stage 2's identical calls walk
  server DOM (the claim walk). Signatures include `template`, `finalize`, `interpolate`, `awaitText`,
  `htmlBlock`, `setAttr`, `toggleClass`, `setStyleProp`, `listen`, `spread`, `bindValue/Checked/
  Group/Element`, `ifBlock`, `forBlock`, `awaitBlock`, `switchBlock`, `tryBlock`, `component`,
  `escape`, `text`, re-exports `effect/untrack/signal`. `BlockFn = (parent, anchor) => () => void`.
- **`ui/internal/analyzeScope.ts`** (NEW, build/SSR only, TS7) — extends `transformScript.ts`;
  enumerates bindings + rewrites cell references. `analyzeScope(root): ScopeAnalysis` with
  `{ module, instance, cellNames, declared }`; `rewriteCellRefs(code, cellNames)`;
  `collectFreeIdentifiers(expr, declared)`.
- **`ui/internal/templatePlan.ts`** (NEW) — the **single shared walk**. `buildPlan(root, analysis):
  TemplatePlan` decides comment anchors ONCE (drift impossible). `TemplatePlan = { skeletonClient,
  serverChunks, slots, scopeAttr, scopedCss }`; `DynamicSlot = { kind, path:number[], expr, meta }`
  where `path` is firstChild/nextSibling steps and `expr` is already cell-ref-rewritten. Blocks get
  paired `<!--[-->…<!--]-->`; interp/await/html get one trailing `<!---->` (matches
  `renderClient.ts:322`).
- **`ui/internal/emitClient.ts` / `emitServer.ts`** (NEW) — `emitClientModule(plan, analysis):
  string` / `emitServerModule(...)`. Emit ES-module strings with real
  `import * as $rt from "abide/ui/internal/runtime"` and lexical identifiers.
- **`ui/internal/emit.ts`** (NEW, façade replacing `assemble.ts`) — `emitModuleSource(source): {
  client, server }` (used by `clientBundle.ts`); `loadEmitted(source): Promise<EmittedModule>`
  (used by SSR; parse→analyze→plan→emit→instantiate, cached).

## 2. Scope analysis — killing `with($s)`

Emitted functions take one merged `$scope` object (same shape `assembleCore.ts:128` builds today):
- Script imports → `const state = $scope.state, greet = $scope.greet;` at setup top (reuses
  `ImportBinding` + "must import everything" rule).
- `state`/`computed`/`linked` cells → emitted as real `let n = state(0)`; every reference (script +
  template) rewritten: read `n`→`n.read()`, `n = x`→`n.write(x)`, `n += x`→`n.write(n.read()+x)`,
  `n++`→`n.write(n.read()+1)`. **The one new hard transform**, built on the same TS7 scanner
  `transformScript.ts:168` uses; cells recognized syntactically at declaration.
- Plain `const`/`function` → verbatim (real lexical names now).
- `const {who} = props()` → verbatim; `props` is `const props = $scope.props`.
- Free template identifiers (not declared, not a JS global) → `$scope.x` at the reference site inside
  the effect (preserves getter-backed reactivity for the raw-scope test fixtures; never appears in
  real pages, so it doesn't undermine #11 type-flow).
- `<script module>` → memoized lazy `$ensureModule($scope)` at emitted-module top level (mirrors
  `assembleCore.ts:133`). Instance `<script>` emits inside `render`/`mount`.

`analyzeScope` replaces `transformScript`'s role; `transformScript.ts` stays until PR8.

## 3. Emit format (worked example)

Source: `<script>import { state } from 'abide/ui/state'; import greet from '../rpc/greet'; let n =
state(0)</script><p>{await greet({name:'x'})}</p><button onclick={()=>n++}>{n}</button>`

Plan skeleton: `"<p><!----></p><button><!----></button>"`; slots = `[await @ [0,0]], [event onclick @
[1]], [interp n @ [1,0]]`.

**Emitted client** — clone template, walk cursor, wire helpers; `n`/`greet`/`state` are real lexical
identifiers; `n++` emitted as `n.write(n.read()+1)`; exports `mount($target,$scope)` returning a
disposer, plus a **Stage-1 stub `hydrate($container,$scope)` that clears + calls `mount`**. No
`new Function`, no `with` → type-checkable (#11 target).

**Emitted server** — read from the SAME plan so anchors match byte-for-byte; builds a string with
`$rt.escape($rt.text(await greet(...)))` + `<!---->` etc.; `onclick` omitted server-side
(`renderServer.ts:283`). Output: `<p>hi x<!----></p><button>0<!----></button>`. The RPC read runs
in-proc through the request-scoped `pageCallable` (`pages.ts:42`), so `collectSeed` still sees it —
**the seed mechanism is untouched by the emitter.**

## 4. Client-bundle rewiring

- `clientBundle.ts`: replace `preparedPages`/`entrySource`; per page call `emitModuleSource(source)
  .client`, write to temp file (existing pattern), generate an entry that `import`s each page's
  `mount`. RPC-spec harvesting stays, keyed off `analysis.*.imports`.
- `pageRegistry.ts`: `PageEntry` `{source, prepared}` → `{ mount }`.
- `bootstrap.ts`: keeps the entire seed/imports contract (`readSeed`, `replayReads`, `imports.route/
  url/navigate`, container clear); only the final line changes to `entry.mount(container, scope)`
  instead of `mountPrepared(...)`. Fresh mount stays (claim stubbed).
- `navigate.ts`: unchanged in spirit; `innerHTML = envelope.html` + fresh mount stays (soft-nav→
  hydrate is Stage 2).
- Deleted at cutover: `mountPrepared.ts`, `assembleCore.ts`; `parse.ts` + `renderClient.ts` stop
  shipping to the browser. Update `bundleSize.test.ts` (`toContain("bootstrapPage")`) and
  `clientBundle.test.ts` (`toContain("Home")`) assertions; bundle shrinks.
- Seed path unchanged: `collectSeed`/`renderDocument`, `readSeed`/`replayReads`, `clientProxy.seed`,
  envelope seed.

## 5. #13 scoped styles (emit-time, in `buildPlan`)

1. On `root.style`, compute `scopeAttr = "data-ab-" + hash(source)`.
2. Stamp every emitted element start tag with it — in BOTH the client skeleton and server chunks,
   from the one plan (they match).
3. New `scopeStyles(css, scopeAttr)` helper rewrites each selector (append the attribute selector),
   replacing the no-op `compileStyle` (`renderServer.ts:472`, `renderClient.ts:406`). Emit as a
   static `<style>`.
4. Nested `<style>` (C9.2) uses the same helper per branch sub-plan; ship root-scope in Stage 1,
   nested-scope as a fast-follow (the recursion hook exists).

## 6. Regression-oracle harness

New `ui/internal/emit.oracle.test.ts`. Corpus = the exact source strings already pinned in
`renderServer.test.ts` / `renderClient.test.ts` / `assemble.test.ts` (extract into a shared
`FIXTURES`). `stripAnchors(html)` removes `<!---->`/`<!--[-->`/`<!--]-->` for parity vs the
anchor-free interpreter. Assert: server parity (`stripAnchors(renderEmitted)` deep-equals
`renderAbide`), client parity (mount both into two hosts, compare `innerHTML` after mount AND after
each interaction/signal update), assemble-level parity for script-bearing fixtures. Keep both
interpreters in tree until green across the full corpus, then delete. Extend `browserBundle.test.ts`
(existing interactivity + seed-replay subprocess tests) as the end-to-end proof; add a no-flash
assertion stub for Stage 2.

## 7. Sequenced, PR-sized breakdown (each keeps `bun test` green)

> Progress: **PR1 ✅** (`runtime.ts` extracted, TS7-free; interpreter delegates; 588/0).
> **PR2 ✅** (`analyzeScope.ts` + `rewriteCellRefs` + `collectFreeIdentifiers`; 75-test suite incl.
> 500-case fuzz; 663/0). **PR3+PR4 ✅** (combined — `templatePlan`/`emitServer`/`emitClient`/`emit`
> + `emitSetup`/`serverRuntime`; regression oracle at 149/0 diffing emitted-vs-interpreter across the
> full fixture corpus incl. post-interaction DOM; #13 scoped styles emitted; full suite 812 pass, 1
> skip = intentional #13 style-scoping divergence; tsc clean; nothing wired into pages/bundle yet).
> **PR6 ✅** (SSR cutover behind reversible `ABIDE_EMIT_SSR` flag, default OFF; added DOM-free
> `loadEmittedServer` so SSR never imports the client module; emitted server HTML is anchor-free +
> byte-identical to interpreter; seed intact flag-ON; 819 pass BOTH flag states, tsc clean).
> **PR7 ✅** (client bundle boots from AOT-emitted per-page `mount`s via `bootstrapPage(mount,…)`;
> seed/replay contract intact; both real-browser subprocess tests green incl. no-refetch;
> independently verified bundle = 32 KB, TS7-free AND interpreter-free — `parse`/`renderClient`/
> `mountPrepared`/`typescript` all absent; 819 pass, tsc clean).
> **PR8 ✅ — STAGE 1 COMPLETE.** SSR is emitted-only (`ABIDE_EMIT_SSR` flag removed); interpreters +
> `transformScript`/`assembleCore`/`mountPrepared`/`assemble` deleted; oracle converted to an
> emitted-output snapshot regression over the fixture corpus; interpreter-test capabilities ported to
> `emitCapabilities.test.ts` (audited, no coverage lost); 696 pass / 0 fail, tsc clean, browser 2/0.
> Two honest notes: (1) accepted §2 divergence — a bare *template* identifier resolves off `$scope`
> and no longer throws when unimported (the `<script>` "must import" guarantee still holds); (2)
> latent pre-existing edge case — a bare template identifier named like a TS *contextual keyword*
> (e.g. `accessor`) tokenizes as a keyword so `analyzeScope` doesn't rewrite it to `$scope.x` →
> ReferenceError at mount. Doesn't affect real pages; tracked as TODO #18.

**Stage 1 done → Stage 2 (TODO #2 hydration proper) is now unblocked:** fill the emitted `hydrate()`
stub with the claim walk over server DOM (the `firstChild`/`nextSibling` cursor helpers are already
dual-mode), suppress-initial-write, state-initializer record/replay, localized mismatch recovery, and
the soft-nav→hydrate unification. See `docs/spec/attach-hydration-design.md`.

1. **PR1 — Extract runtime helpers** into `runtime.ts`; refactor the interpreter to call them. Pure
   refactor. *De-risks everything — the hard DOM logic is reused, not rewritten.* ✅
2. **PR2 — `analyzeScope.ts` + `rewriteCellRefs`**, unit-tested in isolation. **Riskiest correctness
   unit** (cell-ref rewriting) — isolate and fuzz here. ✅
3. **PR3 — `templatePlan.ts` + `emitClient.ts` + `emitServer.ts`**; snapshot tests only.
4. **PR4 — Oracle**, full-corpus parity gate. **Riskiest breadth** (every node kind).
5. **PR5 — Scoped styles (#13)** in plan+emit + fixtures.
6. **PR6 — Server cutover.** `emit.ts` `loadEmitted`; point `pages.ts`/`assemble.ts` façade at
   emitted server modules; interpreters stay. **Riskiest integration** (SSR exec + seed) — reversible
   behind a flag. SSR instantiates the emitted server module via cached dynamic import; the fully
   eval-free end state (generated `src/.abide/*.ts`) is a later build-pipeline slice.
7. **PR7 — Client cutover.** `clientBundle.ts` emits+bundles client modules; `pageRegistry`/
   `bootstrap`/`navigate` switch to `entry.mount`; update bundle-assertions; run browser lane.
   **Riskiest client.**
8. **PR8 — Delete + fold.** Remove `renderServer.ts`, `renderClient.ts`, `assembleCore.ts`,
   `mountPrepared.ts`; fold remaining `transformScript` into `analyzeScope`; retire the interpreter
   test files.

## 8. Out of scope (Stage 2) + where stubs live

- Claim/hydrate walk → `emitClient.ts` emits `hydrate()` that clears + calls `mount` in Stage 1;
  `firstChild`/`nextSibling` authored dual-mode so Stage 2 fills it with the cursor walk over server
  DOM.
- Suppress-initial-write, state-initializer record/replay (leave a `state`-init wrapper seam),
  island skipping (analysis kept, no markers), event delegation (Stage 1 uses direct `listen`),
  soft-nav→hydrate unification, localized mismatch recovery + normalization guard — all Stage 2.

## Critical files
`renderClient.ts` (runtime helpers + client emit source) · `transformScript.ts` (basis for
`analyzeScope`) · `assembleCore.ts` (the `with`/`$def` machinery being replaced) · `clientBundle.ts`
(client cutover) · `server/internal/pages.ts` (server cutover + seed path that must not regress).
