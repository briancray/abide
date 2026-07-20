# abide — build plan

> Remaining work + shortcuts to fix: docs/TODO.md (consolidated).

Implementation roadmap. Specs are authoritative in `docs/spec/*.md`; `CLAUDE.md` is the public
API reference. Build bottom-up: each milestone is independently testable with `bun test` before
the next depends on it.

## Conventions (all code)
- Bun + web standards; Bun APIs over Node. TS runs natively under Bun — no build step for libs.
- `src/lib/{shared,server,ui,test}/` — one export per file, named after the export (`GET.ts` exports `GET`).
- Public import surface: `abide/shared/*`, `abide/server/*`, `abide/ui/*`, `abide/test/*` (see package.json exports + tsconfig paths).
- Internal (non-public) helpers live under `src/lib/<layer>/internal/`.
- Tests colocate as `*.test.ts` next to the module; run `bun test`.
- Monomorphic objects, simple loops, descriptive names, terse why-comments (per CLAUDE.md guidelines).

## Milestones

### M1 — spine (in-process; no server/bundler) ← current
- `shared/internal/reactive` — fine-grained signals: `signal`/`computed`/`effect`/`batch`/`untrack`; push-notify + pull-recompute, microtask-batched, glitch-free (rpc-core §7).
- `shared/internal/codec` — `canonicalKey(v)` (deterministic keyer) + `encode`/`decode` rich value codec for **hydration only** (Date/Map/Set/BigInt/RegExp/TypedArray/circular); RPC wire is JSON (rpc-core §4/§11).
- `shared/internal/context` — ambient cache context: per-request (AsyncLocalStorage, server) / per-session singleton (client); `getContext()`/`runIn` (rpc-core §2).
- `shared/cell` — the memoizer: `cell(asyncFn, opts)` → smart read callable + `.peek/.pending/.error/.refresh/.invalidate/.amend/.watch`; slot state machine `idle→pending→value|error` (+refreshing); coalescing by `canonicalKey`; TTL; partial-object invalidation (rpc-core §1–3, §7.2, §8).

### M2 — server core
- `server/request`/`cookies`/`server`/`context` + `shared/route` accessors; Bun.serve host; router (`/rpc/<name>`); `server/json`/`error`/`redirect`/`jsonl`/`sse`; `GET`/`POST`/… wrapping a handler in a `cell` (in-proc dispatch first); onion `middleware`; `test/createTestApp`.

### M3 — isomorphism
- Bun.build pipeline + module-swap plugin (server specifier → synthesized client fetch proxy over the same `cell` surface); hydration payload (`<script type=application/json>`, record/replay); SSR streaming.

