# Implementation plan — components as `.abide` files (import + `<Card>`)

Lets a page/layout/component `import Card from "./Card.abide"` and use `<Card prop={x}>…</Card>`,
exactly like an inline `{#snippet Card(props, children)}` but in a SHARED reusable file. Gates per PR:
`cd packages/abide && bun test` (805) + `bunx tsc --noEmit` clean, docs e2e 72/72.

## Core design
- **Keep `.abide` imports as REAL ES imports**, specifier rewritten to the compiled component module —
  NOT scope-injection. So the local `Card` stays lexical (`componentRef` already returns the bare
  name for `analysis.declared`); the only fix is to stop aliasing it from `$scope`
  (`emitSetup.ts:22-29`) and re-emit the real import. `Bun.build` (client) + dynamic import (server)
  resolve the graph → nested components, component-imports-component, per-component CSS/`<script
  module>` all FREE. (Scope-injection by local name would collide across `compose` levels.)
- **Each `.abide` module emits a trailing `export default` adapter** reusing its own `mount`/`render`:
  ```js
  // client
  export default (props, childrenFn, $parent) => ({ mount: (parent, anchor) => {
    const $s = Object.create($parent ?? null); $s.props = () => props; $s.children = childrenFn;
    return mount(parent, $s, anchor);
  }});
  // server
  export default async (props, childrenFn, $parent) => {
    const $s = Object.create($parent ?? null); $s.props = () => props; $s.children = childrenFn;
    return new $rt.Raw(await render($s));
  };
  ```
  Emitted for EVERY module (pages import `{mount,hydrate}`/`{render}` and ignore the default) — no
  filename-aware flag needed.
- **`$rt.component` gains a trailing `parentScope` arg** forwarded as the 3rd arg to `componentFn`.
  Inline snippet factories use rest params (`(...$args)=>`) and ignore it → backward compatible.
- **Contextual bindings inherit via `Object.create(parentScope)`** (mirrors `genSnippet`'s
  `Object.create($scope)` + `compose`'s child scope): the component's `state`/`watch`/RPC proxies/
  `route`/`url` are the SAME seeded/recording wrappers the page uses → hydration-seed `state(...)`
  ordinals stay aligned (document order on both sides).
- **Hydration works byte-for-byte**: the adapter's `mount(parent, childScope, marker)` runs the
  component's own instance setup then `$mount0`, which branches on `$rt.hydrating` and CLAIMS the
  server nodes bounded by the component's close marker — structurally identical to an inline snippet
  body mount. No new hydration code.
- **Lazy dir-relative resolution** (from the importer's `pageDirs`/`layoutDirs`, already populated) —
  no eager component scan, no `AppConfig` schema change.

## PRs (each keeps tests green)
- **PR1 — Emit component-mode + runtime `parentScope`** (compiler only). `analyzeScope`: classify
  `.abide` imports as `componentImports {local, specifier}` (still `declared`, excluded from the
  `$scope`-alias preamble, re-emitted as real imports). `emitSetup.importAliasLines`: skip component
  locals. `emitClient`/`emitServer`: emit the real `import Card from "<specifier>"` + the default
  adapter; pass `$scope` as the final arg to `$rt.component(...)` / `$c($props,$children)`.
  `runtime.component(...)`: optional `parentScope` param → 3rd arg to `componentFn`. Refresh oracle
  snapshots (extra arg + default export). Unit-test the adapter directly.
- **PR2 — Cross-file resolution in `loadEmitted` harness (parity proof).** Extend `instantiate`/
  `instantiateServer` (`emit.ts`) to resolve `.abide` imports: recursively emit the referenced source
  to a sibling temp module + rewrite the specifier (same technique as `resolveCssImports`). Add an
  optional resolver param to keep tests hermetic. **Core proof:** a shared `Component.abide` imported
  by two pages — render (SSR), hydrate (claims SAME server nodes, no clear), interactive `state`
  update; plus a control comparing a file-component page vs the equivalent inline-`{#snippet}` page →
  identical SSR HTML + identical claimed nodes.
- **PR3 — Production client bundle resolution** (`clientBundle.ts`). In `emitOne`/`emitModules`, walk
  each source's `componentImports`, resolve against `sourceDir`, emit the component via `emitOne`
  (dedup by abs path, recurse for component-imports-component), rewrite the specifier in the emitted
  client string. `Bun.build` follows the rest. Extend the RPC-spec harvest to include component
  analyses (an RPC used only in a component still ships its proxy). Guard cycles with a visited-set.
- **PR4 — Production SSR resolution** (`emit.ts` `loadEmittedServer` + `pages.ts`). `loadEmittedServer`
  gains a `dir` param; `instantiateServer` resolves `.abide` imports relative to `dir` (recursive temp
  modules + specifier rewrite; cache key `source+dir`). `renderLevel` threads a parallel `dirs[]`
  alongside `levels[]` (from `pageDirs` + layout-chain `layoutDirs`).
- **PR5 — Docs `Sample.abide` migration** (real target + e2e). Extract the `{#snippet Sample}`
  duplicated across 27 pages into one `packages/docs/src/ui/pages/Sample.abide` (takes `page` as a
  prop, imports `snippet`/`html` itself). Migrate incrementally, docs e2e (72/72) after each batch.

## Edge cases / deferred
Nested components + component-imports-component (transitive, cycle-guarded); `<script module>` in a
component (per-compiled-module `$module` — two pages importing one `Card.abide` share one module +
`$module`, acceptable, document it); CSS imports in a component (resolved against its dir, reuse
`resolveCssImports`); reactive prop destructuring (`props().title` at reference site — pre-existing
semantics); component importing an RPC (fold RPC-spec harvest into PR3); non-relative/package `.abide`
specifiers (defer node-resolution); eager component-scan validation manifest (defer).

## Critical files
`emitClient.ts` · `emitServer.ts` · `analyzeScope.ts` (+ `emitSetup.ts:22-29`, `runtime.ts:719-744`) ·
`clientBundle.ts` · `pages.ts` (+ `emit.ts:69-113`).
