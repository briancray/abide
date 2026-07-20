# Implementation plan — full `.abide` type-checking + language server (TODO #11)

Concrete plan to complete TODO #11: full template-expression type-flow (C10.2–6) and a real
`abide lsp` (not the diagnostics-only stub). Companion to `docs/spec/abide-compiler.md` (C10). Every
`file:line` is an anchor in the current code. This doc is the decision record from the design grill —
the resolved fork at each branch is stated with its rationale.

> **STATUS: IMPLEMENTED as PR1–6.** `abide check` does full template + cross-file type-flow; `abide lsp`
> is a full language server (diagnostics · hover · definition · completion · signature-help · references).
> The authoritative AS-BUILT record — including the six bugs end-to-end testing caught and the exact
> `file:line` refs — lives in **`docs/TODO.md` #11**. Where the build deviated from this plan: **§1.5**
> bare-`props()` shipped as a fully-OPEN `Record<string, unknown>` (the widened-default *synthesis* is
> deferred — TODO #11 "bare-props destructuring-synthesis"); the LSP runs `node lsp.ts` behind a Bun
> byte-pump forwarder (`bunCanHostTsgo()` gate); virtual paths are per-lowering *fresh revisions*
> (reused paths stay cached) with `closeFiles` for the prior one. The docs-clean gate also surfaced the
> RPC read-surface typing question → its own decision record in **`docs/spec/promise-read-model.md`**
> (`rpc(): Promise<T>` + drop `.load()`; spec'd, own PR series, not yet built).

## 0. Orienting facts (current code)

- `cli/check.ts` already type-checks `<script module>`+`<script>` bodies: it lifts them into a sibling
  `.ts` (HEADER + verbatim imports + declarations, rewriting `let/const/var x = <init>` →
  `let x = __abideUnwrap(<init>)` to model the `$def` accessor), type-checks via the TS7 `unstable/sync`
  `API` bridged through a `node` subprocess (`diagnose` → `diagnoseViaNodeSubprocess`, `check.ts:436`),
  and maps diagnostics back with a **verbatim-copy `Segment[]`** offset map (`buildGenerated`,
  `check.ts:202`; `mapGenToOrig`). It does NOT check template expressions (`check.ts:19-24`).
- `cli/lsp.ts` is the current stub: a diagnostics-only LSP that re-runs `check(dir)` on open/save
  (whole-project, one-shot) and publishes mapped diagnostics. Reuses `check()` — no second checker.
- The runtime emitters resolve free template identifiers to `$scope.<name>` (`emitClient.ts:22`) —
  **type-erasing**. So the runtime emit gives NO template types: "point `abide check` at the emitted
  TS" is false for template type-flow. `emitCheck` is a separate lowering.
- TS7 is **tsgo** (v7.0.2): the `unstable/sync` `API` spawns the tsgo binary and talks over a pipe
  (the reason it "can't open its pipe under Bun" → `check`'s node bridge). Verified surface:
  - `APIOptions.fs?: FileSystem` (`readFile`/`fileExists` callbacks) → **in-memory virtual buffers**,
    no temp files (`dist/api/fs.d.ts`, `options.d.ts`).
  - `Project.checker` exposes position queries: `getTypeAtPosition`, `getSymbolAtPosition`,
    `getCompletionsAtPosition`, `getReferencedSymbolsForNode`, `getResolvedSignature`, `typeToString`
    (`dist/api/sync/api.d.ts`). → diagnostics + hover + completion + definition + references +
    signature-help are ALL reachable through the API `check` already uses. A Volar-style proxy over
    tsgo's native LSP is UNNECESSARY.
  - `updateSnapshot({ fileChanges })` + `tsserverPath` → incremental snapshots over the bundled tsgo.
- `route().params` is `Record<string, unknown>` (`server/internal/scope.ts:21`); scope primitives
  (`state`/`props`/`route`/…) and every RPC are imported verbatim, so they carry abide's real shipped
  types with no special handling.

## 1. Resolved design decisions (the grill)

1. **Codegen** — a NEW dedicated `ui/internal/emitCheck.ts` typed-lowering is the single source of
   truth for BOTH `check` and `lsp`. Reuses `parse`→`analyzeScope`→`buildPlan`; emits a type-only
   module (never executed). `check.ts`'s current script-only generation becomes a subset.
2. **Engine + process model** — (A) node-does-all + a dumb Bun forwarder. `abide lsp` (Bun, from
   `bin.ts`) is a ~20-line byte pump to `node lspServer.ts`, which runs the LSP transport, `emitCheck`
   lowering, the `API`, and position mapping. The tsgo `API` is isolated behind a `TypeEngine`
   interface; `emitCheck`/`lspServer` are kept free of Bun- or node-only APIs (injected `read`/`write`
   + injected engine). A memoized `bunCanHostTsgo()` probe + `ABIDE_LSP_INPROCESS=1` override auto-
   upgrades to all-Bun the day Bun can host the pipe — revert is deleting the forwarder branch.
3. **Template lowering** — the block tree becomes nested TS so TS's own scoping/narrowing does the
   work. Each `{expr}` → synthetic `__ref(` + **verbatim expr** + `)`. `{#if}`→`if`, `{#for item,i of
   list}`→`for (const [i, item] of __entries(list))`, `{#await p}{:then v}{:catch e}`→`try { const v =
   await (p); … } catch (e) {…}`, `{#try}`→`try/catch`, `{#snippet foo(a)}`→`function foo(a){}` +
   `{foo(x)}`→`__ref(foo(x))`, cell `{count}`→`count` (already `T` via `__abideUnwrap`). RPC calls,
   type annotations (`as`/`satisfies`/`: T`/`!`/`<T>`), and narrowing all check for free.
4. **Cross-file component typing — IN v1.** Each `.abide` gets a stable virtual `.ts` path served by
   the `fs` overlay; `.abide` import specifiers rewrite to those virtual paths; each virtual module
   `export default`s a component typed by its props. TS module resolution handles the graph (cleaner
   than the runtime `emitTree`).
5. **Props contract — GRADUATED.** Explicit `props<T>()` → exact **closed** `T` (names/types/required
   all enforced; the lever for strictness). Bare `props()` + destructuring → **open, best-effort**:
   each destructured key optional; value type **widened** from its default (string/number/boolean
   literal → primitive; `[]`/`{}`/`null`/no-default → `unknown`); extra keys allowed. Near-zero false
   positives on real (bare-props) components; still value-checks what flows in.
6. **Children/snippets — ride the Q5 gradient.** No new machinery: a slot is "just a prop". Explicit
   `props<{ header: (a: string) => unknown }>()` → precise. Bare props → `{children()}` synthesizes
   `children?: () => unknown`; snippet slots are opaque `(...args: any[]) => unknown`. No bidirectional
   snippet-param inference in v1.
7. **Position map — bidirectional `Segment[]`, verbatim-copy invariant.** Segments monotonic in both
   `genStart` and `origStart` → one array answers gen→orig AND orig→gen by binary search. `emitCheck`
   may only WRAP user expressions in synthetic scaffolding, never rewrite INSIDE them (same rule
   `check.ts` follows). Cross-file results map via each file's own `Segment[]` (keyed by virtual path).
   No VLQ source map (tsgo answers by offset through the API; we map ourselves).
8. **Scope/route** — resolved by verbatim imports; `route().params` stays `Record<string,unknown>`.
   Per-route `[name]` `Params` synthesis is deferred (low value, params are strings).
9. **LSP feature set v1** = {diagnostics, hover, completion, go-to-definition, find-references,
   signature-help}. v2 = {rename, semantic tokens}. Rename is deferred because it is the only *write*
   feature — a mis-mapped edit corrupts source — so it needs the round-trip map proven first.
10. **Incremental** — on open/change/save re-lower ONLY the changed doc, update the in-memory virtual
    map, one `updateSnapshot({fileChanges})`, publish diagnostics for OPEN docs (tsgo re-checks
    dependents). Debounce `didChange` (~250–300 ms); `didSave` flushes. No temp-file churn.
11. **Synthetic-span diagnostics** — invariant: scaffolding is well-typed by construction, so user
    errors only land on verbatim spans. A diagnostic entirely inside synthetic text is RELOCATED to
    the nearest enclosing verbatim segment; if none, DROP + log (signals an `emitCheck` bug, not user
    code). Only the existing narrow `SUPPRESSED_CODES` (implicit-any noise) stay suppressed.
12. **Tests + gate** — golden lowering snapshots; source-map round-trip property (`orig→gen→orig`
    identity + every gen pos in a verbatim segment); semantic should-error/clean fixtures asserting
    exact `.abide` line/col; LSP integration tests (in-memory transport, real engine); and the HARD
    per-PR gate: `abide check packages/docs` **clean** + docs Playwright e2e + 853 unit tests green.
    Adjudication: real type bug → fix docs (dogfood); false positive → fix `emitCheck`; never
    blanket-suppress.

## 2. Formatting (out of #11 scope; roadmap only)

- **v2-cheap (safe):** format `<script>`/`<style>` bodies via Biome (already a dep); template +
  islands untouched. Decoupled from the type engine (needs only `parse` + Biome). HTML whitespace is
  output-significant → template reflow is deliberately excluded.
- **v3 (opt-in flag):** Biome's (experimental) HTML formatter + a placeholder-protection layer
  (islands/blocks → neutral placeholders → format → restore verbatim; `{#if}`→`<abide-block>` so
  children indent). Probed: raw feed mangles islands (`{count}`→`{ count}`), so protection is required.
  A *write* feature → gate behind reparse-equals property tests. No owned expression printer (protect
  verbatim; delegate to Biome if ever needed).
- Full template pretty-print: never via the type engine (standalone `.abide` printer only).

## 3. Adjacent finding (tracked, NOT in #11 scope)

The RUNTIME emitter rewrites TYPE-POSITION identifiers to `$scope.X` (`{(x as Foo).bar}` →
`(x.read() as $scope.Foo).bar`; `(i: Item)` → `(i: $scope.Item)`; `v satisfies string` →
`v satisfies $scope.string`). The intermediate `.ts` is not type-valid, but it is **harmless** — Bun
strips types syntactically at build/SSR before resolution. #18 excluded the operators (`as`/
`satisfies`) but not the type OPERAND after them. `emitCheck` is unaffected (verbatim copy, no
`$scope` rewrite). Fix (optional, low-pri): teach `analyzeScope`'s free-identifier pass to skip
type-position operands. Tracked in TODO.md.

## 4. Phasing (each PR gated per §1.12)

- **PR1** — `emitCheck.ts` INTRA-file typed-lowering + bidirectional `Segment[]` map + rewire `check`
  onto it. Headline win: RPC-arg-checking + loop/await/narrowing/annotations in templates. Round-trip
  property + golden + semantic fixtures. The stub `lsp` inherits richer diagnostics for free.
- **PR2** — CROSS-file component typing: virtual `.ts` graph via fs-overlay paths, typed component
  signatures, graduated props (§1.5), opaque slots (§1.6). Dogfoods the docs' shared components.
- **PR3** — `TypeEngine` seam + persistent node sidecar (`API` + `fs` overlay + snapshots) + dumb Bun
  forwarder + `bunCanHostTsgo()` probe; incremental live diagnostics (§1.10, §1.2). The "not a stub"
  transport upgrade.
- **PR4** — hover + go-to-definition (read-only, cross-file result mapping).
- **PR5** — completion + signature-help.
- **PR6** — find-references.

## 5. Deferred / parked

rename, semantic tokens, formatting (§2), per-route `[name]` param typing, bidirectional snippet-param
inference, the runtime type-position cleanup (§3). Each has a recorded rationale (write-risk / poor
cost-value / needs separate machinery).