### M4 — `.abide` compiler (SYNTAX frontend only; types are TS7's)
- abide compiles only the `.abide` *syntax* (TS7/browser can't parse it) → client DOM-wiring module + server string-stream module (AOT); bindings/control-flow/components/snippets; `route()`; nav (three emission modes). Pattern = Svelte/Vue/JSX: framework owns syntax+codegen, delegates types.
- **All type work is TS7-driven:** generate-TS-then-check (C10), type→JSON-Schema derivation (§11), `abide check`/`lsp` on the TS7 language service. abide does NOT reimplement any type checking.
- **PREREQUISITE (validate before building the type layer):** confirm `typescript@7`'s programmatic API surface (compiler API / language service) callable from Bun — the native rewrite differs from TS 5.x `ts.createProgram`/`TypeChecker`/`LanguageService`; adapt the generate-TS/derivation mechanism to whatever TS7 exposes.

### M5+ — sockets, auth (sealed identity/tokens/CSRF), schemas + type-derivation, machine surfaces (openapi/mcp/cli), agent, config/observability, bundle, build pipeline, docs site.

## Status
- M0 scaffold: done (package.json, tsconfig, structure).
- M1 spine: DONE (reactive/codec/context/cell, 93 tests, tsc clean).
- M2 server core: DONE (scope, responses, middleware, RPC over cell, router, createTestApp; 146 tests, tsc clean).
- M7 auth: DONE (sealed identity, bearer/app-token ladder, rolling TTL, CSRF; 173 tests, tsc clean).
- M6 sockets: DONE (socket primitive, mux WS, HTTP face, tail, CSWSH; 193 tests, tsc clean).
- M8a validation: in progress (explicit Standard Schema; type-derivation M8b is TS7-API-gated).
- Order note: building browser-free server surface (auth, sockets, validation, machine surfaces) before compiler/isomorphism (M3-M5).

## TS7 programmatic API (resolved 2026-07-17)
The old `ts.createProgram`/`TypeChecker`/`transpileModule` API is GONE in TS7. The native rewrite
exposes a NEW (unstable) API:
- `typescript/unstable/sync` and `typescript/unstable/async` → `API`, `Program`, `Project`,
  `Checker`, `Symbol`, `Signature`, `Emitter`, `Snapshot`, type-flag predicates (`isObjectType`,
  `isUnionType`, `isTypeReference`, `TypeFlags`, `SymbolFlags`, `NodeBuilderFlags`, …).
- `typescript/unstable/ast` → `SyntaxKind`, `createScanner`, `getTokenAtPosition`, JSDoc helpers,
  factory/visitor/clone — for parsing/analysis.
Use this for M8b type-derivation (§11), M4 generate-TS-then-check (C10), and `abide lsp`.

## Status (cont.)
- M8a validation: DONE (Standard Schema input/output, ValidationErrorData 422; 202 tests, tsc clean).
- M8b type-derivation: DONE (TS7 unstable API works; JSON Schema validator; 240 tests, tsc clean).
- M9 machine surfaces: DONE (registry, OpenAPI 3.1, MCP JSON-RPC server; 251 tests, tsc clean).
- M4a .abide parser: DONE (recursive-descent, full grammar AST; 348 tests, tsc clean).
- M4b server render: DONE (AST -> SSR HTML; 413 tests, tsc clean).
- M4c client render: DONE (fine-grained DOM, keyed reconciliation, binds; 464 tests, tsc clean).
- M3a module assembly: DONE (script state-transform via with-scheme; reactive DOM proof; 489 tests, tsc clean).
- M5a server page SSR: DONE (assembler in router, full HTML doc, in-proc RPC reads; 493 tests, live smoke verified).
- M3b client bundle + module-swap: DONE (clientProxy, Bun.build browser bundle served, bootstrap mount; 503 tests, live-verified).
- M3b-fix: DONE (TS7 moved to build-time; client bundle 419KB->76KB, no typescript; 506 tests).
- M-CLI file-based app + dev/build/start: DONE (loadApp, abide dev/build/start/scaffold, live-reload; 513 tests; scaffold verified).
- M-config config+observability: DONE (env/log/trace/health/online/reachable; 533 tests; scaffold app boots end-to-end).
- Next: M8b type-derivation (TS7 unstable API) unblocks M9 machine surfaces; then browser trio M4/M3/M5.
- M5b nav: DONE (route params, Abide-Nav soft-nav, navigate/url, link interception; 542 tests; param route + fragment verified).
- M-agent agent surface: DONE (agent loop, frames, mock + Claude engine; 550 tests, tsc clean).
- M-bundle desktop API: DONE (bundled/BundleWindow/onMenu + abide bundle MVP launcher; 557 tests, tsc clean).
- FRAMEWORK CODE COMPLETE. Remaining: docs site (content project using abide).

## Monorepo (2026-07-18)
Restructured into a Bun workspace:
- root package.json: workspaces ["packages/*"]
- packages/abide/ — the framework (src/lib, package.json name "abide" with exports, tsconfig, bunfig). Tests: `cd packages/abide && bun test` (557).
- packages/docs/ — the docs site, a real abide app depending on "abide": "workspace:*" (dogfood).
- docs/spec/*.md + docs/BUILD.md stay at repo root (design docs; CLAUDE.md references them).
Bun resolves abide/* from workspace packages at runtime.

## Explicit imports + tree-shaking (2026-07-18)
Flaw: assembleCore.applyImports flat-spread ALL injected RPCs onto page scope, so pages called
RPCs without importing (no tree-shaking, implicit magic). Fix: pages must explicitly import
RPCs/sockets/accessors (state/watch/props stay ambient); client bundle proxies ONLY imported RPCs.

## DOC2: full capability coverage + Playwright e2e (2026-07-18, in progress)
Goal: docs app covers EVERY public export/capability (one live demo per capability), all driven
by Playwright e2e. Staged: (1) validate Playwright harness + capability manifest; (2) fan out
pages+specs per capability bucket; (3) full green e2e run. Runtime-only capabilities (CLI, compile)
stay in bun test; browser-facing ones are Playwright.

## Docs code blocks (2026-07-18, in progress)
Under each demo: a lightweight SSR-syntax-highlighted code block showing the REAL demonstrated code
(extracted from the actual .abide/.ts source via markers — DRY, always in-sync). That code is
formatted + linted (Biome) + type-checked (tsc for .ts; best-effort `abide check` for .abide scripts).
